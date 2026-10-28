/**
 * `docker compose` (v2/v5 behaviour): parse + validate compose.yaml, then
 * up / down / ps / logs / config / build / start / stop / restart / exec / pull.
 * Naming and output follow Docker Compose v5.5.0 (calibrated).
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { build } from './dockerfile';
import { CliError, DockerEngine, flag, Out, parseBytes, parseFlags, registerCompose } from './engine';
import type { Container, Mount, PortBinding } from './types';
import { humanDuration, joinPath, quoteCommand, shellWords, table } from './util';

export interface ServiceSpec {
  name: string;
  image?: string;
  build?: { context: string; dockerfile: string };
  ports: string[];
  environment: string[];
  volumes: { type: 'volume' | 'bind'; source: string; target: string; readOnly: boolean }[];
  networks: string[];
  dependsOn: Record<string, 'service_started' | 'service_healthy' | 'service_completed_successfully'>;
  healthcheck?: string;
  restart?: string;
  command?: string[];
  entrypoint?: string[];
  containerName?: string;
  workingDir?: string;
  user?: string;
  /** mem_limit / deploy.resources.limits.memory (bytes) and cpus. */
  memory?: number;
  nanoCpus?: number;
  init?: boolean;
}

export interface ComposeModel {
  name: string;
  /** Warnings printed before the command runs (e.g. unset variables). */
  warnings: string[];
  services: ServiceSpec[];
  volumes: Record<string, { external?: boolean; name?: string }>;
  networks: Record<string, { external?: boolean; name?: string }>;
}

const SERVICE_KEYS = new Set(['image', 'build', 'ports', 'environment', 'env_file', 'volumes', 'networks', 'depends_on', 'healthcheck', 'restart', 'command', 'entrypoint', 'container_name', 'working_dir', 'user', 'expose', 'labels', 'hostname', 'stdin_open', 'tty', 'deploy', 'profiles', 'init', 'logging', 'pull_policy', 'platform', 'extra_hosts', 'cap_add', 'cap_drop', 'read_only', 'secrets', 'configs', 'stop_grace_period', 'ulimits', 'mem_limit', 'cpus']);
const TOP_KEYS = new Set(['name', 'services', 'volumes', 'networks', 'configs', 'secrets', 'version', 'include']);

const FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];

function invalid(msg: string): never {
  throw new CliError(`${msg}: invalid compose project`, 1);
}

function listOrMap(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => (x === null || x === undefined ? k : `${k}=${x}`));
  return [];
}

function cmdList(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.map(String);
  return shellWords(String(v));
}

/** mem_limit/cpus, or the deploy.resources.limits form. */
function limits(raw: Record<string, unknown>, svc: string, path: string): { memory?: number; nanoCpus?: number } {
  const lim = ((raw.deploy as Record<string, unknown> | undefined)?.resources as Record<string, unknown> | undefined)?.limits as Record<string, unknown> | undefined;
  const mem = raw.mem_limit ?? lim?.memory;
  const cpus = raw.cpus ?? lim?.cpus;
  const memory = mem === undefined ? undefined : typeof mem === 'number' ? mem : parseBytes(String(mem));
  if (memory !== undefined && Number.isNaN(memory)) throw new CliError(`validating ${path}: services.${svc}.mem_limit must be a string or number`, 1);
  return { memory, nanoCpus: cpus === undefined ? undefined : Math.round(Number(cpus) * 1e9) };
}

/** KEY=VALUE lines of an env file (comments and blank lines skipped, optional quotes removed). */
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i < 0) continue;
    env[l.slice(0, i).replace(/^export\s+/, '').trim()] = l.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

