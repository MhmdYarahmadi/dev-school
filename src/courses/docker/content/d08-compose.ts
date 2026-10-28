import type { Module } from '../../../content/types';

const WEB_DB = `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
  cache:
    image: redis:alpine
`;
const API_FILES = {
  'package.json': '{"name":"api","scripts":{"start":"node server.js"},"dependencies":{"express":"^4"}}',
  'package-lock.json': '{}',
  'server.js': "const http = require('http');\nhttp.createServer((req, res) => res.end('api says hi')).listen(3000);\n",
  Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nUSER node\nCMD ["node", "server.js"]\n',
};
const SITE = { 'site/index.html': '<h1>Our team page</h1>\n' };
const PG_HEALTHY = `services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: secret
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 5
  web:
    image: nginx:alpine
    depends_on:
      db:
        condition: service_healthy
`;

export const d08: Module = {
  id: 'd08',
  number: 8,
  title: 'Docker Compose',
  tagline: 'Describe the whole app in one file and start it with one command.',
  games: ['composer'],
  concepts: [
    {
      id: 'd08-up',
      title: 'compose.yaml and docker compose up',
      card: `Typing five \`docker run\` commands with the right flags every time gets old. **Docker Compose** lets you write them down once, in \`compose.yaml\`:

\`\`\`yaml
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
  cache:
    image: redis:alpine
\`\`\`

Each entry under \`services:\` becomes a container. Then:

\`\`\`
docker compose up -d     # create and start everything (in the background)
docker compose ps        # this project's containers
docker compose down      # stop and remove them (and the project's network)
\`\`\`

The **project name** is the folder's name (\`myapp\` here), so containers are called \`myapp-web-1\`, \`myapp-cache-1\`. YAML uses **indentation** (spaces, never tabs) for nesting.`,
      env: { files: { 'compose.yaml': WEB_DB } },
      predict: {
        sql: 'docker compose up -d\ndocker ps --format "{{.Names}}"',
        question: 'The folder is `myapp` and the services are `web` and `cache`. What are the containers called?',
        choices: ['web and cache', 'myapp-web-1 and myapp-cache-1', 'compose_web and compose_cache', 'Random names like happy_turing'],
        answer: 1,
        why: 'Compose names containers PROJECT-SERVICE-NUMBER. The number allows several copies (replicas) of a service.',
      },
      example: { sql: 'cat compose.yaml\ndocker compose up -d\ndocker compose ps\ncurl -s localhost:8080\ndocker compose down\ndocker ps -a', note: '`down` removes the containers and the project network; nothing is left behind.' },
      cheat: { syntax: 'docker compose up -d\ndocker compose ps\ndocker compose down', note: 'Start, list, remove everything in compose.yaml.' },
    },
    {
      id: 'd08-config',
      title: 'Ports, environment, build',
      card: `Most \`docker run\` flags have a compose key:

| docker run | compose.yaml |
|---|---|
| \`-p 8080:80\` | \`ports: ["8080:80"]\` |
| \`-e KEY=value\` | \`environment:\` (a list \`- KEY=value\` or a map \`KEY: value\`) |
| \`--restart unless-stopped\` | \`restart: unless-stopped\` |
| \`IMAGE\` | \`image: nginx:alpine\` |
| build your Dockerfile | \`build: .\` |

\`build: .\` builds the Dockerfile in that folder (the image is called \`myapp-api\`); \`docker compose up -d --build\` rebuilds it after code changes.

Values can use **variables**: \`\${TAG:-1.0}\` takes \`TAG\` from your shell or from a \`.env\` file next to compose.yaml, with \`1.0\` as the default. Keep passwords in \`.env\` (and out of git), not in compose.yaml.`,
      env: { files: { ...API_FILES, 'compose.yaml': 'services:\n  api:\n    build: .\n    ports:\n      - "3000:3000"\n    environment:\n      GREETING: ${GREETING:-hello}\n', '.env': 'GREETING=howdy\n' } },
      predict: {
        sql: 'docker compose up -d\ndocker compose exec api printenv GREETING',
        question: 'compose.yaml says `GREETING: ${GREETING:-hello}`, and `.env` contains `GREETING=howdy`. What is GREETING in the container?',
        choices: ['hello', 'howdy', '${GREETING:-hello}', 'empty'],
        answer: 1,
        why: 'Compose reads `.env` from the project folder. The default after `:-` is only used when the variable isn\'t set.',
      },
      example: { sql: 'docker compose up -d\ndocker compose ps\ncurl -s localhost:3000\ndocker compose config', note: '`docker compose config` prints the file with every variable filled in: handy for checking.' },
      cheat: { syntax: 'build: .\nports: ["H:C"]\nenvironment:\n  KEY: ${VAR:-default}', note: 'Variables come from the shell or .env.' },
    },
    {
      id: 'd08-volumes',
      title: 'Volumes in Compose',
      card: `Named volumes are declared at the **top level**, then mounted by services:

\`\`\`yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - dbdata:/var/lib/postgresql/data     # named volume
  web:
    image: nginx:alpine
    volumes:
      - ./site:/usr/share/nginx/html:ro     # bind mount (starts with ./)
volumes:
  dbdata:
\`\`\`

The volume is really called \`myapp_dbdata\` (project name + \`_\`). And the important difference:

- \`docker compose down\` removes containers and networks but **keeps volumes**: your data survives.
- \`docker compose down -v\` **also deletes the volumes**. Only for throwaway data!`,
      env: { files: { ...SITE, 'compose.yaml': 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n    volumes:\n      - dbdata:/var/lib/postgresql/data\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n    volumes:\n      - ./site:/usr/share/nginx/html:ro\nvolumes:\n  dbdata:\n' } },
      predict: {
        sql: 'docker compose up -d\ndocker compose down\ndocker volume ls',
        question: 'After `docker compose down` (without -v), is the `myapp_dbdata` volume still there?',
        choices: ['Yes: down keeps volumes', 'No: down removes everything the project created', 'Only if the database was stopped first'],
        answer: 0,
        why: 'Volumes outlive `down` on purpose, so you don\'t lose data by restarting your stack. `down -v` deletes them.',
      },
      example: { sql: 'docker compose up -d\ncurl -s localhost:8080\ndocker volume ls\ndocker compose down\ndocker volume ls\ndocker compose down -v\ndocker volume ls', note: 'The first down keeps myapp_dbdata; down -v removes it.' },
      cheat: { syntax: 'volumes:\n  - NAME:/path     (declare NAME under top-level volumes:)\n  - ./dir:/path:ro', note: 'down keeps volumes; down -v deletes them.' },
    },
    {
      id: 'd08-networks',
      title: 'Networks: names for free',
      card: `Compose creates a network for the project (\`myapp_default\`) and puts every service on it. It's a user-defined network, so **every service can reach the others by service name**: the API connects to \`db:5432\`, the web server proxies to \`api:3000\`. No IPs, no \`--network\` flags.

To keep services apart, declare your own networks and list them per service:

\`\`\`yaml
services:
  web:
    image: nginx:alpine
    networks: [front]
  api:
    build: .
    networks: [front, back]   # the only bridge between the two
  db:
    image: postgres:16-alpine
    networks: [back]
networks:
  front:
  back:
\`\`\`

Now \`web\` can reach \`api\` but not \`db\`: the database isn't exposed to the public-facing tier.`,
      env: { files: { 'compose.yaml': 'services:\n  web:\n    image: nginx:alpine\n    networks: [front]\n  api:\n    image: traefik/whoami\n    networks: [front, back]\n  db:\n    image: redis:alpine\n    networks: [back]\nnetworks:\n  front:\n  back:\n' } },
      predict: {
        sql: 'docker compose up -d\ndocker compose exec web ping -c 1 db',
        question: '`web` is only on `front`; `db` is only on `back`. Does `ping db` from web work?',
        choices: ['Yes: all services of a project can talk', 'No: "bad address", they share no network', 'Yes, through api'],
        answer: 1,
        why: 'Name resolution and traffic only work within a shared network. api is on both, but it doesn\'t forward anything.',
        expectError: true,
      },
      example: { sql: 'docker compose up -d\ndocker compose exec web wget -qO- http://api\ndocker compose exec web ping -c 1 db\ndocker network ls', note: 'web reaches api by name; db is unknown to web. The networks are called myapp_front and myapp_back.' },
      cheat: { syntax: 'networks: [front, back]   (per service)\nnetworks:\n  front:\n  back:', note: 'Services reach each other by service name on shared networks.' },
    },
    {
      id: 'd08-depends',
      title: 'depends_on and healthchecks',
      card: `\`depends_on\` sets the **start order**: here \`db\` is started before \`web\`.

\`\`\`yaml
    depends_on:
      - db
\`\`\`

But *started* isn't *ready*: Postgres takes a few seconds before it accepts connections, and an app that connects immediately may crash. The fix is a **healthcheck** on the database and a **condition** on the dependency:

\`\`\`yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: secret
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 5
  web:
    image: nginx:alpine
    depends_on:
      db:
        condition: service_healthy
\`\`\`

Now Compose waits until \`db\` is **healthy** before starting \`web\`. If it never gets healthy, \`up\` fails with *dependency failed to start: container myapp-db-1 is unhealthy*.`,
      env: { files: { 'compose.yaml': PG_HEALTHY } },
      predict: {
        sql: 'docker compose up -d\ndocker compose ps',
        question: 'What does `docker compose ps` show for the db service?',
        choices: ['Up … (healthy)', 'Up … (unhealthy)', 'Exited (1)', 'Created: waiting for web'],
        answer: 0,
        why: 'pg_isready succeeds once Postgres accepts connections, so the container is healthy, and only then web starts.',
      },
      example: { sql: 'docker compose up -d\ndocker compose ps', note: 'Look for "Waiting" and "Healthy" in the up output: Compose held web back until db was healthy.' },
      cheat: { syntax: 'depends_on:\n  db:\n    condition: service_healthy', note: 'Needs a healthcheck on db. Plain depends_on = start order only.' },
    },
    {
      id: 'd08-workflow',
      title: 'Day-to-day: logs, exec, changes',
      card: `The everyday commands mirror plain Docker, but use **service names**:

\`\`\`
docker compose logs web           # one service's logs (all: just logs)
docker compose exec db psql -U postgres   # run a command in a service
docker compose stop / start       # pause the stack without removing it
docker compose up -d --build      # rebuild images, then update
\`\`\`

**Changing the file** and running \`docker compose up -d\` again is safe: Compose compares the file with what's running and **recreates only the services that changed**. The others keep running (\`Container myapp-db-1 Running\`).`,
      env: { files: { 'compose.yaml': WEB_DB } },
      predict: {
        sql: 'docker compose up -d\nsed -i "s/8080:80/9090:80/" compose.yaml\ndocker compose up -d',
        question: 'You change web\'s port from 8080 to 9090 and run `up -d` again. What happens to `cache`?',
        choices: ['It\'s recreated too: up always recreates everything', 'It keeps running untouched ("Running")', 'It\'s stopped: up -d only starts changed services'],
        answer: 1,
        why: 'Only web\'s configuration changed, so only web is recreated (Recreate → Recreated). cache is left alone.',
      },
      example: { sql: 'docker compose up -d\ndocker compose logs cache\ndocker compose exec cache redis-cli ping\ndocker compose stop\ndocker compose ps -a\ndocker compose start', note: '`stop` keeps the containers (Exited); `start` brings them back.' },
      cheat: { syntax: 'docker compose logs SVC\ndocker compose exec SVC CMD\ndocker compose up -d --build', note: 'Re-running up -d recreates only what changed.' },
    },
  ],
  practice: [
    {
      id: 'd08-p1',
      kind: 'write',
      conceptIds: ['d08-up'],
      prompt: 'Write a compose.yaml with one service called **web** that runs **nginx:alpine**, published on host port **8080** (nginx listens on 80).',
      starterSql: 'services:\n  web:\n',
      solution: 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"',
      wrongExample: 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "80:8080"',
      hints: ['Two keys under web: `image:` and `ports:`.', '`ports:` is a list: `- "8080:80"` (HOST:CONTAINER).'],
      explanation: 'Same HOST:CONTAINER order as `-p`.',
      docker: { target: 'compose', after: ['curl -s localhost:8080'] },
    },
    {
      id: 'd08-p2',
      kind: 'readQuery',
      conceptIds: ['d08-up'],
      prompt: 'Your project folder is `shop`, with services `api` and `db`. What does `docker compose down` remove?',
      choices: ['Only the containers', 'The containers shop-api-1 and shop-db-1 and the network shop_default', 'Containers, network and all volumes', 'The images too'],
      answer: 1,
      hints: [],
      explanation: 'down removes containers and networks. Volumes need -v, images need --rmi.',
    },
    {
      id: 'd08-p3',
      kind: 'fixBug',
      conceptIds: ['d08-up'],
      prompt: 'This file fails to parse. Fix the indentation so both services start.',
      starterSql: 'services:\n  web:\n    image: nginx:alpine\n  ports:\n    - "8080:80"\n  cache:\n    image: redis:alpine',
      solution: 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n  cache:\n    image: redis:alpine',
      wrongExample: 'services:\n  web:\n    image: nginx:alpine\n  cache:\n    image: redis:alpine',
      hints: ['`ports` belongs to web, so it must be indented as far as `image`.', 'Indent `ports:` by 4 spaces and its list item by 6.'],
      explanation: 'As written, `ports` was a service of its own (with no image).',
      docker: { target: 'compose', after: ['curl -s localhost:8080'] },
    },
    {
      id: 'd08-p4',
      kind: 'write',
      conceptIds: ['d08-config'],
      prompt: 'Add a **db** service: **postgres:16-alpine** with the environment variable **POSTGRES_PASSWORD** set to `secret`. Keep the web service as it is.',
      starterSql: 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n',
      solution: 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret',
      wrongExample: 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n  db:\n    image: postgres:16-alpine',
      hints: ['`environment:` takes a map (`KEY: value`) or a list (`- KEY=value`).', 'Without the password, postgres exits straight away.'],
      explanation: 'Either form works. The official postgres image refuses to start without POSTGRES_PASSWORD.',
      docker: { target: 'compose', after: ['docker compose ps -a --format "{{.Service}} {{.State}}"'] },
    },
    {
      id: 'd08-p5',
      kind: 'write',
      conceptIds: ['d08-config'],
      prompt: 'The folder has a Dockerfile for a Node API (port 3000). Write a compose.yaml with a service **api** that is **built** from this folder and published on host port **3000**.',
      solution: 'services:\n  api:\n    build: .\n    ports:\n      - "3000:3000"',
      wrongExample: 'services:\n  api:\n    image: node:22-alpine\n    ports:\n      - "3000:3000"',
      hints: ['Instead of `image:`, use `build:` with the folder.', '`build: .`'],
      explanation: 'Compose builds the image (called myapp-api) and runs it.',
      docker: { target: 'compose', files: API_FILES, after: ['curl -s localhost:3000'] },
    },
    {
      id: 'd08-p6',
      kind: 'readQuery',
      conceptIds: ['d08-config'],
      prompt: 'compose.yaml has `image: "myapi:${TAG:-latest}"`. There\'s no .env file and TAG isn\'t set in your shell. Which image is used?',
      choices: ['myapi:${TAG:-latest}', 'myapi:latest', 'myapi: (empty tag, an error)', 'Compose asks you for TAG'],
      answer: 1,
      hints: [],
      explanation: '`:-latest` is the default for an unset (or empty) variable.',
    },
    {
      id: 'd08-p7',
      kind: 'write',
      conceptIds: ['d08-volumes'],
      prompt: 'Give the **db** service a named volume **dbdata** mounted at `/var/lib/postgresql/data`, so the data survives `docker compose down`. Declare the volume too.',
      starterSql: 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n',
      solution: 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n    volumes:\n      - dbdata:/var/lib/postgresql/data\nvolumes:\n  dbdata:',
      wrongExample: 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n    volumes:\n      - /var/lib/postgresql/data',
      hints: ['`volumes:` under the service: `- dbdata:/var/lib/postgresql/data`.', 'And at the top level: `volumes:` with `dbdata:` under it.'],
      explanation: 'Without a name you get an anonymous volume with a random name, which is easy to lose.',
      docker: { target: 'compose', after: ['docker compose down'], compare: ['volumes'] },
    },
    {
      id: 'd08-p8',
      kind: 'write',
      conceptIds: ['d08-volumes'],
      prompt: 'Serve the folder `./site` with **nginx:alpine** on host port **8080**, mounted **read-only** at `/usr/share/nginx/html`. Call the service **web**.',
      solution: 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n    volumes:\n      - ./site:/usr/share/nginx/html:ro',
      wrongExample: 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n    volumes:\n      - site:/usr/share/nginx/html:ro\nvolumes:\n  site:',
      hints: ['A bind mount path starts with `./`.', '`- ./site:/usr/share/nginx/html:ro`'],
      explanation: 'Without `./`, `site` is a (new, empty) named volume instead of your folder.',
      docker: { target: 'compose', files: SITE, after: ['curl -s localhost:8080'] },
    },
    {
      id: 'd08-p9',
      kind: 'write',
      conceptIds: ['d08-networks'],
      prompt: 'Three services: **web** (nginx:alpine), **api** (traefik/whoami) and **cache** (redis:alpine). web must reach api; api must reach cache; web must **not** share a network with cache. Use networks called **front** and **back**.',
      solution: 'services:\n  web:\n    image: nginx:alpine\n    networks: [front]\n  api:\n    image: traefik/whoami\n    networks: [front, back]\n  cache:\n    image: redis:alpine\n    networks: [back]\nnetworks:\n  front:\n  back:',
      wrongExample: 'services:\n  web:\n    image: nginx:alpine\n  api:\n    image: traefik/whoami\n  cache:\n    image: redis:alpine',
      hints: ['api is the only service on both networks.', 'Declare `front:` and `back:` under a top-level `networks:`.'],
      explanation: 'With only the default network, web could reach the cache directly.',
      docker: { target: 'compose' },
    },
    {
      id: 'd08-p10',
      kind: 'fixBug',
      conceptIds: ['d08-depends'],
      prompt: '`docker compose up -d` fails: *dependency failed to start: container myapp-db-1 has no healthcheck configured*. Give **db** a healthcheck that runs `pg_isready -U postgres`.',
      starterSql: 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n  web:\n    image: nginx:alpine\n    depends_on:\n      db:\n        condition: service_healthy',
      solution: PG_HEALTHY,
      wrongExample: 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n  web:\n    image: nginx:alpine\n    depends_on:\n      - db',
      hints: ['`service_healthy` needs a healthcheck on the service it waits for.', 'Under db: `healthcheck:` → `test: ["CMD-SHELL", "pg_isready -U postgres"]`.'],
      explanation: 'Removing the condition makes it start, but then web no longer waits for the database to be ready.',
      docker: { target: 'compose', after: ['docker compose ps --format "{{.Service}} {{.Status}}"'] },
    },
    {
      id: 'd08-p11',
      kind: 'write',
      conceptIds: ['d08-workflow'],
      prompt: 'The stack is running. Show the **logs of the db service** only, then check it with `pg_isready -U postgres` **inside** the db service.',
      solution: 'docker compose logs db\ndocker compose exec db pg_isready -U postgres',
      wrongExample: 'docker logs db\ndocker exec db pg_isready -U postgres',
      hints: ['Compose commands take service names.', '`docker compose logs db`, `docker compose exec db …`'],
      explanation: 'Plain `docker logs` needs the container name, myapp-db-1.',
      docker: { target: 'commands', files: { 'compose.yaml': PG_HEALTHY }, setup: ['docker compose up -d'], compare: ['stdout'] },
    },
  ],
  test: [
    {
      id: 'd08-t1',
      kind: 'write',
      conceptIds: ['d08-config', 'd08-volumes'],
      prompt: 'Write a compose.yaml with **db**: **postgres:16-alpine**, `POSTGRES_PASSWORD=secret`, and a named volume **pgdata** at `/var/lib/postgresql/data` (declared at the top level).',
      solution: 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      - POSTGRES_PASSWORD=secret\n    volumes:\n      - pgdata:/var/lib/postgresql/data\nvolumes:\n  pgdata:',
      wrongExample: 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      - POSTGRES_PASSWORD=secret\n    volumes:\n      - ./pgdata:/var/lib/postgresql/data',
      hints: [],
      explanation: '`./pgdata` would be a bind mount to a folder, not a named volume.',
      docker: { target: 'compose' },
    },
    {
      id: 'd08-t2',
      kind: 'readQuery',
      conceptIds: ['d08-depends'],
      prompt: 'web has `depends_on: [db]` (no condition). What does Compose guarantee?',
      choices: ['db is ready for connections before web starts', 'db is started before web; nothing about readiness', 'web restarts until db is ready', 'Both start at exactly the same time'],
      answer: 1,
      hints: [],
      explanation: 'Readiness needs a healthcheck on db and `condition: service_healthy`.',
    },
    {
      id: 'd08-t3',
      kind: 'write',
      conceptIds: ['d08-config', 'd08-networks'],
      prompt: 'Two services: **api**, built from this folder and published on **3000**, and **cache** (redis:alpine, not published). api must find the cache by name through the environment variable **CACHE_HOST=cache**.',
      solution: 'services:\n  api:\n    build: .\n    ports:\n      - "3000:3000"\n    environment:\n      CACHE_HOST: cache\n  cache:\n    image: redis:alpine',
      wrongExample: 'services:\n  api:\n    build: .\n    ports:\n      - "3000:3000"\n    environment:\n      CACHE_HOST: localhost\n  cache:\n    image: redis:alpine',
      hints: [],
      explanation: 'Inside the api container, localhost is the api container itself. Services find each other by service name.',
      docker: { target: 'compose', files: API_FILES, after: ['curl -s localhost:3000', 'docker compose exec api printenv CACHE_HOST'] },
    },
    {
      id: 'd08-t4',
      kind: 'readQuery',
      conceptIds: ['d08-volumes'],
      prompt: 'You want to throw away the test database completely and start fresh. Which command?',
      choices: ['docker compose down', 'docker compose down -v', 'docker compose stop', 'docker compose rm'],
      answer: 1,
      hints: [],
      explanation: '-v also removes the project\'s named volumes. Never on production data!',
    },
    {
      id: 'd08-t5',
      kind: 'fixBug',
      conceptIds: ['d08-depends'],
      prompt: 'web should wait until db is **healthy**. Fix the depends_on.',
      starterSql: 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U postgres"]\n  web:\n    image: nginx:alpine\n    depends_on:\n      - db',
      solution: 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U postgres"]\n  web:\n    image: nginx:alpine\n    depends_on:\n      db:\n        condition: service_healthy',
      wrongExample: 'services:\n  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_PASSWORD: secret\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U postgres"]\n  web:\n    image: nginx:alpine\n    depends_on:\n      - db',
      hints: [],
      explanation: 'The long form of depends_on takes a condition per dependency.',
      docker: { target: 'compose', after: ['docker compose config'], compare: ['output'] },
    },
    {
      id: 'd08-t6',
      kind: 'write',
      conceptIds: ['d08-workflow'],
      prompt: 'The stack is running. You changed the API code. Rebuild the images and update the running services in **one** command.',
      solution: 'docker compose up -d --build',
      wrongExample: 'docker compose up -d',
      hints: [],
      explanation: 'Without --build, Compose reuses the image it built last time.',
      docker: { target: 'commands', files: { ...API_FILES, 'compose.yaml': 'services:\n  api:\n    build: .\n    ports:\n      - "3000:3000"\n' }, setup: ['docker compose up -d', 'echo "// v2" >> server.js', 'sed -i "s/api says hi/api v2 says hi/" server.js'], after: ['curl -s localhost:3000'], compare: ['output'] },
    },
  ],
};
