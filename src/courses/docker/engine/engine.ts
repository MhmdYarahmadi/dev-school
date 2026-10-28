/**
 * A deterministic, in-browser simulation of the Docker CLI + daemon.
 * Output formats and error messages are calibrated against real Docker 29.7.2
 * (see tests/fixtures-docker-29.txt and tests/docker-golden.test.ts).
 */
import { CATALOG, catalogEntry, isAlpineTag, lookupCatalog, splitRef, type CatalogEntry } from './catalog';
import { checkHealth, DELETED, lookupUser, envMap, filter, hostnameOf, isDir as ctrIsDir, listDir as ctrList, mkdir as ctrMkdir, readFile as ctrRead, redisShutdown, runScript, startProcess, writeFile as ctrWrite, type Ctx, type ShellHost } from './shell';
import type { Container, EngineState, ExecResult, Image, Line, LineKind, Mount, Network, PortBinding, RestartPolicy, Volume } from './types';
import { humanDuration, humanSize, IdGen, isoZ, joinPath, normalizePath, quoteCommand, shellWords, splitShell, table, truncate } from './util';

export interface EngineOptions {
  seed?: number;
  /** Start time (ms). Defaults to 2026-10-05T13:14:00Z. */
  startTime?: number;
  /** Use the real clock (UI) instead of a manual one (tests). */
  realClock?: boolean;
  /** Host files (the learner's project), absolute paths. */
  files?: Record<string, string>;
  cwd?: string;
}

class Out {
  lines: Line[] = [];
  add(text: string, kind: LineKind = 'out') {
    for (const t of text.split('\n')) this.lines.push({ text: t, kind });
  }
  err(text: string) {
    this.add(text, 'err');
  }
}

/** Thrown by commands to stop with an error message and exit code. */
class CliError extends Error {
  constructor(public text: string, public code: number) {
    super(text);
  }
}

const RUN_USAGE = 'Usage:  docker run [OPTIONS] IMAGE [COMMAND] [ARG...]';
const USAGES: Record<string, string> = {
  run: RUN_USAGE,
  create: 'Usage:  docker create [OPTIONS] IMAGE [COMMAND] [ARG...]',
  exec: 'Usage:  docker exec [OPTIONS] CONTAINER COMMAND [ARG...]',
  ps: 'Usage:  docker ps [OPTIONS]',
  stop: 'Usage:  docker stop [OPTIONS] CONTAINER [CONTAINER...]',
  start: 'Usage:  docker start [OPTIONS] CONTAINER [CONTAINER...]',
  rm: 'Usage:  docker rm [OPTIONS] CONTAINER [CONTAINER...]',
  logs: 'Usage:  docker logs [OPTIONS] CONTAINER',
  build: 'Usage:  docker buildx build [OPTIONS] PATH | URL | -',
};

interface FlagSpec {
  names: string[];
  value: boolean;
}

interface Parsed {
  flags: Map<string, string[]>;
  pos: string[];
}

/** Docker-style flag parsing: -d, -dit, -p8080:80, --name=x, --name x. Stops at the first positional if stopAtPos. */
function parseFlags(args: string[], specs: FlagSpec[], cmd: string, stopAtPos = false): Parsed {
  const byName = new Map<string, FlagSpec>();
  for (const s of specs) for (const n of s.names) byName.set(n, s);
  const flags = new Map<string, string[]>();
  const pos: string[] = [];
  const put = (s: FlagSpec, v: string) => {
    // Store under the first long name (e.g. '--network' for '--network,--net').
    const k = s.names.find((n) => n.startsWith('--')) ?? s.names[0];
    flags.set(k, [...(flags.get(k) ?? []), v]);
  };
  const usageErr = (msg: string) =>
    new CliError(`${msg}\n\n${USAGES[cmd] ?? `Usage:  docker ${cmd} [OPTIONS]`}\n\nRun 'docker ${cmd} --help' for more information`, 125);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (stopAtPos && pos.length) {
      pos.push(a);
      continue;
    }
    if (a === '--') {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(0, eq) : a;
      const s = byName.get(name);
      if (!s) throw usageErr(`unknown flag: ${name}`);
      if (s.value) {
        const v = eq > 0 ? a.slice(eq + 1) : args[++i];
        if (v === undefined) throw usageErr(`flag needs an argument: ${name}`);
        put(s, v);
      } else put(s, eq > 0 ? a.slice(eq + 1) : 'true');
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const s = byName.get('-' + a[j]);
        if (!s) throw usageErr(`unknown shorthand flag: '${a[j]}' in ${a}`);
        if (s.value) {
          const v = j + 1 < a.length ? a.slice(j + 1).replace(/^=/, '') : args[++i];
          if (v === undefined) throw usageErr(`flag needs an argument: '${a[j]}' in ${a}`);
          put(s, v);
          break;
        }
        put(s, 'true');
      }
      continue;
    }
    pos.push(a);
  }
  return { flags, pos };
}

const f = (names: string, value = false): FlagSpec => ({ names: names.split(','), value });

const RUN_FLAGS: FlagSpec[] = [
  f('-d,--detach'), f('-i,--interactive'), f('-t,--tty'), f('--rm'), f('--name', true), f('-p,--publish', true), f('-P,--publish-all'),
  f('-v,--volume', true), f('--mount', true), f('-e,--env', true), f('--network,--net', true), f('-w,--workdir', true), f('-u,--user', true),
  f('--restart', true), f('--entrypoint', true), f('-l,--label', true), f('--health-cmd', true), f('--memory,-m', true), f('--cpus', true),
  f('--hostname,-h', true), f('--network-alias', true), f('--read-only'), f('--init'), f('--pull', true), f('--platform', true),
  f('--volumes-from', true), f('--health-interval', true), f('--health-retries', true), f('--health-timeout', true), f('--health-start-period', true),
];

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const MANIFEST_DIGEST = (id: string) => `sha256:${id}`;
const START = Date.UTC(2026, 9, 5, 13, 14, 0);

export class DockerEngine implements ShellHost {
  state: EngineState;
  ids: IdGen;
  cwd: string;
  cwdHost: string;
  /** Every command line the learner ran (for exercise checks). */
  journal: string[] = [];
  /** Names Docker made up (no --name), so checks can ignore them. */
  generatedNames: string[] = [];
  private t: number;
  private realClock: boolean;
  private offset = 0;

  constructor(opts: EngineOptions = {}) {
    this.ids = new IdGen(opts.seed ?? 1);
    this.t = opts.startTime ?? START;
    this.realClock = !!opts.realClock;
    this.cwd = opts.cwd ?? '/home/learner/myapp';
    this.cwdHost = this.cwd;
    this.state = {
      images: [],
      containers: [],
      volumes: [],
      networks: [
        this.mkNetwork('bridge', 'bridge', true, 17),
        this.mkNetwork('host', 'host', true, 0),
        this.mkNetwork('none', 'null', true, 0),
      ],
      files: { ...(opts.files ?? {}) },
      buildCache: [],
    };
  }

  // ---------------------------------------------------------------- clock

  now(): number {
    return (this.realClock ? Date.now() : this.t) + this.offset;
  }

  /** Let time pass (sleep, game ticks). Containers whose process ends will exit. */
  advance(ms: number) {
    if (this.realClock) this.offset += ms;
    else this.t += ms;
    this.reap();
  }

  get files() {
    return this.state.files;
  }

  // ---------------------------------------------------------------- lookups

  private mkNetwork(name: string, driver: Network['driver'], builtIn: boolean, subnet: number): Network {
    return { name, id: this.ids.hex(64), driver, builtIn, labels: {}, subnet, nextHost: 2, created: this.t };
  }

  findContainer(ref: string): Container | undefined {
    if (!ref) return undefined;
    return this.state.containers.find((c) => c.name === ref) ?? (ref.length >= 1 ? this.state.containers.find((c) => c.id.startsWith(ref)) : undefined);
  }

  findImage(ref: string): Image | undefined {
    const { repo, tag } = splitRef(ref);
    return this.state.images.find((i) => i.repo === repo && i.tags.includes(tag)) ?? (/^[0-9a-f]{4,64}$/.test(ref) ? this.state.images.find((i) => i.id.startsWith(ref)) : undefined);
  }

  volumeFiles(name: string): Record<string, string> | null {
    return this.state.volumes.find((v) => v.name === name)?.files ?? null;
  }

  entryFor(img: Image): CatalogEntry {
    return catalogEntry(img.origin) ?? CATALOG.alpine;
  }

  ctx(c: Container, cwd?: string): Ctx {
    const img = this.state.images.find((i) => i.id === c.imageId)!;
    const env = envMap(c.env);
    env.HOSTNAME = hostnameOf(c);
    if (!env.HOME) env.HOME = '/root';
    return { host: this, c, img, entry: this.entryFor(img), cwd: cwd ?? (c.workdir || '/'), env };
  }

  // ---------------------------------------------------------------- networking

  /** DNS as seen from inside container `from` (Docker's embedded DNS on user-defined networks). */
  resolve(from: Container, name: string): { ip: string; target: Container | null } | null {
    if (name === 'localhost' || name === '127.0.0.1') return { ip: '::1', target: from };
    if (name === hostnameOf(from)) return { ip: Object.values(from.ips)[0] ?? '127.0.0.1', target: from };
    for (const net of from.networks) {
      const n = this.state.networks.find((x) => x.name === net);
      if (!n || n.builtIn) continue; // no DNS on the default bridge
      const t = this.state.containers.find((c) => c.status === 'running' && c.networks.includes(net) && (c.name === name || c.aliases.includes(name) || hostnameOf(c) === name));
      if (t) return { ip: t.ips[net], target: t };
    }
    // Direct IP addresses.
    const byIp = this.state.containers.find((c) => c.status === 'running' && Object.values(c.ips).includes(name));
    if (byIp) {
      const shared = byIp.networks.some((n) => from.networks.includes(n));
      return { ip: name, target: shared ? byIp : null };
    }
    return null;
  }

  httpGet(target: Container, port: number, path: string, fromIp: string, hostHeader = 'localhost', client: 'curl' | 'wget' = 'curl'): { status: number; body: string } | { error: 'refused' | 'reset' | 'empty' } {
    if (target.status !== 'running' || !target.proc) return { error: 'refused' };
    const p = target.proc;
    if (p.kind !== 'server' || p.port !== port) return { error: 'refused' };
    if (p.docroot) {
      const ctx = this.ctx(target);
      const rel = path.split('?')[0];
      const file = rel.endsWith('/') ? `${p.docroot}${rel}index.html` : `${p.docroot}${rel}`;
      const body = ctrRead(ctx, file);
      const status = body === null ? 404 : 200;
      const out = body ?? `<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx/1.31.6</center>\r\n</body>\r\n</html>\r\n`;
      if (!this.quiet) target.logs.push(`${fromIp} - - [${this.accessTs()}] "GET ${path} HTTP/1.1" ${status} ${out.length} "-" "curl/8.18.0" "-"`);
      return { status, body: out };
    }
    if (p.listing) return { status: 200, body: p.listing };
    if (p.response !== undefined) {
      if (p.port === 6379 || p.port === 5432 || p.port === 3306) return { error: 'empty' };
      const ip = Object.values(target.ips)[0] ?? '172.17.0.2';
      return { status: 200, body: p.response.replace('{HOSTNAME}', hostnameOf(target)).replace('{IP}', ip).replace('{REMOTE}', fromIp).replace('{PATH}', path).replace('{HOST}', hostHeader).replace('{CLIENT}', client === 'wget' ? 'User-Agent: Wget\nConnection: close' : 'User-Agent: curl/8.18.0\nAccept: */*') };
    }
    return { error: 'empty' };
  }

  private allocIp(netName: string): string {
    const n = this.state.networks.find((x) => x.name === netName)!;
    const ip = `172.${n.subnet}.0.${n.nextHost}`;
    n.nextHost++;
    return ip;
  }

  private attach(c: Container, net: string) {
    if (!c.networks.includes(net)) c.networks.push(net);
    if (net !== 'host' && net !== 'none' && !c.ips[net]) c.ips[net] = this.allocIp(net);
  }

  // ---------------------------------------------------------------- time strings

  private accessTs(): string {
    const d = new Date(this.now());
    const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}/${mon}/${d.getUTCFullYear()}:${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
  }

  private stamp(line: string): string {
    const d = new Date(this.now());
    const p = (n: number) => String(n).padStart(2, '0');
    const ymd = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    const hms = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
    return line
      .replace('{NGINXTS}', `${ymd.replace(/-/g, '/')} ${hms}`)
      .replace('{PGTSS}', `${ymd} ${hms}`)
      .replace('{PGTS}', `${ymd} ${hms}.395`)
      .replace('{MYTS}', `${ymd}T${hms}.000000Z 0`)
      .replace('{WTS}', `${ymd.replace(/-/g, '/')} ${hms}`)
      .replace('{DATE}', `${p(d.getUTCDate())} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`)
      .replace('{TS}', String(Math.floor(d.getTime() / 1000)))
      .replace('{HMS}', hms);
  }

  // ---------------------------------------------------------------- images

  private catalogImage(entry0: CatalogEntry, tag: string): Image {
    const [disk, content] = entry0.tags[tag];
    const origin = isAlpineTag(entry0, tag) ? `${entry0.repo}@alpine` : entry0.repo;
    const entry = catalogEntry(origin) ?? entry0;
    // History sizes add up to the tag's size: the base layer stays, the others are scaled.
    let layers = entry.tagLayers?.[tag] ?? entry.layers;
    const total = layers.reduce((n, l) => n + l.size, 0);
    if (!entry.tagLayers?.[tag] && layers.length > 1 && Math.abs(total - disk) / disk > 0.05) {
      const base = Math.min(layers[0].size, disk * 0.9);
      const rest = total - layers[0].size;
      layers = layers.map((l, i) => ({ ...l, size: i === 0 ? base : rest > 0 ? Math.round(((l.size * (disk - base)) / rest) * 100) / 100 : l.size }));
    }
    return {
      id: this.ids.hex(64),
      repo: entry.repo,
      tags: [tag],
      size: disk,
      contentSize: content,
      layers,
      config: { ...entry.config, cmd: [...entry.config.cmd], entrypoint: [...entry.config.entrypoint], env: [...entry.config.env], exposed: [...entry.config.exposed] },
      files: { ...entry.files },
      created: START - 150 * 86400000,
      origin,
    };
  }

