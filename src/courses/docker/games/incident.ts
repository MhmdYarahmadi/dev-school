/**
 * The finale, Production Incident: one machine, one broken deployment, several
 * acts. Each act reveals the next problem; fixes carry over to the later acts.
 * tests/docker-games.test.ts plays the whole incident with the reference fixes.
 */
import { DockerEngine } from '../engine';
import type { Container } from '../engine/types';
import type { Goal, MissionStart } from './missions';

export interface Act {
  title: string;
  story: string;
  goals: Goal[];
  /** A question answered by typing what the investigation found. */
  ask?: { question: string; accept: RegExp };
  par: number;
  hint: string;
  /** Reference commands (and, for an ask, what to type). */
  solution: string[];
  solutionAnswer?: string;
}

const PROJECT = '/home/learner/myapp';

const COMPOSE = `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:8080"
    volumes:
      - ./site:/usr/share/nginx/html:ro
    depends_on:
      - api
  api:
    build: .
    environment:
      DB_HOST: db
    mem_limit: 32m
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes:
      - dbdata:/var/lib/postgres/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
  cache:
    image: redis:alpine
volumes:
  dbdata:
`;

export const INCIDENT_FILES: Record<string, string> = {
  'compose.yaml': COMPOSE,
  '.env': 'DB_PASSWORD=crumbs-2026\n',
  'site/index.html': '<h1>The Bakery</h1>\n<p>Order before 10 for same-day pickup.</p>\n',
  'package.json': '{"name":"bakery-api","scripts":{"start":"node server.js"},"dependencies":{"express":"^4"}}',
  'package-lock.json': '{}',
  'server.js': "const http = require('http');\nhttp.createServer((req, res) => res.end('bakery api: 12 orders today')).listen(3000);\n",
  Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nUSER node\nCMD ["node", "server.js"]\n',
};

/** Last week's deploys left junk behind; yesterday's orders sit in the volume. Then tonight's deploy. */
export const INCIDENT_SETUP = [
  'docker run --rm -v myapp_dbdata:/data alpine sh -c "echo 16 > /data/PG_VERSION; echo order-1041 > /data/orders.log"',
  'docker build -t myapp-api .',
  'echo "// v2" >> server.js',
  'docker build -t myapp-api .',
  'echo "// v3" >> server.js',
  'docker run --name smoke-test-1 alpine echo ok',
  'docker run --name smoke-test-2 alpine echo ok',
  'docker compose up -d',
  'sleep 4',
];

export function prepareIncident(realClock = false): { engine: DockerEngine; start: MissionStart } {
  const files = Object.fromEntries(Object.entries(INCIDENT_FILES).map(([k, v]) => [`${PROJECT}/${k}`, v]));
  const engine = new DockerEngine({ seed: 9, realClock, files });
  for (const c of INCIDENT_SETUP) engine.exec(c);
  engine.journal = [];
  return { engine, start: { time: engine.now(), ids: Object.fromEntries(engine.state.containers.map((c) => [c.name, c.id])) } };
}

const svc = (e: DockerEngine, s: string): Container | undefined => e.findContainer(`myapp-${s}-1`);
const SERVICES = ['web', 'api', 'db', 'cache'];

