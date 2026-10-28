/**
 * Mission levels for the Docker games: a starting machine, goals checked live
 * against the engine, a par (how many changing commands an expert needs) and
 * a reference solution. tests/docker-games.test.ts proves each mission is
 * unsolved at the start and solved by its solution.
 */
import { DockerEngine } from '../engine';
import type { Container } from '../engine/types';

/** Recorded right after a mission's setup ran. */
export interface MissionStart {
  time: number;
  /** Container ids by name at the start. */
  ids: Record<string, string>;
}

export interface Goal {
  label: string;
  check: (e: DockerEngine, start: MissionStart) => boolean;
}

export interface Mission {
  title: string;
  story: string;
  setup: string[];
  goals: Goal[];
  /** A question answered by typing (e.g. a code found in the logs). */
  ask?: { question: string; answer: (e: DockerEngine) => string };
  par: number;
  solution: string[];
  /** For the ask: what the solver types. */
  solutionAnswer?: string;
  hint: string;
  seconds: number;
  /** Port Traffic Control: the host ports shown as traffic lanes. */
  lanes?: { port: number; want: string; marker: string }[];
  /** Network Switchboard: the connections shown on the board (must = true, must not = false). */
  lines?: { from: string; to: string; want: boolean }[];
  /** Project files on the machine (relative to ~/myapp). */
  files?: Record<string, string>;
}

// ---------------------------------------------------------------- goal helpers

const ctr = (e: DockerEngine, name: string): Container | undefined => e.state.containers.find((c) => c.name === name);
const imageOf = (e: DockerEngine, c: Container) => {
  const i = e.state.images.find((x) => x.id === c.imageId);
  return i ? `${i.repo}:${i.tags[0] ?? '<none>'}` : '';
};
const norm = (ref: string) => (ref.includes(':') ? ref : `${ref}:latest`);

export const hasImage = (ref: string): Goal => ({ label: `Image \`${norm(ref)}\` is on the machine`, check: (e) => !!e.findImage(ref) });
export const noImage = (ref: string): Goal => ({ label: `Image \`${norm(ref)}\` is gone`, check: (e) => !e.findImage(ref) });
export const running = (name: string, image?: string): Goal => ({
  label: `\`${name}\` is Up${image ? ` (from \`${norm(image)}\`)` : ''}`,
  check: (e) => {
    const c = ctr(e, name);
    return !!c && c.status === 'running' && (!image || imageOf(e, c) === norm(image));
  },
});
export const exited = (name: string, image: string, code = 0): Goal => ({
  label: `\`${name}\` ran \`${norm(image)}\` and Exited (${code})`,
  check: (e) => {
    const c = ctr(e, name);
    return !!c && c.status === 'exited' && c.exitCode === code && imageOf(e, c) === norm(image);
  },
});
export const gone = (name: string): Goal => ({ label: `No container called \`${name}\``, check: (e) => !ctr(e, name) });
export const onlyRunning = (names: string[]): Goal => ({
  label: `Nothing else left over: no stopped containers`,
  check: (e) => e.state.containers.every((c) => c.status === 'running' && names.includes(c.name)),
});
export const runsCmd = (name: string, cmd: string): Goal => ({
  label: `\`${name}\` runs \`${cmd}\``,
  check: (e) => {
    const c = ctr(e, name);
    return !!c && c.status === 'running' && c.cmd.join(' ').endsWith(cmd);
  },
});
export const startedAfterSetup = (name: string): Goal => ({
  label: `\`${name}\` was restarted (fresh start time)`,
  check: (e, start) => {
    const c = ctr(e, name);
    return !!c && c.status === 'running' && (c.startedAt ?? 0) > start.time;
  },
});
export const lane = (port: number, marker: string, what: string): Goal => ({
  label: `localhost:${port} → ${what}`,
  check: (e) => {
    const r = e.probe(port);
    return r.code === 0 && r.body.includes(marker);
  },
});
export const publishedOn = (name: string, hostIp: string, port: number): Goal => ({
  label: `\`${name}\` listens on ${hostIp}:${port} only`,
  check: (e) => !!ctr(e, name)?.ports.some((p) => p.hostIp === hostIp && p.hostPort === port),
});

