/**
 * Everything that happens *inside* a simulated container: its filesystem
 * (image files + volumes + bind mounts + writable layer), the handful of
 * commands learners use with `docker exec` / `sh -c`, name resolution and
 * the main process a command turns into.
 */
import { CATALOG, type CatalogEntry } from './catalog';
import type { Container, Image, Proc } from './types';
import { joinPath, normalizePath, shellWords, splitShell } from './util';

const DELETED = '\u0000DELETED';

/** What the shell needs from the engine. */
export interface ShellHost {
  now(): number;
  files: Record<string, string>; // host files (bind mount sources)
  volumeFiles(name: string): Record<string, string> | null;
  /** Resolve a DNS name as seen from container `from` → target container + ip. */
  resolve(from: Container, name: string): { ip: string; target: Container | null } | null;
  /** Perform an HTTP GET to a container's port, as seen from inside the network. */
  httpGet(target: Container, port: number, path: string, fromIp: string, hostHeader?: string, client?: 'curl' | 'wget'): { status: number; body: string } | { error: 'refused' | 'reset' | 'empty' };
  cwdHost: string;
  /** A shell context inside another container (to read its files). */
  ctx(c: Container): Ctx;
}

const REDIS_AOF = '/data/appendonlydir/appendonly.aof.1.incr.aof';

function redisAof(c: Container): boolean {
  const i = c.cmd.indexOf('--appendonly');
  return i >= 0 && c.cmd[i + 1] === 'yes';
}

/** The Redis server's keys, loaded from disk the first time (AOF if enabled, else dump.rdb). */
function redisMem(srv: Ctx): Record<string, string> {
  const p = srv.c.proc;
  if (!p || p.kind !== 'server') return {};
  if (!p.kv) {
    const raw = (redisAof(srv.c) && readFile(srv, REDIS_AOF)) || readFile(srv, '/data/dump.rdb');
    try {
      p.kv = raw ? JSON.parse(raw.replace(/^REDIS0012\n/, '') || '{}') : {};
    } catch {
      p.kv = {};
    }
  }
  return p.kv!;
}

function redisSaveRdb(srv: Ctx) {
  writeFile(srv, '/data/dump.rdb', 'REDIS0012\n' + JSON.stringify(redisMem(srv)));
}

/** A clean Redis shutdown (SIGTERM): save the snapshot. Returns the log lines, or null if this isn't Redis. */
export function redisShutdown(srv: Ctx): string[] | null {
  if (!srv.c.cmd.some((w) => /(^|\/)redis-server$/.test(w)) || srv.c.proc?.kind !== 'server') return null;
  redisSaveRdb(srv);
  return ['1:signal-handler ({TS}) Received SIGTERM scheduling shutdown...', '1:M {DATE} {HMS}.000 * User requested shutdown...', '1:M {DATE} {HMS}.000 * Saving the final RDB snapshot before exiting.', '1:M {DATE} {HMS}.000 * DB saved on disk', '1:M {DATE} {HMS}.000 # Redis is now ready to exit, bye bye...'];
}

/** Open a TCP connection from this container to HOST:PORT. */
function connectTo(ctx: Ctx, host: string, port: number): { ctx: Ctx } | { err: 'unknown' | 'refused' } {
  const r = ctx.host.resolve(ctx.c, host);
  if (!r) return { err: 'unknown' };
  const t = r.target;
  if (!t || t.status !== 'running' || t.proc?.kind !== 'server' || t.proc.port !== port) return { err: 'refused' };
  return { ctx: t === ctx.c ? ctx : ctx.host.ctx(t) };
}

/** `-h HOST -p PORT` style options (also `--host=`), with defaults. */
function hostPort(args: string[], defPort: number, hostFlag = '-h', portFlag = '-p'): { host: string; port: number; rest: string[] } {
  let host = 'localhost';
  let port = defPort;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === hostFlag) host = args[++i] ?? host;
    else if (args[i] === portFlag) port = Number(args[++i] ?? port);
    else rest.push(args[i]);
  }
  return { host, port, rest };
}

export interface Ctx {
  host: ShellHost;
  c: Container;
  img: Image;
  entry: CatalogEntry;
  cwd: string;
  env: Record<string, string>;
}

/** Users every image of a family has, plus the image's own service users. */
const BUILTIN_USERS: Record<string, string> = { node: 'node:x:1000:1000', nginx: 'nginx:x:101:101', postgres: 'postgres:x:999:999', redis: 'redis:x:999:1000', mysql: 'mysql:x:999:999', 'www-data': 'www-data:x:33:33' };

/** Resolve a USER/-u value (`name`, `uid`, `name:group`) like the runtime does via /etc/passwd. Null = unknown name. */
export function lookupUser(ctx: Ctx, spec: string): { name: string | null; uid: number; gid: number; group: string | null } | null {
  const who = (spec || 'root').split(':')[0];
  const lines = ['root:x:0:0', 'nobody:x:65534:65534'];
  const repo = ctx.entry.repo;
  if (BUILTIN_USERS[repo]) lines.push(BUILTIN_USERS[repo]);
  for (const l of (readFile(ctx, '/etc/passwd') ?? '').split('\n')) if (l.trim()) lines.push(l);
  const rows = lines.map((l) => l.split(':')).map((p) => ({ name: p[0], uid: Number(p[2]), gid: Number(p[3]) }));
  const groupOf = (gid: number) => rows.find((r) => r.gid === gid && r.uid === gid)?.name ?? (gid === 0 ? 'root' : null);
  const byName = rows.find((r) => r.name === who);
  if (byName) return { ...byName, group: groupOf(byName.gid) };
  if (/^\d+$/.test(who)) {
    const byUid = rows.find((r) => r.uid === Number(who));
    return byUid ? { ...byUid, group: groupOf(byUid.gid) } : { name: null, uid: Number(who), gid: 0, group: 'root' };
  }
  return null;
}

export interface RunResult {
  out: string[];
  code: number;
  /** If the command keeps running (main process), what it does. */
  proc?: Proc;
  /** Logs produced while starting (for main processes). */
  logs?: string[];
  /** Memory the process needs (MiB). */
  memMb?: number;
}

/** MiB a script allocates up front: `Buffer.alloc(300 * 1024 * 1024)`, `bytearray(300 * 1024 * 1024)`… */
export function allocMb(src: string): number {
  let mb = 0;
  for (const m of src.matchAll(/(\d+)\s*\*\s*1024\s*\*\s*1024/g)) mb += Number(m[1]);
  return mb;
}