/** Compose's variable interpolation: $VAR, ${VAR}, ${VAR:-default}, ${VAR-default}, ${VAR:?error}; $$ is a literal $. */
function interpolate(text: string, vars: Record<string, string>, warnings: string[]): string {
  return text.replace(/\$\$|\$\{(\w+)(?:(:?)([-?])([^}]*))?\}|\$([A-Za-z_]\w*)/g, (m, braced, colon, op, arg, bare) => {
    if (m === '$$') return '$';
    const name = braced ?? bare;
    const v = vars[name];
    const unset = v === undefined || (colon && v === '');
    if (!unset) return v;
    if (op === '-') return arg;
    if (op === '?') throw new CliError(`required variable ${name} is missing a value: ${arg}`, 1);
    if (!warnings.some((w) => w.includes(`"${name}"`))) warnings.push(`WARN[0000] The "${name}" variable is not set. Defaulting to a blank string.`);
    return '';
  });
}

/** Load, parse and validate the project's compose file. */
export function loadCompose(engine: DockerEngine, file: string | undefined, projectName: string | undefined): ComposeModel {
  const dir = engine.cwd;
  const path = file ? joinPath(dir, file) : FILES.map((f) => joinPath(dir, f)).find((p) => engine.files[p] !== undefined);
  if (!path || engine.files[path] === undefined) throw new CliError('no configuration file provided: not found', 1);
  let doc: Record<string, unknown>;
  const warnings: string[] = [];
  // Variables come from your shell and from a .env file next to compose.yaml.
  const vars = { PWD: dir, HOME: '/home/learner', USER: 'learner', ...parseEnvFile(engine.files[joinPath(dir, '.env')] ?? '') };
  const text = interpolate(engine.files[path].split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'), vars, warnings);
  try {
    doc = (parseYaml(text) ?? {}) as Record<string, unknown>;
  } catch (e) {
    const msg = String((e as Error).message).split('\n')[0];
    throw new CliError(`failed to parse ${path}: ${msg}`, 1);
  }
  if (typeof doc !== 'object' || Array.isArray(doc)) throw new CliError(`failed to parse ${path}: top-level object must be a mapping`, 1);
  for (const k of Object.keys(doc)) if (!TOP_KEYS.has(k) && !k.startsWith('x-')) throw new CliError(`validating ${path}: additional properties '${k}' not allowed`, 1);
  const name = (projectName ?? (doc.name as string | undefined) ?? dir.replace(/^.*\//, '')).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const rawServices = (doc.services ?? {}) as Record<string, Record<string, unknown> | null>;
  if (typeof rawServices !== 'object') throw new CliError(`validating ${path}: services must be a mapping`, 1);
  const volumes = Object.fromEntries(Object.entries((doc.volumes ?? {}) as Record<string, Record<string, unknown> | null>).map(([k, v]) => [k, { external: !!v?.external, name: v?.name as string | undefined }]));
  const networks = Object.fromEntries(Object.entries((doc.networks ?? {}) as Record<string, Record<string, unknown> | null>).map(([k, v]) => [k, { external: !!v?.external, name: v?.name as string | undefined }]));
  const services: ServiceSpec[] = [];
  for (const [svcName, raw0] of Object.entries(rawServices)) {
    if (raw0 !== null && (typeof raw0 !== 'object' || Array.isArray(raw0))) throw new CliError(`validating ${path}: services.${svcName} must be a mapping`, 1);
    const raw = raw0 ?? {};
    for (const k of Object.keys(raw)) if (!SERVICE_KEYS.has(k) && !k.startsWith('x-')) throw new CliError(`validating ${path}: services.${svcName} additional properties '${k}' not allowed`, 1);
    const b = raw.build;
    const buildSpec = b === undefined ? undefined : typeof b === 'string' ? { context: b, dockerfile: 'Dockerfile' } : { context: String((b as Record<string, unknown>).context ?? '.'), dockerfile: String((b as Record<string, unknown>).dockerfile ?? 'Dockerfile') };
    const vols = ((raw.volumes as unknown[]) ?? []).map((v) => {
      if (typeof v === 'string') {
        const [src, dst, mode] = v.split(':');
        if (dst === undefined) return { type: 'volume' as const, source: '', target: src, readOnly: false };
        const bind = /^[./~]/.test(src);
        return { type: bind ? ('bind' as const) : ('volume' as const), source: src, target: dst, readOnly: (mode ?? '').includes('ro') };
      }
      const o = v as Record<string, unknown>;
      return { type: (o.type === 'bind' ? 'bind' : 'volume') as 'bind' | 'volume', source: String(o.source ?? ''), target: String(o.target ?? ''), readOnly: !!o.read_only };
    });
    const nets = Array.isArray(raw.networks) ? (raw.networks as string[]) : Object.keys((raw.networks ?? {}) as object);
    const dep: ServiceSpec['dependsOn'] = {};
    if (Array.isArray(raw.depends_on)) for (const d of raw.depends_on as string[]) dep[d] = 'service_started';
    else for (const [d, v] of Object.entries((raw.depends_on ?? {}) as Record<string, { condition?: string }>)) dep[d] = (v?.condition ?? 'service_started') as ServiceSpec['dependsOn'][string];
    const hc = raw.healthcheck as { test?: unknown; disable?: boolean } | undefined;
    let healthcheck: string | undefined;
    if (hc?.test && !hc.disable) {
      const t = hc.test;
      if (Array.isArray(t)) healthcheck = t[0] === 'CMD-SHELL' ? String(t[1]) : t[0] === 'CMD' ? t.slice(1).join(' ') : undefined;
      else healthcheck = String(t);
    }
    services.push({
      name: svcName,
      image: raw.image as string | undefined,
      build: buildSpec,
      ports: ((raw.ports as unknown[]) ?? []).map((p) => {
        if (typeof p === 'object' && p) {
          const o = p as Record<string, unknown>;
          return `${o.host_ip ? `${o.host_ip}:` : ''}${o.published ?? ''}${o.published ? ':' : ''}${o.target}`;
        }
        return String(p);
      }),
      environment: [
        ...((Array.isArray(raw.env_file) ? raw.env_file : raw.env_file ? [raw.env_file] : []) as unknown[]).flatMap((f) => {
          const file = typeof f === 'string' ? f : String((f as Record<string, unknown>).path ?? '');
          const body = engine.files[joinPath(dir, file)];
          if (body === undefined) throw new CliError(`env file ${joinPath(dir, file)} not found: stat ${joinPath(dir, file)}: no such file or directory`, 1);
          return Object.entries(parseEnvFile(body)).map(([k, v]) => `${k}=${v}`);
        }),
        ...listOrMap(raw.environment),
      ],
      volumes: vols,
      networks: nets,
      dependsOn: dep,
      healthcheck,
      restart: raw.restart as string | undefined,
      command: cmdList(raw.command),
      entrypoint: cmdList(raw.entrypoint),
      containerName: raw.container_name as string | undefined,
      workingDir: raw.working_dir as string | undefined,
      user: raw.user as string | undefined,
      ...limits(raw, svcName, path),
      init: raw.init === true,
    });
  }
  // Validation, in the order Compose reports problems.
  for (const s of services) {
    if (!s.image && !s.build) invalid(`service "${s.name}" has neither an image nor a build context specified`);
    for (const d of Object.keys(s.dependsOn)) if (!services.some((x) => x.name === d)) invalid(`service "${s.name}" depends on undefined service "${d}"`);
    for (const v of s.volumes) if (v.type === 'volume' && v.source && !(v.source in volumes)) invalid(`service "${s.name}" refers to undefined volume ${v.source}`);
    for (const n of s.networks) if (n !== 'default' && !(n in networks)) invalid(`service "${s.name}" refers to undefined network ${n}`);
  }
  // Dependency cycles.
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (n: string, path: string[]) => {
    if (done.has(n)) return;
    if (visiting.has(n)) throw new CliError(`dependency cycle detected: ${[...path.slice(path.indexOf(n)), n].join(' -> ')}`, 1);
    visiting.add(n);
    for (const d of Object.keys(services.find((s) => s.name === n)!.dependsOn)) visit(d, [...path, n]);
    visiting.delete(n);
    done.add(n);
  };
  for (const s of services) visit(s.name, []);
  return { name, warnings, services, volumes, networks };
}

/** Services in start order (dependencies first). */
function order(m: ComposeModel, only?: string[]): ServiceSpec[] {
  const out: ServiceSpec[] = [];
  const add = (s: ServiceSpec) => {
    if (out.includes(s)) return;
    for (const d of Object.keys(s.dependsOn)) add(m.services.find((x) => x.name === d)!);
    out.push(s);
  };
  for (const s of m.services) if (!only?.length || only.includes(s.name)) add(s);
  return out;
}

const volName = (m: ComposeModel, v: string) => m.volumes[v]?.name ?? (m.volumes[v]?.external ? v : `${m.name}_${v}`);
const netName = (m: ComposeModel, n: string) => (n === 'default' ? `${m.name}_default` : m.networks[n]?.name ?? (m.networks[n]?.external ? n : `${m.name}_${n}`));
const ctrName = (m: ComposeModel, s: ServiceSpec) => s.containerName ?? `${m.name}-${s.name}-1`;

function projectContainers(e: DockerEngine, m: ComposeModel): Container[] {
  return e.state.containers.filter((c) => c.labels['com.docker.compose.project'] === m.name);
}

function configHash(s: ServiceSpec): string {
  return JSON.stringify(s);
}

function up(e: DockerEngine, m: ComposeModel, args: string[], out: Out): number {
  const p = parseFlags(args, [flag('-d,--detach'), flag('--build'), flag('--force-recreate'), flag('--no-build'), flag('--remove-orphans'), flag('--wait')], 'compose up');
  const svcs = order(m, p.pos);
  const say = (kind: string, name: string, state: string) => out.add(` ${kind} ${name} ${state}`, state.startsWith('Error') ? 'err' : 'dim');
  // Images: build or pull.
  for (const s of svcs) {
    const ref = s.image ?? `${m.name}-${s.name}`;
    if (s.build && (p.flags.has('--build') || !e.findImage(ref))) {
      const saved = e.cwd;
      const ctx = joinPath(e.cwd, s.build.context);
      e.cwd = ctx;
      try {
        build(e, { tags: [s.image ?? `${m.name}-${s.name}`], file: s.build.dockerfile, context: '.', noCache: false }, out);
      } finally {
        e.cwd = saved;
      }
      say('Image', ref, 'Built');
    } else if (!e.findImage(ref)) {
      say('Image', ref, 'Pulling');
      e.pullQuiet(ref);
      say('Image', ref, 'Pulled');
    }
  }
  // Networks and volumes (Compose creates them concurrently: Creating…, then Created…).
  const nets = new Set<string>();
  for (const s of svcs) for (const n of s.networks.length ? s.networks : ['default']) nets.add(n);
  const newNets: [string, string][] = [];
  for (const n of nets) {
    const full = netName(m, n);
    if (e.state.networks.some((x) => x.name === full)) continue;
    if (m.networks[n]?.external) throw new CliError(`network ${full} declared as external, but could not be found`, 1);
    newNets.push([n, full]);
  }
  const newVols: [string, string][] = [];
  for (const s of svcs)
    for (const v of s.volumes) {
      if (v.type !== 'volume' || !v.source) continue;
      const full = volName(m, v.source);
      if (e.state.volumes.some((x) => x.name === full) || newVols.some(([, f]) => f === full)) continue;
      if (m.volumes[v.source]?.external) throw new CliError(`external volume "${full}" not found`, 1);
      newVols.push([v.source, full]);
    }
  for (const [, full] of newNets) say('Network', full, 'Creating');
  for (const [, full] of newVols) say('Volume', full, 'Creating');
  for (const [v, full] of newVols) {
    e.state.volumes.push({ name: full, files: {}, created: e.now(), labels: { 'com.docker.compose.project': m.name, 'com.docker.compose.volume': v } });
    say('Volume', full, 'Created');
  }
  for (const [n, full] of newNets) {
    e.createNetwork(full, { 'com.docker.compose.project': m.name, 'com.docker.compose.network': n });
    say('Network', full, 'Created');
  }
  // Containers: create (or reuse / recreate).
  const toStart: { s: ServiceSpec; c: Container }[] = [];
  for (const s of svcs) {
    const name = ctrName(m, s);
    let c = e.findContainer(name);
    // Unchanged config and the same image: keep it. A rebuilt or re-pulled image means recreate.
    const current = e.findImage(s.image ?? `${m.name}-${s.name}`);
    if (c && c.labels['com.docker.compose.config-hash'] === configHash(s) && (!current || current.id === c.imageId) && !p.flags.has('--force-recreate')) {
      if (c.status === 'running') {
        say('Container', name, 'Running');
        continue;
      }
      toStart.push({ s, c });
      continue;
    }
    const recreated = !!c;
    if (c) {
      say('Container', name, 'Recreate');
      e.stopByName(c);
      e.removeByName(c, false);
    } else say('Container', name, 'Creating');
    const img = e.findImage(s.image ?? `${m.name}-${s.name}`)!;
    const ports: PortBinding[] = s.ports.flatMap((spec) => {
      const [main, proto = 'tcp'] = spec.split('/');
      const parts = main.split(':');
      const [hostIp, host, ctr] = parts.length === 3 ? parts : parts.length === 2 ? ['0.0.0.0', parts[0], parts[1]] : ['0.0.0.0', '', parts[0]];
      const hostPorts = host.includes('-') ? [Number(host.split('-')[0])] : [host ? Number(host) : 0];
      return hostPorts.map((hp) => ({ hostIp, hostPort: hp || 32768 + e.state.containers.length, containerPort: Number(ctr), proto: proto as 'tcp' | 'udp' }));
    });
    const mounts: Mount[] = s.volumes.map((v) => ({
      type: v.type,
      source: v.type === 'volume' ? (v.source ? volName(m, v.source) : e.ids.hex(64)) : joinPath(e.cwd, v.source.replace(/^~(?=\/|$)/, '/home/learner')),
      target: v.target,
      readOnly: v.readOnly,
      ...(v.type === 'volume' && !v.source ? { anonymous: true } : {}),
    }));
    c = e.createContainer({
      image: img,
      imageRef: s.image ?? `${m.name}-${s.name}`,
      name,
      cmd: s.command,
      entrypoint: s.entrypoint,
      ports,
      mounts,
      env: s.environment,
      networks: (s.networks.length ? s.networks : ['default']).map((n) => netName(m, n)),
      workdir: s.workingDir,
      user: s.user,
      restart: s.restart,
      labels: { 'com.docker.compose.project': m.name, 'com.docker.compose.service': s.name, 'com.docker.compose.container-number': '1', 'com.docker.compose.config-hash': configHash(s) },
      healthcheck: s.healthcheck,
      aliases: [s.name],
      memory: s.memory,
      nanoCpus: s.nanoCpus,
      init: s.init,
    });
    say('Container', name, c.status === 'created' && !e.findContainer(name) ? 'Error' : recreated ? 'Recreated' : 'Created');
    toStart.push({ s, c });
  }
  // Start in dependency order, waiting on conditions.
  for (const { s, c } of toStart) {
    for (const [dep, cond] of Object.entries(s.dependsOn)) {
      if (cond === 'service_started') continue;
      const dc = e.findContainer(ctrName(m, m.services.find((x) => x.name === dep)!));
      if (!dc) continue;
      say('Container', dc.name, 'Waiting');
      if (cond === 'service_healthy') {
        e.advance(2000);
        if (dc.status !== 'running' || dc.health !== 'healthy') {
          say('Container', dc.name, 'Error');
          throw new CliError(dc.health === undefined && dc.status === 'running' ? `dependency failed to start: container ${dc.name} has no healthcheck configured` : `dependency failed to start: container ${dc.name} is unhealthy`, 1);
        }
        say('Container', dc.name, 'Healthy');
      } else {
        if (dc.status !== 'exited' || dc.exitCode !== 0) {
          say('Container', dc.name, 'Error');
          throw new CliError(`service "${dep}" didn't complete successfully: exit ${dc.exitCode ?? 1}`, 1);
        }
        say('Container', dc.name, 'Exited');
      }
    }
    say('Container', c.name, 'Starting');
    try {
      e.startCreated(c);
    } catch (err) {
      if (err instanceof CliError) {
        say('Container', c.name, 'Error');
        throw new CliError(err.text.replace(/^docker: /, ''), 1);
      }
      throw err;
    }
    say('Container', c.name, 'Started');
  }
  if (!p.flags.has('--detach')) {
    out.add('Attaching to ' + svcs.map((s) => ctrName(m, s)).join(', '), 'dim');
    for (const s of svcs) {
      const c = e.findContainer(ctrName(m, s));
      for (const l of c?.logs ?? []) out.add(`${s.name}-1  | ${l}`);
    }
    out.add('(In real Docker, `compose up` without -d stays attached and streams logs until Ctrl+C, which stops everything. The simulator returns to the prompt with the containers still running.)', 'dim');
  }
  return 0;
}

function down(e: DockerEngine, m: ComposeModel, args: string[], out: Out): number {
  const p = parseFlags(args, [flag('-v,--volumes'), flag('--rmi', true), flag('--remove-orphans'), flag('-t,--timeout', true)], 'compose down');
  const say = (kind: string, name: string, state: string) => out.add(` ${kind} ${name} ${state}`, 'dim');
  const ctrs = projectContainers(e, m);
  // Reverse dependency order: dependents first.
  const ordered = order(m)
    .map((s) => ctrs.find((c) => c.labels['com.docker.compose.service'] === s.name))
    .filter((c): c is Container => !!c)
    .reverse();
  for (const c of [...ordered, ...ctrs.filter((c) => !ordered.includes(c))]) {
    if (c.status === 'running' || c.status === 'restarting') {
      say('Container', c.name, 'Stopping');
      e.stopByName(c);
      say('Container', c.name, 'Stopped');
    }
    say('Container', c.name, 'Removing');
    e.removeByName(c, false);
    say('Container', c.name, 'Removed');
  }
  const nets = e.state.networks.filter((n) => n.labels['com.docker.compose.project'] === m.name);
  const vols = p.flags.has('--volumes') ? e.state.volumes.filter((v) => v.labels['com.docker.compose.project'] === m.name) : [];
  for (const n of nets) say('Network', n.name, 'Removing');
  for (const v of vols) {
    say('Volume', v.name, 'Removing');
    e.state.volumes = e.state.volumes.filter((x) => x !== v);
    say('Volume', v.name, 'Removed');
  }
  for (const n of nets) {
    e.state.networks = e.state.networks.filter((x) => x !== n);
    say('Network', n.name, 'Removed');
  }
  // --rmi local: images Compose built (no custom tag); --rmi all: every image the services use.
  const rmi = p.flags.get('--rmi')?.slice(-1)[0];
  if (rmi === 'local' || rmi === 'all') {
    for (const s of m.services) {
      if (rmi === 'local' && s.image) continue;
      const ref = s.image ?? `${m.name}-${s.name}`;
      const img = e.findImage(ref);
      if (!img || e.state.containers.some((c) => c.imageId === img.id)) continue;
      say('Image', ref, 'Removing');
      e.state.images = e.state.images.filter((i) => i !== img);
      say('Image', ref, 'Removed');
    }
  }
  return 0;
}

function ps(e: DockerEngine, m: ComposeModel, args: string[], out: Out): number {
  const p = parseFlags(args, [flag('-a,--all'), flag('-q,--quiet'), flag('--format', true), flag('--services')], 'compose ps');
  const ctrs = projectContainers(e, m).filter((c) => p.flags.has('--all') || c.status === 'running' || c.status === 'restarting').sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (p.flags.has('--quiet')) {
    ctrs.forEach((c) => out.add(c.id.slice(0, 12)));
    return 0;
  }
  if (p.flags.has('--services')) {
    ctrs.forEach((c) => out.add(c.labels['com.docker.compose.service']));
    return 0;
  }
  const rows = ctrs.map((c) => {
    const status = (() => {
      const now = e.now();
      if (c.status === 'running') return `Up ${humanDuration(now - (c.startedAt ?? now))}${c.health ? ` (${c.health})` : ''}`;
      if (c.status === 'restarting') return `Restarting (${c.exitCode ?? 0}) ${humanDuration(now - (c.finishedAt ?? now))} ago`;
      if (c.status === 'created') return 'Created';
      return `Exited (${c.exitCode ?? 0}) ${humanDuration(now - (c.finishedAt ?? now))} ago`;
    })();
    return [c.name, c.image, quoteCommand(e.commandText(c)), c.labels['com.docker.compose.service'], `${humanDuration(e.now() - c.created)} ago`, status, e.portsText(c)];
  });
  const fmt = p.flags.get('--format')?.slice(-1)[0];
  if (fmt && !fmt.startsWith('table') && fmt !== 'json') {
    rows.forEach((r, i) => out.add(e.template(fmt, { Name: r[0], Image: r[1], Command: r[2], Service: r[3], CreatedAt: r[4], Status: r[5], Ports: r[6], State: ctrs[i].status, ID: ctrs[i].id.slice(0, 12), Health: ctrs[i].health ?? '', ExitCode: ctrs[i].exitCode ?? 0 })));
    return 0;
  }
  table(['NAME', 'IMAGE', 'COMMAND', 'SERVICE', 'CREATED', 'STATUS', 'PORTS'], rows).forEach((l) => out.add(l));
  return 0;
}

function logs(e: DockerEngine, m: ComposeModel, args: string[], out: Out): number {
  const p = parseFlags(args, [flag('-f,--follow'), flag('-n,--tail', true), flag('-t,--timestamps'), flag('--no-log-prefix')], 'compose logs');
  const tail = p.flags.get('--tail')?.slice(-1)[0];
  for (const s of m.services.filter((x) => !p.pos.length || p.pos.includes(x.name))) {
    const c = e.findContainer(ctrName(m, s));
    if (!c) continue;
    let lines = c.logs;
    if (tail && tail !== 'all') lines = lines.slice(Math.max(0, lines.length - Number(tail)));
    for (const l of lines) out.add(p.flags.has('--no-log-prefix') ? l : `${s.name}-1  | ${l}`);
  }
  return 0;
}

function config(m: ComposeModel, out: Out): number {
  const doc: Record<string, unknown> = { name: m.name, services: {} };
  for (const s of m.services) {
    const o: Record<string, unknown> = {};
    if (s.build) o.build = { context: s.build.context, dockerfile: s.build.dockerfile };
    if (s.command) o.command = s.command;
    if (Object.keys(s.dependsOn).length) o.depends_on = Object.fromEntries(Object.entries(s.dependsOn).map(([k, v]) => [k, { condition: v, required: true }]));
    if (s.environment.length) o.environment = Object.fromEntries(s.environment.map((x) => [x.split('=')[0], x.includes('=') ? x.slice(x.indexOf('=') + 1) : null]));
    if (s.healthcheck) o.healthcheck = { test: ['CMD-SHELL', s.healthcheck] };
    if (s.image) o.image = s.image;
    o.networks = Object.fromEntries((s.networks.length ? s.networks : ['default']).map((n) => [n, null]));
    if (s.ports.length) o.ports = s.ports.map((p) => {
      const parts = p.split(':');
      return { mode: 'ingress', target: Number(parts[parts.length - 1]), ...(parts.length > 1 ? { published: parts[parts.length - 2], ...(parts.length > 2 ? { host_ip: parts[0] } : {}) } : {}), protocol: 'tcp' };
    });
    if (s.restart) o.restart = s.restart;
    if (s.volumes.length) o.volumes = s.volumes.map((v) => ({ type: v.type, source: v.source, target: v.target, ...(v.readOnly ? { read_only: true } : {}) }));
    (doc.services as Record<string, unknown>)[s.name] = o;
  }
  const nets: Record<string, unknown> = {};
  for (const s of m.services) for (const n of s.networks.length ? s.networks : ['default']) nets[n] = { name: netName(m, n) };
  doc.networks = nets;
  if (Object.keys(m.volumes).length) doc.volumes = Object.fromEntries(Object.keys(m.volumes).map((v) => [v, { name: volName(m, v) }]));
  stringifyYaml(doc).replace(/\n$/, '').split('\n').forEach((l) => out.add(l));
  return 0;
}

registerCompose((e, args, out) => {
  try {
    const g = parseFlags(args, [flag('-p,--project-name', true), flag('-f,--file', true), flag('--project-directory', true)], 'compose', true);
    const [sub, ...rest] = g.pos;
    if (sub === 'version') {
      out.add('Docker Compose version v5.5.0');
      return 0;
    }
    if (!sub) throw new CliError("Usage:  docker compose [OPTIONS] COMMAND\n\nRun 'docker compose COMMAND --help' for more information on a command.", 0);
    const m = loadCompose(e, g.flags.get('--file')?.slice(-1)[0], g.flags.get('--project-name')?.slice(-1)[0]);
    for (const w of m.warnings) out.err(w);
    switch (sub) {
      case 'up':
        return up(e, m, rest, out);
      case 'down':
        return down(e, m, rest, out);
      case 'ps':
        return ps(e, m, rest, out);
      case 'logs':
        return logs(e, m, rest, out);
      case 'config':
        return config(m, out);
      case 'build':
        for (const s of order(m, rest.filter((a) => !a.startsWith('-')))) {
          if (!s.build) continue;
          const saved = e.cwd;
          e.cwd = joinPath(e.cwd, s.build.context);
          try {
            build(e, { tags: [s.image ?? `${m.name}-${s.name}`], file: s.build.dockerfile, context: '.', noCache: rest.includes('--no-cache') }, out);
          } finally {
            e.cwd = saved;
          }
        }
        return 0;
      case 'pull':
        for (const s of m.services) if (s.image) {
          out.add(` Image ${s.image} Pulling`, 'dim');
          e.pullQuiet(s.image);
          out.add(` Image ${s.image} Pulled`, 'dim');
        }
        return 0;
      case 'stop':
      case 'start':
      case 'restart': {
        const svcs = order(m, rest.filter((a) => !a.startsWith('-')));
        const list = sub === 'stop' ? [...svcs].reverse() : svcs;
        for (const s of list) {
          const c = e.findContainer(ctrName(m, s));
          if (!c) continue;
          if (sub !== 'start') {
            out.add(` Container ${c.name} Stopping`, 'dim');
            e.stopByName(c);
            out.add(` Container ${c.name} Stopped`, 'dim');
          }
          if (sub !== 'stop') {
            out.add(` Container ${c.name} Starting`, 'dim');
            c.manuallyStopped = false;
            e.startCreated(c);
            out.add(` Container ${c.name} Started`, 'dim');
          }
        }
        return 0;
      }
      case 'exec': {
        const p = parseFlags(rest, [flag('-T'), flag('-i'), flag('-t'), flag('-e,--env', true), flag('-w,--workdir', true), flag('-u,--user', true)], 'compose exec', true);
        const [svc, ...cmd] = p.pos;
        const s = m.services.find((x) => x.name === svc);
        if (!s) throw new CliError(`service "${svc}" is not running`, 1);
        const c = e.findContainer(ctrName(m, s));
        if (!c || c.status !== 'running') throw new CliError(`service "${svc}" is not running`, 1);
        return e.docker(['exec', c.name, ...cmd], out);
      }
      case 'rm': {
        for (const c of projectContainers(e, m).filter((x) => x.status !== 'running')) {
          out.add(` Container ${c.name} Removing`, 'dim');
          e.removeByName(c, false);
          out.add(` Container ${c.name} Removed`, 'dim');
        }
        return 0;
      }
    }
    throw new CliError(`unknown docker command: "compose ${sub}"`, 1);
  } catch (err) {
    if (err instanceof CliError) {
      if (err.code === 0) out.add(err.text);
      else out.err(err.text);
      return err.code;
    }
    throw err;
  }
});