const volFile = (e: DockerEngine, vol: string, path: string): string | undefined => {
  const v = e.state.volumes.find((x) => x.name === vol)?.files[path];
  return v === undefined || typeof v !== 'string' ? undefined : v;
};
export const volumeHas = (vol: string, path: string, text: string): Goal => ({
  label: `Volume \`${vol}\` holds \`${path}\` (with “${text}”)`,
  check: (e) => !!volFile(e, vol, path)?.includes(text),
});
export const hostHas = (path: string, text: string): Goal => ({
  label: `Your folder has \`${path}\` (with “${text}”)`,
  check: (e) => !!e.files[`/home/learner/myapp/${path}`]?.includes(text),
});
/** A Redis key as the running server sees it: its memory, or what it will load from /data. */
export const redisValue = (name: string, key: string, value: string): Goal => ({
  label: `\`${name}\` answers \`${key}\` = ${value}`,
  check: (e) => {
    const c = ctr(e, name);
    if (!c || c.status !== 'running' || c.proc?.kind !== 'server') return false;
    if (c.proc.kv) return c.proc.kv[key] === value;
    const m = c.mounts.find((x) => x.target === '/data' && x.type === 'volume');
    const raw = m ? volFile(e, m.source, '/dump.rdb') : undefined;
    try {
      return !!raw && JSON.parse(raw.replace(/^REDIS0012\n/, ''))[key] === value;
    } catch {
      return false;
    }
  },
});
/** Can `from` reach `to` by name (DNS on a shared user-defined network, and `to` is running)? */
export function reaches(e: DockerEngine, from: string, to: string): boolean {
  const a = ctr(e, from);
  if (!a || a.status !== 'running') return false;
  return e.resolve(a, to)?.target?.name === to;
}
/** Do the two share any network at all (even by IP they could talk)? */
function shareNetwork(e: DockerEngine, a: string, b: string): boolean {
  const x = ctr(e, a);
  const y = ctr(e, b);
  return !!x && !!y && x.networks.some((n) => n !== 'none' && n !== 'host' && y.networks.includes(n));
}
export const canReach = (from: string, to: string): Goal => ({ label: `\`${from}\` → \`${to}\` connects (by name)`, check: (e) => reaches(e, from, to) });
export const isolated = (a: string, b: string): Goal => ({ label: `\`${a}\` and \`${b}\` share no network at all`, check: (e) => !!ctr(e, a) && !!ctr(e, b) && !shareNetwork(e, a, b) });
export const onNetworks = (name: string, nets: string[]): Goal => ({
  label: `\`${name}\` is on ${nets.map((n) => `\`${n}\``).join(' + ')} only`,
  check: (e) => {
    const c = ctr(e, name);
    return !!c && [...c.networks].sort().join() === [...nets].sort().join();
  },
});
export const noPorts = (name: string): Goal => ({ label: `\`${name}\` publishes no ports`, check: (e) => !!ctr(e, name) && ctr(e, name)!.ports.length === 0 });

/** A fresh machine with the mission's setup applied. */
export function prepareMission(m: Mission, realClock = false): { engine: DockerEngine; start: MissionStart } {
  const files = Object.fromEntries(Object.entries(m.files ?? {}).map(([k, v]) => [`/home/learner/myapp/${k}`, v]));
  const engine = new DockerEngine({ seed: 7, realClock, files });
  for (const c of m.setup) engine.exec(c);
  engine.journal = [];
  return { engine, start: { time: engine.now(), ids: Object.fromEntries(engine.state.containers.map((c) => [c.name, c.id])) } };
}

export function goalsMet(m: Mission, e: DockerEngine, start: MissionStart): boolean[] {
  return m.goals.map((g) => {
    try {
      return g.check(e, start);
    } catch {
      return false;
    }
  });
}

const NGINX = 'Welcome to nginx!';
const WHOAMI = 'Hostname:';
const HTTPD = 'It works!';

/** Commands that only look (they don't count against par). */
export function isLookOnly(cmd: string): boolean {
  return /^(docker (ps|images|image ls|container ls|logs|inspect|port|version|info|(?:volume|network) (?:ls|inspect)|history|stats|top|system df|compose (?:ps|logs|config))|docker \w+ --help|curl|ls|cat|help|clear|pwd|echo)\b/.test(cmd.trim()) || /^docker exec \S+ (ls|cat|hostname|env|curl)\b/.test(cmd.trim());
}

// ---------------------------------------------------------------- Engine Match (module 1)