export function envMap(list: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const kv of list) {
    const i = kv.indexOf('=');
    if (i > 0) m[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return m;
}

export function family(entry: CatalogEntry): 'alpine' | 'debian' | 'scratch' {
  return entry.family;
}

// ------------------------------------------------------------------ filesystem

interface Resolved {
  kind: 'volume' | 'bind' | 'root';
  store: Record<string, string>;
  key: string; // key within store
  readOnly: boolean;
}

function mountFor(ctx: Ctx, path: string): { m: Container['mounts'][number]; rel: string } | null {
  let best: { m: Container['mounts'][number]; rel: string } | null = null;
  for (const m of ctx.c.mounts) {
    const t = normalizePath(m.target);
    if (path === t || path.startsWith(t + '/')) {
      if (!best || t.length > normalizePath(best.m.target).length) best = { m, rel: path.slice(t.length) };
    }
  }
  return best;
}

function resolvePath(ctx: Ctx, rawPath: string): Resolved {
  const path = joinPath(ctx.cwd, rawPath);
  const mm = mountFor(ctx, path);
  if (mm) {
    if (mm.m.type === 'volume') {
      const store = ctx.host.volumeFiles(mm.m.source) ?? {};
      return { kind: 'volume', store, key: mm.rel || '/', readOnly: mm.m.readOnly };
    }
    const base = joinPath(ctx.host.cwdHost, mm.m.source);
    return { kind: 'bind', store: ctx.host.files, key: normalizePath(base + mm.rel), readOnly: mm.m.readOnly };
  }
  return { kind: 'root', store: ctx.c.rootfs, key: path, readOnly: false };
}

export function readFile(ctx: Ctx, rawPath: string): string | null {
  const r = resolvePath(ctx, rawPath);
  if (r.kind === 'root') {
    const w = ctx.c.rootfs[r.key];
    if (w === DELETED) return null;
    if (w !== undefined && !r.key.endsWith('/')) return w;
    const f = ctx.img.files[r.key];
    return f !== undefined && !r.key.endsWith('/') ? f : null;
  }
  const v = r.store[r.key];
  return v === undefined || v === DELETED ? null : v;
}

/** Child names of a directory (dirs get a trailing '/'), or null if it isn't a directory. */
export function listDir(ctx: Ctx, rawPath: string): string[] | null {
  const dir = joinPath(ctx.cwd, rawPath);
  const prefix = dir === '/' ? '/' : dir + '/';
  const names = new Map<string, boolean>(); // name → isDir
  let exists = dir === '/';
  const add = (key: string, base: string) => {
    if (key === base) exists = true; // an empty directory (created by mkdir)
    if (!key.startsWith(base) || key === base) return;
    exists = true;
    const rest = key.slice(base.length);
    const slash = rest.indexOf('/');
    if (slash === -1) names.set(rest, names.get(rest) ?? false);
    else if (rest.slice(0, slash)) names.set(rest.slice(0, slash), true);
  };
  const mm = mountFor(ctx, dir);
  if (mm) {
    if (!mm.rel) exists = true;
    if (mm.m.type === 'volume') {
      const store = ctx.host.volumeFiles(mm.m.source) ?? {};
      const base = (mm.rel || '') + '/';
      for (const k of Object.keys(store)) if (store[k] !== DELETED) add(k.startsWith('/') ? k : '/' + k, base === '//' ? '/' : base);
    } else {
      const base = normalizePath(joinPath(ctx.host.cwdHost, mm.m.source) + mm.rel) + '/';
      for (const k of Object.keys(ctx.host.files)) add(k, base);
    }
  } else {
    for (const k of Object.keys(ctx.img.files)) if (ctx.c.rootfs[k] !== DELETED) add(k, prefix);
    for (const [k, v] of Object.entries(ctx.c.rootfs)) if (v !== DELETED) add(k, prefix);
    // Mount points show up as directories in their parent.
    for (const m of ctx.c.mounts) add(normalizePath(m.target) + '/', prefix);
  }
  if (!exists) return null;
  return [...names.entries()].map(([n, d]) => (d ? n + '/' : n)).sort();
}

export function isDir(ctx: Ctx, rawPath: string): boolean {
  return listDir(ctx, rawPath) !== null;
}

export function writeFile(ctx: Ctx, rawPath: string, content: string, append = false): string | null {
  const r = resolvePath(ctx, rawPath);
  if (r.readOnly) return 'Read-only file system';
  const parent = joinPath(ctx.cwd, rawPath).replace(/\/[^/]*$/, '') || '/';
  if (!isDir(ctx, parent)) return 'nonexistent directory';
  const prev = append ? (readFile(ctx, rawPath) ?? '') : '';
  r.store[r.key] = prev + content;
  return null;
}

function removePath(ctx: Ctx, rawPath: string, recursive: boolean): string | null {
  const r = resolvePath(ctx, rawPath);
  if (r.readOnly) return 'Read-only file system';
  const exists = readFile(ctx, rawPath) !== null || isDir(ctx, rawPath);
  if (!exists) return 'No such file or directory';
  if (isDir(ctx, rawPath) && !recursive) return 'Is a directory';
  const key = r.key.replace(/\/$/, '');
  if (r.kind === 'root') {
    const all = new Set([...Object.keys(ctx.img.files), ...Object.keys(ctx.c.rootfs)]);
    for (const k of all) if (k === key || k === key + '/' || k.startsWith(key + '/')) ctx.c.rootfs[k] = DELETED;
  } else {
    for (const k of Object.keys(r.store)) if (k === key || k === key + '/' || k.startsWith(key + '/')) r.store[k] = DELETED;
  }
  return null;
}

export function mkdir(ctx: Ctx, rawPath: string): string | null {
  const r = resolvePath(ctx, rawPath);
  if (r.readOnly) return 'Read-only file system';
  if (r.kind !== 'root' && (r.key === '/' || r.key === '')) return null; // the mount point itself
  r.store[r.key.replace(/\/?$/, '/')] = '';
  return null;
}

// ------------------------------------------------------------------ helpers

function shName(ctx: Ctx): string {
  return family(ctx.entry) === 'debian' ? 'sh' : 'sh';
}

function cantCreate(ctx: Ctx, path: string, why: string): string {
  // busybox ash: "sh: can't create /data/x.txt: Read-only file system"; dash: "sh: 1: cannot create /data/x.txt: Read-only file system"
  return family(ctx.entry) === 'debian' ? `${shName(ctx)}: 1: cannot create ${path}: ${why}` : `${shName(ctx)}: can't create ${path}: ${why}`;
}

export function hostnameOf(c: Container): string {
  return c.id.slice(0, 12);
}

function pingOut(name: string, ip: string): string[] {
  return [
    `PING ${name} (${ip}): 56 data bytes`,
    `64 bytes from ${ip}: seq=0 ttl=64 time=0.136 ms`,
    '',
    `--- ${name} ping statistics ---`,
    '1 packets transmitted, 1 packets received, 0% packet loss',
    'round-trip min/avg/max = 0.136/0.136/0.136 ms',
  ];
}

function parseUrl(url: string): { host: string; port: number; path: string } | null {
  const m = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
  if (!m) return null;
  return { host: m[1], port: m[2] ? Number(m[2]) : 80, path: m[3] ?? '/' };
}

/** Does the image provide this program? */
export function hasTool(ctx: Ctx, prog: string): boolean {
  const base = prog.replace(/^.*\//, '');
  if (ctx.entry.tools.includes(base)) return true;
  // Programs added by the image's own files (built images: COPY'd scripts, installed packages).
  if (readFile(ctx, prog.startsWith('/') ? prog : `/usr/local/bin/${base}`) !== null) return true;
  if (readFile(ctx, `/usr/bin/${base}`) !== null) return true;
  return false;
}

// ------------------------------------------------------------------ commands

type Handler = (ctx: Ctx, args: string[], stdin: string[] | null) => RunResult;

const ok = (out: string[] = []): RunResult => ({ out, code: 0 });
const fail = (out: string[], code = 1): RunResult => ({ out, code });

function httpFetch(ctx: Ctx, url: string, client: 'curl' | 'wget' = 'curl'): { body: string } | { err: string; code: number } {
  const u = parseUrl(url);
  if (!u) return { err: `curl: (3) URL rejected: Malformed input to a URL function`, code: 3 };
  const r = ctx.host.resolve(ctx.c, u.host);
  if (!r) return { err: `curl: (6) Could not resolve host: ${u.host}`, code: 6 };
  if (!r.target) return { err: `curl: (7) Failed to connect to ${u.host} port ${u.port} after 0 ms: Couldn't connect to server`, code: 7 };
  const res = ctx.host.httpGet(r.target, u.port, u.path, r.target === ctx.c ? '127.0.0.1' : (Object.values(ctx.c.ips)[0] ?? '127.0.0.1'), u.port === 80 ? u.host : `${u.host}:${u.port}`, client);
  if ('error' in res) {
    if (res.error === 'refused') return { err: `curl: (7) Failed to connect to ${u.host} port ${u.port} after 0 ms: Couldn't connect to server`, code: 7 };
    if (res.error === 'empty') return { err: 'curl: (52) Empty reply from server', code: 52 };
    return { err: 'curl: (56) Recv failure: Connection reset by peer', code: 56 };
  }
  return { body: res.body };
}

const COMMANDS: Record<string, Handler> = {
  true: () => ok(),
  false: () => fail([], 1),
  pwd: (ctx) => ok([ctx.cwd]),
  hostname: (ctx) => ok([hostnameOf(ctx.c)]),
  id: (ctx) => {
    const u = lookupUser(ctx, ctx.c.user) ?? { name: null, uid: 0, gid: 0, group: 'root' };
    const g = `${u.gid}${u.group ? `(${u.group})` : ''}`;
    return ok([`uid=${u.uid}${u.name ? `(${u.name})` : ''} gid=${g} groups=${g}`]);
  },
  whoami: (ctx) => {
    const u = lookupUser(ctx, ctx.c.user);
    return u?.name ? ok([u.name]) : fail([`whoami: unknown uid ${u?.uid ?? 0}`], 1);
  },
  echo: (_ctx, args) => {
    const noNl = args[0] === '-n';
    return ok([(noNl ? args.slice(1) : args).join(' ')]);
  },
  env: (ctx) => ok(Object.entries(ctx.env).map(([k, v]) => `${k}=${v}`)),
  printenv: (ctx, args) => (args.length ? (ctx.env[args[0]] !== undefined ? ok([ctx.env[args[0]]]) : fail([], 1)) : ok(Object.entries(ctx.env).map(([k, v]) => `${k}=${v}`))),
  cat: (ctx, args, stdin) => {
    if (!args.length) return ok(stdin ?? []);
    const out: string[] = [];
    let code = 0;
    for (const f of args) {
      const v = readFile(ctx, f);
      if (v === null) {
        out.push(isDir(ctx, f) ? `cat: read error: Is a directory` : `cat: can't open '${f}': No such file or directory`);
        code = 1;
      } else out.push(...v.replace(/\n$/, '').split('\n'));
    }
    return { out, code };
  },
  ls: (ctx, args) => {
    const flags = args.filter((a) => a.startsWith('-')).join('');
    const paths = args.filter((a) => !a.startsWith('-'));
    const all = flags.includes('a');
    const long = flags.includes('l');
    const target = paths[0] ?? '.';
    const entries = listDir(ctx, target);
    if (entries === null) {
      if (readFile(ctx, target) !== null) return ok([target]);
      return fail([`ls: ${target}: No such file or directory`], 1);
    }
    const names = [...(all ? ['./', '../'] : []), ...entries.filter((n) => all || !n.startsWith('.'))];
    if (long) return ok(names.map((n) => `${n.endsWith('/') ? 'd' : '-'}rw-r--r--    1 root     root           0 Oct  5 13:14 ${n.replace(/\/$/, '')}`));
    return ok(names.map((n) => n.replace(/\/$/, '')));
  },
  mkdir: (ctx, args) => {
    const parents = args.includes('-p');
    for (const p of args.filter((a) => !a.startsWith('-'))) {
      if (!parents) {
        if (isDir(ctx, p) || readFile(ctx, p) !== null) return fail([`mkdir: can't create directory '${p}': File exists`], 1);
        const parent = joinPath(ctx.cwd, p).replace(/\/[^/]*\/?$/, '') || '/';
        if (!isDir(ctx, parent)) return fail([`mkdir: can't create directory '${p}': No such file or directory`], 1);
      }
      const e = mkdir(ctx, p);
      if (e) return fail([`mkdir: can't create directory '${p}': ${e}`], 1);
    }
    return ok();
  },
  touch: (ctx, args) => {
    for (const p of args) {
      if (readFile(ctx, p) !== null) continue;
      const e = writeFile(ctx, p, '');
      if (e) return fail([`touch: ${p}: ${e}`], 1);
    }
    return ok();
  },
  rm: (ctx, args) => {
    const rec = args.some((a) => /^-[a-zA-Z]*r/.test(a));
    const force = args.some((a) => /^-[a-zA-Z]*f/.test(a));
    for (const p of args.filter((a) => !a.startsWith('-'))) {
      const e = removePath(ctx, p, rec);
      if (e && !(force && e === 'No such file or directory')) return fail([`rm: can't remove '${p}': ${e}`], 1);
    }
    return ok();
  },
  sleep: () => ok(),
  ping: (ctx, args) => {
    const host = args.filter((a, i) => !a.startsWith('-') && !/^-[cW]$/.test(args[i - 1] ?? '')).pop();
    if (!host) return fail(['BusyBox v1.37.0 multi-call binary.', '', 'Usage: ping [OPTIONS] HOST'], 1);
    const r = ctx.host.resolve(ctx.c, host);
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host);
    // --network none has only a loopback interface.
    if (ctx.c.networks.every((n) => n === 'none') && host !== 'localhost' && host !== '127.0.0.1') return fail(isIp ? ['PING ' + host + ' (' + host + '): 56 data bytes', 'ping: sendto: Network unreachable'] : [`ping: bad address '${host}'`], 1);
    if (!r && isIp && !host.startsWith('172.')) return ok(pingOut(host, host)); // outside addresses (e.g. 8.8.8.8) are reachable through the bridge
    if (!r) return fail([`ping: bad address '${host}'`], 1);
    return ok(pingOut(host, r.ip));
  },
  getent: (ctx, args) => {
    if (args[0] !== 'hosts' || !args[1]) return fail([], 2);
    const r = ctx.host.resolve(ctx.c, args[1]);
    if (!r) return fail([], 2);
    return ok([`${r.ip.padEnd(15)} ${args[1]}`]);
  },
  nslookup: (ctx, args) => {
    const name = args[0];
    const r = name ? ctx.host.resolve(ctx.c, name) : null;
    if (!r) return fail(['Server:\t\t127.0.0.11', 'Address:\t127.0.0.11:53', '', `** server can't find ${name}: NXDOMAIN`], 1);
    return ok(['Server:\t\t127.0.0.11', 'Address:\t127.0.0.11:53', '', 'Non-authoritative answer:', `Name:\t${name}`, `Address: ${r.ip}`]);
  },
  curl: (ctx, args) => {
    if (args.includes('--version') || args.includes('-V')) {
      const alp = family(ctx.entry) === 'alpine';
      return ok([`curl 8.14.1 (x86_64-${alp ? 'alpine-linux-musl' : 'pc-linux-gnu'}) libcurl/8.14.1 OpenSSL/3.5.1 zlib/1.3.1`, 'Release-Date: 2025-06-04', 'Protocols: dict file ftp ftps http https imap imaps mqtt pop3 pop3s rtsp smtp smtps telnet tftp ws wss', 'Features: alt-svc AsynchDNS HSTS HTTP2 HTTPS-proxy IPv6 Largefile libz SSL threadsafe UnixSockets']);
    }
    const silent = args.some((a) => /^-[a-zA-Z]*s/.test(a));
    const url = args.filter((a) => !a.startsWith('-')).pop();
    if (!url) return fail(['curl: try \'curl --help\' for more information'], 2);
    const r = httpFetch(ctx, url);
    if ('err' in r) return fail(silent ? [] : [r.err], r.code);
    return ok(r.body.replace(/\n$/, '').split('\n'));
  },
  wget: (ctx, args) => {
    const url = args.filter((a) => !a.startsWith('-')).pop();
    if (!url) return fail(['BusyBox v1.37.0 multi-call binary.'], 1);
    const r = httpFetch(ctx, url, 'wget');
    if ('err' in r) {
      const u = parseUrl(url);
      if (r.code === 6) return fail([`wget: bad address '${u?.host}'`], 1);
      return fail([`wget: can't connect to remote host (${u?.host}): Connection refused`], 1);
    }
    const toStdout = args.some((a) => a === '-O-' || a === '-qO-' || a === '-O' || a.endsWith('O-'));
    return toStdout ? ok(r.body.replace(/\n$/, '').split('\n')) : ok([`Connecting to ${url}`, "saving to 'index.html'", "'index.html' saved"]);
  },
  pg_isready: (ctx, args) => {
    const { host, port } = hostPort(args, 5432);
    const where = host === 'localhost' && !args.includes('-h') ? `/var/run/postgresql:${port}` : `${host}:${port}`;
    const c = connectTo(ctx, host, port);
    return 'ctx' in c && c.ctx.entry.repo === 'postgres' ? ok([`${where} - accepting connections`]) : fail([`${where} - no response`], 2);
  },
  psql: (ctx, args) => {
    const { host, port } = hostPort(args, 5432);
    const c = connectTo(ctx, host, port);
    if ('err' in c) {
      if (c.err === 'unknown') return fail([`psql: error: could not translate host name "${host}" to address: Name or service not known`], 2);
      return fail([host === 'localhost' && !args.includes('-h') ? `psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.${port}" failed: No such file or directory` : `psql: error: connection to server at "${host}" (${ctx.host.resolve(ctx.c, host)?.ip}), port ${port} failed: Connection refused`], 2);
    }
    return ok(['(Connected. The Docker simulator doesn\'t run SQL itself: practise SQL in the PostgreSQL course.)']);
  },
  date: (ctx) => {
    const d = new Date(ctx.host.now());
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    const p2 = (n: number) => String(n).padStart(2, '0');
    return ok([`${day} ${mon} ${String(d.getUTCDate()).padStart(2, ' ')} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}`]);
  },
  nc: (ctx, args) => {
    const pos = args.filter((a) => !a.startsWith('-'));
    const [host, p] = pos;
    if (!host || !p) return fail(['BusyBox v1.37.0 multi-call binary.', '', 'Usage: nc [OPTIONS] HOST PORT  - connect'], 1);
    const c = connectTo(ctx, host, Number(p));
    const verbose = args.some((a) => /^-[a-z]*v/.test(a));
    if ('err' in c) return fail(verbose || c.err === 'unknown' ? [c.err === 'unknown' ? `nc: bad address '${host}'` : `nc: ${host} (${ctx.host.resolve(ctx.c, host)?.ip}:${p}): Connection refused`] : [], 1);
    return ok(verbose ? [`${host} (${ctx.host.resolve(ctx.c, host)?.ip}:${p}) open`] : []);
  },
  'redis-cli': (ctx, args) => {
    if (args.includes('--version') || args.includes('-v')) return ok(['redis-cli 8.2.1']);
    const hp = hostPort(args, 6379);
    const conn = connectTo(ctx, hp.host, hp.port);
    const shown = hp.host === 'localhost' ? '127.0.0.1' : hp.host;
    if ('err' in conn) return fail([`Could not connect to Redis at ${shown}:${hp.port}: ${conn.err === 'unknown' ? 'Name or service not known' : 'Connection refused'}`], 1);
    const srv = conn.ctx;
    // Keys live in the server's memory. They reach /data only on SAVE, a clean shutdown
    // (docker stop), or with --appendonly yes on every write; a kill loses them, as in real Redis.
    const words = hp.rest.filter((a, i) => !a.startsWith('-') && hp.rest[i - 1] !== '-n');
    const cmd = (words[0] ?? 'ping').toLowerCase();
    const db = redisMem(srv);
    const save = () => {
      if (redisAof(srv.c)) {
        mkdir(srv, '/data/appendonlydir');
        writeFile(srv, REDIS_AOF, JSON.stringify(db));
      }
    };
    const [, k, v] = words;
    const wrongArgs = (n: number) => (words.length - 1 < n ? `ERR wrong number of arguments for '${cmd}' command` : null);
    switch (cmd) {
      case 'ping':
        return ok(['PONG']);
      case 'set': {
        const e = wrongArgs(2);
        if (e) return ok([e]);
        db[k] = v;
        save();
        return ok(['OK']);
      }
      case 'get':
        return ok([wrongArgs(1) ?? db[k] ?? '']);
      case 'incr': {
        const n = Number(db[k] ?? '0');
        if (!Number.isInteger(n)) return ok(['ERR value is not an integer or out of range']);
        db[k] = String(n + 1);
        save();
        return ok([db[k]]);
      }
      case 'del':
      case 'exists': {
        const ks = words.slice(1);
        const n = ks.filter((x) => x in db).length;
        if (cmd === 'del') {
          ks.forEach((x) => delete db[x]);
          save();
        }
        return ok([String(n)]);
      }
      case 'keys': {
        const re = new RegExp('^' + (k ?? '*').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        return ok(Object.keys(db).filter((x) => re.test(x)).sort());
      }
      case 'dbsize':
        return ok([String(Object.keys(db).length)]);
      case 'flushall':
      case 'flushdb':
        for (const x of Object.keys(db)) delete db[x];
        save();
        return ok(['OK']);
      case 'save':
      case 'bgsave':
        redisSaveRdb(srv);
        return ok([cmd === 'save' ? 'OK' : 'Background saving started']);
      default:
        return ok([`ERR unknown command '${words[0]}', with args beginning with: ${words.slice(1).map((x) => `'${x}' `).join('')}`]);
    }
  },
  test: (ctx, args) => {
    if (args[0] === '-f') return readFile(ctx, args[1] ?? '') !== null ? ok() : fail([], 1);
    if (args[0] === '-d') return isDir(ctx, args[1] ?? '') ? ok() : fail([], 1);
    if (args[0] === '-e') return readFile(ctx, args[1] ?? '') !== null || isDir(ctx, args[1] ?? '') ? ok() : fail([], 1);
    return ok();
  },
};

// ------------------------------------------------------------------ text filters (shared with the host shell)

export function filter(cmd: string, args: string[], input: string[]): { out: string[]; code: number } | null {
  if (cmd === 'head' || cmd === 'tail') {
    let n = 10;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n') n = Number(args[++i]);
      else if (/^-\d+$/.test(args[i])) n = Number(args[i].slice(1));
    }
    return { out: cmd === 'head' ? input.slice(0, n) : input.slice(Math.max(0, input.length - n)), code: 0 };
  }
  if (cmd === 'grep') {
    const flags = args.filter((a) => a.startsWith('-')).join('');
    const pat = args.find((a) => !a.startsWith('-')) ?? '';
    let re: RegExp;
    try {
      re = new RegExp(pat, flags.includes('i') ? 'i' : '');
    } catch {
      re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
    const out = input.filter((l) => re.test(l) !== flags.includes('v'));
    return { out: flags.includes('c') ? [String(out.length)] : out, code: out.length ? 0 : 1 };
  }
  if (cmd === 'wc') return { out: [String(input.length)], code: 0 };
  if (cmd === 'sort') return { out: [...input].sort(), code: 0 };
  return null;
}

// ------------------------------------------------------------------ script interpreter

/** Runs one simple command (argv) inside the container. */
export function runArgv(ctx: Ctx, argv: string[], stdin: string[] | null = null): RunResult {
  if (!argv.length) return ok();
  const [prog0, ...rest] = argv;
  const prog = prog0.replace(/^\/(usr\/)?(local\/)?s?bin\//, '');
  const wcFiles = prog === 'wc' ? rest.filter((w) => !w.startsWith('-')) : [];
  if (wcFiles.length && hasTool(ctx, 'wc')) {
    // wc FILE…: the count, then the file name.
    const lines = wcFiles.map((f) => {
      const v = readFile(ctx, f);
      return v === null ? `wc: ${f}: No such file or directory` : `${(v.match(/\n/g) ?? []).length} ${f}`;
    });
    return { out: lines, code: lines.some((l) => l.startsWith('wc: ')) ? 1 : 0 };
  }
  const f = filter(prog, rest, stdin ?? []);
  if (f && hasTool(ctx, prog)) return f;
  if (f && ['head', 'tail', 'grep', 'wc', 'sort'].includes(prog) && ctx.entry.family !== 'scratch') return f;
  if ((prog === 'sh' || prog === 'bash' || prog === 'ash') && rest[0] === '-c') return runScript(ctx, rest[1] ?? '');
  if (prog === 'exit') return { out: [], code: Number(rest[0] ?? 0) || 0 };
  if (prog === 'cd') {
    const t = joinPath(ctx.cwd, rest[0] ?? '/');
    if (!isDir(ctx, t)) return fail([`sh: cd: can't cd to ${rest[0]}: No such file or directory`], 2);
    ctx.cwd = t;
    return ok();
  }
  const h = COMMANDS[prog];
  if (h && hasTool(ctx, prog)) return h(ctx, rest, stdin);
  return { out: [], code: 127 };
}

/** `sh -c` style script: `;`, `&&`, `||`, `|`, `>`/`>>` redirection, `$VAR` expansion. */
export function runScript(ctx: Ctx, script: string): RunResult {
  const segs = splitShell(script);
  const out: string[] = [];
  let code = 0;
  let pipe: string[] | null = null;
  let skip = false;
  for (const seg of segs) {
    if (skip) {
      // Skipped by a previous && / ||. A pipeline is skipped as a whole; after a skipped
      // segment, `&&` keeps skipping and `||` / `;` resume (the skipped part "failed"/"succeeded" unchanged).
      skip = seg.op === '|' || (seg.op === '&&' ? code !== 0 : seg.op === '||' ? code === 0 : false);
      continue;
    }
    let words = shellWords(seg.text.replace(/\$\{?(\w+)\}?/g, (_m, v) => (v === '?' ? String(code) : ctx.env[v] ?? '')));
    // Redirections.
    let redirect: { path: string; append: boolean } | null = null;
    const ri = words.findIndex((w) => w === '>' || w === '>>' || /^>>?\S/.test(w));
    if (ri >= 0) {
      const w = words[ri];
      const append = w.startsWith('>>');
      const path = w === '>' || w === '>>' ? words[ri + 1] : w.replace(/^>>?/, '');
      redirect = { path, append };
      words = words.slice(0, ri);
    }
    // Input redirection: `< file` feeds the file to stdin.
    const ii = words.findIndex((w) => w === '<' || /^<[^<]/.test(w));
    if (ii >= 0) {
      const path = words[ii] === '<' ? words[ii + 1] ?? '' : words[ii].slice(1);
      words = [...words.slice(0, ii), ...words.slice(ii + (words[ii] === '<' ? 2 : 1))];
      const v = readFile(ctx, path);
      if (v === null) {
        out.push(family(ctx.entry) === 'debian' ? `sh: 1: cannot open ${path}: No such file` : `sh: can't open '${path}': No such file or directory`);
        code = family(ctx.entry) === 'debian' ? 2 : 1;
        skip = seg.op === '&&' || seg.op === '|';
        continue;
      }
      pipe = v.replace(/\n$/, '').split('\n');
    }
    const res = runArgv(ctx, words, pipe);
    pipe = null;
    if (res.code === 127 && words.length) {
      out.push(`sh: ${words[0]}: not found`);
    }
    if (res.proc) return { out: [...out, ...res.out], code: 0, proc: res.proc, logs: res.logs };
    if (redirect) {
      const e = writeFile(ctx, redirect.path, res.out.map((l) => l + '\n').join(''), redirect.append);
      if (e) {
        out.push(cantCreate(ctx, redirect.path, e === 'nonexistent directory' ? 'nonexistent directory' : e));
        // dash (Debian) exits 2 on any failed redirection; busybox ash exits 2 only for a missing directory.
        code = e === 'nonexistent directory' || family(ctx.entry) === 'debian' ? 2 : 1;
      } else code = res.code;
    } else if (seg.op === '|') {
      pipe = res.out;
      code = res.code;
      continue; // the pipeline continues; && / || apply after its last command
    } else {
      out.push(...res.out);
      code = res.code;
    }
    if (words[0] === 'exit') return { out, code };
    skip = seg.op === '&&' ? code !== 0 : seg.op === '||' ? code === 0 : false;
  }
  return { out, code };
}

// ------------------------------------------------------------------ main processes

const NGINX_DOCROOT = '/usr/share/nginx/html';
const HTTPD_DOCROOT = '/usr/local/apache2/htdocs';

/** Figure out the listening port and response of an app file (node/python). */
/** JS/Python string-literal escapes. */
function unescapeLit(t: string): string {
  return t.replace(/\\([nt'"`\\])/g, (_m, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

/** Does this app file start a server (listen/run), or just run and exit? */
function isServerApp(src: string): boolean {
  return /\.listen\(|createServer|express\(\)|app\.run\(|serve_forever|HTTPServer|uvicorn\.run|Flask\(/.test(src);
}

/** What a print-and-exit script prints: console.log(...) / print(...) with literals and env lookups. */
function scriptOutput(src: string, env: Record<string, string>): { out: string[]; code: number } {
  const out: string[] = [];
  const envOf = (name: string) => env[name];
  const part = (p: string): string => {
    const t = p.trim();
    const lit = /^(['"`])([\s\S]*)\1$/.exec(t);
    if (lit) return unescapeLit(lit[2]).replace(/\$\{\s*process\.env\.(\w+)\s*\}/g, (_m, n) => envOf(n) ?? 'undefined');
    const js = /^process\.env\.(\w+)$/.exec(t) ?? /^process\.env\[['"](\w+)['"]\]$/.exec(t);
    if (js) return envOf(js[1]) ?? 'undefined';
    const py = /^os\.environ\[['"](\w+)['"]\]$/.exec(t) ?? /^os\.environ\.get\(\s*['"](\w+)['"]\s*(?:,\s*(['"])(.*?)\2)?\s*\)$/.exec(t) ?? /^os\.getenv\(\s*['"](\w+)['"]\s*(?:,\s*(['"])(.*?)\2)?\s*\)$/.exec(t);
    if (py) return envOf(py[1]) ?? py[3] ?? 'None';
    if (/^-?\d+(\.\d+)?$/.test(t)) return t;
    return t;
  };
  // Split on a separator outside quotes and brackets.
  const splitTop = (s: string, sep: string) => {
    const res: string[] = [];
    let depth = 0;
    let q: string | null = null;
    let cur = '';
    for (const ch of s) {
      if (q) {
        if (ch === q) q = null;
      } else if (ch === '"' || ch === "'" || ch === '`') q = ch;
      else if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      else if (ch === sep && !depth) {
        res.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    res.push(cur);
    return res;
  };
  const re = /(?:console\.log|print)\(((?:[^()"'`]|"[^"]*"|'[^']*'|`[^`]*`|\([^()]*\))*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (!m[1].trim()) {
      out.push('');
      continue;
    }
    const f = /^\s*f(['"])([\s\S]*)\1\s*$/.exec(m[1]);
    if (f) {
      out.push(...unescapeLit(f[2]).replace(/\{([^}]+)\}/g, (_x, e: string) => part(e)).split('\n'));
      continue;
    }
    const args = splitTop(m[1], ',').map((a) => splitTop(a, '+').map(part).join(''));
    out.push(...args.join(' ').split('\n'));
  }
  const exit = /process\.exit\((\d+)\)|sys\.exit\((\d+)\)/.exec(src);
  return { out, code: exit ? Number(exit[1] ?? exit[2]) : 0 };
}

function appServer(src: string, fallbackPort: number): { port: number; response: string } {
  const portM =
    /listen\(\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d+)/.exec(src) ??
    /port\s*=\s*(?:int\(os\.environ\.get\([^)]*?(\d+)|(\d+))/i.exec(src) ??
    /PORT\s*\|\|\s*(\d+)/.exec(src);
  const port = portM ? Number(portM[1] ?? portM[2]) : fallbackPort;
  const respM = /\b\w+\.(?:end|send)\(\s*(['"`])([\s\S]*?)\1/.exec(src) ?? /return\s+(['"])([\s\S]*?)\1/.exec(src);
  return { port, response: respM ? unescapeLit(respM[2]) : 'OK' };
}

/**
 * What does the container's main command do when it starts? Returns either an
 * exit (with output) or a long-running process. `argv` = entrypoint + cmd.
 */
export function startProcess(ctx: Ctx, argv: string[], isCatalogDefault: boolean): RunResult {
  let a = [...argv];
  // Entrypoint wrapper scripts pass through to the command (like the real ones do with `exec "$@"`).
  let script: string | null = null;
  while (a.length && /(^|\/)docker-entrypoint\.sh$/.test(a[0])) {
    script = a[0];
    a = a.slice(1);
  }
  const e = ctx.entry;
  // Like the official scripts: arguments that start with "-" are options for the image's main program.
  const mainProg: Record<string, string> = { redis: 'redis-server', postgres: 'postgres', mysql: 'mysqld', node: 'node' };
  if (script && a[0]?.startsWith('-') && mainProg[e.repo]) a = [mainProg[e.repo], ...a];

  if (isCatalogDefault) {
    if (e.requiredEnv && !e.requiredEnv.anyOf.some((k) => ctx.env[k])) return { out: [], code: e.requiredEnv.exitCode, logs: e.requiredEnv.logs };
    const b = e.behavior;
    if (b.kind === 'oneshot') return { out: b.output, code: b.exitCode ?? 0 };
    if (b.kind === 'shell') return ctx.c.interactive || ctx.c.tty ? { out: [], code: 0, proc: { kind: 'idle' } } : { out: [], code: 0 };
    if (b.kind === 'server') {
      initDataDir(ctx);
      const docroot = e.repo === 'nginx' ? NGINX_DOCROOT : e.repo === 'httpd' ? HTTPD_DOCROOT : undefined;
      return { out: [], code: 0, proc: { kind: 'server', port: b.port ?? 80, docroot, response: b.response }, logs: e.startLogs ?? [], memMb: e.memMb };
    }
  }

  if (!a.length) return { out: [], code: 0 };
  const prog = a[0].replace(/^.*\//, '');
  const rest = a.slice(1);

  // Long-running programs.
  if (prog === 'sleep') {
    const n = rest[0] === 'infinity' ? Infinity : Number(rest[0]);
    if (!Number.isFinite(n)) return { out: [], code: 0, proc: { kind: 'idle' } };
    if (n <= 0) return { out: [], code: 0 };
    return { out: [], code: 0, proc: { kind: 'timer', until: ctx.host.now() + n * 1000 } };
  }
  if (prog === 'tail' && rest.includes('-f')) return { out: [], code: 0, proc: { kind: 'idle' } };
  if (prog === 'nginx' && hasTool(ctx, 'nginx')) return { out: [], code: 0, proc: { kind: 'server', port: 80, docroot: NGINX_DOCROOT }, logs: CATALOG.nginx.startLogs };
  if (prog === 'httpd-foreground') return { out: [], code: 0, proc: { kind: 'server', port: 80, docroot: HTTPD_DOCROOT }, logs: CATALOG.httpd.startLogs };
  if (prog === 'redis-server') {
    const bad = redisBadOption(rest);
    if (bad) return { out: [], code: 1, logs: ['', '*** FATAL CONFIG FILE ERROR (Redis 8.2.1) ***', 'Reading the configuration file, at line 2', `>>> '${bad}'`, 'Bad directive or wrong number of arguments'] };
    const pi = rest.indexOf('--port');
    initDataDir(ctx);
    return { out: [], code: 0, proc: { kind: 'server', port: pi >= 0 ? Number(rest[pi + 1]) : 6379 }, logs: CATALOG.redis.startLogs, memMb: CATALOG.redis.memMb };
  }
  if ((prog === 'postgres' || prog === 'mysqld') && e.requiredEnv) {
    if (!e.requiredEnv.anyOf.some((k) => ctx.env[k])) return { out: [], code: e.requiredEnv.exitCode, logs: e.requiredEnv.logs };
    initDataDir(ctx);
    return { out: [], code: 0, proc: { kind: 'server', port: prog === 'postgres' ? 5432 : 3306 }, logs: e.startLogs, memMb: e.memMb };
  }
  if (prog === 'whoami' && e.repo === 'traefik/whoami') return { out: [], code: 0, proc: { kind: 'server', port: 80, response: e.behavior.kind === 'server' ? e.behavior.response : '' }, logs: e.startLogs };

  if ((prog === 'node' || prog === 'npm') && hasTool(ctx, 'node')) {
    let file: string | null = null;
    if (prog === 'node' && (rest[0] === '-e' || rest[0] === '--eval')) return scriptOutput(rest[1] ?? '', ctx.env);
    if (prog === 'node' && rest[0]) file = rest[0];
    if (prog === 'npm' && (rest[0] === 'start' || (rest[0] === 'run' && rest[1] === 'start'))) {
      const pkg = readFile(ctx, 'package.json');
      if (pkg === null) return { out: [], code: 254, logs: [`npm error code ENOENT`, `npm error syscall open`, `npm error path ${joinPath(ctx.cwd, 'package.json')}`, `npm error errno -2`, `npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '${joinPath(ctx.cwd, 'package.json')}'`] };
      const m = /"start"\s*:\s*"node\s+([^"\s]+)/.exec(pkg);
      file = m ? m[1] : 'server.js';
    }
    if (!file) return ctx.c.interactive || ctx.c.tty ? { out: [], code: 0, proc: { kind: 'idle' } } : { out: [], code: 0 };
    const src = readFile(ctx, file);
    const full = joinPath(ctx.cwd, file);
    if (src === null) return { out: [], code: 1, logs: ['node:internal/modules/cjs/loader:1386', '  throw err;', '  ^', '', `Error: Cannot find module '${full}'`, '    at Function._resolveFilename (node:internal/modules/cjs/loader:1383:15)', '', 'Node.js v22.20.0'] };
    if (!isServerApp(src)) return { ...scriptOutput(src, ctx.env), memMb: 42 + allocMb(src) };
    const s = appServer(src, 3000);
    return { out: [], code: 0, proc: { kind: 'server', port: Number(ctx.env.PORT) || s.port, response: s.response, app: true }, logs: [`Server listening on port ${Number(ctx.env.PORT) || s.port}`], memMb: 48 + allocMb(src) };
  }
  if ((prog === 'python' || prog === 'python3') && hasTool(ctx, 'python3')) {
    if (rest[0] === '-m' && rest[1] === 'http.server') {
      const port = Number(rest[2]) || 8000;
      const listing = (listDir(ctx, '.') ?? []).map((n) => `<li><a href="${n}">${n}</a></li>`).join('\n');
      return { out: [], code: 0, proc: { kind: 'server', port, listing: `<!DOCTYPE HTML>\n<html>\n<title>Directory listing for /</title>\n<body>\n<ul>\n${listing}\n</ul>\n</body>\n</html>\n` }, logs: [`Serving HTTP on 0.0.0.0 port ${port} (http://0.0.0.0:${port}/) ...`] };
    }
    if (!rest[0]) return ctx.c.interactive || ctx.c.tty ? { out: [], code: 0, proc: { kind: 'idle' } } : { out: [], code: 0 };
    if (rest[0] === '-c') return scriptOutput(rest[1] ?? '', ctx.env);
    const src = readFile(ctx, rest[0]);
    if (src === null) return { out: [], code: 2, logs: [`python3: can't open file '${joinPath(ctx.cwd, rest[0])}': [Errno 2] No such file or directory`] };
    if (!isServerApp(src)) return { ...scriptOutput(src, ctx.env), memMb: 9 + allocMb(src) };
    const s = appServer(src, 5000);
    return { out: [], code: 0, proc: { kind: 'server', port: s.port, response: s.response, app: true }, logs: [` * Running on http://0.0.0.0:${s.port}`], memMb: 24 + allocMb(src) };
  }

  // Interactive shells.
  if ((prog === 'sh' || prog === 'bash' || prog === 'ash') && !rest.length) {
    if (!hasTool(ctx, prog)) return { out: [], code: 127 };
    return ctx.c.interactive || ctx.c.tty ? { out: [], code: 0, proc: { kind: 'idle' } } : { out: [], code: 0 };
  }
  // Shell scripts: run until a long-running command (e.g. `echo hi && sleep 300`).
  if ((prog === 'sh' || prog === 'bash') && rest[0] === '-c') {
    const segs = splitShell(rest[1] ?? '');
    const last = segs[segs.length - 1];
    if (last) {
      const lastWords = shellWords(last.text.replace(/^exec\s+/, ''));
      const lp = lastWords[0]?.replace(/^.*\//, '');
      if (['sleep', 'tail', 'nginx', 'node', 'npm', 'python', 'python3', 'redis-server', 'httpd-foreground'].includes(lp ?? '')) {
        const head = segs.slice(0, -1).map((s) => s.text + (s.op && s.op !== '|' ? ` ${s.op} ` : ' ')).join('');
        const pre = head ? runScript(ctx, head.replace(/\s*(&&|;|\|\|)\s*$/, '')) : { out: [], code: 0 };
        if (pre.code !== 0 && /&&\s*$/.test(head)) return pre;
        const main = startProcess(ctx, lastWords, false);
        return { ...main, out: [...pre.out, ...main.out] };
      }
    }
    return runScript(ctx, rest[1] ?? '');
  }
  if (!hasTool(ctx, prog) && !COMMANDS[prog]) {
    // An existing file that isn't a program: the runtime can't execute it (126).
    if (a[0].startsWith('/') && !/\/s?bin\//.test(a[0]) && readFile(ctx, a[0]) !== null) return { out: [], code: 126 };
    // Through an entrypoint script the container did start; the script's `exec` fails.
    if (script) return { out: [], code: 127, logs: [e.repo === 'postgres' ? `${script}: line 351: exec: ${a[0]}: not found` : `${script}: 47: exec: ${a[0]}: not found`] };
    return { out: [], code: 127 };
  }
  return runArgv(ctx, a);
}

const REDIS_OPTIONS = new Set(['port', 'bind', 'appendonly', 'appendfsync', 'requirepass', 'save', 'maxmemory', 'maxmemory-policy', 'protected-mode', 'loglevel', 'databases', 'dir', 'dbfilename', 'maxclients', 'timeout', 'tcp-keepalive']);

/** redis-server takes config directives as `--name value`; an unknown one is fatal. */
function redisBadOption(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const name = args[i].slice(2);
    const vals: string[] = [];
    while (i + 1 < args.length && !args[i + 1].startsWith('--')) vals.push(args[++i]);
    if (!REDIS_OPTIONS.has(name)) return `${name} ${vals.map((v) => `"${v}"`).join(' ')}`.trim();
  }
  return null;
}

/** First start of a database image: create its data files (in the mounted volume if there is one). */
function initDataDir(ctx: Ctx) {
  const dd = ctx.entry.dataDir;
  if (!dd || !dd.files.length) return;
  const existing = listDir(ctx, dd.path);
  if (existing && existing.length) return; // already initialised (e.g. a reused volume)
  for (const f of dd.files) writeFile(ctx, `${dd.path}/${f}`, f === 'PG_VERSION' ? '16\n' : '');
}

/** Runs a healthcheck command; healthy when it exits 0. */
export function checkHealth(ctx: Ctx, test: string): boolean {
  const t = test.replace(/^CMD-SHELL\s+/, '').replace(/\s*\|\|\s*exit 1\s*$/, '');
  return runScript(ctx, t).code === 0;
}

export { DELETED };