  /** `docker pull` (also used implicitly by run/create/build). Returns the image or throws. */
  pull(ref: string, out: Out, implicit: boolean, quiet = false): Image {
    const hit = lookupCatalog(ref);
    const { repo, tag } = splitRef(ref);
    const shown = `${repo}:${tag}`;
    const existing = this.findImage(shown);
    if (implicit) out.add(`Unable to find image '${shown}' locally`, 'dim');
    const lib0 = repo.includes('/') ? repo : `library/${repo}`;
    if (!hit && lookupCatalog(repo)) {
      // The repository exists but not this tag.
      const msg = `Error response from daemon: failed to resolve reference "docker.io/${lib0}:${tag}": docker.io/${lib0}:${tag}: not found`;
      if (implicit) throw new CliError(`docker: ${msg}\n\nRun 'docker run --help' for more information`, 125);
      throw new CliError(msg, 1);
    }
    if (!hit) {
      if (implicit) throw new CliError(`docker: Error response from daemon: pull access denied for ${repo}, repository does not exist or may require 'docker login'\n\nRun 'docker run --help' for more information`, 125);
      throw new CliError(`Error response from daemon: pull access denied for ${repo}, repository does not exist or may require 'docker login'`, 1);
    }
    const lib = repo.includes('/') ? repo : `library/${repo}`;
    if (!quiet && !implicit && !/:/.test(ref.replace(/^.*\//, ''))) out.add('Using default tag: latest', 'dim');
    if (existing) {
      if (!quiet) {
        out.add(`${tag}: Pulling from ${lib}`, 'dim');
        out.add(`Digest: ${MANIFEST_DIGEST(existing.id)}`, 'dim');
        out.add(`Status: Image is up to date for ${shown}`, 'ok');
        out.add(`docker.io/${lib}:${tag}`);
      }
      return existing;
    }
    // Another tag of the same catalog image with identical content shares the id (like real tags do).
    const sibling = this.state.images.find((i) => i.repo === repo && hit.entry.tags[i.tags[0]]?.[0] === hit.entry.tags[tag][0]);
    let img: Image;
    if (sibling) {
      sibling.tags.push(tag);
      img = sibling;
    } else {
      img = this.catalogImage(hit.entry, tag);
      this.state.images.push(img);
    }
    if (!quiet) {
      out.add(`${tag}: Pulling from ${lib}`, 'dim');
      for (let i = 0; i < Math.max(1, hit.entry.layers.filter((l) => l.size > 0).length); i++) out.add(`${this.ids.hex(12)}: Pull complete`, 'dim');
      out.add(`Digest: ${MANIFEST_DIGEST(img.id)}`, 'dim');
      out.add(`Status: Downloaded newer image for ${shown}`, 'ok');
      if (!implicit) out.add(`docker.io/${lib}:${tag}`);
    }
    return img;
  }

  addImage(img: Omit<Image, 'id'> & { id?: string }): Image {
    // Re-tagging: remove the tag from older images first.
    for (const t of img.tags) {
      const old = this.state.images.find((i) => i.repo === img.repo && i.tags.includes(t));
      if (old) old.tags = old.tags.filter((x) => x !== t);
    }
    // An image that lost its last tag stays, as a dangling <none> image, until it is pruned.
    const full: Image = { ...img, id: img.id ?? this.ids.hex(64) };
    this.state.images.push(full);
    return full;
  }

  // ---------------------------------------------------------------- containers: lifecycle

  /** Start (or restart) a container's main process. Returns output for attached runs. */
  private startContainer(c: Container): string[] {
    const img = this.state.images.find((i) => i.id === c.imageId)!;
    if (!c.networks.length) this.attach(c, 'bridge');
    for (const n of c.networks) this.attach(c, n);
    const ctx = this.ctx(c);
    const isDefault =
      catalogEntry(img.origin) !== undefined &&
      img.repo === img.origin.split('@')[0] &&
      JSON.stringify(c.cmd) === JSON.stringify([...img.config.entrypoint, ...img.config.cmd]);
    c.startedAt = this.now();
    c.finishedAt = null;
    c.status = 'running';
    c.exitCode = 0;
    c.oomKilled = false;
    const r = startProcess(ctx, c.cmd, isDefault);
    c.memUsage = r.memMb ?? 0.55;
    const logStart = c.logs.length;
    // Over the --memory limit: the kernel's OOM killer ends the main process (SIGKILL, exit 137, no output).
    if (c.memory && r.code === 0 && c.memUsage * 1024 * 1024 > c.memory) {
      if (r.logs && r.proc) c.logs.push(...r.logs.slice(0, 2).map((l) => this.stamp(l)));
      c.oomKilled = true;
      this.processExited(c, 137);
      if ((c.status as string) === 'restarting' && !c.loop) c.loop = { since: this.now(), base: c.restartCount, logs: c.logs.slice(logStart) };
      return [];
    }
    if (r.logs) c.logs.push(...r.logs.map((l) => this.stamp(l)));
    c.logs.push(...r.out);
    if (r.proc) {
      c.proc = r.proc;
      if (c.healthcheck) {
        c.health = checkHealth(this.ctx(c), c.healthcheck) ? 'healthy' : 'unhealthy';
        c.failingStreak = c.health === 'healthy' ? 0 : 3;
      }
      return r.out;
    }
    this.processExited(c, r.code);
    // A crash loop: each restart attempt (100 ms, 200 ms, 400 ms… up to a minute apart) repeats the same output.
    if ((c.status as string) === 'restarting' && !c.loop) c.loop = { since: this.now(), base: c.restartCount, logs: c.logs.slice(logStart) };
    return r.out;
  }

  /** The main process ended with `code`: apply the restart policy. */
  private processExited(c: Container, code: number) {
    c.proc = null;
    c.exitCode = code;
    c.finishedAt = this.now();
    c.health = undefined;
    const p = c.restart;
    const wantRestart = !c.manuallyStopped && (p === 'always' || p === 'unless-stopped' || (p === 'on-failure' && code !== 0));
    if (wantRestart) {
      if (p === 'on-failure' && c.maxRetries > 0) {
        // It keeps crashing straight away, so it uses up all its retries.
        c.restartCount = c.maxRetries;
        c.status = 'exited';
        return;
      }
      c.restartCount++;
      c.status = 'restarting';
      return;
    }
    c.status = 'exited';
    if (c.autoRemove) this.removeContainer(c, true);
  }

  private stopContainer(c: Container, signal: 'TERM' | 'KILL') {
    if (c.status !== 'running' && c.status !== 'restarting') return;
    const img = this.state.images.find((i) => i.id === c.imageId)!;
    const entry = this.entryFor(img);
    let code = 137;
    if (signal === 'TERM') {
      const p = c.proc;
      // Servers handle SIGTERM and exit 0; `sleep` and interactive shells as PID 1 ignore it → killed after the timeout.
      // Servers handle SIGTERM and exit cleanly. A Node/Python app as PID 1 has no handler, so the kernel ignores
      // the signal and Docker kills it after the timeout (137); with --init the signal reaches it (143).
      if (p?.kind === 'server') code = p.app ? (c.init ? 143 : 137) : entry.stopExit ?? 0;
      else code = 137;
      if (c.status === 'restarting') code = c.exitCode ?? 0;
      // Redis saves its data on a clean shutdown (a kill skips this).
      if (c.status === 'running') {
        const logs = redisShutdown(this.ctx(c));
        if (logs) c.logs.push(...logs.map((l) => this.stamp(l)));
      }
    }
    c.manuallyStopped = true;
    c.proc = null;
    c.loop = undefined;
    c.status = 'exited';
    c.exitCode = code;
    c.finishedAt = this.now();
    c.health = undefined;
    if (c.autoRemove) this.removeContainer(c, true);
  }

  private removeContainer(c: Container, removeAnonVolumes: boolean) {
    this.state.containers = this.state.containers.filter((x) => x !== c);
    if (removeAnonVolumes) {
      for (const m of c.mounts) {
        if (m.anonymous) this.state.volumes = this.state.volumes.filter((v) => v.name !== m.source);
      }
    }
  }

  /** Time-based transitions: `sleep N` ending, restart loops. */
  reap() {
    const now = this.now();
    for (const c of [...this.state.containers]) {
      if (c.status === 'running' && c.proc?.kind === 'timer' && c.proc.until <= now) {
        this.processExited(c, 0);
      }
      if (c.status === 'restarting' && c.loop) {
        let t = now - c.loop.since;
        let k = 0;
        for (let delay = 100; t >= delay && k < 1000; delay = Math.min(delay * 2, 60000)) {
          t -= delay;
          k++;
        }
        while (c.restartCount < c.loop.base + k) {
          c.restartCount++;
          if (c.logs.length < 400) c.logs.push(...c.loop.logs);
        }
      }
    }
  }

  // ---------------------------------------------------------------- shell entry point

  /** Runs one line typed in the terminal (host shell with docker + a few utilities). */
  exec(line: string): ExecResult {
    const out = new Out();
    // A little time passes with every command (keeps creation order and "ago" times realistic).
    if (!this.realClock) this.t += 100;
    this.reap();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return { lines: [], exitCode: 0 };
    this.journal.push(trimmed);
    const code = this.runLine(this.substitute(trimmed, out), out);
    return { lines: out.lines, exitCode: code };
  }

  /** `$(command)`: runs the inner command and splices its output in, as a shell does. */
  private substitute(line: string, out: Out): string {
    let res = '';
    let quote: string | null = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote === "'") {
        if (ch === "'") quote = null;
        res += ch;
        continue;
      }
      if (ch === "'" && !quote) quote = "'";
      else if (ch === '"') quote = quote === '"' ? null : '"';
      if (ch === '\\' && line[i + 1] === '$') {
        res += '\\$';
        i++;
        continue;
      }
      // Variables expand on the host, as in bash: unknown ones become empty.
      const v = ch === '$' ? /^(?:\{(\w+)\}|([A-Za-z_]\w*))/.exec(line.slice(i + 1)) : null;
      if (v) {
        const name = v[1] ?? v[2];
        const hostEnv: Record<string, string> = { PWD: this.cwd, HOME: '/home/learner', USER: 'learner', SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin' };
        res += hostEnv[name] ?? '';
        i += v[0].length;
        continue;
      }
      if (ch === '$' && line[i + 1] === '(') {
        let depth = 1;
        let j = i + 2;
        for (; j < line.length && depth; j++) {
          if (line[j] === '(') depth++;
          else if (line[j] === ')') depth--;
        }
        if (depth) {
          res += line.slice(i);
          break;
        }
        const inner = new Out();
        this.runLine(this.substitute(line.slice(i + 2, j - 1), out), inner);
        for (const l of inner.lines) if (l.kind === 'err') out.err(l.text);
        res += inner.lines.filter((l) => l.kind === 'out' || l.kind === 'ok').map((l) => l.text).filter(Boolean).join(quote ? '\n' : ' ');
        i = j - 1;
        continue;
      }
      res += ch;
    }
    return res;
  }

  /** Runs a command line (with |, &&, ||, ;) and returns the exit code of the last command. */
  private runLine(line: string, out: Out): number {
    let code = 0;
    let pipeIn: string[] | null = null;
    let skip = false;
    for (const seg of splitShell(line)) {
      const skipping: boolean = skip;
      if (!skipping) {
        const words = shellWords(seg.text);
        if (seg.op === '|') {
          const tmp = new Out();
          code = this.hostCommand(words, tmp, pipeIn);
          pipeIn = tmp.lines.map((l) => l.text);
        } else {
          code = this.hostCommand(words, out, pipeIn);
          pipeIn = null;
        }
      }
      // `a && b`: run b only if a succeeded; `a || b`: only if a failed; a pipeline is skipped as a whole.
      if (seg.op === '|') skip = skipping;
      else if (seg.op === '&&') skip = code !== 0;
      else if (seg.op === '||') skip = code === 0;
      else skip = false;
    }
    return code;
  }

  private hostCommand(words0: string[], out: Out, stdin: string[] | null): number {
    // stderr redirections: everything already goes to the same terminal.
    const dropErr = words0.includes('2>/dev/null');
    const words1 = words0.filter((w) => w !== '2>&1' && w !== '2>/dev/null');
    // stdout redirection: `cmd > file` / `cmd >> file` (also `>/dev/null`).
    const ri = words1.findIndex((w) => w === '>' || w === '>>' || /^>>?[^>&]/.test(w));
    if (ri >= 0 || dropErr) {
      const w = ri >= 0 ? words1[ri] : '';
      const bare = w === '>' || w === '>>';
      const target = ri < 0 ? null : bare ? words1[ri + 1] ?? '' : w.replace(/^>>?/, '');
      const rest = ri < 0 ? words1 : [...words1.slice(0, ri), ...words1.slice(ri + (bare ? 2 : 1))];
      const tmp = new Out();
      const code = this.hostCommand(rest, tmp, stdin);
      const outLines = tmp.lines.filter((l) => l.kind === 'out');
      for (const l of tmp.lines) if ((l.kind !== 'out' || target === null) && !(dropErr && l.kind === 'err')) out.lines.push(l);
      if (target && target !== '/dev/null') {
        const p = joinPath(this.cwd, target);
        this.files[p] = (w.startsWith('>>') ? this.files[p] ?? '' : '') + outLines.map((l) => l.text + '\n').join('');
      }
      return code;
    }
    const words = words1;
    if (!words.length) return 0;
    const [cmd, ...args] = words;
    const flt = filter(cmd, args, stdin ?? []);
    if (flt) {
      flt.out.forEach((l) => out.add(l));
      return flt.code;
    }
    switch (cmd) {
      case 'docker':
        return this.docker(args, out);
      case 'sleep':
        this.advance((Number(args[0]) || 0) * 1000);
        return 0;
      case 'cd': {
        const t = joinPath(this.cwd, args[0] ?? '/home/learner');
        if (!this.hostIsDir(t)) {
          out.err(`bash: cd: ${args[0]}: No such file or directory`);
          return 1;
        }
        this.cwd = t;
        this.cwdHost = t;
        return 0;
      }
      case 'pwd':
        out.add(this.cwd);
        return 0;
      case 'ls': {
        const p = joinPath(this.cwd, args.filter((a) => !a.startsWith('-'))[0] ?? '.');
        const all = args.some((a) => /^-[a-z]*a/.test(a));
        const names = this.hostList(p);
        if (!names) {
          out.err(`ls: cannot access '${args.filter((a) => !a.startsWith('-'))[0] ?? '.'}': No such file or directory`);
          return 2;
        }
        names.filter((n) => all || !n.startsWith('.')).forEach((n) => out.add(n));
        return 0;
      }
      case 'cat': {
        let code = 0;
        for (const a of args) {
          const v = this.files[joinPath(this.cwd, a)];
          if (v === undefined) {
            out.err(`cat: ${a}: No such file or directory`);
            code = 1;
          } else out.add(v.replace(/\n$/, ''));
        }
        return code;
      }
      case 'echo': {
        const gt = args.findIndex((a) => a === '>' || a === '>>');
        if (gt >= 0) {
          const p = joinPath(this.cwd, args[gt + 1] ?? '');
          const text = args.slice(0, gt).join(' ') + '\n';
          this.files[p] = (args[gt] === '>>' ? this.files[p] ?? '' : '') + text;
          return 0;
        }
        out.add(args.join(' '));
        return 0;
      }
      case 'sed': {
        // Only in-place substitution: sed -i 's/OLD/NEW/[g]' FILE…
        const expr = args.find((a) => !a.startsWith('-'));
        const m = expr ? /^s(.)(.*?)\1(.*?)\1(g?)$/.exec(expr) : null;
        const files = args.filter((a) => !a.startsWith('-') && a !== expr);
        if (!args.includes('-i') || !m || !files.length) {
          out.err("sed: the simulator only supports in-place substitution: sed -i 's/OLD/NEW/' FILE");
          return 1;
        }
        let re: RegExp;
        try {
          re = new RegExp(m[2], m[4] ? 'g' : '');
        } catch {
          out.err(`sed: -e expression #1, char ${expr!.length}: unterminated \`s' command`);
          return 1;
        }
        for (const f of files) {
          const p = joinPath(this.cwd, f);
          if (this.files[p] === undefined) {
            out.err(`sed: can't read ${f}: No such file or directory`);
            return 2;
          }
          this.files[p] = this.files[p].split('\n').map((l) => l.replace(re, m[3].replace(/\$/g, '$$$$').replace(/\\\//g, '/').replace(/\\n/g, '\n').replace(/&/g, '$$&'))).join('\n');
        }
        return 0;
      }
      case 'curl':
        return this.hostCurl(args, out);
      case 'help':
        this.help(out);
        return 0;
      case 'true':
        return 0;
      case 'false':
        return 1;
      case 'clear':
        return 0;
      default:
        out.err(`bash: ${cmd}: command not found`);
        return 127;
    }
  }

  hostIsDir(p: string): boolean {
    const d = normalizePath(p);
    if (d === '/' || d === '/home' || d === '/home/learner' || d === '/tmp' || d === normalizePath(this.cwd)) return true;
    return Object.keys(this.files).some((k) => k.startsWith(d + '/'));
  }

  hostList(p: string): string[] | null {
    const d = normalizePath(p);
    if (!this.hostIsDir(d)) return this.files[d] !== undefined ? [d.replace(/^.*\//, '')] : null;
    const names = new Set<string>();
    for (const k of Object.keys(this.files)) {
      if (!k.startsWith(d + '/')) continue;
      const rest = k.slice(d.length + 1);
      if (rest) names.add(rest.split('/')[0]);
    }
    return [...names].sort();
  }

  private quiet = false;

  /** What `curl -s localhost:PORT` would get from the host, without leaving traces (games use it to check goals). */
  probe(port: number, path = '/'): { code: number; body: string } {
    const out = new Out();
    this.quiet = true;
    try {
      const code = this.hostCurl(['-s', `localhost:${port}${path}`], out);
      return { code, body: out.lines.map((l) => l.text).join('\n') };
    } finally {
      this.quiet = false;
    }
  }

  private hostCurl(args: string[], out: Out): number {
    const silent = args.some((a) => /^-[a-zA-Z]*s/.test(a));
    const url = args.filter((a) => !a.startsWith('-')).pop() ?? '';
    const m = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
    if (!m) {
      if (!silent) out.err('curl: (3) URL rejected: Malformed input to a URL function');
      return 3;
    }
    const host = m[1];
    const port = Number(m[2] ?? 80);
    const path = m[3] ?? '/';
    if (!['localhost', '127.0.0.1', '0.0.0.0'].includes(host)) {
      if (!silent) out.err(`curl: (6) Could not resolve host: ${host}`);
      return 6;
    }
    // --network host: the container's own ports are the host's ports.
    const hostNet = this.state.containers.find((x) => x.status === 'running' && x.networks.includes('host') && x.proc?.kind === 'server' && x.proc.port === port);
    if (hostNet) {
      const r = this.httpGet(hostNet, port, path, '127.0.0.1', port === 80 ? host : `${host}:${port}`);
      if ('error' in r) {
        if (!silent) out.err('curl: (52) Empty reply from server');
        return 52;
      }
      out.add(r.body.replace(/\n$/, ''));
      return 0;
    }
    const c = this.state.containers.find((x) => x.status === 'running' && x.ports.some((p) => p.hostPort === port));
    if (!c) {
      if (!silent) out.err(`curl: (7) Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server`);
      return 7;
    }
    const b = c.ports.find((p) => p.hostPort === port)!;
    const r = this.httpGet(c, b.containerPort, path, '172.17.0.1', port === 80 ? host : `${host}:${port}`);
    if ('error' in r) {
      if (!silent) out.err(r.error === 'empty' ? 'curl: (52) Empty reply from server' : 'curl: (56) Recv failure: Connection reset by peer');
      return r.error === 'empty' ? 52 : 56;
    }
    out.add(r.body.replace(/\n$/, ''));
    return 0;
  }

  private help(out: Out) {
    out.add('This simulated terminal understands:', 'info');
    out.add('  docker run | create | start | stop | restart | kill | rm | ps | logs | exec | inspect | port', 'dim');
    out.add('  docker pull | images | rmi | tag | build | history | stats | update | cp', 'dim');
    out.add('  docker volume … | network … | container/image/system prune | system df', 'dim');
    out.add('  docker compose up/down/ps/logs/exec/build/config/stop/start/restart', 'dim');
    out.add("  plus: ls, cat, cd, pwd, echo (> file), sed -i 's/old/new/' FILE, curl, sleep N (lets time pass), clear", 'dim');
    out.add('  and pipes to head, tail, grep, wc -l', 'dim');
  }

  // ---------------------------------------------------------------- docker CLI

  docker(args: string[], out: Out): number {
    try {
      return this.dockerCmd(args, out);
    } catch (e) {
      if (e instanceof CliError) {
        out.err(e.text);
        return e.code;
      }
      throw e;
    }
  }

  private dockerCmd(args: string[], out: Out): number {
    const [sub, ...rest] = args;
    switch (sub) {
      case undefined:
      case 'help':
      case '--help':
        this.help(out);
        return 0;
      case 'version':
        if (rest.includes('--format')) out.add('29.7.2');
        else out.add('Client: Docker Engine - Community\n Version:           29.7.2\n\nServer: Docker Engine - Community\n Engine:\n  Version:          29.7.2');
        return 0;
      case '--version':
      case '-v':
        out.add('Docker version 29.7.2, build a7dcaa6');
        return 0;
      case 'run':
        return this.cmdRun(rest, out, false);
      case 'create':
        return this.cmdRun(rest, out, true);
      case 'ps':
        return this.cmdPs(rest, out);
      case 'start':
        return this.cmdStart(rest, out);
      case 'stop':
        return this.cmdStop(rest, out, 'TERM');
      case 'kill':
        return this.cmdStop(rest, out, 'KILL');
      case 'restart':
        return this.cmdRestart(rest, out);
      case 'rm':
        return this.cmdRm(rest, out);
      case 'logs':
        return this.cmdLogs(rest, out);
      case 'exec':
        return this.cmdExec(rest, out);
      case 'inspect':
        return this.cmdInspect(rest, out);
      case 'port':
        return this.cmdPort(rest, out);
      case 'cp':
        return this.cmdCp(rest, out);
      case 'pull': {
        const p = parseFlags(rest, [f('-q,--quiet'), f('-a,--all-tags')], 'pull');
        if (!p.pos[0]) throw new CliError(`"docker pull" requires exactly 1 argument.\nSee 'docker pull --help'.\n\nUsage:  docker pull [OPTIONS] NAME[:TAG|@DIGEST]\n\nPull an image or a repository from a registry`, 1);
        this.validateRef(p.pos[0], false);
        this.pull(p.pos[0], out, false);
        return 0;
      }
      case 'images':
        return this.cmdImages(rest, out);
      case 'image':
        return this.cmdImageGroup(rest, out);
      case 'rmi':
        return this.cmdRmi(rest, out);
      case 'tag':
        return this.cmdTag(rest, out);
      case 'history':
        return this.cmdHistory(rest, out);
      case 'build':
        return this.cmdBuild(rest, out);
      case 'buildx':
        if (rest[0] === 'build') return this.cmdBuild(rest.slice(1), out);
        break;
      case 'volume':
        return this.cmdVolume(rest, out);
      case 'network':
        return this.cmdNetwork(rest, out);
      case 'container':
        return this.cmdContainerGroup(rest, out);
      case 'update':
        return this.cmdUpdate(rest, out);
      case 'stats':
        return this.cmdStats(rest, out);
      case 'system':
        return this.cmdSystem(rest, out);
      case 'compose':
        return this.cmdCompose(rest, out);
    }
    throw new CliError(`docker: unknown command: docker ${sub}\n\nRun 'docker --help' for more information`, 1);
  }

  private validateRef(ref: string, inRun: boolean) {
    const { repo } = splitRef(ref);
    const pre = inRun ? 'docker: ' : '';
    const post = inRun ? '\n\nRun \'docker run --help\' for more information' : '';
    if (/[A-Z]/.test(repo)) throw new CliError(`${pre}invalid reference format: repository name (${repo.includes('/') ? repo : `library/${repo}`}) must be lowercase${post}`, inRun ? 125 : 1);
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[\w][\w.-]{0,127})?$/.test(ref.replace(/^docker\.io\//, '')))
      throw new CliError(`${pre}invalid reference format${post}`, inRun ? 125 : 1);
  }

  private parsePort(spec: string, inRun: boolean): PortBinding[] {
    const [main, proto = 'tcp'] = spec.split('/');
    const parts = main.split(':');
    let hostIp = '0.0.0.0';
    let host: string;
    let ctr: string;
    if (parts.length === 3) [hostIp, host, ctr] = parts;
    else if (parts.length === 2) [host, ctr] = parts;
    else {
      host = '';
      ctr = parts[0];
    }
    const pre = inRun ? 'docker: ' : '';
    const post = inRun ? "\n\nRun 'docker run --help' for more information" : '';
    if (host && (!/^\d+$/.test(host) || Number(host) > 65535 || Number(host) < 1)) throw new CliError(`${pre}invalid hostPort: ${host}${post}`, 125);
    if (!/^\d+$/.test(ctr) || Number(ctr) > 65535) throw new CliError(`${pre}invalid containerPort: ${ctr}${post}`, 125);
    return [{ hostIp, hostPort: host ? Number(host) : this.randomPort(), containerPort: Number(ctr), proto: proto as 'tcp' | 'udp' }];
  }

  private randomPort(): number {
    let p = 32768;
    while (this.state.containers.some((c) => c.ports.some((b) => b.hostPort === p))) p++;
    return p;
  }

  private parseMount(spec: string, isMountFlag: boolean): Mount {
    if (isMountFlag) {
      const kv = Object.fromEntries(spec.split(',').map((x) => {
        const i = x.indexOf('=');
        return i < 0 ? [x, 'true'] : [x.slice(0, i), x.slice(i + 1)];
      }));
      const type = kv.type === 'bind' ? 'bind' : 'volume';
      let source = kv.source ?? kv.src ?? '';
      if (type === 'bind') {
        source = this.hostAbs(source);
        if (!this.hostIsDir(source) && this.files[source] === undefined) throw new CliError(`docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: ${source}\n\nRun 'docker run --help' for more information`, 125);
      }
      return { type, source, target: kv.target ?? kv.destination ?? kv.dst ?? '', readOnly: kv.readonly === 'true' || kv.ro === 'true' };
    }
    const parts = spec.split(':');
    if (parts.length === 1) return { type: 'volume', source: this.ids.hex(64), target: parts[0], readOnly: false, anonymous: true };
    const [src, dst, mode] = parts;
    const bind = src.startsWith('/') || src.startsWith('.') || src.startsWith('~');
    if (!bind) return { type: 'volume', source: src, target: dst, readOnly: (mode ?? '').split(',').includes('ro') };
    // The CLI makes the path absolute; with -v, a missing host folder is created (empty).
    const source = this.hostAbs(src);
    if (!this.hostIsDir(source) && this.files[source] === undefined) this.files[source + '/'] = '';
    return { type: 'bind', source, target: dst, readOnly: (mode ?? '').split(',').includes('ro') };
  }

  private hostAbs(p: string): string {
    return joinPath(this.cwdHost, p.replace(/^~(?=\/|$)/, '/home/learner'));
  }

  /** Shared by `docker run`, `docker create` and compose. */
  createContainer(o: {
    image: Image;
    imageRef: string;
    name?: string;
    cmd?: string[];
    entrypoint?: string[];
    ports?: PortBinding[];
    publishAll?: boolean;
    mounts?: Mount[];
    env?: string[];
    networks?: string[];
    workdir?: string;
    user?: string;
    restart?: string;
    autoRemove?: boolean;
    tty?: boolean;
    interactive?: boolean;
    labels?: Record<string, string>;
    healthcheck?: string;
    aliases?: string[];
    memory?: number;
    nanoCpus?: number;
    init?: boolean;
  }): Container {
    const img = o.image;
    const ep = o.entrypoint ?? img.config.entrypoint;
    const cmd = o.cmd && o.cmd.length ? o.cmd : o.entrypoint ? [] : img.config.cmd;
    const [policy, max] = (o.restart ?? 'no').split(':');
    const ports = [...(o.ports ?? [])];
    if (o.publishAll) for (const p of img.config.exposed) ports.push({ hostIp: '0.0.0.0', hostPort: this.randomPort() + ports.length, containerPort: p, proto: 'tcp' });
    const c: Container = {
      id: this.ids.hex(64),
      name: o.name ?? this.randomName(),
      autoNamed: o.name === undefined,
      image: o.imageRef,
      imageId: img.id,
      cmd: [...ep, ...cmd],
      status: 'created',
      exitCode: 0,
      ports,
      mounts: o.mounts ?? [],
      networks: [],
      ips: {},
      aliases: o.aliases ?? [],
      env: [...img.config.env, ...(o.env ?? []).map((e) => (e.includes('=') ? e : `${e}=`))],
      workdir: o.workdir ?? img.config.workdir,
      user: o.user ?? img.config.user,
      restart: (['no', 'always', 'unless-stopped', 'on-failure'].includes(policy) ? policy : 'no') as RestartPolicy,
      maxRetries: Number(max ?? 0) || 0,
      restartCount: 0,
      healthcheck: o.healthcheck ?? img.config.healthcheck,
      memory: o.memory ?? 0,
      nanoCpus: o.nanoCpus ?? 0,
      init: !!o.init,
      autoRemove: !!o.autoRemove,
      tty: !!o.tty,
      interactive: !!o.interactive,
      created: this.now(),
      startedAt: null,
      finishedAt: null,
      rootfs: {},
      logs: [],
      labels: o.labels ?? {},
      manuallyStopped: false,
      proc: null,
    };
    for (const path of o.image.config.volumes ?? []) {
      if (!c.mounts.some((m) => normalizePath(m.target) === normalizePath(path))) c.mounts.push({ type: 'volume', source: this.ids.hex(64), target: path, readOnly: false, anonymous: true });
    }
    for (const m of c.mounts) {
      if (m.type !== 'volume') continue;
      let vol = this.state.volumes.find((v) => v.name === m.source);
      if (!vol) {
        vol = { name: m.source, files: {}, created: this.now(), labels: {} };
        this.state.volumes.push(vol);
      }
      // An empty volume is first filled with what the image has at that path (Docker's copy-up).
      if (!Object.values(vol.files).some((v) => v !== DELETED)) {
        const t = normalizePath(m.target).replace(/\/$/, '');
        for (const [k, v] of Object.entries(img.files)) if (k.startsWith(t + '/') && k.length > t.length + 1) vol.files[k.slice(t.length)] = v;
      }
    }
    if (c.workdir) c.rootfs[c.workdir.replace(/\/?$/, '/')] = '';
    // Later env entries override earlier ones (user -e beats image ENV).
    const seen = new Map<string, string>();
    for (const e of c.env) seen.set(e.split('=')[0], e);
    c.env = [...seen.values()];
    for (const n of o.networks ?? []) c.networks.push(n);
    this.state.containers.unshift(c);
    return c;
  }

  private randomName(): string {
    const adj = ['brave', 'happy', 'jolly', 'loving', 'nice', 'sharp', 'silent', 'tiny', 'eager', 'zen', 'vibrant', 'quirky'];
    const sci = ['albattani', 'bardeen', 'bohr', 'curie', 'darwin', 'einstein', 'fermi', 'galileo', 'hypatia', 'lovelace', 'newton', 'tesla', 'turing'];
    for (;;) {
      const n = `${adj[parseInt(this.ids.hex(2), 16) % adj.length]}_${sci[parseInt(this.ids.hex(2), 16) % sci.length]}`;
      if (!this.state.containers.some((c) => c.name === n)) {
        this.generatedNames.push(n);
        return n;
      }
    }
  }

  private cmdRun(args: string[], out: Out, createOnly: boolean): number {
    const cmdName = createOnly ? 'create' : 'run';
    const p = parseFlags(args, RUN_FLAGS, cmdName, true);
    const F = (k: string) => p.flags.get(k);
    const has = (k: string) => !!F(k);
    const [ref, ...cmd] = p.pos;
    if (!ref) throw new CliError(`docker: 'docker ${cmdName}' requires at least 1 argument\n\n${USAGES[cmdName]}\n\nSee 'docker ${cmdName} --help' for more information`, 1);
    this.validateRef(ref, true);
    const ports = (F('--publish') ?? []).flatMap((s) => this.parsePort(s, true));
    const name = F('--name')?.slice(-1)[0];
    if (name !== undefined && !NAME_RE.test(name)) throw new CliError(`docker: Error response from daemon: Invalid container name (${name}), only [a-zA-Z0-9][a-zA-Z0-9_.-] are allowed\n\nRun 'docker run --help' for more information`, 125);
    let img = this.findImage(ref);
    if (!img) img = this.pull(ref, out, true);
    if (name !== undefined) {
      const clash = this.state.containers.find((c) => c.name === name);
      if (clash) throw new CliError(`docker: Error response from daemon: Conflict. The container name "/${name}" is already in use by container "${clash.id}". You have to remove (or rename) that container to be able to reuse that name.\n\nRun 'docker run --help' for more information`, 125);
    }
    const restart = F('--restart')?.slice(-1)[0];
    if (restart && !/^(no|always|unless-stopped|on-failure(:\d+)?)$/.test(restart)) throw new CliError(`docker: invalid restart policy format: ${restart}\n\nRun 'docker run --help' for more information`, 125);
    const labels: Record<string, string> = {};
    for (const l of F('--label') ?? []) {
      const i = l.indexOf('=');
      labels[i < 0 ? l : l.slice(0, i)] = i < 0 ? '' : l.slice(i + 1);
    }
    // --volumes-from NAME[:ro]: the same mounts as another container (never removed with this one).
    const volumesFrom = (F('--volumes-from') ?? []).flatMap((spec) => {
      const [src, mode] = spec.split(':');
      const from = this.findContainer(src);
      if (!from) throw new CliError(`docker: Error response from daemon: No such container: ${src}\n\nRun 'docker ${cmdName} --help' for more information`, 125);
      return from.mounts.map((m) => ({ ...m, anonymous: false, readOnly: mode === 'ro' || m.readOnly }));
    });
    const memSpec = F('--memory')?.slice(-1)[0];
    const memory = memSpec === undefined ? 0 : parseBytes(memSpec);
    if (Number.isNaN(memory)) throw new CliError(`invalid argument "${memSpec}" for "-m, --memory" flag: invalid size: '${memSpec}'\n\nUsage:  docker ${cmdName} [OPTIONS] IMAGE [COMMAND] [ARG...]\n\nRun 'docker ${cmdName} --help' for more information`, 125);
    if (memory && memory < 6 * 1024 * 1024) throw new CliError(`docker: Error response from daemon: Minimum memory limit allowed is 6MB\n\nRun 'docker ${cmdName} --help' for more information`, 125);
    const cpuSpec = F('--cpus')?.slice(-1)[0];
    const nanoCpus = cpuSpec === undefined ? 0 : Math.round(Number(cpuSpec) * 1e9);
    if (Number.isNaN(nanoCpus)) throw new CliError(`invalid argument "${cpuSpec}" for "--cpus" flag: failed to parse ${cpuSpec} as a rational number\n\nUsage:  docker ${cmdName} [OPTIONS] IMAGE [COMMAND] [ARG...]\n\nRun 'docker ${cmdName} --help' for more information`, 125);
    const net = F('--network')?.slice(-1)[0];
    if (net === 'host' && ports.length) {
      out.err('WARNING: Published ports are discarded when using host network mode');
      ports.length = 0;
    }
    const c = this.createContainer({
      image: img,
      imageRef: ref,
      name,
      cmd,
      entrypoint: F('--entrypoint') ? shellWords(F('--entrypoint')!.slice(-1)[0]) : undefined,
      ports,
      publishAll: has('--publish-all'),
      mounts: [...(F('--volume') ?? []).map((v) => this.parseMount(v, false)), ...(F('--mount') ?? []).map((v) => this.parseMount(v, true)), ...volumesFrom],
      env: F('--env') ?? [],
      networks: net ? [net] : [],
      workdir: F('--workdir')?.slice(-1)[0],
      user: F('--user')?.slice(-1)[0],
      restart,
      autoRemove: has('--rm'),
      tty: has('--tty'),
      interactive: has('--interactive'),
      labels,
      healthcheck: F('--health-cmd')?.slice(-1)[0],
      aliases: F('--network-alias') ?? [],
      memory,
      nanoCpus,
      init: has('--init'),
    });
    const detach = has('--detach');
    if (createOnly) {
      out.add(c.id);
      return 0;
    }
    c.attached = !detach;
    return this.runStart(c, detach, out, true);
  }

  /** Start a created container the way `docker run` does (network + port checks first). */
  private runStart(c: Container, detach: boolean, out: Out, fromRun: boolean): number {
    const pre = fromRun ? 'docker: ' : '';
    const post = fromRun ? "\n\nRun 'docker run --help' for more information" : '';
    const net = c.networks.find((name) => !this.state.networks.some((n) => n.name === name));
    if (net) {
      if (detach) out.add(c.id);
      throw new CliError(`${pre}Error response from daemon: failed to set up container networking: network ${net} not found${post}`, fromRun ? 125 : 1);
    }
    for (const b of c.ports) {
      const clash = this.state.containers.find((x) => x !== c && x.status === 'running' && x.ports.some((y) => y.hostPort === b.hostPort && y.proto === b.proto && (y.hostIp === b.hostIp || y.hostIp === '0.0.0.0' || b.hostIp === '0.0.0.0')));
      if (clash) {
        if (detach) out.add(c.id);
        throw new CliError(`${pre}Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint ${c.name} (${this.ids.hex(64)}): Bind for ${b.hostIp}:${b.hostPort} failed: port is already allocated${post}`, fromRun ? 125 : 1);
      }
    }
    if (c.user && !lookupUser(this.ctx(c), c.user)) {
      if (detach) out.add(c.id);
      throw new CliError(`${pre}Error response from daemon: unable to find user ${c.user.split(':')[0]}: no matching entries in passwd file${post}`, fromRun ? 125 : 1);
    }
    const prog = c.cmd.filter((x) => !/(^|\/)docker-entrypoint\.sh$/.test(x))[0];
    const outLines = this.startContainer(c);
    if (c.status === 'exited' && c.exitCode === 126 && prog && !outLines.length) {
      c.status = 'created';
      c.finishedAt = null;
      if (detach) out.add(c.id);
      throw new CliError(`${pre}Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: exec: "${prog}": permission denied: unknown${post}`, fromRun ? 126 : 1);
    }
    if (c.status === 'exited' && c.exitCode === 127 && prog && !outLines.length && !c.logs.length) {
      // The program doesn't exist in the image: Docker fails at start and leaves the container "Created".
      c.status = 'created';
      c.finishedAt = null;
      if (detach) out.add(c.id);
      throw new CliError(`${pre}Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: exec: "${prog}": executable file not found in $PATH: unknown${post}`, fromRun ? 127 : 1);
    }
    if (detach) {
      out.add(c.id);
      return 0;
    }
    // Attached: show what the process printed.
    for (const l of c.logs) out.add(l);
    if (c.status === 'running') {
      out.add(`(attached to ${c.name}: in real Docker this keeps running in the foreground until you press Ctrl+C. The simulator gives you the prompt back; use "docker stop ${c.name}" to stop it.)`, 'dim');
      return 0;
    }
    const code = c.exitCode ?? 0;
    return code;
  }

  private statusText(c: Container): string {
    const now = this.now();
    switch (c.status) {
      case 'created':
        return 'Created';
      case 'running': {
        let s = `Up ${humanDuration(now - (c.startedAt ?? now))}`;
        if (c.health) s += now - (c.startedAt ?? now) < 1000 ? ' (health: starting)' : ` (${c.health})`;
        return s;
      }
      case 'restarting':
        return `Restarting (${c.exitCode ?? 0}) ${humanDuration(now - (c.finishedAt ?? now))} ago`;
      default:
        return `Exited (${c.exitCode ?? 0}) ${humanDuration(now - (c.finishedAt ?? now))} ago`;
    }
  }

  portsText(c: Container): string {
    if (c.status !== 'running' || c.networks.includes('host')) return '';
    const img = this.state.images.find((i) => i.id === c.imageId);
    const parts: string[] = [];
    const published = new Set<number>();
    for (const b of c.ports) {
      published.add(b.containerPort);
      if (b.hostIp === '0.0.0.0') parts.push(`0.0.0.0:${b.hostPort}->${b.containerPort}/${b.proto}`, `[::]:${b.hostPort}->${b.containerPort}/${b.proto}`);
      else parts.push(`${b.hostIp}:${b.hostPort}->${b.containerPort}/${b.proto}`);
    }
    for (const e of img?.config.exposed ?? []) if (!published.has(e)) parts.push(`${e}/tcp`);
    return parts.join(', ');
  }

  commandText(c: Container): string {
    return c.cmd.map((w) => (/\s/.test(w) ? `'${w}'` : w)).join(' ');
  }

  private matchFilters(c: Container, filters: string[]): boolean {
    for (const fl of filters) {
      const i = fl.indexOf('=');
      const k = fl.slice(0, i);
      const v = fl.slice(i + 1);
      if (k === 'name') {
        let re: RegExp;
        try {
          re = new RegExp(v);
        } catch {
          re = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
        if (!re.test(c.name)) return false;
      } else if (k === 'label') {
        const j = v.indexOf('=');
        const lk = j < 0 ? v : v.slice(0, j);
        if (!(lk in c.labels)) return false;
        if (j >= 0 && c.labels[lk] !== v.slice(j + 1)) return false;
      } else if (k === 'status') {
        const st = c.status === 'exited' ? 'exited' : c.status;
        if (st !== v) return false;
      } else if (k === 'ancestor') {
        if (c.image !== v && !c.image.startsWith(v + ':')) return false;
      } else if (k === 'network') {
        if (!c.networks.includes(v)) return false;
      }
    }
    return true;
  }

  private cmdPs(args: string[], out: Out): number {
    const p = parseFlags(args, [f('-a,--all'), f('-q,--quiet'), f('-f,--filter', true), f('--format', true), f('--no-trunc'), f('-n,--last', true), f('-l,--latest')], 'ps');
    let list = this.state.containers.filter((c) => p.flags.has('--all') || c.status === 'running' || c.status === 'restarting');
    list = list.filter((c) => this.matchFilters(c, p.flags.get('--filter') ?? []));
    if (p.flags.has('--quiet')) {
      list.forEach((c) => out.add(c.id.slice(0, 12)));
      return 0;
    }
    const fmt = p.flags.get('--format')?.slice(-1)[0];
    if (fmt) {
      for (const c of list) out.add(this.template(fmt, this.psRow(c)));
      return 0;
    }
    const rows = list.map((c) => {
      const r = this.psRow(c);
      return [r.ID, r.Image, r.Command, r.CreatedAt, r.Status, r.Ports, r.Names];
    });
    table(['CONTAINER ID', 'IMAGE', 'COMMAND', 'CREATED', 'STATUS', 'PORTS', 'NAMES'], rows).forEach((l) => out.add(l));
    return 0;
  }

  private psRow(c: Container): Record<string, string> {
    const created = humanDuration(this.now() - c.created);
    return {
      ID: c.id.slice(0, 12),
      Image: c.image,
      Command: quoteCommand(this.commandText(c)),
      CreatedAt: `${created} ago`,
      RunningFor: `${created} ago`,
      Status: this.statusText(c),
      State: c.status,
      Ports: this.portsText(c),
      Names: c.name,
      Labels: Object.entries(c.labels).map(([k, v]) => `${k}=${v}`).join(','),
      Networks: c.networks.join(','),
      Mounts: c.mounts.map((m) => m.source).join(','),
    };
  }

  /** Go-template subset: {{.Field}}, {{.A.B}}, {{.}}, {{json .X}}, {{index .X "k"}}, {{range .X}}…{{end}}. */
  template(fmt: string, data: unknown): string {
    if (fmt === 'json') return JSON.stringify(data);
    return renderTemplate(fmt.replace(/\\t/g, '\t').replace(/\\n/g, '\n'), data);
  }

  private cmdStart(args: string[], out: Out): number {
    const p = parseFlags(args, [f('-a,--attach'), f('-i,--interactive')], 'start');
    let code = 0;
    for (const ref of p.pos) {
      const c = this.findContainer(ref);
      if (!c) {
        out.err(`Error response from daemon: No such container: ${ref}`);
        code = 1;
        continue;
      }
      if (c.status === 'running') {
        out.add(ref);
        continue;
      }
      c.manuallyStopped = false;
      c.loop = undefined;
      try {
        const sink = new Out();
        const before = c.logs.length;
        this.runStart(c, true, sink, false);
        if (!p.flags.has('--attach')) out.add(ref);
        else {
          // Attached: the new output streams to the terminal; the exit code is the container's.
          for (const l of c.logs.slice(before)) out.add(l);
          if ((c.status as string) === 'running') out.add(`(attached to ${c.name}: in real Docker this keeps running in the foreground until you press Ctrl+C. The simulator gives you the prompt back.)`, 'dim');
          else code = c.exitCode ?? 0;
        }
      } catch (e) {
        if (!(e instanceof CliError)) throw e;
        out.err(e.text.replace(/^Error response from daemon: /, 'Error response from daemon: '));
        out.err(`Error: failed to start containers: ${ref}`);
        code = 1;
      }
    }
    return code;
  }

  /** docker cp CONTAINER:SRC DEST  |  docker cp SRC CONTAINER:DEST (works on stopped containers too). */
  private cmdCp(args: string[], out: Out): number {
    const p = parseFlags(args, [f('-a,--archive'), f('-L,--follow-link'), f('-q,--quiet')], 'cp');
    const [src, dst] = p.pos;
    if (!src || !dst) throw new CliError(`docker: 'docker cp' requires 2 arguments\n\nUsage:  docker cp [OPTIONS] CONTAINER:SRC_PATH DEST_PATH|-\n\tdocker cp [OPTIONS] SRC_PATH|- CONTAINER:DEST_PATH\n\nCopy files/folders between a container and the local filesystem`, 1);
    const split = (x: string) => {
      const m = /^([a-zA-Z0-9][\w.-]*):(.*)$/.exec(x);
      return m ? { ctr: m[1], path: m[2] || '/' } : null;
    };
    const a = split(src);
    const b = split(dst);
    if (a && b) throw new CliError('copying between containers is not supported', 1);
    if (!a && !b) throw new CliError('must specify at least one container source', 1);
    const name = (a ?? b)!.ctr;
    const c = this.findContainer(name);
    if (!c) throw new CliError(`Error response from daemon: No such container: ${name}`, 1);
    const ctx = this.ctx(c, '/');
    const files: Record<string, string> = {}; // relative path ('' = the item itself) → content; 'x/' = directory
    const base = (x: string) => normalizePath(x).replace(/^.*\//, '') || '/';
    if (a) {
      const v = ctrRead(ctx, a.path);
      if (v !== null) files[''] = v;
      else if (ctrIsDir(ctx, a.path)) {
        const walk = (dir: string, rel: string) => {
          files[rel ? rel + '/' : ''] = files[rel ? rel + '/' : ''] ?? '';
          for (const n of ctrList(ctx, dir) ?? []) {
            if (n.endsWith('/')) walk(`${dir}/${n.slice(0, -1)}`, rel ? `${rel}/${n.slice(0, -1)}` : n.slice(0, -1));
            else files[rel ? `${rel}/${n}` : n] = ctrRead(ctx, `${dir}/${n}`) ?? '';
          }
        };
        walk(normalizePath(a.path), '');
      } else throw new CliError(`Error response from daemon: Could not find the file ${a.path} in container ${name}`, 1);
      const d = joinPath(this.cwd, dst);
      const target = this.hostIsDir(d) || dst.endsWith('/') ? `${d}/${base(a.path)}` : d;
      for (const [rel, v] of Object.entries(files)) {
        if (rel === '' && v === '' && files[''] === undefined) continue;
        if (rel.endsWith('/') || rel === '') {
          if (rel === '' && Object.keys(files).length === 1 && ctrRead(ctx, a.path) !== null) this.files[target] = v;
          else if (!Object.keys(this.files).some((k) => k.startsWith(`${target}/${rel}`))) this.files[`${target}/${rel}`.replace(/\/+$/, '/')] = '';
        } else this.files[`${target}/${rel}`] = v;
      }
    } else {
      const sAbs = joinPath(this.cwd, src);
      if (this.files[sAbs] !== undefined) files[''] = this.files[sAbs];
      else if (this.hostIsDir(sAbs)) {
        for (const [k, v] of Object.entries(this.files)) if (k.startsWith(sAbs + '/') && !k.endsWith('/')) files[k.slice(sAbs.length + 1)] = v;
      } else throw new CliError(`lstat ${sAbs}: no such file or directory`, 1);
      const intoDir = ctrIsDir(ctx, b!.path);
      const target = intoDir ? `${normalizePath(b!.path).replace(/\/$/, '')}/${base(src)}` : normalizePath(b!.path);
      const ensure = (path: string) => {
        let cur = '';
        for (const part of path.split('/').filter(Boolean)) {
          cur += '/' + part;
          if (!ctrIsDir(ctx, cur)) ctrMkdir(ctx, cur);
        }
      };
      for (const [rel, v] of Object.entries(files)) {
        const to = rel ? `${target}/${rel}` : target;
        ensure(to.replace(/\/[^/]*$/, ''));
        const err = ctrWrite(ctx, to, v);
        if (err) throw new CliError(`Error response from daemon: ${err === 'Read-only file system' ? `mounted volume is marked read-only` : err}`, 1);
      }
      if (!Object.keys(files).length) ensure(target);
    }
    const bytes = Object.values(files).reduce((n, v) => n + 512 + Math.ceil(v.length / 512) * 512, 1024);
    const size = bytes < 1000 ? `${bytes}B` : bytes < 1e6 ? `${(bytes / 1000).toPrecision(3)}kB` : `${(bytes / 1e6).toPrecision(3)}MB`;
    if (!p.flags.has('--quiet')) out.add(`Successfully copied ${size} to ${a ? (dst.startsWith('/') ? dst : `${this.cwd}/${dst}`) : dst}`);
    return 0;
  }

  private cmdStop(args: string[], out: Out, sig: 'TERM' | 'KILL'): number {
    const p = parseFlags(args, [f('-t,--time,--timeout', true), f('-s,--signal', true)], sig === 'TERM' ? 'stop' : 'kill');
    if (!p.pos.length) throw new CliError(`docker: '${sig === 'TERM' ? 'stop' : 'kill'}' requires at least 1 argument`, 1);
    let code = 0;
    for (const ref of p.pos) {
      const c = this.findContainer(ref);
      if (!c) {
        out.err(`Error response from daemon: No such container: ${ref}`);
        code = 1;
        continue;
      }
      if (sig === 'KILL' && c.status !== 'running') {
        out.err(`Error response from daemon: cannot kill container: ${ref}: container ${c.id} is not running`);
        code = 1;
        continue;
      }
      this.stopContainer(c, sig);
      out.add(ref);
    }
    return code;
  }

  private cmdRestart(args: string[], out: Out): number {
    const p = parseFlags(args, [f('-t,--time,--timeout', true)], 'restart');
    let code = 0;
    for (const ref of p.pos) {
      const c = this.findContainer(ref);
      if (!c) {
        out.err(`Error response from daemon: No such container: ${ref}`);
        code = 1;
        continue;
      }
      this.stopContainer(c, 'TERM');
      if (!this.state.containers.includes(c)) {
        out.add(ref);
        continue;
      }
      c.manuallyStopped = false;
      c.loop = undefined;
      this.startContainer(c);
      out.add(ref);
    }
    return code;
  }

  private cmdRm(args: string[], out: Out): number {
    const p = parseFlags(args, [f('-f,--force'), f('-v,--volumes'), f('-l,--link')], 'rm');
    if (!p.pos.length) throw new CliError(`docker: 'docker rm' requires at least 1 argument\n\n${USAGES.rm}\n\nSee 'docker rm --help' for more information`, 1);
    let code = 0;
    for (const ref of p.pos) {
      const c = this.findContainer(ref);
      if (!c) {
        out.err(`Error response from daemon: No such container: ${ref}`);
        code = 1;
        continue;
      }
      if ((c.status === 'running' || c.status === 'restarting') && !p.flags.has('--force')) {
        out.err(`Error response from daemon: cannot remove container "${ref}": container is running: stop the container before removing or force remove`);
        code = 1;
        continue;
      }
      if (c.status === 'running') this.stopContainer(c, 'KILL');
      this.removeContainer(c, p.flags.has('--volumes'));
      out.add(ref);
    }
    return code;
  }

  private cmdLogs(args: string[], out: Out): number {
    const p = parseFlags(args, [f('-f,--follow'), f('-n,--tail', true), f('-t,--timestamps'), f('--since', true)], 'logs');
    const ref = p.pos[0];
    if (!ref) throw new CliError(`docker: 'docker logs' requires exactly 1 argument\n\n${USAGES.logs}\n\nSee 'docker logs --help' for more information`, 1);
    const c = this.findContainer(ref);
    if (!c) throw new CliError(`Error response from daemon: No such container: ${ref}`, 1);
    let lines = [...c.logs];
    const tail = p.flags.get('--tail')?.slice(-1)[0];
    if (tail && tail !== 'all') lines = lines.slice(Math.max(0, lines.length - Number(tail)));
    const ts = p.flags.has('--timestamps') ? `${isoZ(c.startedAt ?? c.created).replace(/(\.\d+)?Z$/, '')}.${String(c.id.charCodeAt(0) * 7919).padStart(9, '0').slice(0, 9)}Z ` : '';
    lines.forEach((l) => out.add(ts + l));
    if (p.flags.has('--follow') && c.status === 'running') out.add('(following logs: the simulator stops here; in real Docker, press Ctrl+C to stop following)', 'dim');
    return 0;
  }

  private cmdExec(args: string[], out: Out): number {
    const p = parseFlags(args, [f('-i,--interactive'), f('-t,--tty'), f('-d,--detach'), f('-e,--env', true), f('-w,--workdir', true), f('-u,--user', true)], 'exec', true);
    const [ref, ...cmd] = p.pos;
    if (!ref || !cmd.length) throw new CliError(`docker: 'docker exec' requires at least 2 arguments\n\n${USAGES.exec}\n\nSee 'docker exec --help' for more information`, 1);
    const c = this.findContainer(ref);
    if (!c) throw new CliError(`Error response from daemon: No such container: ${ref}`, 1);
    if (c.status !== 'running') throw new CliError(`Error response from daemon: container ${c.id} is not running`, 1);
    const ctx = this.ctx(c, p.flags.get('--workdir')?.slice(-1)[0]);
    for (const e of p.flags.get('--env') ?? []) {
      const i = e.indexOf('=');
      if (i > 0) ctx.env[e.slice(0, i)] = e.slice(i + 1);
    }
    const prog = cmd[0].replace(/^.*\//, '');
    if (['sh', 'bash', 'ash'].includes(prog) && cmd.length === 1) {
      if (p.flags.has('--interactive') && p.flags.has('--tty')) {
        out.add(`(The simulator can't open an interactive shell. Run one command at a time instead, e.g. "docker exec ${ref} ls /" or "docker exec ${ref} sh -c 'cd /app && ls'".)`, 'dim');
        return 0;
      }
      return 0;
    }
    const r = runScript(ctx, cmd.map((w) => (/[\s'"$;&|<>]/.test(w) ? `'${w.replace(/'/g, `'\\''`)}'` : w)).join(' '));
    if (r.code === 127 && !r.out.filter((l) => !/: not found$/.test(l)).length) {
      throw new CliError(`OCI runtime exec failed: exec failed: unable to start container process: exec: "${cmd[0]}": executable file not found in $PATH: unknown`, 127);
    }
    r.out.forEach((l) => out.add(l));
    return r.code;
  }

  private cmdPort(args: string[], out: Out): number {
    const c = this.findContainer(args[0]);
    if (!c) throw new CliError(`Error response from daemon: No such container: ${args[0]}`, 1);
    if (c.status !== 'running') return 0;
    for (const b of c.ports) {
      if (b.hostIp === '0.0.0.0') {
        out.add(`${b.containerPort}/${b.proto} -> 0.0.0.0:${b.hostPort}`);
        out.add(`${b.containerPort}/${b.proto} -> [::]:${b.hostPort}`);
      } else out.add(`${b.containerPort}/${b.proto} -> ${b.hostIp}:${b.hostPort}`);
    }
    return 0;
  }

  inspectContainer(c: Container): Record<string, unknown> {
    return {
      Id: c.id,
      Created: isoZ(c.created),
      Path: c.cmd[0] ?? '',
      Args: c.cmd.slice(1),
      State: {
        Status: c.status,
        Running: c.status === 'running',
        Restarting: c.status === 'restarting',
        ExitCode: c.exitCode ?? 0,
        StartedAt: c.startedAt ? isoZ(c.startedAt) : '0001-01-01T00:00:00Z',
        FinishedAt: c.finishedAt ? isoZ(c.finishedAt) : '0001-01-01T00:00:00Z',
        OOMKilled: !!c.oomKilled,
        Error: '',
        ...(c.health ? { Health: { Status: c.health, FailingStreak: c.failingStreak ?? 0 } } : {}),
      },
      Image: `sha256:${c.imageId}`,
      Name: `/${c.name}`,
      RestartCount: c.restartCount,
      HostConfig: {
        RestartPolicy: { Name: c.restart, MaximumRetryCount: c.maxRetries },
        AutoRemove: c.autoRemove,
        Init: c.init || null,
        Memory: c.memory,
        NanoCpus: c.nanoCpus,
        PortBindings: Object.fromEntries(c.ports.map((b) => [`${b.containerPort}/${b.proto}`, [{ HostIp: b.hostIp === '0.0.0.0' ? '' : b.hostIp, HostPort: String(b.hostPort) }]])),
        Binds: c.mounts.filter((m) => !m.anonymous).map((m) => `${m.source}:${m.target}${m.readOnly ? ':ro' : ''}`),
      },
      Mounts: c.mounts.map((m) => ({
        Type: m.type,
        ...(m.type === 'volume' ? { Name: m.source, Source: `/var/lib/docker/volumes/${m.source}/_data` } : { Source: joinPath(this.cwdHost, m.source) }),
        Destination: m.target,
        RW: !m.readOnly,
      })),
      Config: {
        Hostname: hostnameOf(c),
        Image: c.image,
        Cmd: c.cmd.slice(this.state.images.find((i) => i.id === c.imageId)?.config.entrypoint.length ?? 0),
        Entrypoint: this.state.images.find((i) => i.id === c.imageId)?.config.entrypoint ?? null,
        Env: c.env,
        WorkingDir: c.workdir,
        User: c.user,
        Labels: c.labels,
        ExposedPorts: Object.fromEntries((this.state.images.find((i) => i.id === c.imageId)?.config.exposed ?? []).map((p) => [`${p}/tcp`, {}])),
        ...(c.healthcheck ? { Healthcheck: { Test: ['CMD-SHELL', c.healthcheck] } } : {}),
      },
      NetworkSettings: {
        Networks: Object.fromEntries(c.networks.map((n) => [n, { IPAddress: c.status === 'running' ? c.ips[n] ?? '' : '', Aliases: c.aliases.length ? c.aliases : null }])),
        Ports: Object.fromEntries(c.ports.map((b) => [`${b.containerPort}/${b.proto}`, [{ HostIp: b.hostIp, HostPort: String(b.hostPort) }]])),
      },
    };
  }

  inspectImage(i: Image): Record<string, unknown> {
    return {
      Id: `sha256:${i.id}`,
      RepoTags: i.tags.map((t) => `${i.repo}:${t}`),
      Created: isoZ(i.created),
      Size: Math.round(i.contentSize * 1e6),
      Config: {
        Cmd: i.config.cmd.length ? i.config.cmd : null,
        Entrypoint: i.config.entrypoint.length ? i.config.entrypoint : null,
        Env: i.config.env,
        WorkingDir: i.config.workdir,
        User: i.config.user,
        ExposedPorts: Object.fromEntries(i.config.exposed.map((p) => [`${p}/tcp`, {}])),
        ...(i.config.volumes?.length ? { Volumes: Object.fromEntries(i.config.volumes.map((v) => [v, {}])) } : {}),
      },
      RootFS: { Type: 'layers', Layers: i.layers.map(() => `sha256:${this.ids.hex(64)}`) },
    };
  }

  private cmdInspect(args: string[], out: Out): number {
    const p = parseFlags(args, [f('-f,--format', true), f('--type', true), f('-s,--size')], 'inspect');
    const fmt = p.flags.get('--format')?.slice(-1)[0];
    const results: Record<string, unknown>[] = [];
    let code = 0;
    for (const ref of p.pos) {
      const type = p.flags.get('--type')?.slice(-1)[0];
      const c = type === 'image' ? undefined : this.findContainer(ref);
      const i = c ? undefined : type === 'container' ? undefined : this.findImage(ref);
      const v = c || i ? undefined : this.state.volumes.find((x) => x.name === ref);
      const n = c || i || v ? undefined : this.state.networks.find((x) => x.name === ref);
      const obj = c ? this.inspectContainer(c) : i ? this.inspectImage(i) : v ? this.inspectVolume(v) : n ? this.inspectNetwork(n) : null;
      if (!obj) {
        out.err(`error: no such object: ${ref}`);
        code = 1;
        continue;
      }
      results.push(obj);
    }
    if (fmt) results.forEach((r) => out.add(this.template(fmt, r)));
    else if (results.length) out.add(JSON.stringify(results, null, 4));
    return code;
  }

  // ---------------------------------------------------------------- images

  private cmdImages(args: string[], out: Out): number {
    const p = parseFlags(args, [f('-a,--all'), f('-q,--quiet'), f('--format', true), f('-f,--filter', true), f('--tree')], 'images');
    const want = p.pos[0];
    const rows: { name: string; img: Image }[] = [];
    for (const img of this.state.images) {
      for (const t of img.tags) {
        const name = `${img.repo}:${t}`;
        if (want) {
          const w = splitRef(want);
          if (w.repo !== img.repo || (want.includes(':') && w.tag !== t)) continue;
        }
        rows.push({ name, img });
      }
      if (!img.tags.length && !want) rows.push({ name: '<none>:<none>', img });
    }
    rows.sort((a, b) => cmp(a.name, b.name));
    if (p.flags.has('--quiet')) {
      [...new Set(rows.map((r) => r.img.id.slice(0, 12)))].forEach((id) => out.add(id));
      return 0;
    }
    const fmt = p.flags.get('--format')?.slice(-1)[0];
    if (fmt) {
      for (const r of rows) {
        const [repo, tag] = r.name.split(':');
        out.add(this.template(fmt, { Repository: repo, Tag: tag, ID: r.img.id.slice(0, 12), Size: humanSize(r.img.size) }));
      }
      return 0;
    }
    const used = (img: Image) => this.state.containers.some((c) => c.imageId === img.id);
    table(
      ['IMAGE', 'ID', 'DISK USAGE', 'CONTENT SIZE', 'EXTRA'],
      rows.map((r) => [r.name, r.img.id.slice(0, 12), humanSize(r.img.size), humanSize(r.img.contentSize), used(r.img) ? 'U' : '']),
      [2, 3],
      true,
    ).forEach((l) => out.add(l));
    return 0;
  }

  private cmdImageGroup(args: string[], out: Out): number {
    const [sub, ...rest] = args;
    if (sub === 'ls' || sub === 'list') return this.cmdImages(rest, out);
    if (sub === 'rm') return this.cmdRmi(rest, out);
    if (sub === 'pull') return this.dockerCmd(['pull', ...rest], out);
    if (sub === 'build') return this.cmdBuild(rest, out);
    if (sub === 'history') return this.cmdHistory(rest, out);
    if (sub === 'tag') return this.cmdTag(rest, out);
    if (sub === 'inspect') return this.cmdInspect(['--type', 'image', ...rest], out);
    if (sub === 'prune') {
      const all = rest.includes('-a') || rest.includes('--all');
      const gone = this.state.images.filter((i) => !this.state.containers.some((c) => c.imageId === i.id) && (all || !i.tags.length));
      this.state.images = this.state.images.filter((i) => !gone.includes(i));
      if (gone.length) {
        out.add('Deleted Images:');
        for (const i of gone) {
          for (const t of i.tags) out.add(`untagged: ${i.repo}:${t}`);
          out.add(`deleted: sha256:${i.id}`);
        }
        out.add('');
      }
      out.add(`Total reclaimed space: ${humanSize(gone.reduce((s, i) => s + i.contentSize, 0))}`);
      return 0;
    }
    throw new CliError(`docker: unknown command: docker image ${sub}\n\nRun 'docker image --help' for more information`, 1);
  }

  private cmdRmi(args: string[], out: Out): number {
    const p = parseFlags(args, [f('-f,--force')], 'rmi');
    let code = 0;
    for (const ref of p.pos) {
      const img = this.findImage(ref);
      if (!img) {
        out.err(`Error response from daemon: No such image: ${ref.includes(':') || /^[0-9a-f]{12}/.test(ref) ? ref : `${ref}:latest`}`);
        code = 1;
        continue;
      }
      const { repo, tag } = splitRef(ref);
      const byId = /^[0-9a-f]{4,64}$/.test(ref) && !img.tags.includes(tag);
      const user = this.state.containers.find((c) => c.imageId === img.id);
      const name = byId ? ref : `${repo}:${tag}`;
      if (user && !p.flags.has('--force') && (byId || img.tags.length <= 1)) {
        out.err(`Error response from daemon: conflict: unable to delete ${name} (must be forced) - container ${user.id.slice(0, 12)} is using its referenced image ${img.id.slice(0, 12)}`);
        code = 1;
        continue;
      }
      const tags = byId ? [...img.tags] : [tag];
      for (const t of tags) {
        img.tags = img.tags.filter((x) => x !== t);
        out.add(`Untagged: ${img.repo}:${t}`);
      }
      if (!img.tags.length && !user) {
        this.state.images = this.state.images.filter((i) => i !== img);
        out.add(`Deleted: sha256:${img.id}`);
      }
    }
    return code;
  }

  private cmdTag(args: string[], out: Out): number {
    const [src, dst] = args;
    if (!src || !dst) throw new CliError(`docker: 'docker tag' requires 2 arguments\n\nUsage:  docker tag SOURCE_IMAGE[:TAG] TARGET_IMAGE[:TAG]\n\nSee 'docker tag --help' for more information`, 1);
    const img = this.findImage(src);
    if (!img) throw new CliError(`Error response from daemon: No such image: ${src.includes(':') ? src : `${src}:latest`}`, 1);
    this.validateRef(dst, false);
    const t = splitRef(dst);
    if (t.repo === img.repo) {
      if (!img.tags.includes(t.tag)) img.tags.push(t.tag);
    } else {
      this.state.images.push({ ...img, repo: t.repo, tags: [t.tag] });
    }
    void out;
    return 0;
  }

  private cmdHistory(args: string[], out: Out): number {
    const ref = args.filter((a) => !a.startsWith('-'))[0];
    const img = ref ? this.findImage(ref) : undefined;
    if (!img) throw new CliError(`Error response from daemon: No such image: ${ref}`, 1);
    const rows = [...img.layers].reverse().map((l, i) => [
      i === 0 ? img.id.slice(0, 12) : '<missing>',
      `${humanDuration(this.now() - img.created)} ago`,
      truncate(l.createdBy, 45),
      l.size === 0 ? '0B' : humanSize(l.size),
      'buildkit.dockerfile.v0',
    ]);
    table(['IMAGE', 'CREATED', 'CREATED BY', 'SIZE', 'COMMENT'], rows).forEach((l) => out.add(l));
    return 0;
  }

  /** Implemented in dockerfile.ts (assigned at module load to avoid a circular import). */
  cmdBuild(args: string[], out: Out): number {
    return buildImpl(this, args, out);
  }

  // ---------------------------------------------------------------- volumes

  inspectVolume(v: Volume): Record<string, unknown> {
    return {
      CreatedAt: isoZ(v.created),
      Driver: 'local',
      Labels: Object.keys(v.labels).length ? v.labels : null,
      Mountpoint: `/var/lib/docker/volumes/${v.name}/_data`,
      Name: v.name,
      Options: null,
      Scope: 'local',
    };
  }

  private cmdVolume(args: string[], out: Out): number {
    const [sub, ...rest] = args;
    switch (sub) {
      case 'create': {
        const p = parseFlags(rest, [f('-d,--driver', true), f('-l,--label', true), f('-o,--opt', true)], 'volume create');
        const name = p.pos[0] ?? this.ids.hex(64);
        if (!this.state.volumes.some((v) => v.name === name)) this.state.volumes.push({ name, files: {}, created: this.now(), labels: {} });
        out.add(name);
        return 0;
      }
      case 'ls':
      case 'list': {
        const p = parseFlags(rest, [f('-q,--quiet'), f('-f,--filter', true), f('--format', true)], 'volume ls');
        let vols = [...this.state.volumes];
        for (const fl of p.flags.get('--filter') ?? []) {
          const [k, v] = fl.split('=');
          if (k === 'name') vols = vols.filter((x) => x.name.includes(v));
          if (k === 'dangling') vols = vols.filter((x) => (v === 'true') === !this.volumeUsers(x.name).length);
        }
        vols.sort((a, b) => cmp(a.name, b.name));
        const vfmt = p.flags.get('--format')?.slice(-1)[0];
        if (p.flags.has('--quiet')) vols.forEach((v) => out.add(v.name));
        else if (vfmt && vfmt !== 'table') vols.forEach((v) => out.add(this.template(vfmt, { Name: v.name, Driver: 'local', Scope: 'local', Mountpoint: `/var/lib/docker/volumes/${v.name}/_data`, Labels: '' })));
        else table(['DRIVER', 'VOLUME NAME'], vols.map((v) => ['local', v.name])).forEach((l) => out.add(l));
        return 0;
      }
      case 'inspect': {
        const p = parseFlags(rest, [f('-f,--format', true)], 'volume inspect');
        const res = p.pos.map((n) => this.state.volumes.find((v) => v.name === n));
        const missing = p.pos.find((_n, i) => !res[i]);
        if (missing) throw new CliError(`Error response from daemon: get ${missing}: no such volume`, 1);
        const fmt = p.flags.get('--format')?.slice(-1)[0];
        if (fmt) res.forEach((v) => out.add(this.template(fmt, this.inspectVolume(v!))));
        else out.add(JSON.stringify(res.map((v) => this.inspectVolume(v!)), null, 4));
        return 0;
      }
      case 'rm':
      case 'remove': {
        const p = parseFlags(rest, [f('-f,--force')], 'volume rm');
        let code = 0;
        for (const n of p.pos) {
          const v = this.state.volumes.find((x) => x.name === n);
          if (!v) {
            out.err(`Error response from daemon: get ${n}: no such volume`);
            code = 1;
            continue;
          }
          const users = this.volumeUsers(n);
          if (users.length) {
            out.err(`Error response from daemon: remove ${n}: volume is in use - [${users.map((c) => c.id).join(', ')}]`);
            code = 1;
            continue;
          }
          this.state.volumes = this.state.volumes.filter((x) => x !== v);
          out.add(n);
        }
        return code;
      }
      case 'prune': {
        const all = rest.some((a) => a === '--all' || /^-[a-z]*a/.test(a));
        const gone = this.state.volumes.filter((v) => !this.volumeUsers(v.name).length && (all || /^[0-9a-f]{64}$/.test(v.name)));
        this.state.volumes = this.state.volumes.filter((v) => !gone.includes(v));
        if (gone.length) {
          out.add('Deleted Volumes:');
          gone.forEach((v) => out.add(v.name));
          out.add('');
        }
        out.add('Total reclaimed space: 0B');
        return 0;
      }
    }
    throw new CliError(`docker: unknown command: docker volume ${sub ?? ''}\n\nRun 'docker volume --help' for more information`, 1);
  }

  volumeUsers(name: string): Container[] {
    return this.state.containers.filter((c) => c.mounts.some((m) => m.type === 'volume' && m.source === name));
  }

  // ---------------------------------------------------------------- networks

  inspectNetwork(n: Network): Record<string, unknown> {
    return {
      Name: n.name,
      Id: n.id,
      Created: isoZ(n.created),
      Scope: 'local',
      Driver: n.driver,
      IPAM: n.driver === 'bridge' ? { Config: [{ Subnet: `172.${n.subnet}.0.0/16`, Gateway: `172.${n.subnet}.0.1` }] } : { Config: [] },
      Containers: Object.fromEntries(
        this.state.containers.filter((c) => c.status === 'running' && c.networks.includes(n.name)).map((c) => [c.id, { Name: c.name, IPv4Address: `${c.ips[n.name]}/16` }]),
      ),
      Labels: n.labels,
    };
  }

  createNetwork(name: string, labels: Record<string, string> = {}): Network {
    const used = this.state.networks.map((n) => n.subnet);
    let subnet = 18;
    while (used.includes(subnet)) subnet++;
    const n = this.mkNetwork(name, 'bridge', false, subnet);
    n.labels = labels;
    n.created = this.now();
    this.state.networks.push(n);
    return n;
  }

  private cmdNetwork(args: string[], out: Out): number {
    const [sub, ...rest] = args;
    switch (sub) {
      case 'create': {
        const p = parseFlags(rest, [f('-d,--driver', true), f('--subnet', true), f('--internal'), f('-l,--label', true)], 'network create');
        const name = p.pos[0];
        if (!name) throw new CliError(`docker: 'docker network create' requires 1 argument\n\nUsage:  docker network create [OPTIONS] NETWORK\n\nSee 'docker network create --help' for more information`, 1);
        if (this.state.networks.some((n) => n.name === name)) throw new CliError(`Error response from daemon: network with name ${name} already exists`, 1);
        out.add(this.createNetwork(name).id);
        return 0;
      }
      case 'ls':
      case 'list': {
        const p = parseFlags(rest, [f('-q,--quiet'), f('-f,--filter', true), f('--format', true), f('--no-trunc')], 'network ls');
        let nets = [...this.state.networks];
        for (const fl of p.flags.get('--filter') ?? []) {
          const [k, v] = fl.split('=');
          if (k === 'name') nets = nets.filter((x) => x.name.includes(v));
        }
        nets.sort((a, b) => cmp(a.name, b.name));
        const nfmt = p.flags.get('--format')?.slice(-1)[0];
        if (p.flags.has('--quiet')) nets.forEach((n) => out.add(n.id.slice(0, 12)));
        else if (nfmt && nfmt !== 'table') nets.forEach((n) => out.add(this.template(nfmt, { ID: n.id.slice(0, 12), Name: n.name, Driver: n.driver, Scope: 'local', IPv6: false, Internal: false, Labels: '' })));
        else table(['NETWORK ID', 'NAME', 'DRIVER', 'SCOPE'], nets.map((n) => [n.id.slice(0, 12), n.name, n.driver, 'local'])).forEach((l) => out.add(l));
        return 0;
      }
      case 'inspect': {
        const p = parseFlags(rest, [f('-f,--format', true)], 'network inspect');
        const ref = p.pos[0];
        const n = this.state.networks.find((x) => x.name === ref || x.id.startsWith(ref ?? '-'));
        if (!n) throw new CliError(`Error response from daemon: network ${ref} not found`, 1);
        const fmt = p.flags.get('--format')?.slice(-1)[0];
        if (fmt) out.add(this.template(fmt, this.inspectNetwork(n)));
        else out.add(JSON.stringify([this.inspectNetwork(n)], null, 4));
        return 0;
      }
      case 'rm':
      case 'remove': {
        let code = 0;
        for (const name of rest) {
          const n = this.state.networks.find((x) => x.name === name || x.id.startsWith(name));
          if (!n) {
            out.err(`Error response from daemon: network ${name} not found`);
            code = 1;
            continue;
          }
          if (n.builtIn) {
            out.err(`Error response from daemon: ${name} is a pre-defined network and cannot be removed`);
            code = 1;
            continue;
          }
          // Listed in the order the containers joined (oldest first), like Docker does.
          const active = this.state.containers.filter((c) => c.status === 'running' && c.networks.includes(n.name)).reverse();
          if (active.length) {
            out.err(`Error response from daemon: error while removing network: network ${n.name} has active endpoints (${active.map((c) => `name:"${c.name}" id:"${this.ids.hex(12)}"`).join(', ')})`);
            out.err('exit status 1');
            code = 1;
            continue;
          }
          this.state.networks = this.state.networks.filter((x) => x !== n);
          // Stopped containers keep the reference; starting them later fails ("network … not found").
          for (const c of this.state.containers) {
            delete c.ips[n.name];
          }
          out.add(name);
        }
        return code;
      }
      case 'connect':
      case 'disconnect': {
        const p = parseFlags(rest, [f('--alias', true), f('-f,--force')], `network ${sub}`);
        const [netName, ref] = p.pos;
        const n = this.state.networks.find((x) => x.name === netName);
        if (!n) throw new CliError(`Error response from daemon: network ${netName} not found`, 1);
        const c = this.findContainer(ref);
        if (!c) throw new CliError(`Error response from daemon: No such container: ${ref}`, 1);
        if (sub === 'connect') {
          if (c.networks.includes(netName)) throw new CliError(`Error response from daemon: endpoint with name ${c.name} already exists in network ${netName}`, 1);
          this.attach(c, netName);
          for (const a of p.flags.get('--alias') ?? []) if (!c.aliases.includes(a)) c.aliases.push(a);
        } else {
          if (!c.networks.includes(netName)) throw new CliError(`Error response from daemon: container ${c.id} is not connected to network ${netName}`, 1);
          c.networks = c.networks.filter((x) => x !== netName);
          delete c.ips[netName];
        }
        return 0;
      }
      case 'prune': {
        const gone = this.state.networks.filter((n) => !n.builtIn && !this.state.containers.some((c) => c.networks.includes(n.name)));
        this.state.networks = this.state.networks.filter((n) => !gone.includes(n));
        if (gone.length) {
          out.add('Deleted Networks:');
          gone.forEach((n) => out.add(n.name));
        }
        return 0;
      }
    }
    throw new CliError(`docker: unknown command: docker network ${sub ?? ''}\n\nRun 'docker network --help' for more information`, 1);
  }

  // ---------------------------------------------------------------- container group / system

  private cmdContainerGroup(args: string[], out: Out): number {
    const [sub, ...rest] = args;
    const map: Record<string, string> = { ls: 'ps', list: 'ps', rm: 'rm', start: 'start', stop: 'stop', restart: 'restart', logs: 'logs', exec: 'exec', run: 'run', create: 'create', kill: 'kill', inspect: 'inspect', port: 'port' };
    if (map[sub]) return this.dockerCmd([map[sub], ...rest], out);
    if (sub === 'prune') {
      if (!rest.includes('-f') && !rest.includes('--force')) {
        out.add('WARNING! This will remove all stopped containers.');
        out.add('Are you sure you want to continue? [y/N] ', 'dim');
        out.add('(The simulator can\'t answer prompts: run "docker container prune -f" to skip the question.)', 'dim');
        return 1;
      }
      const gone = this.state.containers.filter((c) => c.status !== 'running' && c.status !== 'restarting');
      gone.forEach((c) => this.removeContainer(c, false));
      if (gone.length) {
        out.add('Deleted Containers:');
        gone.forEach((c) => out.add(c.id));
        out.add('');
      }
      out.add('Total reclaimed space: 0B');
      return 0;
    }
    throw new CliError(`docker: unknown command: docker container ${sub ?? ''}\n\nRun 'docker container --help' for more information`, 1);
  }

  /** docker update: change the restart policy or resource limits of existing containers. */
  private cmdUpdate(args: string[], out: Out): number {
    const p = parseFlags(args, [f('--restart', true), f('--memory,-m', true), f('--memory-swap', true), f('--cpus', true)], 'update');
    if (!p.pos.length) throw new CliError(`docker: 'docker update' requires at least 1 argument\n\nUsage:  docker update [OPTIONS] CONTAINER [CONTAINER...]\n\nSee 'docker update --help' for more information`, 1);
    const restart = p.flags.get('--restart')?.slice(-1)[0];
    if (restart && !/^(no|always|unless-stopped|on-failure(:\d+)?)$/.test(restart)) throw new CliError(`invalid restart policy format: ${restart}`, 1);
    const memSpec = p.flags.get('--memory')?.slice(-1)[0];
    const memory = memSpec === undefined ? undefined : parseBytes(memSpec);
    if (memory !== undefined && (Number.isNaN(memory) || (memory && memory < 6 * 1024 * 1024))) throw new CliError(Number.isNaN(memory) ? `invalid argument "${memSpec}" for "-m, --memory" flag: invalid size: '${memSpec}'` : 'Error response from daemon: Minimum memory limit allowed is 6MB', 1);
    const cpus = p.flags.get('--cpus')?.slice(-1)[0];
    let code = 0;
    for (const ref of p.pos) {
      const c = this.findContainer(ref);
      if (!c) {
        out.err(`Error response from daemon: No such container: ${ref}`);
        code = 1;
        continue;
      }
      if (restart) {
        const [policy, max] = restart.split(':');
        c.restart = policy as RestartPolicy;
        c.maxRetries = Number(max ?? 0) || 0;
        // No longer allowed to restart: a crash loop ends.
        if (policy === 'no' && c.status === 'restarting') {
          c.status = 'exited';
          c.loop = undefined;
        }
      }
      if (cpus !== undefined) c.nanoCpus = Math.round(Number(cpus) * 1e9);
      if (memory !== undefined) {
        c.memory = memory;
        if (memory && c.status === 'running' && (c.memUsage ?? 0) * 1024 * 1024 > memory) {
          c.oomKilled = true;
          this.processExited(c, 137);
        }
      }
      out.add(ref);
    }
    return code;
  }

  /** docker stats: one snapshot (the simulator can't stream; --no-stream is implied). */
  private cmdStats(args: string[], out: Out): number {
    const p = parseFlags(args, [f('-a,--all'), f('--no-stream'), f('--no-trunc'), f('--format', true)], 'stats');
    let list = this.state.containers.filter((c) => p.flags.has('--all') || c.status === 'running');
    if (p.pos.length) {
      list = [];
      for (const ref of p.pos) {
        const c = this.findContainer(ref);
        if (!c) throw new CliError(`Error response from daemon: No such container: ${ref}`, 1);
        list.push(c);
      }
    }
    const HOST = 7.755 * 1024 ** 3;
    const size = (b: number) => (b >= 1024 ** 3 ? `${+(b / 1024 ** 3).toFixed(3)}GiB` : b >= 1024 ** 2 ? `${+(b / 1024 ** 2).toFixed(2)}MiB` : b > 0 ? `${Math.round(b / 1024)}KiB` : '0B');
    const rows = list.map((c) => {
      const up = c.status === 'running';
      const used = up ? (c.memUsage ?? 0.55) * 1024 * 1024 : 0;
      const limit = up ? c.memory || HOST : 0;
      const server = up && c.proc?.kind === 'server';
      const seed = parseInt(c.id.slice(0, 4), 16);
      return {
        Container: c.id.slice(0, 12),
        ID: c.id.slice(0, 12),
        Name: c.name,
        CPUPerc: server ? `${((seed % 9) / 100 + 0.01).toFixed(2)}%` : '0.00%',
        MemUsage: `${size(used)} / ${size(limit)}`,
        MemPerc: limit ? `${((used / limit) * 100).toFixed(2)}%` : '0.00%',
        NetIO: up ? `${(seed % 900) + 200}B / ${(seed % 80) + 40}B` : '0B / 0B',
        BlockIO: up && server ? `${((seed % 20) / 10 + 0.5).toFixed(1)}MB / 0B` : '0B / 0B',
        PIDs: up ? String(server ? (seed % 5) + 2 : 1) : '0',
      };
    });
    const fmt = p.flags.get('--format')?.slice(-1)[0];
    if (fmt && !fmt.startsWith('table')) {
      for (const r of rows) out.add(this.template(fmt, r));
      return 0;
    }
    for (const l of table(['CONTAINER ID', 'NAME', 'CPU %', 'MEM USAGE / LIMIT', 'MEM %', 'NET I/O', 'BLOCK I/O', 'PIDS'], rows.map((r) => [r.ID, r.Name, r.CPUPerc, r.MemUsage, r.MemPerc, r.NetIO, r.BlockIO, r.PIDs]))) out.add(l);
    if (!p.flags.has('--no-stream')) out.add('(Real docker stats keeps refreshing until you press Ctrl+C; the simulator shows one snapshot, like --no-stream.)', 'dim');
    return 0;
  }

  private cmdSystem(args: string[], out: Out): number {
    const [sub, ...rest] = args;
    if (sub === 'df') {
      const usedImgs = this.state.images.filter((i) => this.state.containers.some((c) => c.imageId === i.id));
      const imgSize = this.state.images.reduce((s, i) => s + i.contentSize, 0);
      const usedSize = usedImgs.reduce((s, i) => s + i.contentSize, 0);
      const running = this.state.containers.filter((c) => c.status === 'running').length;
      const usedVols = this.state.volumes.filter((v) => this.volumeUsers(v.name).length).length;
      const pct = (a: number, b: number) => (b ? ` (${Math.round((a / b) * 100)}%)` : '');
      table(
        ['TYPE', 'TOTAL', 'ACTIVE', 'SIZE', 'RECLAIMABLE'],
        [
          ['Images', String(this.state.images.length), String(usedImgs.length), humanSize(imgSize), humanSize(imgSize - usedSize) + pct(imgSize - usedSize, imgSize)],
          ['Containers', String(this.state.containers.length), String(running), '0B', '0B'],
          ['Local Volumes', String(this.state.volumes.length), String(usedVols), '0B', '0B'],
          ['Build Cache', String(this.state.buildCache.length), '0', '0B', '0B'],
        ],
      ).forEach((l) => out.add(l));
      return 0;
    }
    if (sub === 'prune') {
      const pf = parseFlags(rest, [f('-a,--all'), f('-f,--force'), f('--volumes'), f('--filter', true)], 'system prune');
      const all = pf.flags.has('--all');
      if (!pf.flags.has('--force')) {
        out.add(`WARNING! This will remove:\n  - all stopped containers\n  - all networks not used by at least one container${pf.flags.has('--volumes') ? '\n  - all anonymous volumes not used by at least one container' : ''}\n  - ${all ? 'all images without at least one container associated to them' : 'all dangling images'}\n  - ${all ? 'all build cache' : 'unused build cache'}\n\nAre you sure you want to continue? [y/N] `);
        out.add('(The simulator can\'t answer prompts: add -f to skip the question.)', 'dim');
        return 1;
      }
      const stopped = this.state.containers.filter((c) => c.status !== 'running' && c.status !== 'restarting');
      stopped.forEach((c) => this.removeContainer(c, false));
      const nets = this.state.networks.filter((n) => !n.builtIn && !this.state.containers.some((c) => c.networks.includes(n.name)));
      this.state.networks = this.state.networks.filter((n) => !nets.includes(n));
      const imgs = this.state.images.filter((i) => !this.state.containers.some((c) => c.imageId === i.id) && (all || !i.tags.length));
      const vols = pf.flags.has('--volumes') ? this.state.volumes.filter((v) => /^[0-9a-f]{64}$/.test(v.name) && !this.volumeUsers(v.name).length) : [];
      this.state.volumes = this.state.volumes.filter((v) => !vols.includes(v));
      this.state.images = this.state.images.filter((i) => !imgs.includes(i));
      this.state.buildCache = [];
      if (stopped.length) {
        out.add('Deleted Containers:');
        stopped.forEach((c) => out.add(c.id));
        out.add('');
      }
      if (nets.length) {
        out.add('Deleted Networks:');
        nets.forEach((n) => out.add(n.name));
        out.add('');
      }
      if (vols.length) {
        out.add('Deleted Volumes:');
        vols.forEach((v) => out.add(v.name));
        out.add('');
      }
      if (imgs.length) {
        out.add('Deleted Images:');
        imgs.forEach((i) => {
          for (const t of i.tags) out.add(`untagged: ${i.repo}:${t}`);
          out.add(`deleted: sha256:${i.id}`);
        });
        out.add('');
      }
      out.add(`Total reclaimed space: ${humanSize(imgs.reduce((s, i) => s + i.contentSize, 0))}`);
      return 0;
    }
    throw new CliError(`docker: unknown command: docker system ${sub ?? ''}\n\nRun 'docker system --help' for more information`, 1);
  }

  /** Implemented in compose.ts. */
  cmdCompose(args: string[], out: Out): number {
    return composeImpl(this, args, out);
  }

  // ---------------------------------------------------------------- public helpers for builder/compose/UI

  /** Start a container created with createContainer() (compose up). Throws CliError on failure. */
  startCreated(c: Container): void {
    this.runStart(c, true, new Out(), false);
  }

  stopByName(c: Container) {
    this.stopContainer(c, 'TERM');
  }

  removeByName(c: Container, volumes: boolean) {
    this.removeContainer(c, volumes);
  }

  pullQuiet(ref: string): Image {
    return this.pull(ref, new Out(), false, true);
  }

  /** A normalised, comparable picture of the engine (used by exercise checks). */
  snapshot() {
    const imgName = (id: string) => {
      const i = this.state.images.find((x) => x.id === id);
      return i ? `${i.repo}:${i.tags[0] ?? '<none>'}` : '<none>';
    };
    return {
      images: this.state.images.flatMap((i) => i.tags.map((t) => `${i.repo}:${t}`)).sort(),
      containers: this.state.containers
        .map((c) => ({
          name: c.name,
          auto: !!c.autoNamed,
          attached: !!c.attached,
          image: imgName(c.imageId),
          status: c.status,
          exitCode: c.status === 'exited' ? c.exitCode : null,
          ports: c.ports.map((b) => `${b.hostIp === '0.0.0.0' ? '' : b.hostIp + ':'}${b.hostPort}->${b.containerPort}/${b.proto}`).sort(),
          mounts: c.mounts.map((m) => `${m.type}:${m.type === 'volume' && /^[0-9a-f]{64}$/.test(m.source) ? '<anonymous>' : m.source}:${m.target}${m.readOnly ? ':ro' : ''}`).sort(),
          networks: [...c.networks].sort(),
          env: c.env.filter((e) => !this.state.images.find((i) => i.id === c.imageId)?.config.env.includes(e)).sort(),
          restart: c.restart + (c.maxRetries ? `:${c.maxRetries}` : ''),
          cmd: c.cmd.join(' '),
        }))
        .sort((a, b) => cmp(a.name, b.name)),
      volumes: this.state.volumes
        .filter((v) => !/^[0-9a-f]{64}$/.test(v.name))
        .map((v) => ({ name: v.name, files: Object.keys(v.files).filter((k) => v.files[k] !== DELETED).sort() }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      networks: this.state.networks.filter((n) => !n.builtIn).map((n) => n.name).sort(),
    };
  }
}

/** Byte-order string comparison (Go's sort.Strings), e.g. '-' sorts before '_'. */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Go's default formatting for template values: slices as [a b], maps as map[k:v]. */
export function goFormat(v: unknown): string {
  if (v === null || v === undefined) return '<no value>';
  if (Array.isArray(v)) return `[${v.map(goFormat).join(' ')}]`;
  if (typeof v === 'object') return `map[${Object.entries(v as object).map(([k, x]) => `${k}:${goFormat(x)}`).join(' ')}]`;
  return String(v);
}

// Late-bound implementations (dockerfile.ts / compose.ts register themselves).
type Impl = (e: DockerEngine, args: string[], out: Out) => number;
let buildImpl: Impl = (_e, _a, out) => {
  out.err('docker build is not available');
  return 1;
};
let composeImpl: Impl = (_e, _a, out) => {
  out.err('docker compose is not available');
  return 1;
};
export function registerBuild(fn: Impl) {
  buildImpl = fn;
}
export function registerCompose(fn: Impl) {
  composeImpl = fn;
}

export { Out, CliError, parseFlags, f as flag };

// ------------------------------------------------------------------ Go templates

type TplNode = { t: 'text'; v: string } | { t: 'expr'; v: string } | { t: 'range'; v: string; body: TplNode[] };

function parseTemplate(src: string): TplNode[] {
  const root: TplNode[] = [];
  const stack: TplNode[][] = [root];
  const re = /\{\{-?\s*(.*?)\s*-?\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.push({ t: 'text', v: src.slice(last, m.index) });
    last = re.lastIndex;
    const action = m[1];
    if (/^range\s+/.test(action)) {
      const node: TplNode = { t: 'range', v: action.replace(/^range\s+/, ''), body: [] };
      top.push(node);
      stack.push(node.body);
    } else if (action === 'end') {
      if (stack.length > 1) stack.pop();
    } else top.push({ t: 'expr', v: action });
  }
  if (last < src.length) stack[stack.length - 1].push({ t: 'text', v: src.slice(last) });
  return root;
}

type Vars = Record<string, unknown>;

function lookup(dot: unknown, path: string, vars: Vars = {}): unknown {
  if (path === '.') return dot;
  let v: unknown = dot;
  let rest = path;
  const m = /^\$(\w*)/.exec(path);
  if (m) {
    v = vars[m[1] || '$'];
    rest = path.slice(m[0].length);
  }
  for (const k of rest.replace(/^\./, '').split('.').filter(Boolean)) v = (v as Record<string, unknown> | undefined)?.[k];
  return v;
}

function evalExpr(expr: string, dot: unknown, vars: Vars = {}): unknown {
  const words = expr.match(/"[^"]*"|\S+/g) ?? [];
  if (words[0] === 'json') return JSON.stringify(evalExpr(words.slice(1).join(' '), dot, vars) ?? null);
  if (words[0] === 'index') {
    const base = lookup(dot, words[1] ?? '.', vars) as Record<string, unknown> | undefined;
    const key = (words[2] ?? '').replace(/^"|"$/g, '');
    return base?.[key];
  }
  if (words[0] === 'len') {
    const v = lookup(dot, words[1] ?? '.', vars);
    return Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : String(v ?? '').length;
  }
  return lookup(dot, words[0] ?? '.', vars);
}

function renderNodes(nodes: TplNode[], dot: unknown, vars: Vars): string {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') out += n.v;
    else if (n.t === 'expr') {
      const v = evalExpr(n.v, dot, vars);
      out += typeof v === 'string' && n.v.startsWith('json') ? v : goFormat(v);
    } else {
      // `range $k, $v := X` / `range $v := X` / `range X`
      const decl = /^\$(\w+)\s*(?:,\s*\$(\w+))?\s*:=\s*(.*)$/.exec(n.v);
      const v = evalExpr(decl ? decl[3] : n.v, dot, vars);
      // Go ranges over maps in key order.
      const entries: [unknown, unknown][] = Array.isArray(v) ? v.map((x, i) => [i, x]) : v && typeof v === 'object' ? Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]) : [];
      for (const [k, item] of entries) {
        const scope = { ...vars };
        if (decl && decl[2]) Object.assign(scope, { [decl[1]]: k, [decl[2]]: item });
        else if (decl) scope[decl[1]] = item;
        out += renderNodes(n.body, item, scope);
      }
    }
  }
  return out;
}

export function renderTemplate(src: string, data: unknown): string {
  return renderNodes(parseTemplate(src), data, { $: data });
}

/** Docker's RAMInBytes: 64m, 1g, 512k, 1048576 (b/k/m/g, case-insensitive, optional trailing b). */
export function parseBytes(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([kmgt]?)i?b?$/i.exec(s.trim());
  if (!m) return NaN;
  const mult: Record<string, number> = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };
  return Math.round(Number(m[1]) * mult[m[2].toLowerCase()]);
}