export const ENGINE_MATCH: Mission[] = [
  {
    title: 'Stock the shelf',
    story: 'The team needs the **redis** image available offline. Don\'t start anything yet.',
    setup: [],
    goals: [hasImage('redis'), { label: 'No containers', check: (e) => e.state.containers.length === 0 }],
    par: 1,
    solution: ['docker pull redis'],
    hint: '`docker pull` downloads without running.',
    seconds: 60,
  },
  {
    title: 'Open for business',
    story: 'Start the **nginx** web server in the background, named `web`.',
    setup: [],
    goals: [running('web', 'nginx')],
    par: 1,
    solution: ['docker run -d --name web nginx'],
    hint: '`docker run -d --name NAME IMAGE`',
    seconds: 60,
  },
  {
    title: 'Proof of life',
    story: 'Run **hello-world** once, in a container named `hello`, and have the small **nginx:alpine** image ready too.',
    setup: [],
    goals: [exited('hello', 'hello-world'), hasImage('nginx:alpine')],
    par: 2,
    solution: ['docker run --name hello hello-world', 'docker pull nginx:alpine'],
    hint: 'hello-world prints its message and exits by itself. Tags go after a colon.',
    seconds: 90,
  },
  {
    title: 'Twins',
    story: 'Two web servers, both from **nginx**, both running: `blue` and `green`.',
    setup: [],
    goals: [running('blue', 'nginx'), running('green', 'nginx')],
    par: 2,
    solution: ['docker run -d --name blue nginx', 'docker run -d --name green nginx'],
    hint: 'One image, two `docker run`s, two names.',
    seconds: 90,
  },
  {
    title: 'The right flavour',
    story: 'A cache server called `cache` must run from **redis:alpine** (not plain redis!), and an **alpine** container called `note` must have printed `hi` and finished.',
    setup: [],
    goals: [running('cache', 'redis:alpine'), exited('note', 'alpine'), { label: '`note` printed `hi`', check: (e) => ctr(e, 'note')?.logs.join('\n').trim() === 'hi' }],
    par: 2,
    solution: ['docker run -d --name cache redis:alpine', 'docker run --name note alpine echo hi'],
    hint: 'Put the tag on the image: `redis:alpine`. For note: `docker run --name note alpine echo hi`.',
    seconds: 120,
  },
  {
    title: 'Name clash',
    story: 'Someone left a **stopped** container named `app` (from busybox). You need `app` to be a **running httpd** server now.',
    setup: ['docker run --name app busybox echo old'],
    goals: [running('app', 'httpd')],
    par: 2,
    solution: ['docker rm app', 'docker run -d --name app httpd'],
    hint: 'The old container still owns the name `app`. Remove it first: `docker rm app`.',
    seconds: 120,
  },
];

// ---------------------------------------------------------------- Lifecycle Rush (module 2)

export const LIFECYCLE_RUSH: Mission[] = [
  {
    title: 'Who switched it off?',
    story: 'The `web` container was stopped by mistake. Bring **the same container** back.',
    setup: ['docker run -d --name web nginx', 'docker stop web'],
    goals: [running('web', 'nginx'), { label: 'Still the original container (not a new one)', check: (e, start) => ctr(e, 'web')?.id === start.ids.web }],
    par: 1,
    solution: ['docker start web'],
    hint: 'A stopped container can be started again: `docker start web`.',
    seconds: 60,
  },
  {
    title: 'Sleepy worker',
    story: '`job` (alpine) keeps exiting straight away. Replace it with a `job` container that stays up running `sleep 3600`.',
    setup: ['docker run -d --name job alpine'],
    goals: [runsCmd('job', 'sleep 3600')],
    par: 2,
    solution: ['docker rm job', 'docker run -d --name job alpine sleep 3600'],
    hint: 'Its main process (a shell) ends at once. Remove it, then run alpine with `sleep 3600` as the command.',
    seconds: 90,
  },
  {
    title: 'Spring cleaning',
    story: 'Three finished containers are lying around. Remove every stopped container, but keep `api` running.',
    setup: ['docker run -d --name api nginx', 'docker run --name t1 alpine echo 1', 'docker run --name t2 alpine echo 2', 'docker run --name t3 busybox echo 3'],
    goals: [running('api', 'nginx'), onlyRunning(['api'])],
    par: 1,
    solution: ['docker container prune -f'],
    hint: '`docker container prune -f` removes all stopped containers in one go.',
    seconds: 90,
  },
  {
    title: 'Have you tried turning it off and on again?',
    story: '`api` is acting up. **Restart** it (it must come back Up).',
    setup: ['docker run -d --name api nginx'],
    goals: [startedAfterSetup('api')],
    par: 1,
    solution: ['docker restart api'],
    hint: '`docker restart NAME` = stop + start.',
    seconds: 60,
  },
  {
    title: 'Last words',
    story: 'The `mystery` container printed a **secret code** before it exited. Find it.',
    setup: ['docker run --name mystery alpine sh -c "echo booting; echo code: K7Q2; echo shutting down"'],
    goals: [],
    ask: { question: 'What is the secret code?', answer: () => 'K7Q2' },
    par: 0,
    solution: ['docker logs mystery'],
    solutionAnswer: 'K7Q2',
    hint: 'What a container printed is kept in its logs, even after it stops.',
    seconds: 90,
  },
  {
    title: 'Look inside',
    story: 'The running container `vault` holds one file in `/data`. What is its name?',
    setup: ['docker run -d --name vault alpine sh -c "mkdir -p /data && echo x > /data/plans-2027.txt && sleep 3600"'],
    goals: [running('vault', 'alpine')],
    ask: { question: 'File name in /data:', answer: () => 'plans-2027.txt' },
    par: 0,
    solution: ['docker exec vault ls /data'],
    solutionAnswer: 'plans-2027.txt',
    hint: '`docker exec vault ls /data` runs ls inside the running container.',
    seconds: 90,
  },
  {
    title: 'Busy name, running server',
    story: '`web` runs **nginx:1.27**, but it must run **nginx:alpine** now, still named `web`. Do it, and leave no old container behind.',
    setup: ['docker run -d --name web nginx:1.27'],
    goals: [running('web', 'nginx:alpine'), onlyRunning(['web'])],
    par: 2,
    solution: ['docker rm -f web', 'docker run -d --name web nginx:alpine'],
    hint: 'Free the name first: `docker rm -f web` (or stop + rm), then run the new image.',
    seconds: 120,
  },
];

