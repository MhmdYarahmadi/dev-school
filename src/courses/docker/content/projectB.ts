import type { Project } from '../../../content/types';

/** The bakery's order API, as it sits on the developer's laptop. */
const APP = {
  'package.json': '{"name":"bakery-api","scripts":{"start":"node server.js","test":"jest"},"dependencies":{"express":"^4","pg":"^8"},"devDependencies":{"jest":"29","eslint":"9"}}',
  'package-lock.json': '{}',
  'server.js': "const http = require('http');\nhttp.createServer((req, res) => res.end('bakery api: 12 orders today')).listen(3000);\n",
  'node_modules/express/index.js': '60',
  '.git/HEAD': 'ref: refs/heads/main\n',
  '.env': 'DB_PASSWORD=crumbs-2026\n',
};
const DOCKERFILE = 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nUSER node\nCMD ["node", "server.js"]';
const IGNORE = 'node_modules\n.git\n.env\n';
const BUILT = { ...APP, '.dockerignore': IGNORE, Dockerfile: DOCKERFILE + '\n' };

const COMPOSE = `services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      DB_HOST: db
      DB_PASSWORD: \${DB_PASSWORD}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes:
      - dbdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 5
    restart: unless-stopped
volumes:
  dbdata:`;

const HARDENED = COMPOSE.replace('    restart: unless-stopped\n  db:', '    restart: unless-stopped\n    mem_limit: 256m\n    cpus: 0.5\n  db:')
  .replace('    restart: unless-stopped\nvolumes:', '    restart: unless-stopped\n    mem_limit: 512m\n  cache:\n    image: redis:alpine\n    volumes:\n      - cachedata:/data\n    restart: unless-stopped\n    mem_limit: 128m\nvolumes:')
  .replace('volumes:\n  dbdata:', 'volumes:\n  dbdata:\n  cachedata:');

/** The night-shift incident: the api warms a 300 MB cache but only has 256 MB. */
const LEAKY = {
  ...BUILT,
  'server.js': "const http = require('http');\nconst menuCache = Buffer.alloc(300 * 1024 * 1024); // warm the menu cache\nhttp.createServer((req, res) => res.end('bakery api: 12 orders today')).listen(3000);\n",
  'compose.yaml': HARDENED + '\n',
};

