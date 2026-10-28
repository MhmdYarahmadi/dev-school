import type { Module } from '../../../content/types';

const SERVER_JS = "const http = require('http');\nhttp.createServer((req, res) => res.end('hello from node')).listen(3000);\n";
/** A small Node API, with node_modules, .git and a .env lying around like on a real laptop. */
const NODE_APP = {
  'package.json': '{"name":"api","scripts":{"start":"node server.js"},"dependencies":{"express":"^4"}}',
  'package-lock.json': '{}',
  'server.js': SERVER_JS,
};
const LAPTOP = { ...NODE_APP, 'node_modules/express/index.js': '60', '.git/HEAD': 'ref: refs/heads/main\n', '.env': 'DB_PASSWORD=hunter2\n' };
const PY_APP = { 'requirements.txt': 'flask\nrequests\n', 'app.py': 'print("Report ready")\n' };
const SITE = {
  'package.json': '{"name":"site","scripts":{"build":"vite build"},"dependencies":{"react":"18"},"devDependencies":{"vite":"5","typescript":"5"}}',
  'package-lock.json': '{}',
  'src/main.js': 'console.log("app")\n',
};

const GOOD_NODE = 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nUSER node\nCMD ["node", "server.js"]';

export const d07: Module = {
  id: 'd07',
  number: 7,
  title: 'Better images',
  tagline: 'Fast rebuilds, small images, no secrets inside, and no root.',
  games: ['layerdiet'],
  concepts: [
    {
      id: 'd07-cache',
      title: 'Layers and the build cache',
      card: `Each \`RUN\`, \`COPY\` and \`WORKDIR\` adds a **layer** to the image. Docker remembers every layer it built. On the next build, a step whose inputs haven't changed is reused: the build output says **\`CACHED\`** and the step takes no time.

The rule that matters: **once one step changes, every step after it runs again**, even if those later steps didn't change.

- A \`COPY\` step changes when **any copied file** changes.
- A \`RUN\` step changes when its **text** changes (or when an earlier step changed).

So \`COPY . .\` near the top means *any* edit, even a typo fix in a comment, re-runs everything below it. \`docker history IMAGE\` lists the layers and their sizes.`,
      env: { files: { ...NODE_APP, Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nCMD ["node", "server.js"]\n' } },
      predict: {
        sql: 'docker build -t api .\necho "// tweak" >> server.js\ndocker build -t api .',
        question: 'The Dockerfile copies everything (`COPY . .`) and then runs `npm ci`. After a one-line change to server.js, what happens on the second build?',
        choices: ['Everything is CACHED: npm ci doesn\'t depend on server.js', 'WORKDIR is CACHED, but COPY and npm ci run again', 'The whole build starts from scratch, FROM included'],
        answer: 1,
        why: 'The COPY step\'s input changed (server.js is in it), so COPY runs again, and every later step, including the slow `npm ci`, runs again too.',
      },
      example: { sql: 'docker build -t api .\ndocker build -t api .\ndocker history api', note: 'The second build changes nothing, so every step says CACHED. History shows each layer and its size.' },
      cheat: { syntax: 'docker history IMAGE', note: 'A changed step re-runs itself and every step after it.' },
    },
    {
      id: 'd07-order',
      title: 'Order your Dockerfile for the cache',
      card: `Put what changes **rarely** at the top and what changes **often** at the bottom. For a Node app, the dependency list changes rarely; your code changes all the time:

\`\`\`dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./      # 1. only the dependency list
RUN npm ci                 # 2. install: cached until package*.json changes
COPY . .                   # 3. then the code
CMD ["node", "server.js"]
\`\`\`

Now a code change re-runs only \`COPY . .\`: the install comes from the cache. The same pattern works everywhere:

| | manifest first | install |
|---|---|---|
| Node | \`COPY package*.json ./\` | \`RUN npm ci\` |
| Python | \`COPY requirements.txt .\` | \`RUN pip install -r requirements.txt\` |`,
      env: { files: { ...NODE_APP, Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nCMD ["node", "server.js"]\n' } },
      predict: {
        sql: 'docker build -t api .\necho "// tweak" >> server.js\ndocker build -t api .',
        question: 'Now the Dockerfile copies `package*.json`, runs `npm ci`, and only then copies the rest. After the same change to server.js, which steps run again?',
        choices: ['All of them', 'Only `COPY . .` (npm ci is CACHED)', 'Only `RUN npm ci`', 'None: the change is ignored'],
        answer: 1,
        why: 'package*.json didn\'t change, so its COPY and the install are cached. Only the last COPY sees the new server.js.',
      },
      example: { sql: 'docker build -t api .\necho "// tweak" >> server.js\ndocker build -t api .', note: 'Look for `RUN npm ci` → CACHED in the second build.' },
      cheat: { syntax: 'COPY package*.json ./\nRUN npm ci\nCOPY . .', note: 'Manifest, install, then code: code edits keep the install cached.' },
    },
    {
      id: 'd07-ignore',
      title: '.dockerignore: keep junk and secrets out',
      card: `\`COPY . .\` copies the **whole build context**: your \`node_modules\`, the \`.git\` history, and that \`.env\` file with passwords. They make the image bigger, slow the build, bust the cache, and **anyone who has the image can read the secrets**.

A \`.dockerignore\` file next to the Dockerfile lists what to leave out, one pattern per line:

\`\`\`
node_modules
.git
.env
*.log
\`\`\`

Ignored files aren't even sent to the build, so \`COPY\` can't copy them. \`node_modules\` gets installed inside the image anyway, by \`npm ci\`, for the right Linux.`,
      env: { files: { ...LAPTOP, Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "server.js"]\n' } },
      predict: {
        sql: 'docker build -t api .\ndocker run --rm api cat /app/.env',
        question: 'There\'s no .dockerignore. Your folder has a `.env` file with a database password. What does the last command print?',
        choices: ['An error: .env files are never copied', 'DB_PASSWORD=hunter2', 'Nothing: COPY skips hidden files'],
        answer: 1,
        why: '`COPY . .` copies everything in the build context, hidden files included. The password is now inside the image for anyone who pulls it.',
      },
      example: { sql: 'docker build -t api .\ndocker run --rm api ls -a /app\necho ".env" > .dockerignore\necho "node_modules" >> .dockerignore\necho ".git" >> .dockerignore\ndocker build -t api .\ndocker run --rm api ls -a /app\ndocker images api', note: 'After adding .dockerignore, .env, .git and the 60 MB node_modules stay out.' },
      cheat: { syntax: '.dockerignore:\nnode_modules\n.git\n.env', note: 'Keeps files out of the build context (and the image).' },
    },
    {
      id: 'd07-slim',
      title: 'Smaller bases, cleaner installs',
      card: `The base image is usually most of the size:

| Base | Size |
|---|---|
| \`node:22\` | 1.12 GB |
| \`node:22-alpine\` | 161 MB |
| \`python:3.12\` | 1.02 GB |
| \`python:3.12-slim\` | 124 MB |
| \`debian:12-slim\` | 97 MB |

\`-slim\` (Debian without extras) and \`-alpine\` (a tiny Linux, with \`apk\` instead of \`apt-get\`) variants run most apps just fine.

**Clean up in the same RUN.** A layer can't shrink later: deleting files in a *new* RUN hides them but they still take space in the earlier layer.

\`\`\`dockerfile
RUN apt-get update \\
 && apt-get install -y --no-install-recommends curl \\
 && rm -rf /var/lib/apt/lists/*
\`\`\`

Also: \`apk add --no-cache\` on Alpine, \`pip install --no-cache-dir\` for Python, \`npm ci --omit=dev\` to skip development packages.`,
      env: { files: { Dockerfile: 'FROM debian:12\nRUN apt-get update\nRUN apt-get install -y curl\nRUN rm -rf /var/lib/apt/lists/*\n', 'Dockerfile.lean': 'FROM debian:12-slim\nRUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*\n' } },
      predict: {
        sql: 'docker build -t fat .\ndocker build -t lean -f Dockerfile.lean .\ndocker images',
        question: 'Both images install curl. `fat` deletes the apt lists in a separate RUN; `lean` uses debian:12-slim and cleans up in the same RUN. How do they compare?',
        choices: ['Same size: both delete the apt lists', '`lean` is clearly smaller', '`fat` is smaller: more layers compress better'],
        answer: 1,
        why: 'The fat image still carries the apt lists in the layer that downloaded them, plus the bigger base. The lean one never stored them.',
      },
      example: { sql: 'docker build -t fat .\ndocker build -t lean -f Dockerfile.lean .\ndocker images\ndocker history fat', note: 'History shows the `rm -rf` layer is 0.5 MB: it didn\'t give back the space of the earlier layers.' },
      cheat: { syntax: 'RUN apt-get update && apt-get install -y --no-install-recommends PKG && rm -rf /var/lib/apt/lists/*', note: 'Clean up in the same RUN. Prefer -slim / -alpine bases.' },
    },
    {
      id: 'd07-multistage',
      title: 'Multi-stage builds',
      card: `Building an app often needs heavy tools (compilers, dev dependencies) that running it doesn't. A **multi-stage** Dockerfile builds in one stage and copies **only the result** into a small final stage:

\`\`\`dockerfile
FROM node:22 AS build          # stage 1: the workshop
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build              # produces /app/dist

FROM nginx:alpine              # stage 2: what ships
COPY --from=build /app/dist /usr/share/nginx/html
\`\`\`

Only the **last stage** becomes the image. The 1 GB of Node and dev packages stays behind in the build stage; the final image is nginx plus a few files. \`docker build --target build\` builds just a named stage (handy for running tests).`,
      env: { files: { ...SITE, Dockerfile: 'FROM node:22 AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM nginx:alpine\nCOPY --from=build /app/dist /usr/share/nginx/html\n' } },
      predict: {
        sql: 'docker build -t site .\ndocker images site',
        question: 'Stage 1 is `node:22` (1.12 GB) plus dev dependencies. Stage 2 is `nginx:alpine` (74.5 MB) plus the built files. About how big is the `site` image?',
        choices: ['About 1.2 GB: both stages', 'About 75 MB: only the last stage', 'About 1.1 GB: only the first stage'],
        answer: 1,
        why: 'Only the last stage ends up in the image. COPY --from takes just the built files across.',
      },
      example: { sql: 'docker build -t site .\ndocker images\ndocker run -d --name site -p 8080:80 site\ncurl -s localhost:8080', note: 'The final image serves the built page with nginx, without any Node inside.' },
      cheat: { syntax: 'FROM big AS build\n…\nFROM small\nCOPY --from=build /out /dest', note: 'Only the last stage ships.' },
    },
    {
      id: 'd07-user',
      title: 'Non-root USER and pinned tags',
      card: `**Don't run as root.** By default a container's process runs as \`root\`. If an attacker breaks into your app, they're root inside the container, a much better starting point for breaking out. Switch to an ordinary user with \`USER\`:

\`\`\`dockerfile
FROM node:22-alpine
…
USER node                       # node images ship a "node" user
CMD ["node", "server.js"]
\`\`\`

Other images: create one first, e.g. \`RUN adduser -D app\` (Alpine) or \`RUN useradd -r app\` (Debian), then \`USER app\`. A user that doesn't exist makes the container fail to start: *unable to find user app*.

**Pin your base.** \`FROM node\` means \`node:latest\`, which jumps to a new major version whenever upstream releases one. Your build can break overnight without you changing a thing. Name a version: \`node:22-alpine\`, \`python:3.12-slim\`.`,
      env: { files: { Dockerfile: 'FROM alpine:3.22\nRUN adduser -D app\nUSER app\nCMD ["id"]\n' } },
      predict: {
        sql: 'docker build -t safe .\ndocker run --rm safe',
        question: 'The Dockerfile creates a user `app` and switches to it. What does `id` print?',
        choices: ['uid=0(root) gid=0(root) groups=0(root)', 'uid=1000(app) gid=1000(app) groups=1000(app)', 'An error: only root can run commands'],
        answer: 1,
        why: '`USER app` makes every later RUN, CMD and `docker exec` run as that user.',
      },
      example: { sql: 'docker build -t safe .\ndocker run --rm safe\ndocker run --rm safe whoami\ndocker run --rm --user root safe whoami', note: '`--user` overrides the image\'s USER at run time (useful for debugging, not for production).' },
      cheat: { syntax: 'RUN adduser -D app\nUSER app', note: 'Run as a normal user. Pin bases: node:22-alpine, not node.' },
    },
  ],
  practice: [
    {
      id: 'd07-p1',
      kind: 'readQuery',
      conceptIds: ['d07-cache'],
      prompt: 'A Dockerfile has 6 steps. You edit a file that only step 4 (`COPY src/ ./src/`) copies, and rebuild. Which steps run again?',
      choices: ['Only step 4', 'Steps 4, 5 and 6', 'All 6 steps', 'None: COPY is always cached'],
      answer: 1,
      hints: [],
      explanation: 'Steps 1–3 are CACHED. Step 4\'s input changed, and from then on nothing can come from the cache.',
    },
    {
      id: 'd07-p2',
      kind: 'fixBug',
      conceptIds: ['d07-order'],
      prompt: 'Every code change makes this build run `npm ci` again, which takes minutes. Reorder it so a change to `server.js` keeps the install **CACHED**.',
      starterSql: 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nCMD ["node", "server.js"]',
      solution: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nCMD ["node", "server.js"]',
      wrongExample: 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nCOPY package*.json ./\nCMD ["node", "server.js"]',
      hints: ['What does `npm ci` actually need? Only the dependency list.', 'Copy `package*.json ./` first, run `npm ci`, then `COPY . .`.'],
      explanation: 'The install only depends on package.json and the lock file, so copy those first. The code comes after.',
      docker: { target: 'dockerfile', files: NODE_APP, after: ['docker run -d --name t -p 3000:3000 app', 'curl -s localhost:3000'], rebuild: { edit: 'server.js', cached: ['RUN npm ci'] } },
    },
    {
      id: 'd07-p3',
      kind: 'write',
      conceptIds: ['d07-order'],
      prompt: 'Package the Python app (`app.py`, `requirements.txt`) with **python:3.12-slim** in `/app`, so that editing `app.py` keeps the `pip install` step cached. Run it with `python app.py`.',
      starterSql: 'FROM python:3.12-slim\nWORKDIR /app\n',
      solution: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["python", "app.py"]',
      wrongExample: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nRUN pip install --no-cache-dir -r requirements.txt\nCMD ["python", "app.py"]',
      hints: ['Python\'s dependency list is `requirements.txt`.', 'COPY requirements.txt, RUN pip install -r requirements.txt, then COPY . .'],
      explanation: 'Same pattern as Node: the manifest, the install, then the code.',
      docker: { target: 'dockerfile', files: PY_APP, after: ['docker run --rm app'], rebuild: { edit: 'app.py', cached: ['RUN pip install'] } },
    },
    {
      id: 'd07-p4',
      kind: 'write',
      conceptIds: ['d07-ignore'],
      prompt: 'The Dockerfile copies the whole folder, which holds `node_modules` (60 MB), `.git` and a `.env` with a password. Write a **.dockerignore** (this command answer: create it with `echo`) so none of the three get in, then build the image as `api`.',
      solution: 'echo "node_modules" > .dockerignore\necho ".git" >> .dockerignore\necho ".env" >> .dockerignore\ndocker build -t api .',
      wrongExample: 'echo "node_modules" > .dockerignore\ndocker build -t api .',
      hints: ['One pattern per line: `echo "node_modules" > .dockerignore`, then `>>` to add more lines.', 'Three lines: node_modules, .git, .env. Then `docker build -t api .`'],
      explanation: 'Ignored files never reach the build, so COPY can\'t copy them.',
      docker: { target: 'commands', files: { ...LAPTOP, Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "server.js"]\n' }, after: ['docker run --rm api ls -a /app'], compare: ['output'] },
    },
    {
      id: 'd07-p5',
      kind: 'readQuery',
      conceptIds: ['d07-ignore'],
      prompt: 'You add `.env` to .dockerignore. Which statement is true?',
      choices: ['The image still has .env if an earlier image had it', '`COPY . .` no longer copies .env, and it isn\'t even sent to the builder', 'The container can\'t read environment variables any more', '.dockerignore only affects `docker push`'],
      answer: 1,
      hints: [],
      explanation: 'Pass secrets at run time instead (`-e`, `--env-file`), never bake them into the image.',
    },
    {
      id: 'd07-p6',
      kind: 'fixBug',
      conceptIds: ['d07-slim'],
      prompt: 'This image must stay **under 110 MB** and still have curl. Fix it: use a smaller base and clean up properly.',
      starterSql: 'FROM debian:12\nRUN apt-get update\nRUN apt-get install -y curl\nRUN rm -rf /var/lib/apt/lists/*\nCMD ["curl", "--version"]',
      solution: 'FROM debian:12-slim\nRUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*\nCMD ["curl", "--version"]',
      wrongExample: 'FROM debian:12-slim\nRUN apt-get update\nRUN apt-get install -y curl\nRUN rm -rf /var/lib/apt/lists/*\nCMD ["curl", "--version"]',
      hints: ['debian:12-slim is about 40 MB smaller than debian:12.', 'One RUN: `apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*`.'],
      explanation: 'A slim base plus a single RUN that cleans up after itself. Deleting in a later RUN can\'t shrink an earlier layer.',
      docker: { target: 'dockerfile', after: ['docker run --rm app'], maxSizeMb: 110 },
    },
    {
      id: 'd07-p7',
      kind: 'readQuery',
      conceptIds: ['d07-slim'],
      prompt: '`RUN apt-get update && apt-get install -y gcc` is followed by `RUN apt-get purge -y gcc && rm -rf /var/lib/apt/lists/*`. What happens to the image size?',
      choices: ['It shrinks back: gcc is gone', 'It stays big: the earlier layer still holds gcc and the lists; the later one only hides them', 'It doubles: purge copies files'],
      answer: 1,
      hints: [],
      explanation: 'Layers only add. To avoid keeping something, remove it in the same RUN, or use a multi-stage build.',
    },
    {
      id: 'd07-p8',
      kind: 'fillBlank',
      conceptIds: ['d07-multistage'],
      prompt: 'Complete the multi-stage build: compile in the `build` stage, then serve only `/app/dist` with nginx.',
      starterSql: 'FROM node:22 AS ___\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM nginx:alpine\nCOPY --from=___ /app/dist /usr/share/nginx/html',
      solution: 'FROM node:22 AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM nginx:alpine\nCOPY --from=build /app/dist /usr/share/nginx/html',
      wrongExample: 'FROM node:22 AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\nCMD ["npx", "serve", "dist"]',
      hints: ['`AS NAME` names a stage.', '`COPY --from=NAME` takes files out of that stage.'],
      explanation: 'The final image is nginx:alpine plus the built files: about 75 MB instead of 1.2 GB.',
      docker: { target: 'dockerfile', files: SITE, after: ['docker run -d --name s -p 8080:80 app', 'curl -s localhost:8080'], maxSizeMb: 100 },
    },
    {
      id: 'd07-p9',
      kind: 'write',
      conceptIds: ['d07-user'],
      prompt: 'Make this image run as a non-root user called **app** (create it with `adduser -D app` on Alpine). `docker run --rm app` should print the user\'s name.',
      starterSql: 'FROM alpine:3.22\nCMD ["whoami"]',
      solution: 'FROM alpine:3.22\nRUN adduser -D app\nUSER app\nCMD ["whoami"]',
      wrongExample: 'FROM alpine:3.22\nUSER app\nCMD ["whoami"]',
      hints: ['The user must exist before USER can switch to it.', '`RUN adduser -D app`, then `USER app`.'],
      explanation: 'Without the adduser line, the container fails to start: unable to find user app.',
      docker: { target: 'dockerfile', after: ['docker run --rm app'], user: 'app' },
    },
    {
      id: 'd07-p10',
      kind: 'readQuery',
      conceptIds: ['d07-user'],
      prompt: 'Your Dockerfile says `FROM node`. It built fine for months; today the build fails although nobody changed anything. The most likely reason?',
      choices: ['Docker Hub deleted the image', '`node` means `node:latest`, which moved to a new major version', 'The build cache expired', 'node images need a licence key'],
      answer: 1,
      hints: [],
      explanation: 'Pin a version (`node:22-alpine`) so builds only change when you change them.',
    },
    {
      id: 'd07-p11',
      kind: 'parsons',
      conceptIds: ['d07-order', 'd07-user'],
      prompt: 'Put together a production-ready Dockerfile for the Node API: pinned small base, cache-friendly order, production dependencies only, non-root.',
      blocks: ['FROM node:22-alpine', 'WORKDIR /app', 'COPY package*.json ./', 'RUN npm ci --omit=dev', 'COPY . .', 'USER node', 'CMD ["node", "server.js"]'],
      distractors: ['FROM node:latest', 'RUN npm install --global everything'],
      wrongOrder: ['FROM node:22-alpine', 'WORKDIR /app', 'COPY . .', 'RUN npm ci --omit=dev', 'COPY package*.json ./', 'USER node', 'CMD ["node", "server.js"]'],
      hints: [],
      explanation: 'Manifest → install → code keeps the install cached; USER node drops root before the app starts.',
      docker: { target: 'dockerfile', files: NODE_APP, after: ['docker run -d --name t -p 3000:3000 app', 'curl -s localhost:3000', 'docker exec t whoami'], rebuild: { edit: 'server.js', cached: ['RUN npm ci'] } },
    },
  ],
  test: [
    {
      id: 'd07-t1',
      kind: 'write',
      conceptIds: ['d07-order', 'd07-slim'],
      prompt: 'Write a Dockerfile for the Node API (`server.js`, listens on 3000) on **node:22-alpine** in `/app`: install production dependencies only (`npm ci --omit=dev`), keep the install cached when `server.js` changes, and start it with `node server.js`.',
      solution: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nCMD ["node", "server.js"]',
      wrongExample: 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci --omit=dev\nCMD ["node", "server.js"]',
      hints: [],
      explanation: 'Manifest first, install, then the code.',
      docker: { target: 'dockerfile', files: NODE_APP, after: ['docker run -d --name t -p 3000:3000 app', 'curl -s localhost:3000'], rebuild: { edit: 'server.js', cached: ['RUN npm ci'] } },
    },
    {
      id: 'd07-t2',
      kind: 'readQuery',
      conceptIds: ['d07-multistage'],
      prompt: 'In a two-stage Dockerfile, what ends up in the final image?',
      choices: ['Both stages, merged', 'Only the last stage, plus whatever it copied with COPY --from', 'Only the first stage', 'Whichever stage is bigger'],
      answer: 1,
      hints: [],
      explanation: 'Earlier stages are just workshops: only what you COPY --from them crosses over.',
    },
    {
      id: 'd07-t3',
      kind: 'fixBug',
      conceptIds: ['d07-user'],
      prompt: 'The container fails with `unable to find user web`. Fix the Dockerfile so it runs as `web`.',
      starterSql: 'FROM alpine:3.22\nUSER web\nCMD ["whoami"]',
      solution: 'FROM alpine:3.22\nRUN adduser -D web\nUSER web\nCMD ["whoami"]',
      wrongExample: 'FROM alpine:3.22\nUSER web\nRUN adduser -D web\nCMD ["whoami"]',
      hints: [],
      explanation: 'Create the user before switching to it (and as root: after USER web, adduser would lack the rights).',
      docker: { target: 'dockerfile', after: ['docker run --rm app'], user: 'web' },
    },
    {
      id: 'd07-t4',
      kind: 'readQuery',
      conceptIds: ['d07-ignore'],
      prompt: 'Which file belongs in .dockerignore for a Node project?',
      choices: ['package.json', 'node_modules', 'server.js', 'Dockerfile.prod (if you build with it)'],
      answer: 1,
      hints: [],
      explanation: 'node_modules is installed inside the image by npm ci; your local copy would only bloat the context and might be for the wrong OS.',
    },
    {
      id: 'd07-t5',
      kind: 'fixBug',
      conceptIds: ['d07-slim', 'd07-order'],
      prompt: 'This Python image is over 1 GB and reinstalls everything on every code change. Get it **under 200 MB** with the install cached when `app.py` changes.',
      starterSql: 'FROM python:3.12\nWORKDIR /app\nCOPY . .\nRUN pip install -r requirements.txt\nCMD ["python", "app.py"]',
      solution: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nCMD ["python", "app.py"]',
      wrongExample: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nRUN pip install --no-cache-dir -r requirements.txt\nCMD ["python", "app.py"]',
      hints: [],
      explanation: 'A -slim base for the size; requirements.txt first for the cache.',
      docker: { target: 'dockerfile', files: PY_APP, after: ['docker run --rm app'], maxSizeMb: 200, rebuild: { edit: 'app.py', cached: ['RUN pip install'] } },
    },
    {
      id: 'd07-t6',
      kind: 'write',
      conceptIds: ['d07-multistage', 'd07-user'],
      prompt: 'Write the complete production Dockerfile for the Node API: **node:22-alpine**, `/app`, production dependencies only, cache-friendly, running as the `node` user, started with `node server.js`.',
      solution: GOOD_NODE,
      wrongExample: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nCMD ["node", "server.js"]',
      hints: [],
      explanation: 'Everything from this module in seven lines.',
      docker: { target: 'dockerfile', files: NODE_APP, after: ['docker run -d --name t -p 3000:3000 app', 'curl -s localhost:3000'], user: 'node', rebuild: { edit: 'server.js', cached: ['RUN npm ci'] } },
    },
  ],
};