export const ACTS: Act[] = [
  {
    title: '02:47: the pager goes off',
    story: 'Tonight\'s deploy of the bakery stack (`~/myapp`, started with `docker compose up -d`) went out an hour ago. Monitoring says **one service keeps restarting**. Look around (looking is free) and name it.',
    goals: [],
    ask: { question: 'Which service is crash-looping?', accept: /^(myapp-)?api(-1)?$/ },
    par: 0,
    hint: '`docker compose ps -a` (or `docker ps -a`): look for Restarting.',
    solution: ['docker compose ps -a'],
    solutionAnswer: 'api',
  },
  {
    title: '02:55: root cause',
    story: 'It exits with **137**, again and again, with nothing in its logs. Find out why and fix it **in compose.yaml** (the terminal has `sed -i \'s/OLD/NEW/\' FILE`), then update the stack. Keep a memory limit: just make it sensible.',
    goals: [
      { label: '`api` is Up', check: (e) => svc(e, 'api')?.status === 'running' },
      { label: 'It\'s no longer killed for memory', check: (e) => svc(e, 'api')?.oomKilled === false && svc(e, 'api')?.status === 'running' },
      { label: 'It still has a memory limit', check: (e) => (svc(e, 'api')?.memory ?? 0) > 0 },
    ],
    par: 2,
    hint: '`docker inspect -f "{{.State.OOMKilled}}" myapp-api-1` says true: 32 MB is too little for a Node server. `sed -i \'s/mem_limit: 32m/mem_limit: 256m/\' compose.yaml`, then `docker compose up -d`.',
    solution: ['docker inspect -f "{{.State.OOMKilled}}" myapp-api-1', "sed -i 's/mem_limit: 32m/mem_limit: 256m/' compose.yaml", 'docker compose up -d'],
  },
  {
    title: '03:10: "the website is down"',
    story: 'The API is back, but customers still get nothing at **localhost:8080**. Fix it.',
    goals: [
      {
        label: 'localhost:8080 shows the bakery\'s page',
        check: (e) => {
          const r = e.probe(8080);
          return r.code === 0 && r.body.includes('The Bakery');
        },
      },
    ],
    par: 2,
    hint: '`docker compose ps` shows web publishes `8080->8080`, but nginx listens on 80. Change the port mapping to `"8080:80"` and `docker compose up -d`.',
    solution: ['curl localhost:8080', "sed -i 's/8080:8080/8080:80/' compose.yaml", 'docker compose up -d'],
  },
  {
    title: '03:25: where are yesterday\'s orders?',
    story: 'The shop manager calls: the order history is **empty**. The data is safe in the volume `myapp_dbdata` (it contains `orders.log`), but the database isn\'t looking at it. Make `db` use it again.',
    goals: [
      { label: '`db` keeps `/var/lib/postgresql/data` in `myapp_dbdata`', check: (e) => !!svc(e, 'db')?.mounts.some((m) => m.source === 'myapp_dbdata' && m.target === '/var/lib/postgresql/data') },
      { label: '`db` is Up and healthy', check: (e) => svc(e, 'db')?.status === 'running' && svc(e, 'db')?.health === 'healthy' },
      { label: 'The orders are still there', check: (e) => !!e.state.volumes.find((v) => v.name === 'myapp_dbdata')?.files['/orders.log']?.includes('order-1041') },
    ],
    par: 2,
    hint: '`docker inspect -f "{{json .Mounts}}" myapp-db-1`: it\'s mounted at `/var/lib/postgres/data`. Postgres uses `/var/lib/postgresql/data`. Fix the path in compose.yaml and `docker compose up -d`.',
    solution: ['docker inspect -f "{{json .Mounts}}" myapp-db-1', "sed -i 's#/var/lib/postgres/data#/var/lib/postgresql/data#' compose.yaml", 'docker compose up -d'],
  },
  {
    title: '03:40: disk at 91%',
    story: 'While you\'re here: the disk alert. Old `<none>` images from last week\'s deploys and stopped smoke-test containers are piling up. Clean up, **without** touching the stack or its data.',
    goals: [
      { label: 'No dangling (`<none>`) images', check: (e) => e.state.images.every((i) => i.tags.length > 0) },
      { label: 'No stopped containers', check: (e) => e.state.containers.every((c) => c.status === 'running') },
      { label: 'All four services still Up', check: (e) => SERVICES.every((s) => svc(e, s)?.status === 'running') },
      { label: '`myapp_dbdata` is still there', check: (e) => e.state.volumes.some((v) => v.name === 'myapp_dbdata') },
    ],
    par: 2,
    hint: '`docker system df`, then `docker container prune -f` and `docker image prune -f`. Not `volume prune`!',
    solution: ['docker system df', 'docker container prune -f', 'docker image prune -f'],
  },
  {
    title: '03:55: never again',
    story: 'Last step before bed: if the server reboots tonight, **every** service must come back on its own, but not ones someone stopped on purpose. Make it so in compose.yaml.',
    goals: [
      ...SERVICES.map((s): Goal => ({ label: `\`${s}\` restarts unless stopped`, check: (e) => svc(e, s)?.restart === 'unless-stopped' && svc(e, s)?.status === 'running' })),
      {
        label: 'The site still works',
        check: (e) => {
          const r = e.probe(8080);
          return r.code === 0 && r.body.includes('The Bakery');
        },
      },
    ],
    par: 4,
    hint: 'Add `restart: unless-stopped` to web, db and cache (api already has it). With sed: `sed -i \'s#image: nginx:alpine#image: nginx:alpine\\n    restart: unless-stopped#\' compose.yaml` and the same for the other images, then `docker compose up -d`.',
    solution: [
      "sed -i 's#image: nginx:alpine#image: nginx:alpine\\n    restart: unless-stopped#' compose.yaml",
      "sed -i 's#image: postgres:16-alpine#image: postgres:16-alpine\\n    restart: unless-stopped#' compose.yaml",
      "sed -i 's#image: redis:alpine#image: redis:alpine\\n    restart: unless-stopped#' compose.yaml",
      'docker compose up -d',
    ],
  },
];

export function actMet(a: Act, e: DockerEngine, start: MissionStart): boolean[] {
  return a.goals.map((g) => {
    try {
      return g.check(e, start);
    } catch {
      return false;
    }
  });
}