// ---------------------------------------------------------------- Port Traffic Control (module 3)

export const PORT_CONTROL: Mission[] = [
  {
    title: 'First lane',
    story: 'Traffic for **port 8080** must reach an nginx web server. Name it `web`.',
    setup: [],
    goals: [lane(8080, NGINX, 'nginx')],
    lanes: [{ port: 8080, want: 'nginx', marker: NGINX }],
    par: 1,
    solution: ['docker run -d --name web -p 8080:80 nginx'],
    hint: 'nginx listens on 80 inside: `-p 8080:80`.',
    seconds: 60,
  },
  {
    title: 'Who\'s there?',
    story: 'Port **9000** must reach a `traefik/whoami` app (it listens on port 80).',
    setup: [],
    goals: [lane(9000, WHOAMI, 'whoami')],
    lanes: [{ port: 9000, want: 'whoami', marker: WHOAMI }],
    par: 1,
    solution: ['docker run -d --name who -p 9000:80 traefik/whoami'],
    hint: '`-p 9000:80`',
    seconds: 60,
  },
  {
    title: 'Occupied',
    story: '`legacy` (nginx) owns port 8080 and must keep serving it. Add an **httpd** server reachable on port **8081**.',
    setup: ['docker run -d --name legacy -p 8080:80 nginx'],
    goals: [lane(8080, NGINX, 'nginx (legacy)'), lane(8081, HTTPD, 'httpd')],
    lanes: [
      { port: 8080, want: 'nginx', marker: NGINX },
      { port: 8081, want: 'httpd', marker: HTTPD },
    ],
    par: 1,
    solution: ['docker run -d --name apache -p 8081:80 httpd'],
    hint: 'A host port can serve one container. httpd also listens on 80 inside.',
    seconds: 90,
  },
  {
    title: 'Dead end',
    story: '`broken` was published as `-p 8080:8080`, so port 8080 resets every connection. Make port **8080** reach nginx.',
    setup: ['docker run -d --name broken -p 8080:8080 nginx'],
    goals: [lane(8080, NGINX, 'nginx')],
    lanes: [{ port: 8080, want: 'nginx', marker: NGINX }],
    par: 2,
    solution: ['docker rm -f broken', 'docker run -d --name fixed -p 8080:80 nginx'],
    hint: 'Ports are fixed when a container is created: remove it and run a new one with `-p 8080:80`.',
    seconds: 120,
  },
  {
    title: 'Rush hour',
    story: 'Three lanes: **8001** and **8002** → whoami (two separate containers), **8003** → nginx.',
    setup: [],
    goals: [lane(8001, WHOAMI, 'whoami'), lane(8002, WHOAMI, 'whoami'), lane(8003, NGINX, 'nginx'), { label: '8001 and 8002 are different containers', check: (e) => { const a = e.probe(8001).body.split('\n')[0]; const b = e.probe(8002).body.split('\n')[0]; return !!a && a !== b; } }],
    lanes: [
      { port: 8001, want: 'whoami', marker: WHOAMI },
      { port: 8002, want: 'whoami', marker: WHOAMI },
      { port: 8003, want: 'nginx', marker: NGINX },
    ],
    par: 3,
    solution: ['docker run -d --name w1 -p 8001:80 traefik/whoami', 'docker run -d --name w2 -p 8002:80 traefik/whoami', 'docker run -d --name web -p 8003:80 nginx'],
    hint: 'One `docker run` per lane. Each whoami gets its own host port, all on 80 inside.',
    seconds: 150,
  },
  {
    title: 'Staff only',
    story: 'Run nginx as `admin` on port **7000**, but reachable **only from this machine** (127.0.0.1).',
    setup: [],
    goals: [lane(7000, NGINX, 'nginx'), publishedOn('admin', '127.0.0.1', 7000)],
    lanes: [{ port: 7000, want: 'nginx (private)', marker: NGINX }],
    par: 1,
    solution: ['docker run -d --name admin -p 127.0.0.1:7000:80 nginx'],
    hint: '`-p 127.0.0.1:7000:80`',
    seconds: 90,
  },
  {
    title: 'Lucky number',
    story: 'Run `traefik/whoami` as `lucky` with **-P** (random port). Then report which host port it got.',
    setup: ['docker run -d --name taken -P nginx'],
    goals: [running('lucky', 'traefik/whoami'), { label: '`lucky` was published with -P', check: (e) => !!ctr(e, 'lucky')?.ports.some((p) => p.hostPort >= 32768) }],
    ask: { question: 'Host port of lucky:', answer: (e) => String(ctr(e, 'lucky')?.ports[0]?.hostPort ?? '') },
    par: 1,
    solution: ['docker run -d -P --name lucky traefik/whoami', 'docker port lucky'],
    solutionAnswer: '32769',
    hint: '`docker run -d -P --name lucky traefik/whoami`, then `docker port lucky`.',
    seconds: 120,
  },
];

