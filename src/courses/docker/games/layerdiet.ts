/**
 * Layer Diet levels: a working but bloated Dockerfile (and sometimes a .dockerignore)
 * to slim down. "Weighing" builds it, runs the taste commands, then changes a source
 * file and rebuilds to see which steps came from the cache. tests/docker-games.test.ts
 * proves each solution meets every goal and the starter does not.
 */
import { buildSteps, DockerEngine } from '../engine';
import type { Image } from '../engine/types';
import type { TranscriptEntry } from '../check';

export interface Weighing {
  dockerfile: string;
  built: boolean;
  image: Image | null;
  /** Output of each taste command. */
  outputs: string[];
  /** The rebuild after a source change: each step and whether it was CACHED. */
  rebuild: { instr: string; cached: boolean }[];
  transcript: TranscriptEntry[];
}

export interface DietGoal {
  label: string;
  check: (w: Weighing) => boolean;
}

export interface Diet {
  title: string;
  ticket: string;
  files: Record<string, string>;
  starter: string;
  /** Present when the level lets you edit .dockerignore (its starting content). */
  ignore?: string;
  taste: string[];
  /** File changed before the rebuild that tests the cache. */
  edit: string;
  goals: DietGoal[];
  solution: string;
  solutionIgnore?: string;
  hint: string;
  par: number;
  seconds: number;
}

const PROJECT = '/home/learner/myapp';

export function weigh(diet: Diet, dockerfile: string, ignore?: string): Weighing {
  const files: Record<string, string> = { [`${PROJECT}/Dockerfile`]: dockerfile.endsWith('\n') ? dockerfile : dockerfile + '\n' };
  for (const [k, v] of Object.entries(diet.files)) files[`${PROJECT}/${k}`] = v;
  if (ignore !== undefined && ignore.trim()) files[`${PROJECT}/.dockerignore`] = ignore.endsWith('\n') ? ignore : ignore + '\n';
  const e = new DockerEngine({ seed: 7, files });
  const transcript: TranscriptEntry[] = [];
  const run = (cmd: string) => {
    const r = e.exec(cmd);
    transcript.push({ cmd, lines: r.lines, code: r.exitCode });
    return r;
  };
  const b = run('docker build -t order .');
  if (b.exitCode !== 0) return { dockerfile, built: false, image: null, outputs: [], rebuild: [], transcript };
  const outputs = diet.taste.map((c) =>
    run(c)
      .lines.filter((l) => l.kind === 'out' || l.kind === 'err')
      .map((l) => l.text)
      .join('\n')
      .trim(),
  );
  const image = e.findImage('order') ?? null;
  const p = `${PROJECT}/${diet.edit}`;
  e.files[p] = (e.files[p] ?? '') + (/\.py$/.test(p) ? '\n# a small change\n' : '\n// a small change\n');
  const rebuild = buildSteps(run('docker build -t order .').lines);
  return { dockerfile, built: true, image, outputs, rebuild, transcript };
}

