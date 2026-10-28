/**
 * Compose Architect blueprints: write a compose.yaml to spec. "Deploy" runs
 * `docker compose up -d` on a fresh machine and the goals inspect the result.
 * tests/docker-games.test.ts proves each solution meets every goal and the starter does not.
 */
import { DockerEngine, loadCompose } from '../engine';
import type { Container } from '../engine/types';
import type { TranscriptEntry } from '../check';

export interface Deployment {
  yaml: string;
  ok: boolean;
  engine: DockerEngine;
  transcript: TranscriptEntry[];
}

export interface BlueprintGoal {
  label: string;
  check: (d: Deployment) => boolean;
}

export interface Blueprint {
  title: string;
  brief: string;
  files?: Record<string, string>;
  starter: string;
  goals: BlueprintGoal[];
  solution: string;
  hint: string;
  par: number;
  seconds: number;
}

const PROJECT = '/home/learner/myapp';
export const svcName = (svc: string) => `myapp-${svc}-1`;

export function deploy(b: Blueprint, yaml: string): Deployment {
  const files: Record<string, string> = { [`${PROJECT}/compose.yaml`]: yaml.endsWith('\n') ? yaml : yaml + '\n' };
  for (const [k, v] of Object.entries(b.files ?? {})) files[`${PROJECT}/${k}`] = v;
  const engine = new DockerEngine({ seed: 7, files });
  const r = engine.exec('docker compose up -d');
  return { yaml, ok: r.exitCode === 0, engine, transcript: [{ cmd: 'docker compose up -d', lines: r.lines, code: r.exitCode }] };
}