// ---------------------------------------------------------------- Data Rescue (module 4)

export const DATA_RESCUE: Mission[] = [
  {
    title: 'Evacuate the diary',
    story: 'The container `diary` is scheduled for demolition. Its only copy of `/data/diary.txt` lives **inside** it, with no volume. Get the file into your folder, then demolish `diary` yourself.',
    setup: ['docker run -d --name diary alpine sh -c "mkdir /data && echo Day 1: learned Docker > /data/diary.txt && sleep 3600"'],
    goals: [hostHas('diary.txt', 'Day 1'), gone('diary')],
    par: 2,
    solution: ['docker cp diary:/data/diary.txt .', 'docker rm -f diary'],
    hint: '`docker cp CONTAINER:PATH .` copies a file out of a container (even a stopped one).',
    seconds: 120,
  },
  {
    title: 'A vault from day one',
    story: 'Start PostgreSQL 16 as `vault` (password `secret`), with its data in a volume named **pgvault** from the very first second.',
    setup: [],
    goals: [running('vault', 'postgres:16'), volumeHas('pgvault', '/PG_VERSION', '')],
    par: 1,
    solution: ['docker run -d --name vault -e POSTGRES_PASSWORD=secret -v pgvault:/var/lib/postgresql/data postgres:16'],
    hint: 'postgres keeps its data in `/var/lib/postgresql/data`.',
    seconds: 120,
  },
  {
    title: 'Move it into a volume',
    story: 'The `shop` container kept its orders in `/data/orders.txt`, inside the container. Rescue the file into a volume called **orders** (as `/orders.txt` at the volume\'s top level), then remove `shop`. Leave no containers behind.',
    setup: ['docker run -d --name shop alpine sh -c "mkdir /data && echo order 1: bread > /data/orders.txt && sleep 3600"'],
    goals: [volumeHas('orders', '/orders.txt', 'order 1'), gone('shop'), { label: 'No containers left', check: (e) => e.state.containers.length === 0 }],
    par: 4,
    solution: ['docker cp shop:/data/orders.txt .', 'docker create --name mover -v orders:/x alpine', 'docker cp orders.txt mover:/x/', 'docker rm -f shop mover'],
    hint: 'Copy the file out to your folder. A container that mounts the volume (it doesn\'t even need to run: `docker create`) lets you `docker cp` it in.',
    seconds: 240,
  },
  {
    title: 'Unsaved changes',
    story: 'The `cache` (redis, volume `cachedata` on /data) just counted `visits` = 42, still only in memory. Upgrade it to **redis:alpine**, same name, same volume, and don\'t lose the count.',
    setup: ['docker run -d --name cache -v cachedata:/data redis', 'docker exec cache redis-cli set visits 42'],
    goals: [running('cache', 'redis:alpine'), redisValue('cache', 'visits', '42')],
    par: 3,
    solution: ['docker stop cache', 'docker rm cache', 'docker run -d --name cache -v cachedata:/data redis:alpine'],
    hint: 'Redis writes its memory to /data when it **stops cleanly**. `docker rm -f` kills it first.',
    seconds: 180,
  },
  {
    title: 'Read-only evidence',
    story: 'Serve the folder **./case** with nginx as `evidence` on **http://localhost:8080**, so the files can be read but never changed by the container.',
    setup: [],
    files: { 'case/index.html': '<h1>Exhibit A</h1>\n' },
    goals: [lane(8080, 'Exhibit A', 'the case files'), { label: 'The mount is read-only', check: (e) => !!ctr(e, 'evidence')?.mounts.some((m) => m.type === 'bind' && m.readOnly && m.target === '/usr/share/nginx/html') }],
    par: 1,
    solution: ['docker run -d --name evidence -p 8080:80 -v ./case:/usr/share/nginx/html:ro nginx'],
    hint: 'A path (`./case`) makes a bind mount; `:ro` at the end makes it read-only.',
    seconds: 150,
  },
  {
    title: 'Spring cleaning',
    story: 'Old volumes are piling up: an anonymous one from a deleted database and an unused `old_cache`. Delete **every unused volume**, but `pgvault` (used by the running `vault`) must survive.',
    setup: ['docker run -d --name tmpdb -e POSTGRES_PASSWORD=x postgres:16', 'docker rm -f tmpdb', 'docker volume create old_cache', 'docker run -d --name vault -e POSTGRES_PASSWORD=secret -v pgvault:/var/lib/postgresql/data postgres:16'],
    goals: [{ label: 'Only `pgvault` is left', check: (e) => e.state.volumes.map((v) => v.name).join() === 'pgvault' }, running('vault', 'postgres:16')],
    par: 1,
    solution: ['docker volume prune -af'],
    hint: '`docker volume prune -f` only removes anonymous volumes; `-a` removes all unused ones.',
    seconds: 120,
  },
];