export const projectB: Project = {
  id: 'docker-project-b',
  title: 'Project B: containerise and compose an app',
  story: `The bakery's order system has only ever run on one developer's laptop. Your job: ship it.

The folder holds a small Node API (\`server.js\`, listening on **3000**) that needs a PostgreSQL database. It also holds what laptops always hold: \`node_modules\`, the \`.git\` history and a \`.env\` file with the database password.

You'll write the **Dockerfile**, then a **compose.yaml** for the whole stack, harden it for production, and finally handle a night-shift incident. Every task is checked with real Docker commands against what you built. There are many good answers: compare yours with ours at the end of each task.`,
  tasks: [
    {
      id: 'dpb-1',
      prompt: `Write the **Dockerfile** for the API, ready for production:

- based on **node:22-alpine**, working in \`/app\`, started with \`node server.js\`
- production dependencies only (\`npm ci --omit=dev\`), and the install stays **cached** when only the code changes
- **not** running as root (node images have a \`node\` user)

The folder already has a \`.dockerignore\` that keeps out node_modules, .git and .env.`,
      requirements: [
        { label: 'It builds', sql: 'docker image inspect -f "{{.Config.WorkingDir}}" bakery-api', expect: '^/app$' },
        { label: 'The API answers on port 3000', sql: 'docker run -d --name t -p 3000:3000 bakery-api\ncurl -s localhost:3000', expect: 'bakery api' },
        { label: 'It runs as a normal user, not root', sql: 'docker run --rm bakery-api whoami', expect: '^node$' },
        { label: 'Dev dependencies stay out: the image is under 190 MB', sql: 'docker images bakery-api --format "{{.Size}}"', expect: '^(\\d{1,2}(\\.\\d+)?|1[0-8]\\d(\\.\\d+)?)MB$' },
        { label: 'A code change keeps `npm ci` CACHED', sql: 'echo "// tweak" >> server.js\ndocker build -t bakery-api .', expect: 'RUN npm ci[^\\n]*\\n#\\d+ CACHED' },
        { label: 'The password file `.env` is not in the image', sql: 'docker run --rm bakery-api test -e /app/.env', code: 1 },
      ],
      referenceSolution: DOCKERFILE,
      discussion: 'Manifest → install → code is what keeps rebuilds fast. `--omit=dev` keeps jest and eslint out (they only matter on a developer\'s machine or in CI). `USER node` comes last, after everything that needs root. The `.dockerignore` matters just as much as the Dockerfile: without it, `COPY . .` would bake the database password into every copy of the image.',
      hints: ['Start from the module 7 pattern: `COPY package*.json ./`, `RUN npm ci --omit=dev`, then `COPY . .`.', 'Finish with `USER node` and `CMD ["node", "server.js"]`.'],
      docker: { target: 'dockerfile', tag: 'bakery-api', files: { ...APP, '.dockerignore': IGNORE }, starter: 'FROM node:22-alpine\n' },
    },
    {
      id: 'dpb-2',
      prompt: `Now the whole stack in **compose.yaml** (your Dockerfile from task 1 is in the folder):

- **api**: built from this folder, published on **3000**, with \`DB_HOST=db\` and \`DB_PASSWORD\` taken from the **.env** file (\`\${DB_PASSWORD}\`), restarting **unless-stopped**
- **db**: **postgres:16-alpine**, \`POSTGRES_PASSWORD\` from the same variable, data in a named volume **dbdata**, **not** published, restarting unless-stopped
- api must only start once db is **healthy** (check it with \`pg_isready -U postgres\`)`,
      requirements: [
        { label: 'Both services are up; db is healthy', sql: 'docker compose ps --format "{{.Service}} {{.Status}}"', expect: '^api Up[\\s\\S]*^db Up .*\\(healthy\\)' },
        { label: 'The API answers on localhost:3000', sql: 'curl -s localhost:3000', expect: 'bakery api' },
        { label: 'api reaches db by name on port 5432', sql: 'docker compose exec api nc -z db 5432' },
        { label: 'api gets the password from .env', sql: 'docker compose exec api printenv DB_PASSWORD', expect: '^crumbs-2026$' },
        { label: 'compose.yaml doesn\'t contain the password itself', sql: 'cat compose.yaml | grep -c crumbs-2026', expect: '^0$', code: 1 },
        { label: 'db keeps its data in the named volume dbdata', sql: 'docker inspect -f "{{range .Mounts}}{{.Name}}:{{.Destination}} {{end}}" myapp-db-1', expect: 'myapp_dbdata:/var/lib/postgresql/data' },
        { label: 'db is not published on the host', sql: 'docker port myapp-db-1', expect: '^$' },
        { label: 'api waits for a healthy db', sql: 'docker compose config', expect: 'condition: service_healthy' },
        { label: 'Both restart unless stopped', sql: 'docker inspect -f "{{.HostConfig.RestartPolicy.Name}}" myapp-api-1 myapp-db-1', expect: '^unless-stopped\\nunless-stopped$' },
      ],
      referenceSolution: COMPOSE,
      discussion: 'Compose reads `.env` next to compose.yaml, so the password lives in one file that stays out of git and out of the image. The healthcheck plus `condition: service_healthy` means the API never starts against a database that isn\'t accepting connections yet. And db has no `ports:` at all: the API reaches it over the project network, nobody else can.',
      hints: ['Two services. api uses `build: .`; db uses `image: postgres:16-alpine`.', 'Variables: `DB_PASSWORD: ${DB_PASSWORD}` and `POSTGRES_PASSWORD: ${DB_PASSWORD}`.', 'db gets `healthcheck: { test: ["CMD-SHELL", "pg_isready -U postgres"] }`; api gets `depends_on: { db: { condition: service_healthy } }`. Declare `dbdata:` under a top-level `volumes:`.'],
      docker: { target: 'compose', files: BUILT, starter: 'services:\n  api:\n    build: .\n' },
    },
    {
      id: 'dpb-3',
      prompt: `Harden the stack for production. Starting from your compose.yaml:

- give **api** at most **256 MB** of memory and **half a CPU**; give **db** at most **512 MB**
- add a **cache** service: **redis:alpine**, data in a named volume **cachedata**, at most **128 MB**, restarting unless-stopped, not published
- everything else stays as it was`,
      requirements: [
        { label: 'api: 256 MB and half a CPU', sql: 'docker inspect -f "{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}" myapp-api-1', expect: '^268435456 500000000$' },
        { label: 'db: 512 MB', sql: 'docker inspect -f "{{.HostConfig.Memory}}" myapp-db-1', expect: '^536870912$' },
        { label: 'cache is up, limited to 128 MB, data in cachedata', sql: 'docker inspect -f "{{.State.Status}} {{.HostConfig.Memory}} {{range .Mounts}}{{.Name}}{{end}}" myapp-cache-1', expect: '^running 134217728 myapp_cachedata$' },
        { label: 'api reaches the cache by name', sql: 'docker compose exec api nc -z cache 6379' },
        { label: 'cache is not published', sql: 'docker port myapp-cache-1', expect: '^$' },
        { label: 'The API still answers', sql: 'curl -s localhost:3000', expect: 'bakery api' },
        { label: 'Nothing is over its limit (docker stats)', sql: 'docker stats --no-stream --format "{{.Name}} {{.MemPerc}}"', expect: '^(?<![\\s\\S])(?![\\s\\S]*\\b(\\d{3,}|[89]\\d)\\.\\d+%)' },
      ],
      referenceSolution: HARDENED,
      discussion: 'Limits are what keep one misbehaving service from taking the whole server down. Size them from `docker stats` under real load, with some headroom. CPU limits only slow a service down; memory limits kill it, so be generous with memory and watch for exit code 137.',
      hints: ['`mem_limit: 256m` and `cpus: 0.5` go directly under the service.', 'The cache is one more service with a named volume at `/data`; remember to declare `cachedata:` at the top level.'],
      docker: { target: 'compose', files: BUILT, starter: COMPOSE + '\n' },
    },
    {
      id: 'dpb-4',
      prompt: `**Incident at 3 a.m.** The night shift deployed a new API version that warms a menu cache at start-up. Since then the site is down. The stack is running (it's your hardened compose.yaml plus the new \`server.js\`).

Find out what's wrong with the usual routine, then fix it **without changing the code**: the API needs more room. Edit compose.yaml (\`sed -i 's/OLD/NEW/' compose.yaml\` works in this terminal) and update the stack. Use one command per line.`,
      requirements: [
        { label: 'api is Up (not restarting)', sql: 'docker inspect -f "{{.State.Status}}" myapp-api-1', expect: '^running$' },
        { label: 'It wasn\'t killed for memory this time', sql: 'docker inspect -f "{{.State.OOMKilled}}" myapp-api-1', expect: '^false$' },
        { label: 'The site answers again', sql: 'curl -s localhost:3000', expect: 'bakery api' },
        { label: 'api still has a memory limit (raised, not removed)', sql: 'docker inspect -f "{{.HostConfig.Memory}}" myapp-api-1', expect: '^[1-9]\\d+$' },
        { label: 'The database kept running the whole time', sql: 'docker inspect -f "{{.RestartCount}} {{.State.Status}}" myapp-db-1', expect: '^0 running$' },
      ],
      referenceSolution: "docker compose ps -a\ndocker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' myapp-api-1\nsed -i 's/mem_limit: 256m/mem_limit: 512m/' compose.yaml\ndocker compose up -d",
      discussion: '`docker compose ps -a` shows api Restarting (137); inspect confirms `OOMKilled=true`: the new version needs about 350 MB and the limit is 256 MB. Raising the limit in compose.yaml and running `docker compose up -d` recreates **only** the api (db and cache keep running). In real life you would also ask why the memory need jumped, and set the new limit from `docker stats` with headroom.',
      hints: ['`docker compose ps -a`: which service is unhappy, and with what exit code?', '137 → `docker inspect -f "{{.State.OOMKilled}}" myapp-api-1`.', '`sed -i \'s/mem_limit: 256m/mem_limit: 512m/\' compose.yaml`, then `docker compose up -d`.'],
      docker: { files: LEAKY, setup: ['docker compose up -d'] },
    },
  ],
};