export function dietMet(d: Diet, w: Weighing | null): boolean[] {
  return d.goals.map((g) => {
    if (!w) return false;
    try {
      return g.check(w);
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------- goal helpers

const works = (i: number, cmd: string, want: string): DietGoal => ({ label: `Still works: \`${cmd}\` shows “${want}”`, check: (w) => w.built && !!w.outputs[i]?.includes(want) });
export const under = (mb: number): DietGoal => ({ label: `Image under **${mb} MB**`, check: (w) => !!w.image && w.image.size < mb });
const cached = (step: string, file: string): DietGoal => ({ label: `After a change to \`${file}\`, \`${step}\` is CACHED`, check: (w) => w.rebuild.some((s) => s.instr.startsWith(step) && s.cached) });
const nonRoot = (user: string): DietGoal => ({ label: `Runs as \`${user}\`, not root`, check: (w) => w.image?.config.user === user });
const lacks = (i: number, _cmd: string, name: string): DietGoal => ({ label: `\`${name}\` is not in the image`, check: (w) => w.built && w.outputs[i] !== undefined && !w.outputs[i].split('\n').includes(name) });
const pinned: DietGoal = { label: 'Every FROM names a version (no `:latest`)', check: (w) => [...w.dockerfile.matchAll(/^\s*FROM\s+(\S+)/gim)].every((m) => /:/.test(m[1]) && !/:latest$/.test(m[1])) };

// ---------------------------------------------------------------- levels

const NODE_APP = {
  'package.json': '{"name":"api","scripts":{"start":"node server.js"},"dependencies":{"express":"^4"},"devDependencies":{"jest":"29","eslint":"9"}}',
  'package-lock.json': '{}',
  'server.js': "const http = require('http');\nhttp.createServer((req, res) => res.end('menu: soup, salad')).listen(3000);\n",
};
const SERVE = ['docker run -d --name dish -p 3000:3000 order', 'curl -s localhost:3000'];

export const LAYER_DIET: Diet[] = [
  {
    title: 'Crash diet',
    ticket: 'This Node API image weighs over a gigabyte. Get it **under 250 MB** without breaking it.',
    files: NODE_APP,
    starter: 'FROM node:22\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nCMD ["node", "server.js"]\n',
    taste: SERVE,
    edit: 'server.js',
    goals: [works(1, 'curl -s localhost:3000', 'menu: soup'), under(250)],
    solution: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nCMD ["node", "server.js"]\n',
    hint: 'The base image is nearly all of it. `node:22-alpine` is 161 MB instead of 1.12 GB.',
    par: 1,
    seconds: 150,
  },
  {
    title: 'Cache me if you can',
    ticket: 'Every one-line code change re-installs all dependencies. Keep `RUN npm ci` **CACHED** when `server.js` changes.',
    files: NODE_APP,
    starter: 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nCMD ["node", "server.js"]\n',
    taste: SERVE,
    edit: 'server.js',
    goals: [works(1, 'curl -s localhost:3000', 'menu: soup'), cached('RUN npm ci', 'server.js')],
    solution: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nCMD ["node", "server.js"]\n',
    hint: 'Copy only `package*.json ./` before `RUN npm ci`, and the rest after it.',
    par: 1,
    seconds: 150,
  },
  {
    title: 'Clean out the fridge',
    ticket: 'The image contains your laptop\'s `node_modules` (60 MB), the `.git` history and **`.env` with the database password**. Keep all three out, get **under 200 MB**, and keep it working. You can edit `.dockerignore` too.',
    files: { ...NODE_APP, 'node_modules/express/index.js': '60', '.git/HEAD': 'ref: refs/heads/main\n', '.env': 'DB_PASSWORD=hunter2\n' },
    starter: 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nCMD ["node", "server.js"]\n',
    ignore: '',
    taste: [...SERVE, 'docker run --rm order ls -a /app'],
    edit: 'server.js',
    goals: [works(1, 'curl -s localhost:3000', 'menu: soup'), lacks(2, 'ls -a /app', '.env'), lacks(2, 'ls -a /app', '.git'), under(200)],
    solution: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nCMD ["node", "server.js"]\n',
    solutionIgnore: 'node_modules\n.git\n.env\n',
    hint: 'Put `node_modules`, `.git` and `.env` in .dockerignore, one per line.',
    par: 1,
    seconds: 180,
  },
  {
    title: 'Apt diet',
    ticket: 'A curl toolbox on Debian. It must still print curl\'s version, but weigh **under 110 MB**.',
    files: {},
    starter: 'FROM debian:12\nRUN apt-get update\nRUN apt-get install -y curl\nRUN rm -rf /var/lib/apt/lists/*\nCMD ["curl", "--version"]\n',
    taste: ['docker run --rm order'],
    edit: 'Dockerfile',
    goals: [works(0, 'docker run --rm order', 'curl 8'), under(110)],
    solution: 'FROM debian:12-slim\nRUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*\nCMD ["curl", "--version"]\n',
    hint: '`debian:12-slim`, and one RUN that updates, installs `--no-install-recommends` and removes `/var/lib/apt/lists/*`.',
    par: 2,
    seconds: 180,
  },
  {
    title: 'Two-course meal',
    ticket: 'This builds a website with Node, then serves `dist/` from the same 1 GB image. Serve it with **nginx:alpine** instead (port 80, from `/usr/share/nginx/html`), **under 100 MB**.',
    files: {
      'package.json': '{"name":"site","scripts":{"build":"vite build"},"dependencies":{"react":"18"},"devDependencies":{"vite":"5"}}',
      'package-lock.json': '{}',
      'src/main.js': 'console.log("app")\n',
    },
    starter: 'FROM node:22\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\nCMD ["python3", "-m", "http.server", "80", "--directory", "dist"]\n',
    taste: ['docker run -d --name dish -p 8080:80 order', 'curl -s localhost:8080'],
    edit: 'src/main.js',
    goals: [works(1, 'curl -s localhost:8080', 'Hello from the built app'), under(100)],
    solution: 'FROM node:22 AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM nginx:alpine\nCOPY --from=build /app/dist /usr/share/nginx/html\n',
    hint: 'Name the first stage (`FROM node:22 AS build`), then `FROM nginx:alpine` and `COPY --from=build /app/dist /usr/share/nginx/html`.',
    par: 2,
    seconds: 240,
  },
  {
    title: 'The full makeover',
    ticket: 'A Python report job. Make it production-ready: **under 200 MB**, a **pinned** base, `pip install` **CACHED** when `app.py` changes, and running as a user called **app** (Debian-based images create one with `useradd -r app`).',
    files: { 'requirements.txt': 'flask\nrequests\n', 'app.py': 'print("Report ready")\n' },
    starter: 'FROM python\nWORKDIR /app\nCOPY . .\nRUN pip install -r requirements.txt\nCMD ["python", "app.py"]\n',
    taste: ['docker run --rm order'],
    edit: 'app.py',
    goals: [works(0, 'docker run --rm order', 'Report ready'), under(200), pinned, cached('RUN pip install', 'app.py'), nonRoot('app')],
    solution: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nRUN useradd -r app\nUSER app\nCMD ["python", "app.py"]\n',
    hint: '`python:3.12-slim`; `COPY requirements.txt .` → `RUN pip install --no-cache-dir -r requirements.txt` → `COPY . .`; then `RUN useradd -r app` and `USER app`.',
    par: 2,
    seconds: 300,
  },
];