// ---------------------------------------------------------------- Network Switchboard (module 5)

export const SWITCHBOARD: Mission[] = [
  {
    title: 'First call',
    story: '`phone` wants to call `operator` by name, but both sit on the default bridge, where names don\'t resolve. Connect them, without restarting either.',
    setup: ['docker run -d --name phone alpine sleep 3600', 'docker run -d --name operator alpine sleep 3600'],
    goals: [canReach('phone', 'operator')],
    lines: [{ from: 'phone', to: 'operator', want: true }],
    par: 3,
    solution: ['docker network create line', 'docker network connect line phone', 'docker network connect line operator'],
    hint: 'Create a network, then `docker network connect NET CONTAINER` for each.',
    seconds: 150,
  },
  {
    title: 'Wrong exchange',
    story: '`client` is on `net-a`, `server` on `net-b`. The client must reach the server, and the server must stay **only** on `net-b`.',
    setup: ['docker network create net-a', 'docker network create net-b', 'docker run -d --name client --network net-a alpine sleep 3600', 'docker run -d --name server --network net-b traefik/whoami'],
    goals: [canReach('client', 'server'), onNetworks('server', ['net-b'])],
    lines: [{ from: 'client', to: 'server', want: true }],
    par: 1,
    solution: ['docker network connect net-b client'],
    hint: 'Move the caller, not the callee: connect `client` to `net-b`.',
    seconds: 120,
  },
  {
    title: 'Private line',
    story: 'Wire the three tiers: `web` (on `front`) must reach `api`, and `api` must reach `db` (on `back`). `web` must **never** share a network with `db`. `api` is still on the default bridge.',
    setup: ['docker network create front', 'docker network create back', 'docker run -d --name web --network front nginx', 'docker run -d --name db --network back -e POSTGRES_PASSWORD=secret postgres:16', 'docker run -d --name api traefik/whoami'],
    goals: [canReach('web', 'api'), canReach('api', 'db'), isolated('web', 'db')],
    lines: [{ from: 'web', to: 'api', want: true }, { from: 'api', to: 'db', want: true }, { from: 'web', to: 'db', want: false }],
    par: 2,
    solution: ['docker network connect front api', 'docker network connect back api'],
    hint: 'Only `api` belongs on both networks.',
    seconds: 150,
  },
  {
    title: 'Cut the line',
    story: 'Someone attached `intruder` to the `office` network, where it can reach `files`. Cut it off. `laptop` must keep reaching `files`, and `intruder` keeps running (it\'s evidence).',
    setup: ['docker network create office', 'docker run -d --name files --network office traefik/whoami', 'docker run -d --name laptop --network office alpine sleep 3600', 'docker run -d --name intruder --network office alpine sleep 3600'],
    goals: [canReach('laptop', 'files'), { label: '`intruder` can\'t reach `files`', check: (e) => !reaches(e, 'intruder', 'files') && !shareNetwork(e, 'intruder', 'files') }, running('intruder')],
    lines: [{ from: 'laptop', to: 'files', want: true }, { from: 'intruder', to: 'files', want: false }],
    par: 1,
    solution: ['docker network disconnect office intruder'],
    hint: '`docker network disconnect NET CONTAINER`',
    seconds: 120,
  },
  {
    title: 'Quiet room',
    story: 'Start an **alpine** container called `sandbox` that keeps running (`sleep 3600`) with **no network at all**, for opening suspicious files.',
    setup: [],
    goals: [running('sandbox', 'alpine'), onNetworks('sandbox', ['none'])],
    par: 1,
    solution: ['docker run -d --name sandbox --network none alpine sleep 3600'],
    hint: 'There\'s a built-in network called `none`.',
    seconds: 90,
  },
  {
    title: 'New exchange',
    story: 'From scratch: a network `chat`, a Redis server `cache` and a `traefik/whoami` service `api`, both on `chat`. `api` must reach `cache` by name. Nothing is published to the outside.',
    setup: [],
    goals: [running('cache', 'redis'), running('api', 'traefik/whoami'), canReach('api', 'cache'), noPorts('cache'), noPorts('api')],
    lines: [{ from: 'api', to: 'cache', want: true }],
    par: 3,
    solution: ['docker network create chat', 'docker run -d --name cache --network chat redis', 'docker run -d --name api --network chat traefik/whoami'],
    hint: 'Create the network first, then start both containers with `--network chat`.',
    seconds: 180,
  },
];