export function blueprintMet(b: Blueprint, d: Deployment | null): boolean[] {
  return b.goals.map((g) => {
    if (!d) return false;
    try {
      return g.check(d);
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------- goal helpers

const ctr = (d: Deployment, svc: string): Container | undefined => d.engine.findContainer(svcName(svc));
const up = (svc: string, image?: string): BlueprintGoal => ({
  label: `\`${svc}\` is Up${image ? ` (\`${image}\`)` : ''}`,
  check: (d) => {
    const c = ctr(d, svc);
    return !!c && c.status === 'running' && (!image || c.image === image);
  },
});
const serves = (port: number, marker: string, what: string): BlueprintGoal => ({
  label: `localhost:${port} shows ${what}`,
  check: (d) => {
    const r = d.engine.probe(port);
    return r.code === 0 && r.body.includes(marker);
  },
});
/** `from` reaches `to` by service name. */
export function svcReaches(d: Deployment, from: string, to: string): boolean {
  const a = ctr(d, from);
  return !!a && a.status === 'running' && d.engine.resolve(a, to)?.target?.name === svcName(to);
}
const reach = (from: string, to: string): BlueprintGoal => ({ label: `\`${from}\` → \`${to}\` connects by name`, check: (d) => svcReaches(d, from, to) });
const cutOff = (a: string, b: string): BlueprintGoal => ({
  label: `\`${a}\` and \`${b}\` share no network`,
  check: (d) => {
    const x = ctr(d, a);
    const y = ctr(d, b);
    return !!x && !!y && !x.networks.some((n) => y.networks.includes(n));
  },
});
const unpublished = (svc: string): BlueprintGoal => ({ label: `\`${svc}\` isn't published on the host`, check: (d) => !!ctr(d, svc) && ctr(d, svc)!.ports.length === 0 });
const namedVolume = (svc: string, vol: string, path: string): BlueprintGoal => ({
  label: `\`${svc}\` keeps \`${path}\` in the named volume \`${vol}\``,
  check: (d) => !!ctr(d, svc)?.mounts.some((m) => m.type === 'volume' && m.source === `myapp_${vol}` && m.target.replace(/\/$/, '') === path),
});
const healthy = (svc: string): BlueprintGoal => ({ label: `\`${svc}\` is healthy`, check: (d) => ctr(d, svc)?.health === 'healthy' });
const waitsFor = (svc: string, dep: string): BlueprintGoal => ({
  label: `\`${svc}\` waits until \`${dep}\` is healthy`,
  check: (d) => loadCompose(d.engine, undefined, undefined).services.find((s) => s.name === svc)?.dependsOn[dep] === 'service_healthy',
});
const restarts = (svc: string, policy: string): BlueprintGoal => ({ label: `\`${svc}\` restarts automatically (\`${policy}\`)`, check: (d) => ctr(d, svc)?.restart === policy });
const envIs = (svc: string, kv: string): BlueprintGoal => ({ label: `\`${svc}\` has \`${kv}\``, check: (d) => !!ctr(d, svc)?.env.includes(kv) });

// ---------------------------------------------------------------- blueprints

const NGINX = 'Welcome to nginx!';
const API = {
  'package.json': '{"name":"api","scripts":{"start":"node server.js"},"dependencies":{"express":"^4"}}',
  'package-lock.json': '{}',
  'server.js': "const http = require('http');\nhttp.createServer((req, res) => res.end('orders api')).listen(3000);\n",
  Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nUSER node\nCMD ["node", "server.js"]\n',
};

export const COMPOSER: Blueprint[] = [
  {
    title: 'Front door',
    brief: 'One service, **web**, running **nginx:alpine**, reachable at **localhost:8080**.',
    starter: 'services:\n  web:\n',
    goals: [up('web', 'nginx:alpine'), serves(8080, NGINX, 'the nginx page')],
    solution: 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n',
    hint: '`image: nginx:alpine` and `ports: ["8080:80"]` under web.',
    par: 1,
    seconds: 120,
  },
  {
    title: 'Corner shop',
    brief: 'Add a **cache** (**redis:alpine**) next to the **web** server (nginx:alpine on 8080). web must find it by name; the cache must **not** be published on the host.',
    starter: 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n',
    goals: [up('web'), up('cache', 'redis:alpine'), reach('web', 'cache'), unpublished('cache'), serves(8080, NGINX, 'the nginx page')],
    solution: 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n  cache:\n    image: redis:alpine\n',
    hint: 'Just add a second service. Compose puts both on one network where service names resolve.',
    par: 1,
    seconds: 150,
  },
  {
    title: 'The vault',
    brief: 'A **db** service: **postgres:16-alpine** with the password `secret`, its data (`/var/lib/postgresql/data`) in a named volume **dbdata**, and no published port.',
    starter: 'services:\n  db:\n    image: postgres:16-alpine\n',
    goals: [up('db', 'postgres:16-alpine'), namedVolume('db', 'dbdata', '/var/lib/postgresql/data'), unpublished('db')],
    solution: 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n    volumes:\n      - dbdata:/var/lib/postgresql/data\nvolumes:\n  dbdata:\n',
    hint: '`environment: { POSTGRES_PASSWORD: secret }`, `volumes: ["dbdata:/var/lib/postgresql/data"]`, and declare `dbdata:` under a top-level `volumes:`.',
    par: 1,
    seconds: 180,
  },
  {
    title: 'Two tiers',
    brief: '**web** (nginx:alpine, on 8080) talks to **api** (traefik/whoami); api talks to **db** (redis:alpine). web must **never** share a network with db. Use networks **front** and **back**.',
    starter: 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n  api:\n    image: traefik/whoami\n  db:\n    image: redis:alpine\n',
    goals: [reach('web', 'api'), reach('api', 'db'), cutOff('web', 'db'), serves(8080, NGINX, 'the nginx page')],
    solution: 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n    networks: [front]\n  api:\n    image: traefik/whoami\n    networks: [front, back]\n  db:\n    image: redis:alpine\n    networks: [back]\nnetworks:\n  front:\n  back:\n',
    hint: 'web on `front`, db on `back`, api on both. Declare both under a top-level `networks:`.',
    par: 2,
    seconds: 240,
  },
  {
    title: 'Wait for it',
    brief: '**web** (nginx:alpine) must only start once **db** (postgres:16-alpine, password `secret`) is **ready**. Check readiness with `pg_isready -U postgres`.',
    starter: 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n  web:\n    image: nginx:alpine\n    depends_on:\n      - db\n',
    goals: [healthy('db'), waitsFor('web', 'db'), up('web'), reach('web', 'db')],
    solution: 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U postgres"]\n      interval: 5s\n      retries: 5\n  web:\n    image: nginx:alpine\n    depends_on:\n      db:\n        condition: service_healthy\n',
    hint: 'db gets `healthcheck: { test: ["CMD-SHELL", "pg_isready -U postgres"] }`; web gets the long form `depends_on: { db: { condition: service_healthy } }`.',
    par: 2,
    seconds: 240,
  },
  {
    title: 'Grand opening',
    brief: 'The real thing: **api** is **built** from this folder (it listens on 3000) and published on **3000**, with `CACHE_HOST=cache`, restarting **unless-stopped**. **cache** is redis:alpine, not published.',
    files: API,
    starter: 'services:\n',
    goals: [serves(3000, 'orders api', 'the orders api'), envIs('api', 'CACHE_HOST=cache'), restarts('api', 'unless-stopped'), reach('api', 'cache'), unpublished('cache')],
    solution: 'services:\n  api:\n    build: .\n    ports:\n      - "3000:3000"\n    environment:\n      CACHE_HOST: cache\n    restart: unless-stopped\n  cache:\n    image: redis:alpine\n',
    hint: '`build: .` instead of `image:`; `environment: { CACHE_HOST: cache }`; `restart: unless-stopped`.',
    par: 2,
    seconds: 300,
  },
];
