/**
 * Dockerfile Kitchen orders: the player writes a Dockerfile; "cooking" builds it on a
 * fresh machine and "tastes" the image with a few docker commands. Goals check the
 * built image and what the tasting printed. tests/docker-games.test.ts proves each
 * order's solution passes and the empty starter does not.
 */
import { DockerEngine } from '../engine';
import type { Image } from '../engine/types';
import type { TranscriptEntry } from '../check';

export interface Tasting {
  dockerfile: string;
  built: boolean;
  image: Image | null;
  /** Output of each taste command (dim progress lines left out). */
  outputs: string[];
  transcript: TranscriptEntry[];
}

export interface KitchenGoal {
  label: string;
  check: (t: Tasting) => boolean;
}

export interface Order {
  title: string;
  ticket: string;
  files?: Record<string, string>;
  /** Commands run after a successful build (the image is tagged `order`). */
  taste: string[];
  goals: KitchenGoal[];
  starter: string;
  solution: string;
  hint: string;
  seconds: number;
}

const PROJECT = '/home/learner/myapp';

/** Build the Dockerfile on a fresh machine and taste it. */
export function cook(order: Order, dockerfile: string): Tasting {
  const files: Record<string, string> = { [`${PROJECT}/Dockerfile`]: dockerfile.endsWith('\n') ? dockerfile : dockerfile + '\n' };
  for (const [k, v] of Object.entries(order.files ?? {})) files[`${PROJECT}/${k}`] = v;
  const e = new DockerEngine({ seed: 7, files });
  const transcript: TranscriptEntry[] = [];
  const run = (cmd: string) => {
    const r = e.exec(cmd);
    transcript.push({ cmd, lines: r.lines, code: r.exitCode });
    return r;
  };
  const b = run('docker build -t order .');
  if (b.exitCode !== 0) return { dockerfile, built: false, image: null, outputs: [], transcript };
  const outputs = order.taste.map((c) =>
    run(c)
      .lines.filter((l) => l.kind === 'out' || l.kind === 'err')
      .map((l) => l.text)
      .join('\n')
      .trim(),
  );
  return { dockerfile, built: true, image: e.findImage('order') ?? null, outputs, transcript };
}