// ---------------------------------------------------------------- Break It (module 9)

const healthyGoal = (name: string): Goal => ({ label: `\`${name}\` is Up and **healthy**`, check: (e) => ctr(e, name)?.status === 'running' && ctr(e, name)?.health === 'healthy' });
const finishedWith = (name: string, text: string): Goal => ({
  label: `\`${name}\` finished cleanly (Exited 0) and logged “${text}”`,
  check: (e) => {
    const c = ctr(e, name);
    return !!c && c.status === 'exited' && c.exitCode === 0 && c.logs.some((l) => l.includes(text));
  },
});
const mountedAt = (name: string, vol: string, path: string): Goal => ({
  label: `\`${name}\` keeps \`${path}\` in the volume \`${vol}\``,
  check: (e) => !!ctr(e, name)?.mounts.some((m) => m.type === 'volume' && m.source === vol && m.target.replace(/\/$/, '') === path),
});
const noStopped: Goal = { label: 'No stopped containers left', check: (e) => e.state.containers.every((c) => c.status === 'running') };
const noDangling: Goal = { label: 'No dangling (`<none>`) images', check: (e) => e.state.images.every((i) => i.tags.length > 0) };
const volumeKept = (vol: string): Goal => ({ label: `The volume \`${vol}\` is still there`, check: (e) => e.state.volumes.some((v) => v.name === vol) });

const REPORT_FILES = {
  'report.js': 'const data = Buffer.alloc(300 * 1024 * 1024); // the whole day in memory\nconsole.log("Report finished");\n',
  Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY report.js .\nCMD ["node", "report.js"]\n',
};

