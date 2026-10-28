import type { Module } from '../../../content/types';
import { projectA } from './projectA';

export const d05: Module = {
  id: 'd05',
  number: 5,
  title: 'Networks',
  tagline: 'Let containers talk to each other by name, and keep apart the ones that shouldn\'t.',
  games: ['switchboard'],
  project: projectA,
  concepts: [
    {
      id: 'd05-bridge',
      title: 'The default bridge: IPs, no names',
      card: `Every Docker machine has three built-in networks: \`docker network ls\` shows **bridge**, **host** and **none**.

A container started without \`--network\` joins the default **bridge** network and gets an IP address like \`172.17.0.2\`. Containers on it can reach each other **by IP**, but **not by name**:

\`\`\`
docker run -d --name api traefik/whoami
docker run --rm alpine ping -c 1 api         # ping: bad address 'api'
docker run --rm alpine wget -qO- 172.17.0.2  # works, but who knows the IP?
\`\`\`

IPs change whenever containers restart in a different order, so hard-coding them is fragile. The default bridge is a leftover from Docker's early days; for anything real, create your own network.`,
      predict: {
        sql: 'docker run -d --name api traefik/whoami\ndocker run --rm alpine ping -c 1 api',
        question: 'Both containers are on the default bridge network. Does `ping api` work?',
        choices: ['Yes: Docker resolves container names', 'No: "bad address", because there\'s no name lookup on the default bridge', 'No: ping isn\'t installed in alpine'],
        answer: 1,
        why: 'The default bridge has no DNS for container names. A user-defined network does.',
        expectError: true,
      },
      example: { sql: 'docker network ls\ndocker run -d --name api traefik/whoami\ndocker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" api\ndocker run --rm alpine wget -qO- 172.17.0.2', note: 'By IP it works. Reading the IP from inspect for every connection isn\'t a plan.' },
      cheat: { syntax: 'docker network ls', note: 'Default bridge: IPs only, no container names.' },
    },
    {
      id: 'd05-user',
      title: 'User-defined networks: names just work',
      card: `Create a network and put containers on it with \`--network\`. Docker runs a small **DNS** server for it: every container can find every other one **by name**.

\`\`\`
docker network create appnet
docker run -d --name api --network appnet traefik/whoami
docker run --rm --network appnet alpine wget -qO- api     # works!
\`\`\`

- The container **name** is its host name on the network.
- \`docker network ls\` lists networks; \`docker network inspect appnet\` shows who's on it.
- \`docker network rm appnet\` deletes it, but not while a **running** container is attached (*has active endpoints*).`,
      predict: {
        sql: 'docker network create appnet\ndocker run -d --name api --network appnet traefik/whoami\ndocker run --rm --network appnet alpine ping -c 1 api',
        question: 'Same as before, but both containers are on `appnet`. Does `ping api` work now?',
        choices: ['Yes: user-defined networks resolve container names', 'No: you still need the IP address', 'No: api must publish a port first'],
        answer: 0,
        why: 'Docker\'s embedded DNS (127.0.0.11) answers container names on user-defined networks. No ports need publishing between containers.',
      },
      example: { sql: 'docker network create appnet\ndocker run -d --name api --network appnet traefik/whoami\ndocker run --rm --network appnet alpine wget -qO- api\ndocker network inspect -f "{{range .Containers}}{{.Name}} {{end}}" appnet', note: 'The reply shows api\'s host name and the caller\'s address.' },
      cheat: { syntax: 'docker network create NET\ndocker run --network NET …', note: 'Containers on the same user-defined network reach each other by name.' },
    },
    {
      id: 'd05-names',
      title: 'Connect by name, not localhost',
      card: `An app container finds its database through a **host name**. On a shared network, that's the database container's **name**:

\`\`\`
docker network create appnet
docker run -d --name cache --network appnet redis
docker run --rm --network appnet redis redis-cli -h cache ping     # PONG
\`\`\`

Remember module 3: \`localhost\` inside a container is **that container**. \`redis-cli -h localhost\` from another container finds nothing.

Also note: no \`-p\` was needed. **Publishing** is only for reaching a container from **your machine**. Containers on the same network talk to each other's container ports directly. That keeps databases private: don't publish them unless you must.`,
      predict: {
        sql: 'docker network create appnet\ndocker run -d --name cache --network appnet redis\ndocker run --rm --network appnet redis redis-cli -h localhost ping',
        question: 'The second container runs redis-cli with `-h localhost`. What happens?',
        choices: ['PONG: localhost reaches cache', 'Could not connect: localhost is the redis-cli container itself', 'PONG, but only because port 6379 is published'],
        answer: 1,
        why: 'Inside a container, localhost is that container. Its own redis server isn\'t running (it runs redis-cli instead), so the connection is refused. Use `-h cache`.',
        expectError: true,
      },
      example: { sql: 'docker network create appnet\ndocker run -d --name cache --network appnet redis\ndocker run --rm --network appnet redis redis-cli -h cache set greeting hello\ndocker exec cache redis-cli get greeting', note: 'One container writes to the other over the network, by name, without -p.' },
      cheat: { syntax: 'redis-cli -h cache   (not localhost)', note: 'Address another container by its name. No -p needed between containers.' },
    },
    {
      id: 'd05-isolation',
      title: 'Separate networks keep containers apart',
      card: `Networks are also **walls**. A container only reaches containers on networks it's attached to.

A common layout: the web front end can reach the API, the API can reach the database, but the front end can **not** reach the database.

\`\`\`
docker network create front
docker network create back
docker run -d --name db  --network back  -e POSTGRES_PASSWORD=secret postgres:16
docker run -d --name api --network back  traefik/whoami
docker network connect front api                 # api is on both
docker run --rm --network front alpine wget -qO- api        # works
docker run --rm --network front postgres:16 pg_isready -h db   # no response
\`\`\`

To put a container on a second network, use \`docker network connect\` (next lesson).`,
      predict: {
        sql: 'docker network create front\ndocker network create back\ndocker run -d --name db --network back -e POSTGRES_PASSWORD=secret postgres:16\ndocker run --rm --network front postgres:16 pg_isready -h db',
        question: 'A container on `front` checks the database `db` on `back`. What does pg_isready say?',
        choices: ['db:5432 - accepting connections', 'db:5432 - no response: the name db doesn\'t exist on front', 'It waits until db joins front'],
        answer: 1,
        why: 'DNS and traffic are per network. From `front`, `db` simply doesn\'t exist.',
        expectError: true,
      },
      example: { sql: 'docker network create front\ndocker network create back\ndocker run -d --name api --network back traefik/whoami\ndocker network connect front api\ndocker inspect -f \'{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}\' api\ndocker run --rm --network front alpine wget -qO- api', note: 'api is on both networks, so the front side can reach it.' },
      cheat: { syntax: 'docker network create front; docker network create back', note: 'Only containers sharing a network can talk.' },
    },
    {
      id: 'd05-connect',
      title: 'connect and disconnect',
      card: `You can change a **running** container's networks without restarting it:

\`\`\`
docker network connect appnet web       # add web to appnet
docker network disconnect bridge web    # remove it from the default bridge
\`\`\`

Both print nothing when they succeed. Check with:

\`\`\`
docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' web
\`\`\`

Typical uses: attach a debugging container to a network, move a container between networks, or join an existing container to a new app's network.`,
      predict: {
        sql: 'docker network create appnet\ndocker run -d --name api traefik/whoami\ndocker network connect appnet api\ndocker run --rm --network appnet alpine wget -qO- api',
        question: 'api was started on the default bridge, then connected to appnet. Can a container on appnet reach it by name?',
        choices: ['Yes: it\'s on appnet now, so the name resolves', 'No: api must be restarted first', 'No: names only work for containers started with --network'],
        answer: 0,
        why: '`network connect` attaches the running container immediately, and the network\'s DNS knows it from that moment.',
      },
      example: { sql: 'docker network create appnet\ndocker run -d --name api traefik/whoami\ndocker network connect appnet api\ndocker network disconnect bridge api\ndocker inspect -f \'{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}\' api', note: 'Now api is only on appnet.' },
      cheat: { syntax: 'docker network connect NET CONTAINER\ndocker network disconnect NET CONTAINER', note: 'Change networks of a running container.' },
    },
    {
      id: 'd05-hostnone',
      title: 'host and none',
      card: `Two special networks:

- \`--network host\`: the container **shares your machine's network**. No separate IP, no port mapping: an app listening on 80 is directly on your machine's port 80. \`-p\` is ignored. (On Linux only; Docker Desktop on Mac/Windows behaves differently.)
- \`--network none\`: **no network at all**, only loopback. For jobs that must not talk to anything: processing untrusted files, batch calculations.

\`\`\`
docker run -d --name h --network host nginx
curl localhost             # nginx answers on port 80 of your machine
docker run --rm --network none alpine ping -c 1 8.8.8.8    # Network unreachable
\`\`\``,
      predict: {
        sql: 'docker run --rm --network none alpine ping -c 1 8.8.8.8',
        question: 'What happens?',
        choices: ['The ping works: 8.8.8.8 is on the internet', 'Network unreachable: the container has no network', 'bad address'],
        answer: 1,
        why: 'With `--network none` the container only has a loopback interface. Nothing goes in or out.',
        expectError: true,
      },
      example: { sql: 'docker run -d --name h --network host nginx\ncurl -s localhost | head -4\ndocker ps', note: 'No port mapping in PORTS: nginx is on the host\'s port 80 directly.' },
      cheat: { syntax: '--network host | --network none', note: 'host: share the machine\'s network. none: no network.' },
    },
  ],
  practice: [
    {
      id: 'd05-p1',
      kind: 'write',
      conceptIds: ['d05-user'],
      prompt: 'Create a network called **appnet**.',
      solution: 'docker network create appnet',
      wrongExample: 'docker network create app',
      hints: ['`docker network …`', '`docker network create NAME`'],
      explanation: 'User-defined networks get name resolution.',
      docker: { target: 'commands' },
    },
    {
      id: 'd05-p2',
      kind: 'write',
      conceptIds: ['d05-user'],
      prompt: 'The network `appnet` exists. Run **traefik/whoami** in the background as `api` on it.',
      solution: 'docker run -d --name api --network appnet traefik/whoami',
      wrongExample: 'docker run -d --name api traefik/whoami',
      hints: ['Choose the network when the container starts.', '`--network appnet`'],
      explanation: '`--network appnet` attaches the container to appnet instead of the default bridge.',
      docker: { target: 'commands', setup: ['docker network create appnet'], after: ['docker run --rm --network appnet alpine wget -qO- api'] },
    },
    {
      id: 'd05-p3',
      kind: 'fixBug',
      conceptIds: ['d05-bridge', 'd05-user'],
      prompt: 'These commands should let `client` ping `server` by name, but ping says "bad address". Fix them.',
      starterSql: 'docker run -d --name server alpine sleep 3600\ndocker run -d --name client alpine sleep 3600\ndocker exec client ping -c 1 server',
      solution: 'docker network create net\ndocker run -d --name server --network net alpine sleep 3600\ndocker run -d --name client --network net alpine sleep 3600\ndocker exec client ping -c 1 server',
      wrongExample: 'docker network create net\ndocker run -d --name server --network net alpine sleep 3600\ndocker run -d --name client alpine sleep 3600\ndocker exec client ping -c 1 server',
      hints: ['Which network are they on? Is there name lookup there?', 'Create a network and start **both** containers on it.'],
      explanation: 'Names only resolve on user-defined networks, and both containers must be on the same one. (Any network name works.)',
      docker: { target: 'commands', compare: ['stdout'] },
    },
    {
      id: 'd05-p4',
      kind: 'fillBlank',
      conceptIds: ['d05-names'],
      prompt: '`cache` (redis) runs on `appnet`. From a throwaway redis container on the same network, store `hits` = `1` in cache.',
      starterSql: 'docker run --rm --network ___ redis redis-cli -h ___ set hits 1',
      solution: 'docker run --rm --network appnet redis redis-cli -h cache set hits 1',
      wrongExample: 'docker run --rm --network appnet redis redis-cli -h localhost set hits 1',
      hints: ['Join the same network.', 'The host name is the container\'s name.'],
      explanation: 'On appnet, the name `cache` resolves to the redis container.',
      docker: { target: 'commands', setup: ['docker network create appnet', 'docker run -d --name cache --network appnet redis'], after: ['docker exec cache redis-cli get hits'] },
    },
    {
      id: 'd05-p5',
      kind: 'readQuery',
      conceptIds: ['d05-names'],
      prompt: 'An app container connects to `postgres://db:5432`. The database container is `db`, on the same user-defined network. Does `db` need `-p 5432:5432`?',
      choices: ['Yes: otherwise port 5432 is closed', 'No: publishing is for reaching it from your machine; containers on a network use container ports directly', 'Yes, but only with -P', 'No, because postgres uses no ports'],
      answer: 1,
      hints: [],
      explanation: 'Containers on a shared network talk directly. Leaving the database unpublished keeps it private.',
    },
    {
      id: 'd05-p6',
      kind: 'write',
      conceptIds: ['d05-connect'],
      prompt: '`web` (nginx) is running on the default bridge. Add it to the existing network **appnet** without restarting it.',
      solution: 'docker network connect appnet web',
      wrongExample: 'docker network connect web appnet',
      hints: ['`docker network connect …`', 'Network first, then container.'],
      explanation: '`docker network connect NETWORK CONTAINER`.',
      docker: { target: 'commands', setup: ['docker network create appnet', 'docker run -d --name web nginx'] },
    },
    {
      id: 'd05-p7',
      kind: 'write',
      conceptIds: ['d05-connect'],
      prompt: '`web` is on both the default `bridge` and `appnet`. Take it **off** the default bridge.',
      solution: 'docker network disconnect bridge web',
      wrongExample: 'docker network disconnect appnet web',
      hints: ['The opposite of connect.', '`docker network disconnect bridge web`'],
      explanation: 'Now web is only reachable on appnet.',
      docker: { target: 'commands', setup: ['docker network create appnet', 'docker run -d --name web nginx', 'docker network connect appnet web'] },
    },
    {
      id: 'd05-p8',
      kind: 'parsons',
      conceptIds: ['d05-isolation'],
      prompt: 'Build this: the database `db` (postgres:16) on network **back** only; `api` (traefik/whoami) on **back** and **front**.',
      blocks: ['docker network create front', 'docker network create back', 'docker run -d --name db --network back -e POSTGRES_PASSWORD=secret postgres:16', 'docker run -d --name api --network back traefik/whoami', 'docker network connect front api'],
      distractors: ['docker network connect front db', 'docker run -d --name api traefik/whoami'],
      wrongOrder: ['docker network create front', 'docker run -d --name db --network back -e POSTGRES_PASSWORD=secret postgres:16', 'docker network create back', 'docker run -d --name api --network back traefik/whoami', 'docker network connect front api'],
      hints: [],
      explanation: 'Networks must exist before containers join them. The second network is added with `network connect`.',
      docker: { target: 'commands' },
    },
    {
      id: 'd05-p9',
      kind: 'write',
      conceptIds: ['d05-hostnone'],
      prompt: 'Run an **alpine** container named `job` with **no network at all** that prints `offline`.',
      solution: 'docker run --name job --network none alpine echo offline',
      wrongExample: 'docker run --name job alpine echo offline',
      hints: ['There\'s a built-in network with nothing on it.', '`--network none`'],
      explanation: 'The container has only loopback.',
      docker: { target: 'commands', compare: ['stdout', 'containers'] },
    },
    {
      id: 'd05-p10',
      kind: 'readQuery',
      conceptIds: ['d05-hostnone'],
      prompt: '`docker run -d --network host -p 8080:80 nginx`. Where does nginx answer?',
      choices: ['localhost:8080', 'localhost:80: with the host network, -p is ignored', 'Nowhere: host and -p conflict, so it fails', 'Only inside the container'],
      answer: 1,
      hints: [],
      explanation: 'With `--network host` the container uses the machine\'s network directly; Docker warns that published ports are discarded.',
    },
    {
      id: 'd05-p11',
      kind: 'write',
      conceptIds: ['d05-user'],
      prompt: 'The network `oldnet` is no longer needed, and neither is `legacy`, the running container attached to it. Delete both.',
      solution: 'docker rm -f legacy\ndocker network rm oldnet',
      wrongExample: 'docker network rm oldnet',
      hints: ['Read the error: "active endpoints".', 'Remove the container first.'],
      explanation: 'A network can\'t be removed while running containers are attached to it. (A *stopped* container doesn\'t block it, but then can\'t start again: "network oldnet not found".)',
      docker: { target: 'commands', setup: ['docker network create oldnet', 'docker run -d --name legacy --network oldnet alpine sleep 3600'] },
    },
  ],
  test: [
    {
      id: 'd05-t1',
      kind: 'write',
      conceptIds: ['d05-user', 'd05-names'],
      prompt: 'Create the network **shop**, then run **redis** in the background on it as `cart`.',
      solution: 'docker network create shop\ndocker run -d --name cart --network shop redis',
      wrongExample: 'docker network create shop\ndocker run -d --name cart redis',
      hints: [],
      explanation: 'Create the network, then start the container on it.',
      docker: { target: 'commands', after: ['docker run --rm --network shop redis redis-cli -h cart ping'] },
    },
    {
      id: 'd05-t2',
      kind: 'readQuery',
      conceptIds: ['d05-bridge'],
      prompt: 'Two containers were started **without** `--network`. One runs `wget -qO- api`. What happens?',
      choices: ['It works: Docker resolves names everywhere', '"bad address": there\'s no name lookup on the default bridge', 'It works only if api publishes port 80', 'Connection refused'],
      answer: 1,
      hints: [],
      explanation: 'Use a user-defined network for name lookup.',
    },
    {
      id: 'd05-t3',
      kind: 'fixBug',
      conceptIds: ['d05-names'],
      prompt: '`db` (postgres) runs on `appnet`. This check should report it as ready. Fix it.',
      starterSql: 'docker run --rm --network appnet postgres:16 pg_isready -h localhost',
      solution: 'docker run --rm --network appnet postgres:16 pg_isready -h db',
      wrongExample: 'docker run --rm postgres:16 pg_isready -h db',
      hints: [],
      explanation: 'Use the container name on the shared network.',
      docker: { target: 'commands', setup: ['docker network create appnet', 'docker run -d --name db --network appnet -e POSTGRES_PASSWORD=secret postgres:16'], compare: ['containers', 'stdout'] },
    },
    {
      id: 'd05-t4',
      kind: 'write',
      conceptIds: ['d05-connect', 'd05-isolation'],
      prompt: '`api` runs on network `back`. Make it reachable from network **front** as well (it exists), without restarting it.',
      solution: 'docker network connect front api',
      wrongExample: 'docker network connect back api',
      hints: [],
      explanation: '`docker network connect front api`.',
      docker: { target: 'commands', setup: ['docker network create front', 'docker network create back', 'docker run -d --name api --network back traefik/whoami'], after: ['docker run --rm --network front alpine wget -qO- api'] },
    },
    {
      id: 'd05-t5',
      kind: 'readQuery',
      conceptIds: ['d05-isolation'],
      prompt: '`web` is on `front`. `db` is on `back`. `api` is on both. Which connection **fails**?',
      choices: ['web → api', 'api → db', 'web → db', 'api → web'],
      answer: 2,
      hints: [],
      explanation: 'web and db share no network.',
    },
    {
      id: 'd05-t6',
      kind: 'write',
      conceptIds: ['d05-hostnone'],
      prompt: 'Run **nginx** in the background as `edge`, sharing the **host\'s network** (no port mapping).',
      solution: 'docker run -d --name edge --network host nginx',
      wrongExample: 'docker run -d --name edge -p 80:80 nginx',
      hints: [],
      explanation: '`--network host`: nginx listens on the machine\'s port 80 directly.',
      docker: { target: 'commands', after: ['curl -s localhost'] },
    },
  ],
};