export function ordersMet(o: Order, t: Tasting | null): boolean[] {
  return o.goals.map((g) => {
    if (!t) return false;
    try {
      return g.check(t);
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------- goal helpers

const fromLine = (t: Tasting) => (/^\s*FROM\s+(\S+)/im.exec(t.dockerfile)?.[1] ?? '').toLowerCase();
const norm = (ref: string) => (ref.includes(':') ? ref : `${ref}:latest`);

const builds: KitchenGoal = { label: 'It builds', check: (t) => t.built };
const base = (ref: string): KitchenGoal => ({ label: `Based on \`${ref}\``, check: (t) => norm(fromLine(t)) === norm(ref) });
const tastes = (i: number, cmd: string, want: string): KitchenGoal => ({ label: `\`${cmd}\` prints \`${want}\``, check: (t) => t.outputs[i] === want });
const tasteHas = (i: number, cmd: string, want: string): KitchenGoal => ({ label: `\`${cmd}\` shows “${want}”`, check: (t) => !!t.outputs[i]?.includes(want) });
const workdir = (dir: string): KitchenGoal => ({ label: `Works in \`${dir}\``, check: (t) => t.image?.config.workdir === dir });
const env = (kv: string): KitchenGoal => ({ label: `Has the default \`${kv}\``, check: (t) => !!t.image?.config.env.includes(kv) });
const exposes = (port: number): KitchenGoal => ({ label: `Documents port ${port} (EXPOSE)`, check: (t) => !!t.image?.config.exposed.includes(port) });
const under = (mb: number): KitchenGoal => ({ label: `Image under ${mb} MB`, check: (t) => !!t.image && t.image.size < mb });

// ---------------------------------------------------------------- orders

export const KITCHEN: Order[] = [
  {
    title: 'Order up!',
    ticket: 'Table 1 wants the house special: an **alpine** image that prints `Order up!` when it runs.',
    taste: ['docker run --rm order'],
    goals: [builds, base('alpine'), tastes(0, 'docker run --rm order', 'Order up!')],
    starter: 'FROM ',
    solution: 'FROM alpine\nCMD ["echo", "Order up!"]',
    hint: '`FROM alpine`, then `CMD ["echo", "Order up!"]`. (RUN would only print during the build.)',
    seconds: 120,
  },
  {
    title: 'Node to go',
    ticket: 'Pack `hello.js` in **node:22-alpine**: work in `/app`, copy the script there, run it with node.',
    files: { 'hello.js': 'console.log("Hello from Node!");\n' },
    taste: ['docker run --rm order'],
    goals: [builds, base('node:22-alpine'), workdir('/app'), tastes(0, 'docker run --rm order', 'Hello from Node!')],
    starter: 'FROM node:22-alpine\n',
    solution: 'FROM node:22-alpine\nWORKDIR /app\nCOPY hello.js .\nCMD ["node", "hello.js"]',
    hint: '`WORKDIR /app`, `COPY hello.js .`, `CMD ["node", "hello.js"]`.',
    seconds: 180,
  },
  {
    title: 'Extra spicy',
    ticket: '`menu.py` prints today\'s flavour from the `FLAVOR` variable. Pack it in **python:3.12-slim** (in `/app`) with the default flavour **spicy**. Customers can still ask for another one with `-e`.',
    files: { 'menu.py': 'import os\nprint("Today:", os.environ.get("FLAVOR", "plain"))\n' },
    taste: ['docker run --rm order', 'docker run --rm -e FLAVOR=mild order'],
    goals: [builds, env('FLAVOR=spicy'), tastes(0, 'docker run --rm order', 'Today: spicy'), tastes(1, 'docker run --rm -e FLAVOR=mild order', 'Today: mild')],
    starter: 'FROM python:3.12-slim\nWORKDIR /app\n',
    solution: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY menu.py .\nENV FLAVOR=spicy\nCMD ["python3", "menu.py"]',
    hint: '`ENV FLAVOR=spicy` sets a default that `-e` overrides.',
    seconds: 180,
  },
  {
    title: 'Curl in a box',
    ticket: 'A tiny **alpine** toolbox with **curl** installed, running `curl --version` by default. Keep it light: no package cache left in the image.',
    taste: ['docker run --rm order'],
    goals: [builds, base('alpine'), tasteHas(0, 'docker run --rm order', 'curl 8'), under(17)],
    starter: 'FROM alpine\n',
    solution: 'FROM alpine\nRUN apk add --no-cache curl\nCMD ["curl", "--version"]',
    hint: 'Alpine installs with `apk add`; `--no-cache` keeps the package index out of the image.',
    seconds: 180,
  },
  {
    title: 'The greeter combo',
    ticket: 'An **alpine** greeter: plain `docker run --rm order` says `Hello world`, and `docker run --rm order Chef` says `Hello Chef`.',
    taste: ['docker run --rm order', 'docker run --rm order Chef'],
    goals: [builds, tastes(0, 'docker run --rm order', 'Hello world'), tastes(1, 'docker run --rm order Chef', 'Hello Chef')],
    starter: 'FROM alpine\n',
    solution: 'FROM alpine\nENTRYPOINT ["echo", "Hello"]\nCMD ["world"]',
    hint: 'The fixed part goes in ENTRYPOINT, the replaceable default in CMD.',
    seconds: 180,
  },
  {
    title: 'Web special',
    ticket: 'Serve `index.html` with **nginx:alpine** (copy it to `/usr/share/nginx/html/`), and document port **80** in your Dockerfile.',
    files: { 'index.html': '<h1>Kitchen Special</h1>\n' },
    taste: ['docker run -d --name dish -p 8080:80 order', 'curl -s localhost:8080'],
    goals: [builds, base('nginx:alpine'), { label: 'Your Dockerfile documents port 80 (EXPOSE)', check: (t) => /^\s*EXPOSE\s+80\b/im.test(t.dockerfile) && exposes(80).check(t) }, tastes(1, 'curl -s localhost:8080', '<h1>Kitchen Special</h1>')],
    starter: 'FROM nginx:alpine\n',
    solution: 'FROM nginx:alpine\nCOPY index.html /usr/share/nginx/html/\nEXPOSE 80',
    hint: 'nginx already has the right CMD. You only COPY the page in and EXPOSE 80.',
    seconds: 180,
  },
];