export const BREAK_IT: Mission[] = [
  {
    title: 'The worker that won\'t stay up',
    story: 'Someone started the background **worker** (alpine) with `docker run -d --name worker alpine`. It never shows up in `docker ps`. It should just stay up (`sleep infinity` is its job for now).',
    setup: ['docker run -d --name worker alpine'],
    goals: [running('worker', 'alpine')],
    par: 2,
    solution: ['docker rm worker', 'docker run -d --name worker alpine sleep infinity'],
    hint: 'A container lives as long as its main process. Alpine\'s default shell exits at once without a terminal. Remove it and run it again with a long-running command.',
    seconds: 120,
  },
  {
    title: 'Port is already allocated',
    story: 'The new site (`httpd`, container **site**) should be live on **localhost:8080**, but starting it failed: an old nginx container, **old-web**, still holds the port. Retire old-web and get site serving.',
    setup: ['docker run -d --name old-web -p 8080:80 nginx', 'docker create --name site -p 8080:80 httpd'],
    goals: [lane(8080, HTTPD, 'the new site (It works!)'), gone('old-web'), running('site', 'httpd')],
    par: 2,
    solution: ['docker rm -f old-web', 'docker start site'],
    hint: '`docker rm -f old-web` frees the port; `site` already exists (Created), so `docker start site` is enough.',
    seconds: 120,
  },
  {
    title: 'Crash loop',
    story: 'The database **db** (postgres:16-alpine, data in volume `pgdata`) was deployed with `--restart always` and has been restarting ever since. Find out why, and get **db** running for real, still with `pgdata` and the restart policy. Use the password `secret`.',
    setup: ['docker volume create pgdata', 'docker run -d --name db --restart always -v pgdata:/var/lib/postgresql/data postgres:16-alpine', 'sleep 5'],
    goals: [running('db', 'postgres:16-alpine'), mountedAt('db', 'pgdata', '/var/lib/postgresql/data'), { label: '`db` still restarts automatically (`always`)', check: (e) => ctr(e, 'db')?.restart === 'always' }],
    par: 2,
    solution: ['docker rm -f db', 'docker run -d --name db --restart always -e POSTGRES_PASSWORD=secret -v pgdata:/var/lib/postgresql/data postgres:16-alpine'],
    hint: '`docker logs --tail 10 db`: the password is missing. A restart can\'t fix that: remove it and run it again with `-e POSTGRES_PASSWORD=secret`.',
    seconds: 180,
  },
  {
    title: 'Killed in the night',
    story: 'The nightly **report** job (image `report`) died with **Exited (137)** and empty logs. It runs with `--memory 256m`. Get a successful run, in a container called **report2**.',
    files: REPORT_FILES,
    setup: ['docker build -t report .', 'docker run --name report --memory 256m report'],
    goals: [finishedWith('report2', 'Report finished')],
    par: 1,
    solution: ['docker run --name report2 --memory 512m report'],
    hint: '`docker inspect -f "{{.State.OOMKilled}}" report` → true. The job needs about 350 MB: give report2 `--memory 512m`.',
    seconds: 150,
  },
  {
    title: 'Can\'t find the API',
    story: '**probe** (alpine) must call **api** by name, but `docker exec probe wget -qO- http://api` says *bad address*. api lives on the network `shop`. Fix it without recreating anything.',
    setup: ['docker network create shop', 'docker run -d --name api --network shop traefik/whoami', 'docker run -d --name probe alpine sleep infinity'],
    goals: [canReach('probe', 'api'), { label: 'Neither container was recreated', check: (e, s) => ctr(e, 'api')?.id === s.ids.api && ctr(e, 'probe')?.id === s.ids.probe }],
    par: 1,
    solution: ['docker network connect shop probe'],
    hint: 'probe is on the default bridge (no name lookup). `docker network connect shop probe`.',
    seconds: 120,
  },
  {
    title: 'Where did the orders go?',
    story: 'After yesterday\'s upgrade, **db** (postgres:16-alpine) looks empty. Its volume **orders** is there and full, but the container mounts it at the wrong path. Recreate **db** (password `secret`) with **orders** at the right data directory.',
    setup: ['docker volume create orders', 'docker run --rm -v orders:/data alpine sh -c "echo 16 > /data/PG_VERSION; echo order-1041 > /data/orders.log"', 'docker run -d --name db -e POSTGRES_PASSWORD=secret -v orders:/var/lib/postgres/data postgres:16-alpine'],
    goals: [running('db', 'postgres:16-alpine'), mountedAt('db', 'orders', '/var/lib/postgresql/data'), volumeHas('orders', '/orders.log', 'order-1041')],
    par: 2,
    solution: ['docker rm -f db', 'docker run -d --name db -e POSTGRES_PASSWORD=secret -v orders:/var/lib/postgresql/data postgres:16-alpine'],
    hint: '`docker inspect -f "{{json .Mounts}}" db` shows `/var/lib/postgres/data`. Postgres keeps its data in `/var/lib/postgresql/data`.',
    seconds: 180,
  },
  {
    title: 'Disk full',
    story: 'The server\'s disk is nearly full of leftovers: stopped containers and old `<none>` images from rebuilds. Clean them up. **Don\'t touch** the running **db** or its volume **pgdata**.',
    files: { Dockerfile: 'FROM alpine:3.22\nCMD ["echo", "v3"]\n' },
    setup: [
      'docker run -d --name db -e POSTGRES_PASSWORD=secret -v pgdata:/var/lib/postgresql/data postgres:16-alpine',
      'echo \'FROM alpine:3.22\' > Dockerfile', 'echo \'CMD ["echo", "v1"]\' >> Dockerfile', 'docker build -t tool .',
      'echo \'CMD ["echo", "v2"]\' >> Dockerfile', 'docker build -t tool .',
      'echo \'CMD ["echo", "v3"]\' >> Dockerfile', 'docker build -t tool .',
      'docker run --name run1 tool', 'docker run --name run2 tool', 'docker run --name test alpine:3.22 true',
    ],
    goals: [noStopped, noDangling, running('db'), volumeKept('pgdata')],
    par: 2,
    solution: ['docker container prune -f', 'docker image prune -f'],
    hint: '`docker system df` shows where the space goes. `docker container prune -f`, then `docker image prune -f`. Leave `volume prune` alone.',
    seconds: 150,
  },
  {
    title: 'Up, but unhealthy',
    story: '**web** (nginx:alpine, on localhost:8080) shows `(unhealthy)`: its healthcheck asks the wrong port. Recreate it so it\'s **healthy**, still on 8080. (The check runs `curl -f` inside the container.)',
    setup: ['docker run -d --name web -p 8080:80 --health-cmd "curl -f http://localhost:8080/ || exit 1" nginx:alpine', 'sleep 31'],
    goals: [healthyGoal('web'), lane(8080, NGINX, 'nginx')],
    par: 2,
    solution: ['docker rm -f web', 'docker run -d --name web -p 8080:80 --health-cmd "curl -f http://localhost/ || exit 1" nginx:alpine'],
    hint: 'Inside the container nginx listens on 80; 8080 only exists on the host. Health command: `curl -f http://localhost/ || exit 1`.',
    seconds: 180,
  },
];
