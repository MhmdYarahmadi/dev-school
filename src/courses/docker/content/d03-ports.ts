import type { Module } from '../../../content/types';

export const d03: Module = {
  id: 'd03',
  number: 3,
  title: 'Ports',
  tagline: 'Containers have their own network. Publish ports to reach the apps inside them.',
  games: ['ports'],
  concepts: [
    {
      id: 'd03-isolated',
      title: 'A container has its own network',
      card: `Each container gets its **own network stack**: its own IP address (like \`172.17.0.2\`) and its own set of ports.

nginx listens on port **80**, but on port 80 *of the container*, not of your machine. From your machine, nothing is listening:

\`\`\`
docker run -d --name web nginx
curl localhost:80        # fails: Couldn't connect to server
\`\`\`

\`docker ps\` shows \`80/tcp\` in PORTS: the port exists inside the container, but isn't **published** to the outside.`,
      predict: {
        sql: 'docker run -d --name web nginx\ncurl localhost:80',
        question: 'nginx is running and listens on port 80. What does curl get?',
        choices: ['The "Welcome to nginx!" page', 'An error: Couldn\'t connect to server', 'An empty page'],
        answer: 1,
        why: 'Port 80 is inside the container\'s own network. Your machine\'s port 80 has nothing behind it until you publish one.',
        expectError: true,
      },
      example: { sql: 'docker run -d --name web nginx\ndocker ps\ncurl localhost:80', note: 'PORTS says 80/tcp, without an arrow: not published.' },
      cheat: { syntax: '80/tcp  (no arrow in docker ps)', note: 'Port exists in the container but isn\'t reachable from your machine.' },
    },
    {
      id: 'd03-publish',
      title: 'Publishing a port: -p HOST:CONTAINER',
      card: `\`-p\` connects a port on **your machine** to a port **in the container**:

\`\`\`
docker run -d --name web -p 8080:80 nginx
curl localhost:8080
\`\`\`

Read \`-p 8080:80\` as "**host** port 8080 → **container** port 80". \`docker ps\` shows it as \`0.0.0.0:8080->80/tcp\`.

- The **container** port is fixed by the app (nginx: 80, redis: 6379, postgres: 5432).
- The **host** port is your choice: any free port.
- You can repeat \`-p\` to publish several ports.`,
      predict: {
        sql: 'docker run -d --name web -p 8080:80 nginx\ncurl localhost:8080',
        question: 'What does curl get now?',
        choices: ['The "Welcome to nginx!" page', 'An error: nginx listens on 80, not 8080', 'An error: port 8080 is not exposed'],
        answer: 0,
        why: 'Requests to port 8080 on your machine are forwarded to port 80 in the container, where nginx answers.',
      },
      example: { sql: 'docker run -d --name web -p 8080:80 nginx\ndocker ps\ncurl localhost:8080', note: 'PORTS: 0.0.0.0:8080->80/tcp.' },
      cheat: { syntax: 'docker run -p HOST:CONTAINER IMAGE', note: 'Host port first, container port second.' },
    },
    {
      id: 'd03-conflict',
      title: 'One host port, one container',
      card: `Many containers can use port 80 **inside**: each container has its own. But a **host** port can be published by only one running container:

\`\`\`
docker run -d --name a -p 8080:80 nginx
docker run -d --name b -p 8081:80 nginx     # fine
docker run -d --name c -p 8080:80 nginx     # port is already allocated
\`\`\`

Watch out: when publishing fails, the container has **already been created**. It's left in the \`Created\` state, holding its name. Remove it before trying again with the same name.`,
      predict: {
        sql: 'docker run -d --name a -p 8080:80 nginx\ndocker run -d --name c -p 8080:80 nginx\ndocker ps -a',
        question: 'The second run fails with "port is already allocated". What does `docker ps -a` show for c?',
        choices: ['Nothing: c doesn\'t exist', 'c with status Created', 'c with status Up, but without ports', 'c with status Exited (1)'],
        answer: 1,
        why: 'Docker creates the container first, then fails to start it. c stays "Created" and keeps the name, so `docker run --name c` again would hit a name conflict.',
        expectError: true,
      },
      example: { sql: 'docker run -d --name a -p 8080:80 nginx\ndocker run -d --name b -p 8081:80 nginx\ncurl -s localhost:8081 | head -4', note: 'Two nginx containers, both on port 80 inside, on different host ports.' },
      cheat: { syntax: 'Bind for 0.0.0.0:8080 failed: port is already allocated', note: 'Pick another host port, or stop what uses it.' },
    },
    {
      id: 'd03-wrongport',
      title: 'The container port must match the app',
      card: `Publishing only forwards traffic. Something must **listen** on the container port:

\`\`\`
docker run -d -p 8080:8080 nginx    # nginx listens on 80, not 8080
curl localhost:8080                 # Connection reset by peer
\`\`\`

The connection reaches the container, but nothing answers on 8080 inside. How do you find the right port? The image's documentation, or the **EXPOSE** information: \`docker ps\` shows \`80/tcp\`, and so does \`docker image inspect\`.`,
      predict: {
        sql: 'docker run -d --name web -p 8080:8080 nginx\ncurl localhost:8080',
        question: 'What happens?',
        choices: ['Works: Docker redirects to 80', 'An error: the connection is reset, because nothing listens on 8080 inside', 'docker run fails: wrong port'],
        answer: 1,
        why: 'Docker happily publishes any port. nginx only listens on 80, so the forwarded connection to container port 8080 is reset.',
        expectError: true,
      },
      example: { sql: 'docker run -d --name web -p 8080:8080 nginx\ncurl localhost:8080\ndocker ps', note: '8080->8080: forwarded to a port where nothing listens.' },
      cheat: { syntax: '-p ANY:THE_APP\'S_PORT', note: 'The second number is what the app listens on inside.' },
    },
    {
      id: 'd03-P',
      title: 'Random ports: -P and docker port',
      card: `\`-P\` (capital P) publishes **every port the image declares** (EXPOSE) to a **random free host port**, starting from 32768.

\`docker port NAME\` tells you which ones it picked:

\`\`\`
docker run -d -P --name web nginx
docker port web
80/tcp -> 0.0.0.0:32768
\`\`\`

Handy for quick tests and when running many copies. For anything you share, choose the port yourself with \`-p\`.`,
      predict: {
        sql: 'docker run -d -P --name web nginx\ndocker port web',
        question: 'Which host port does nginx get?',
        choices: ['80', '8080', 'A random high port such as 32768', 'None: -P needs a port number'],
        answer: 2,
        why: '`-P` takes each EXPOSEd port (80 for nginx) and maps it to a free port from the random range (32768 and up).',
      },
      example: { sql: 'docker run -d -P --name web nginx\ndocker port web\ncurl -s localhost:32768 | head -4', note: 'docker port shows the mapping (twice: IPv4 and IPv6).' },
      cheat: { syntax: 'docker run -P IMAGE\ndocker port NAME', note: 'Publish all exposed ports to random host ports; show them.' },
    },
    {
      id: 'd03-localhost',
      title: 'What "localhost" means',
      card: `\`localhost\` always means "**this** machine", and inside a container, *this* machine is **the container**.

\`\`\`
docker run -d --name web -p 8080:80 nginx
curl localhost:8080                    # from your machine: works
docker exec web curl -s localhost      # inside web: nginx on 80, works
docker exec web curl localhost:8080    # inside web: nothing on 8080!
\`\`\`

Port 8080 exists only on your machine. Inside the container, the app is on its own port 80.

Also: \`-p 8080:80\` listens on **all** your machine's network addresses (\`0.0.0.0\`), so other computers can reach it. \`-p 127.0.0.1:8080:80\` restricts it to your machine only.`,
      predict: {
        sql: 'docker run -d --name web -p 8080:80 nginx\ndocker exec web curl -s localhost:8080',
        question: 'What does curl, running *inside* web, get?',
        choices: ['The nginx page: 8080 is published', 'Nothing: inside the container, nothing listens on 8080', 'The page from your machine'],
        answer: 1,
        why: 'Inside the container, localhost is the container itself. nginx listens on 80 there; 8080 exists only on the host side.',
        expectError: true,
      },
      example: { sql: 'docker run -d --name web -p 127.0.0.1:8080:80 nginx\ndocker ps\ndocker exec web curl -s localhost | head -4', note: '127.0.0.1:8080: reachable only from this machine.' },
      cheat: { syntax: '-p 127.0.0.1:8080:80', note: 'localhost inside a container = the container. Bind to 127.0.0.1 to stay private.' },
    },
  ],
  practice: [
    {
      id: 'd03-p1',
      kind: 'write',
      conceptIds: ['d03-isolated', 'd03-publish'],
      prompt: 'Run **nginx** in the background as `web`, reachable at **http://localhost:8080**.',
      solution: 'docker run -d --name web -p 8080:80 nginx',
      wrongExample: 'docker run -d --name web -p 80:8080 nginx',
      hints: ['nginx listens on port 80 inside the container.', '`-p HOST:CONTAINER`, so `-p 8080:80`.'],
      explanation: 'Host port 8080 → container port 80.',
      docker: { target: 'commands', after: ['curl -s localhost:8080'] },
    },
    {
      id: 'd03-p2',
      kind: 'fillBlank',
      conceptIds: ['d03-publish'],
      prompt: '`traefik/whoami` is a tiny web app that listens on port **80**. Make it reachable on host port **9000**.',
      starterSql: 'docker run -d --name who -p ___:___ traefik/whoami',
      solution: 'docker run -d --name who -p 9000:80 traefik/whoami',
      wrongExample: 'docker run -d --name who -p 9000:9000 traefik/whoami',
      hints: ['Host port first.', 'The app\'s port goes second.'],
      explanation: '`-p 9000:80`: host 9000 → container 80.',
      docker: { target: 'commands', after: ['curl -s localhost:9000'] },
    },
    {
      id: 'd03-p3',
      kind: 'write',
      conceptIds: ['d03-conflict'],
      prompt: '`old` (nginx) already uses host port 8080. Start a second nginx called `new`, reachable on host port **8081**, and leave `old` running.',
      solution: 'docker run -d --name new -p 8081:80 nginx',
      wrongExample: 'docker run -d --name new -p 8080:80 nginx',
      hints: ['Each host port can be used by one container only.', 'Inside, both use port 80.'],
      explanation: 'Different host ports, same container port.',
      docker: { target: 'commands', setup: ['docker run -d --name old -p 8080:80 nginx'], after: ['curl -s localhost:8081'] },
    },
    {
      id: 'd03-p4',
      kind: 'fixBug',
      conceptIds: ['d03-wrongport'],
      prompt: 'With this command, `curl localhost:8080` says "Connection reset by peer". Fix it so nginx answers on port 8080.',
      starterSql: 'docker run -d --name web -p 8080:8080 nginx',
      solution: 'docker run -d --name web -p 8080:80 nginx',
      wrongExample: 'docker run -d --name web -p 8080:8080 nginx',
      hints: ['Which port does nginx listen on inside the container?', '80.'],
      explanation: 'The container port must be the one the app listens on: 80 for nginx.',
      docker: { target: 'commands', after: ['curl -s localhost:8080'] },
    },
    {
      id: 'd03-p5',
      kind: 'readQuery',
      conceptIds: ['d03-publish'],
      prompt: 'In `docker run -p 3000:80 myapp`, where is port **3000**?',
      choices: ['Inside the container: the app listens on it', 'On your machine (the host): you connect to it', 'In the image', 'On Docker Hub'],
      answer: 1,
      hints: [],
      explanation: 'HOST:CONTAINER. You browse to localhost:3000; Docker forwards it to port 80 in the container.',
    },
    {
      id: 'd03-p6',
      kind: 'write',
      conceptIds: ['d03-P'],
      prompt: 'Run **nginx** as `auto`, publishing all its exposed ports to **random** host ports.',
      solution: 'docker run -d -P --name auto nginx',
      wrongExample: 'docker run -d --name auto nginx',
      hints: ['There\'s a capital-letter option for this.', '`-P` (`--publish-all`)'],
      explanation: '`-P` maps each EXPOSEd port to a random free host port.',
      docker: { target: 'commands', after: ['docker port auto'] },
    },
    {
      id: 'd03-p7',
      kind: 'readQuery',
      conceptIds: ['d03-P'],
      prompt: 'Given this output, which URL reaches the app in `auto`?',
      sql: '$ docker port auto\n80/tcp -> 0.0.0.0:32771\n80/tcp -> [::]:32771',
      choices: ['http://localhost:80', 'http://localhost:32771', 'http://localhost:80/32771', 'http://auto:80'],
      answer: 1,
      hints: [],
      explanation: 'The host side is 32771; container port 80 is behind it.',
    },
    {
      id: 'd03-p8',
      kind: 'write',
      conceptIds: ['d03-localhost'],
      prompt: 'Run **nginx** as `private` on host port **8080**, reachable **only from this machine** (address 127.0.0.1).',
      solution: 'docker run -d --name private -p 127.0.0.1:8080:80 nginx',
      wrongExample: 'docker run -d --name private -p 8080:80 nginx',
      hints: ['`-p` can start with an IP address.', '`-p IP:HOST:CONTAINER`'],
      explanation: 'Without an address, Docker listens on 0.0.0.0, meaning every network your machine is on.',
      docker: { target: 'commands' },
    },
    {
      id: 'd03-p9',
      kind: 'write',
      conceptIds: ['d03-localhost'],
      prompt: '`web` runs nginx, published as `-p 8080:80`. From **inside** `web`, fetch its home page with `curl -s`.',
      solution: 'docker exec web curl -s localhost',
      wrongExample: 'docker exec web curl -s localhost:8080',
      hints: ['Inside the container, which port does nginx use?', 'Port 80 is the default for http, so `localhost` alone works.'],
      explanation: 'Inside, localhost is the container itself, where nginx listens on 80.',
      docker: { target: 'commands', setup: ['docker run -d --name web -p 8080:80 nginx'], compare: ['stdout', 'containers'] },
    },
    {
      id: 'd03-p10',
      kind: 'parsons',
      conceptIds: ['d03-publish', 'd03-conflict'],
      prompt: 'Run two copies of `traefik/whoami` (it listens on 80): `one` on host port 8001 and `two` on host port 8002. Then ask `two` who it is.',
      blocks: ['docker run -d --name one -p 8001:80 traefik/whoami', 'docker run -d --name two -p 8002:80 traefik/whoami', 'curl -s localhost:8002'],
      distractors: ['docker run -d --name two -p 8001:80 traefik/whoami', 'curl -s localhost:80'],
      wrongOrder: ['curl -s localhost:8002', 'docker run -d --name one -p 8001:80 traefik/whoami', 'docker run -d --name two -p 8002:80 traefik/whoami'],
      hints: [],
      explanation: 'Same container port (80), different host ports. curl must come after the container exists.',
      docker: { target: 'commands', compare: ['containers', 'stdout'] },
    },
  ],
  test: [
    {
      id: 'd03-t1',
      kind: 'write',
      conceptIds: ['d03-publish'],
      prompt: '**httpd** (the Apache web server) listens on port 80. Run it in the background as `apache`, reachable on host port **8888**.',
      solution: 'docker run -d --name apache -p 8888:80 httpd',
      wrongExample: 'docker run -d --name apache -p 80:8888 httpd',
      hints: [],
      explanation: '`-p 8888:80`.',
      docker: { target: 'commands', after: ['curl -s localhost:8888'] },
    },
    {
      id: 'd03-t2',
      kind: 'readQuery',
      conceptIds: ['d03-conflict'],
      prompt: 'What does this mean?',
      sql: 'Bind for 0.0.0.0:5000 failed: port is already allocated',
      choices: ['The app inside can\'t use port 5000', 'Another running container already publishes host port 5000', 'Port 5000 is not EXPOSEd by the image', 'You need administrator rights'],
      answer: 1,
      hints: [],
      explanation: 'A host port can be published by only one running container. (Something else on the host can also be holding it.)',
    },
    {
      id: 'd03-t3',
      kind: 'write',
      conceptIds: ['d03-publish'],
      prompt: 'Run **traefik/whoami** (listens on 80) as `who`, on host port **5000**.',
      solution: 'docker run -d --name who -p 5000:80 traefik/whoami',
      wrongExample: 'docker run -d --name who -p 5000:5000 traefik/whoami',
      hints: [],
      explanation: '`-p 5000:80`.',
      docker: { target: 'commands', after: ['curl -s localhost:5000'] },
    },
    {
      id: 'd03-t4',
      kind: 'readQuery',
      conceptIds: ['d03-localhost'],
      prompt: 'Inside a container, a program connects to `localhost:5432`. What is it connecting to?',
      choices: ['The database on your machine', 'Port 5432 of the same container', 'Any container that publishes 5432', 'Docker Hub'],
      answer: 1,
      hints: [],
      explanation: 'localhost inside a container is the container itself. (Module 5 shows how containers talk to each other.)',
    },
    {
      id: 'd03-t5',
      kind: 'fixBug',
      conceptIds: ['d03-publish'],
      prompt: 'The goal: nginx as `web`, reachable at **http://localhost:8080**. Fix the command.',
      starterSql: 'docker run -d --name web -p 80:8080 nginx',
      solution: 'docker run -d --name web -p 8080:80 nginx',
      wrongExample: 'docker run -d --name web -p 80:8080 nginx',
      hints: [],
      explanation: 'The numbers were swapped: host first, container second.',
      docker: { target: 'commands', after: ['curl -s localhost:8080'] },
    },
    {
      id: 'd03-t6',
      kind: 'readQuery',
      conceptIds: ['d03-P', 'd03-isolated'],
      prompt: '`docker ps` shows PORTS `80/tcp` for a running nginx container. What does that mean?',
      choices: ['It is reachable at localhost:80', 'Port 80 is open inside the container but not published to the host', 'It uses a random port', 'nginx is not running'],
      answer: 1,
      hints: [],
      explanation: 'No arrow = not published. A published port looks like `0.0.0.0:8080->80/tcp`.',
    },
  ],
};
