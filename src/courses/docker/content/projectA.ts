import type { Project } from '../../../content/types';

const SITE = { 'site/index.html': '<h1>Corner Shop</h1>\n<p>Fresh bread every morning.</p>\n' };
const NET = 'docker network create shop';
const CACHE = 'docker run -d --name cache --network shop -v cachedata:/data redis';
const API = 'docker run -d --name api --network shop traefik/whoami';
const WEB = 'docker run -d --name web --network shop -p 8080:80 -v ./site:/usr/share/nginx/html:ro nginx';
const nets = (name: string) => `docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' ${name}`;

/** Project A (after module 5): a three-container app, wired up by hand. */
export const projectA: Project = {
  id: 'docker-project-a',
  title: 'Project A: run a 3-container app by hand',
  story: `The corner shop wants its website online. It's three pieces:

- **web**: nginx serving the shop's pages from the folder \`./site\`
- **api**: a small back-end service (\`traefik/whoami\` stands in for it)
- **cache**: Redis, holding the shop's counters

Only the website should be reachable from outside. The API and the cache stay private, on their own network, and the cache's data must survive anything you do to its container.

Build it step by step. Each task starts from the result of the previous one. Use the terminal-style editor: one command per line.`,
  tasks: [
    {
      id: 'dpa-1',
      prompt: 'Create a private network called **shop**, and start the **cache**: Redis, named `cache`, on that network, keeping its data in a volume named **cachedata**. Don\'t publish any ports.',
      requirements: [
        { label: 'The network `shop` exists', sql: "docker network inspect -f '{{.Name}}' shop", expect: '^shop$' },
        { label: '`cache` is running Redis', sql: "docker inspect -f '{{.State.Running}} {{.Config.Image}}' cache", expect: '^true redis' },
        { label: '`cache` is on `shop`', sql: nets('cache'), expect: '\\bshop\\b' },
        { label: 'Its data directory `/data` is the volume `cachedata`', sql: "docker inspect -f '{{range .Mounts}}{{.Type}}:{{.Name}}:{{.Destination}} {{end}}' cache", expect: 'volume:cachedata:/data\\b' },
        { label: 'No ports are published', sql: 'docker port cache', expect: '^$' },
        { label: 'Other containers on `shop` can reach it by name', sql: 'docker run --rm --network shop redis redis-cli -h cache ping', expect: '^PONG$' },
      ],
      referenceSolution: `${NET}\n${CACHE}`,
      discussion: 'The network gives the containers name lookup; the volume holds `/data`, which is where Redis writes. Leaving out `-p` keeps Redis private: only containers on `shop` can reach it.',
      hints: ['Two commands: `docker network create …`, then `docker run -d …`.', 'Redis keeps its data in `/data`: `-v cachedata:/data`.', 'Don\'t forget `--network shop` and `--name cache`.'],
      docker: {},
    },
    {
      id: 'dpa-2',
      prompt: 'The network and the cache are running. Start the **api** (`traefik/whoami`, named `api`) on the `shop` network, also without publishing ports.',
      requirements: [
        { label: '`api` is running `traefik/whoami`', sql: "docker inspect -f '{{.State.Running}} {{.Config.Image}}' api", expect: '^true traefik/whoami' },
        { label: '`api` is on `shop`', sql: nets('api'), expect: '\\bshop\\b' },
        { label: 'No ports are published', sql: 'docker port api', expect: '^$' },
        { label: 'A container on `shop` gets an answer from `http://api`', sql: 'docker run --rm --network shop alpine wget -qO- api', expect: '^Hostname: ' },
        { label: '`cache` is still running', sql: "docker inspect -f '{{.State.Running}}' cache", expect: '^true$' },
      ],
      referenceSolution: API,
      discussion: 'Containers on the same user-defined network talk to each other directly, on the container\'s own port (80 here). No `-p` needed.',
      hints: ['`docker run -d --name api …`', 'Add `--network shop`.'],
      docker: { setup: [NET, CACHE] },
    },
    {
      id: 'dpa-3',
      prompt: 'Now the **web** front end: nginx, named `web`, serving the folder **./site** (read-only) at `/usr/share/nginx/html`, on the `shop` network, and published on host port **8080**. It\'s the only container the outside world can reach.',
      requirements: [
        { label: 'http://localhost:8080 shows the shop\'s page', sql: 'curl -s localhost:8080', expect: '<h1>Corner Shop</h1>' },
        { label: '`./site` is bind-mounted read-only', sql: "docker exec web sh -c 'echo x > /usr/share/nginx/html/x.html'", code: 2, expect: 'Read-only file system' },
        { label: '`web` is on `shop` and can reach `api` by name', sql: 'docker exec web curl -s api', expect: '^Hostname: ' },
        { label: 'Only web publishes a port', sql: "docker ps --format '{{.Names}} {{.Ports}}'", expect: '^(?![\\s\\S]*(api|cache) [^\\n]*->)[\\s\\S]*web 0\\.0\\.0\\.0:8080->80/tcp' },
      ],
      referenceSolution: WEB,
      discussion: '`./site` (a path) makes a bind mount, `:ro` keeps nginx from changing it, `-p 8080:80` publishes the site, and `--network shop` lets nginx reach the API by name.',
      hints: ['Combine what you learned: `-p`, `-v` and `--network` all on one `docker run`.', 'The mount is `-v ./site:/usr/share/nginx/html:ro`.'],
      docker: { files: SITE, setup: [NET, CACHE, API] },
    },
    {
      id: 'dpa-4',
      prompt: 'The shop has been running for a while: the cache holds `orders` = `3`. **Upgrade** the cache to `redis:alpine` without losing that value. The new container must still be called `cache`, on `shop`, with no published ports.',
      requirements: [
        { label: '`cache` runs `redis:alpine`', sql: "docker inspect -f '{{.State.Running}} {{.Config.Image}}' cache", expect: '^true redis:alpine$' },
        { label: '`orders` is still 3', sql: 'docker exec cache redis-cli get orders', expect: '^3$' },
        { label: '`cache` is on `shop` and reachable by name', sql: 'docker run --rm --network shop redis redis-cli -h cache ping', expect: '^PONG$' },
        { label: 'No ports are published', sql: 'docker port cache', expect: '^$' },
      ],
      referenceSolution: 'docker stop cache\ndocker rm cache\ndocker run -d --name cache --network shop -v cachedata:/data redis:alpine',
      discussion: 'The container is disposable; the data lives in `cachedata`. **Stop** the old container first: Redis keeps recent changes in memory and writes them to `/data` when it shuts down cleanly. (`docker rm -f` kills it and those changes are lost.) Then remove it, which frees the name, and start the new version with the **same volume** at the same path.',
      hints: ['Redis writes its data to disk when it\'s stopped cleanly, not when it\'s killed.', '`docker stop cache`, `docker rm cache`, then a new `docker run` with the same volume at `/data`.'],
      docker: { files: SITE, setup: [NET, CACHE, API, WEB, 'docker exec cache redis-cli set orders 3'] },
    },
    {
      id: 'dpa-5',
      prompt: 'The shop is moving to a new server. **Tear everything down**: all three containers and the network. But keep the **data**: the volume `cachedata` must stay.',
      requirements: [
        { label: 'No containers are left (running or stopped)', sql: 'docker ps -aq', expect: '^$' },
        { label: 'The network `shop` is gone', sql: 'docker network inspect shop', code: 1 },
        { label: 'Exactly one volume is left: cachedata', sql: 'docker volume ls -q', expect: '^cachedata$' },
        { label: 'The saved data is in it: `orders` is 3', sql: 'docker run -d --name check -v cachedata:/data redis\ndocker exec check redis-cli get orders', expect: '^3$' },
      ],
      referenceSolution: 'docker stop web api cache\ndocker rm web api cache\ndocker network rm shop',
      discussion: '`docker stop` first, so Redis saves its data to the volume as it shuts down. Then remove the containers and the network. Named volumes are never removed by `docker rm` (not even with `-v`), so the data stays for the new server.',
      hints: ['Redis only writes its data to `/data` on a clean shutdown: stop before you remove.', '`docker stop` and `docker rm` both take several names. Then `docker network rm shop`.'],
      docker: { files: SITE, setup: [NET, CACHE, API, WEB, 'docker exec cache redis-cli set orders 3'] },
    },
  ],
};
