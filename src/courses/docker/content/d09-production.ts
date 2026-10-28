import type { Module } from '../../../content/types';
import { projectB } from './projectB';

const API = {
  'package.json': '{"name":"api","scripts":{"start":"node server.js"},"dependencies":{"express":"^4"}}',
  'package-lock.json': '{}',
  'server.js': "const http = require('http');\nhttp.createServer((req, res) => res.end('api ok')).listen(3000);\n",
  Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nUSER node\nCMD ["node", "server.js"]\n',
};
/** A nightly job that loads 300 MB into memory. */
const REPORT = {
  'report.js': 'const data = Buffer.alloc(300 * 1024 * 1024); // load the whole day into memory\nconsole.log("Report finished");\n',
  Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY report.js .\nCMD ["node", "report.js"]\n',
};
const HEALTHY_WEB = { Dockerfile: 'FROM nginx:alpine\nHEALTHCHECK --interval=30s CMD curl -f http://localhost/ || exit 1\n' };

export const d09: Module = {
  id: 'd09',
  number: 9,
  title: 'Production & troubleshooting',
  tagline: 'Keep containers running, find out why they stopped, and keep the machine tidy.',
  games: ['breakit', 'incident'],
  project: projectB,
  concepts: [
    {
      id: 'd09-restart',
      title: 'Restart policies',
      card: `By default a container that stops **stays stopped**, also after the server reboots. A **restart policy** tells Docker to bring it back:

| \`--restart\` | Restarts when… |
|---|---|
| \`no\` (default) | never |
| \`on-failure[:N]\` | it exits with a non-zero code (at most N times) |
| \`always\` | it stops for any reason, and when Docker starts (after a reboot) |
| \`unless-stopped\` | like always, **except** after you stopped it yourself |

\`unless-stopped\` is the usual choice for services. A container that crashes straight away goes into a **crash loop**: \`docker ps\` shows \`Restarting (1)\`, Docker waits longer between attempts (0.1 s, 0.2 s, 0.4 s… up to a minute), and \`RestartCount\` keeps climbing. A restart policy hides crashes, so read the logs!

Change the policy of an existing container with \`docker update --restart unless-stopped NAME\`.`,
      predict: {
        sql: 'docker run -d --name worker --restart unless-stopped alpine sh -c "echo connecting; exit 1"\nsleep 3\ndocker ps',
        question: 'The worker exits with code 1 right after starting. With `--restart unless-stopped`, what does `docker ps` show 3 seconds later?',
        choices: ['Up 3 seconds', 'Restarting (1) …', 'Nothing: it exited', 'Exited (1), waiting for you to start it'],
        answer: 1,
        why: 'Docker keeps restarting it, with growing pauses between attempts. In between, the status is Restarting (last exit code).',
      },
      example: { sql: 'docker run -d --name worker --restart unless-stopped alpine sh -c "echo connecting; exit 1"\nsleep 3\ndocker ps\ndocker inspect -f "{{.RestartCount}}" worker\ndocker logs worker\ndocker update --restart no worker\ndocker ps -a', note: 'The logs show one "connecting" per attempt. Switching the policy to no ends the loop.' },
      cheat: { syntax: '--restart unless-stopped\ndocker update --restart POLICY NAME', note: 'no · on-failure[:N] · always · unless-stopped' },
    },
    {
      id: 'd09-health',
      title: 'Healthchecks',
      card: `"Up" only means the main process is running. A web server can be up but stuck, or answering errors. A **healthcheck** is a command Docker runs regularly inside the container: exit 0 means healthy.

\`\`\`dockerfile
HEALTHCHECK --interval=30s CMD curl -f http://localhost/ || exit 1
\`\`\`

or at run time: \`docker run --health-cmd "curl -f http://localhost/ || exit 1" …\` (in Compose: \`healthcheck:\`).

\`docker ps\` then shows \`Up 2 minutes (healthy)\`, \`(health: starting)\` or \`(unhealthy)\`; \`docker inspect -f "{{.State.Health.Status}}"\` gives just the status.

Two facts that surprise people:
- Plain Docker **doesn't restart unhealthy containers**. It only reports them. Compose's \`service_healthy\`, load balancers and orchestrators (Swarm, Kubernetes) act on it.
- The check runs **inside** the container, so the tool it uses (curl, wget, pg_isready) must exist in the image.`,
      env: { files: HEALTHY_WEB },
      predict: {
        sql: 'docker build -t web .\ndocker run -d --name web web\nsleep 31\ndocker ps',
        question: 'The image has `HEALTHCHECK --interval=30s CMD curl -f http://localhost/ || exit 1`, and nginx answers on port 80. What does docker ps show after 31 seconds?',
        choices: ['Up 31 seconds (healthy)', 'Up 31 seconds (unhealthy)', 'Up 31 seconds (health: starting)', 'Restarting'],
        answer: 0,
        why: 'The first check ran after the 30-second interval, curl got the page, so the container is healthy.',
      },
      example: { sql: 'docker build -t web .\ndocker run -d --name web web\ndocker ps\nsleep 31\ndocker ps\ndocker run -d --name broken --health-cmd "curl -f http://localhost:8080/ || exit 1" nginx:alpine\nsleep 31\ndocker ps\ndocker inspect -f "{{json .State.Health}}" broken', note: 'The broken one checks the wrong port: unhealthy, but still Up. Docker doesn\'t restart it.' },
      cheat: { syntax: 'HEALTHCHECK CMD curl -f http://localhost/ || exit 1\ndocker inspect -f "{{.State.Health.Status}}" NAME', note: 'starting → healthy / unhealthy. Plain Docker only reports it.' },
    },
    {
      id: 'd09-limits',
      title: 'Memory and CPU limits',
      card: `Without limits, one runaway container can eat all the server's memory and take everything else down with it. Set limits per container:

\`\`\`
docker run -d --name api --memory 256m --cpus 0.5 myapi
docker stats --no-stream          # live usage vs limit
\`\`\`

- \`--cpus 0.5\`: at most half a CPU core. Too little makes the app **slow**, never killed.
- \`--memory 256m\`: a hard ceiling. A process that needs more is **killed by the kernel** (the "OOM killer"): exit code **137**, and \`docker inspect -f "{{.State.OOMKilled}}"\` says \`true\`. Often no error message at all in the logs!

In Compose: \`mem_limit: 256m\` and \`cpus: 0.5\`. Raise a limit on a running container with \`docker update --memory 512m NAME\`.`,
      env: { files: REPORT },
      predict: {
        sql: 'docker build -t report .\ndocker run --name nightly --memory 256m report\ndocker ps -a --format "{{.Names}}: {{.Status}}"',
        question: 'The report job loads 300 MB into memory. It runs with `--memory 256m`. What happens?',
        choices: ['It prints "Report finished": limits only slow things down', 'It\'s killed: Exited (137), no output', 'Docker refuses to start it', 'It uses swap and finishes slowly'],
        answer: 1,
        why: 'It needs more than its 256 MB ceiling, so the kernel kills it with SIGKILL: exit code 137 (128 + 9).',
        expectError: true,
      },
      example: { sql: 'docker build -t report .\ndocker run --name nightly --memory 256m report\ndocker inspect -f "{{.State.ExitCode}} {{.State.OOMKilled}}" nightly\ndocker logs nightly\ndocker run --rm --memory 512m report\ndocker run -d --name web --memory 64m --cpus 0.5 nginx:alpine\ndocker stats --no-stream', note: 'OOMKilled=true and empty logs: the classic signature. With 512 MB it finishes.' },
      cheat: { syntax: '--memory 256m --cpus 0.5\ndocker stats --no-stream\ndocker inspect -f "{{.State.OOMKilled}}" NAME', note: 'Over the memory limit → killed, exit 137.' },
    },
    {
      id: 'd09-exitcodes',
      title: 'Reading exit codes',
      card: `\`docker ps -a\` shows \`Exited (N)\`. The number is the first clue:

| Code | Meaning | Typical cause |
|---|---|---|
| 0 | finished normally | a one-off job, or a shell without \`-it\` |
| 1 | the app reported an error | read the logs |
| 125 | **docker itself** failed | bad flag, name in use, port taken |
| 126 | command can't be executed | not a program (permission denied) |
| 127 | command not found | typo, or not in this image |
| 137 | killed (128 + SIGKILL 9) | \`docker kill\`, out of memory, or ignored \`docker stop\` |
| 143 | terminated (128 + SIGTERM 15) | stopped, and the app quit on the signal |

\`docker stop\` sends SIGTERM and waits 10 seconds, then SIGKILL. A Node or Python app running as PID 1 has no SIGTERM handler, so it **ignores** the signal and gets killed after the wait: slow stops and 137. \`docker run --init\` puts a tiny init process in front that passes the signal on: quick stop, 143.`,
      env: { files: API },
      predict: {
        sql: 'docker build -t api .\ndocker run -d --name api api\ndocker run -d --name api2 --init api\ndocker stop api api2\ndocker ps -a --format "{{.Names}}: {{.Status}}"',
        question: 'Both run the same Node server; api2 has `--init`. After `docker stop`, what are their exit codes?',
        choices: ['Both 0', 'api: 137, api2: 143', 'api: 143, api2: 137', 'Both 137'],
        answer: 1,
        why: 'As PID 1, node ignores SIGTERM, so Docker kills it after 10 s (137). With --init the signal reaches node, which quits on it (143).',
      },
      example: { sql: 'docker run -d --name t1 alpine sh -c "exit 3"\ndocker run -d --name t2 nginx:alpine nosuchprogram\ndocker run -d --name t3 alpine sleep 1\nsleep 2\ndocker ps -a --format "{{.Names}}: {{.Status}}"\ndocker logs t2', note: 't2\'s entrypoint script tried to run nosuchprogram: exit 127, and the logs say "not found".' },
      cheat: { syntax: 'docker ps -a\ndocker inspect -f "{{.State.ExitCode}}" NAME', note: '125 docker · 126 not executable · 127 not found · 137 killed · 143 terminated' },
    },
    {
      id: 'd09-routine',
      title: 'A troubleshooting routine',
      card: `When something's wrong, go from the outside in:

1. **\`docker ps -a\`**: is it running, restarting, exited? With which code?
2. **\`docker logs --tail 50 NAME\`**: what did the app say last? (\`-t\` adds timestamps.)
3. **\`docker inspect NAME\`** (or \`-f\` for one field): the real configuration. Ports, mounts, networks, env, restart policy, \`State.OOMKilled\`, \`State.Health\`.
4. **\`docker exec NAME …\`**: look from inside: files, \`env\`, \`wget -qO- http://other:port\`.
5. **\`docker stats --no-stream\`**: memory and CPU against the limits.

Most problems are one of a handful: a missing environment variable, a wrong port mapping, a container on the wrong network, a volume mounted at the wrong path, or a process that exits because it has nothing to do.`,
      env: { setup: ['docker network create shop', 'docker run -d --name db --network shop -e POSTGRES_PASSWORD=secret postgres:16-alpine', 'docker run -d --name api --restart unless-stopped postgres:16-alpine'] },
      predict: {
        sql: 'docker ps -a\ndocker logs --tail 10 api',
        question: 'Someone started `api` from the postgres image (as a test). `docker ps -a` shows it Restarting. What do the logs most likely say?',
        choices: ['Nothing: restarting containers have no logs', 'That the superuser password is not specified', 'That the network shop is missing', 'Out of memory'],
        answer: 1,
        why: 'The postgres image refuses to start without POSTGRES_PASSWORD, exits 1, and the restart policy keeps trying.',
      },
      example: { sql: 'docker ps -a\ndocker logs --tail 10 api\ndocker inspect -f "{{.RestartCount}} {{.HostConfig.RestartPolicy.Name}}" api\ndocker inspect -f "{{json .Config.Env}}" api\ndocker inspect -f "{{json .NetworkSettings.Networks}}" api', note: 'Logs say what, inspect confirms why: no password in the env, and not even on the shop network.' },
      cheat: { syntax: 'ps -a → logs --tail → inspect -f → exec → stats', note: 'Outside in.' },
    },
    {
      id: 'd09-cleanup',
      title: 'Cleaning up: df and prune',
      card: `Images, stopped containers, unused volumes and build cache pile up until the disk is full. See where the space goes:

\`\`\`
docker system df
\`\`\`

Then prune what you don't need (each asks first; \`-f\` skips the question):

| Command | Removes |
|---|---|
| \`docker container prune\` | stopped containers |
| \`docker image prune\` | **dangling** images (\`<none>\`, left over from rebuilds) |
| \`docker image prune -a\` | every image no container uses |
| \`docker volume prune\` | unused **anonymous** volumes (\`-a\`: named ones too) |
| \`docker system prune\` | stopped containers, unused networks, dangling images, build cache |

Be careful with volumes: a volume no container uses *right now* may still hold your database for the container you'll start tomorrow. Prune images and containers freely; prune volumes on purpose.`,
      env: { files: { Dockerfile: 'FROM alpine:3.22\nCMD ["echo", "v1"]\n' }, setup: ['docker build -t tool .', 'docker run --name old1 alpine:3.22 echo hi', 'docker run --name old2 alpine:3.22 echo hi'] },
      predict: {
        sql: 'docker container prune -f\ndocker ps -a',
        question: 'There are two stopped containers (old1, old2) and no running ones. What does `docker ps -a` show after `docker container prune -f`?',
        choices: ['Both containers, still there', 'An empty list (just the header)', 'Only old2', 'An error: -f needs a filter'],
        answer: 1,
        why: 'container prune removes every stopped container. -f just skips the "Are you sure?" question.',
      },
      example: { sql: 'docker system df\ndocker container prune -f\necho \'FROM alpine:3.22\' > Dockerfile\necho \'CMD ["echo", "v2"]\' >> Dockerfile\ndocker build -t tool .\ndocker images\ndocker image prune -f\ndocker system df', note: 'Rebuilding with the same tag left the old image as <none>: dangling. image prune removes it.' },
      cheat: { syntax: 'docker system df\ndocker container|image|volume|system prune [-f] [-a]', note: 'Prune volumes only on purpose.' },
    },
  ],
  practice: [
    {
      id: 'd09-p1',
      kind: 'write',
      conceptIds: ['d09-restart'],
      prompt: 'Run **nginx:alpine** in the background as **web**, so it comes back after crashes and after a server reboot, **but not** if you stopped it yourself.',
      solution: 'docker run -d --name web --restart unless-stopped nginx:alpine',
      wrongExample: 'docker run -d --name web --restart always nginx:alpine',
      hints: ['Which policy makes an exception for containers you stopped by hand?', '`--restart unless-stopped`'],
      explanation: '`always` would also start it again after a reboot even if you had stopped it on purpose.',
      docker: { target: 'commands', after: ['docker inspect -f "{{.HostConfig.RestartPolicy.Name}}" web'] },
    },
    {
      id: 'd09-p2',
      kind: 'write',
      conceptIds: ['d09-restart'],
      prompt: '`worker` is in a crash loop (it keeps restarting). Stop the loop by changing its restart policy to **no**, without removing it, so you can read its logs in peace.',
      solution: 'docker update --restart no worker',
      wrongExample: 'docker rm -f worker',
      hints: ['There\'s a command that changes settings of an existing container.', '`docker update --restart no worker`'],
      explanation: 'docker update changes the policy in place; the container stays (Exited) with all its logs.',
      docker: { target: 'commands', setup: ['docker run -d --name worker --restart always alpine sh -c "echo cannot reach queue; exit 1"'], after: ['docker ps -a --format "{{.Names}}: {{.State}}"', 'docker logs --tail 1 worker'] },
    },
    {
      id: 'd09-p3',
      kind: 'readQuery',
      conceptIds: ['d09-restart'],
      prompt: 'A container runs with `--restart on-failure:3`. Its job finishes successfully (exit 0). What does Docker do?',
      choices: ['Restarts it 3 times', 'Nothing: on-failure only restarts after a non-zero exit', 'Restarts it forever', 'Removes it'],
      answer: 1,
      hints: [],
      explanation: 'Exit 0 isn\'t a failure. `always` would restart it.',
    },
    {
      id: 'd09-p4',
      kind: 'write',
      conceptIds: ['d09-health'],
      prompt: 'Add a healthcheck to this nginx image that runs `curl -f http://localhost/ || exit 1`.',
      starterSql: 'FROM nginx:alpine\n',
      solution: 'FROM nginx:alpine\nHEALTHCHECK CMD curl -f http://localhost/ || exit 1',
      wrongExample: 'FROM nginx:alpine\nRUN curl -f http://localhost/ || exit 1',
      hints: ['The instruction is called HEALTHCHECK.', '`HEALTHCHECK CMD curl -f http://localhost/ || exit 1`'],
      explanation: 'RUN would execute once at build time (and fail: nothing is serving then).',
      docker: { target: 'dockerfile', after: ['docker run -d --name w app', 'docker inspect -f "{{.State.Health.Status}}" w'] },
    },
    {
      id: 'd09-p5',
      kind: 'readQuery',
      conceptIds: ['d09-health'],
      prompt: 'A plain `docker run` container (restart policy `always`) becomes **unhealthy** but keeps running. What does Docker do?',
      choices: ['Restarts it, because of the policy', 'Nothing but report it: restart policies react to the process exiting, not to health', 'Stops it', 'Removes it and starts a new one'],
      answer: 1,
      hints: [],
      explanation: 'Acting on health is the job of Compose (service_healthy), a load balancer, or an orchestrator.',
    },
    {
      id: 'd09-p6',
      kind: 'write',
      conceptIds: ['d09-limits'],
      prompt: 'Run the image **api** in the background as **api**, limited to **256 MB** of memory and **half a CPU**.',
      solution: 'docker run -d --name api --memory 256m --cpus 0.5 api',
      wrongExample: 'docker run -d --name api --memory 256 --cpus 0.5 api',
      hints: ['`--memory` takes a size with a unit: k, m, g.', '`--memory 256m --cpus 0.5`'],
      explanation: 'Without a unit, 256 means 256 *bytes*: Docker rejects it (the minimum is 6 MB).',
      docker: { target: 'commands', files: API, setup: ['docker build -t api .'], after: ['docker inspect -f "{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}" api'] },
    },
    {
      id: 'd09-p7',
      kind: 'fixBug',
      conceptIds: ['d09-limits', 'd09-exitcodes'],
      prompt: 'The nightly report container `nightly` died with **Exited (137)** and empty logs. Find out why (it\'s free to look), then fix it: run the image **report** again as **nightly2**, so that it finishes.',
      starterSql: 'docker run --name nightly2 --memory 256m report',
      solution: 'docker inspect -f "{{.State.OOMKilled}}" nightly\ndocker run --name nightly2 --memory 512m report',
      wrongExample: 'docker run --name nightly2 --memory 256m --restart on-failure report',
      hints: ['137 = killed. `docker inspect -f "{{.State.OOMKilled}}" nightly`', 'It needs about 300 MB. Give it more memory, e.g. `--memory 512m`.'],
      explanation: 'OOMKilled=true: the limit was too low for the job. Restarting doesn\'t help: it would just get killed again.',
      docker: { target: 'commands', files: REPORT, setup: ['docker build -t report .', 'docker run --name nightly --memory 256m report'], after: ['docker logs nightly2', 'docker ps -a --filter name=nightly2 --format "{{.Status}}"'], compare: ['output'] },
    },
    {
      id: 'd09-p8',
      kind: 'readQuery',
      conceptIds: ['d09-exitcodes'],
      prompt: '`docker run -d --name web -p 8080:80 nginx` prints an error and exits with code **125**. Where is the problem?',
      choices: ['In nginx\'s configuration', 'In the docker command itself or the daemon (e.g. name in use, port taken): the container never ran', 'nginx was killed', 'nginx isn\'t in the image'],
      answer: 1,
      hints: [],
      explanation: '125 means Docker couldn\'t even run the container. Read docker\'s own error message.',
    },
    {
      id: 'd09-p9',
      kind: 'write',
      conceptIds: ['d09-exitcodes'],
      prompt: 'The Node server image **api** takes 10 seconds to stop, and stops with code 137. Start it again as **api** (in the background), so that `docker stop` delivers the signal and it quits straight away.',
      solution: 'docker run -d --name api --init api',
      wrongExample: 'docker run -d --name api api',
      hints: ['Node as PID 1 ignores SIGTERM.', 'A flag puts a small init process in front of it: `--init`.'],
      explanation: 'With --init, docker stop ends it with 143 (SIGTERM) instead of waiting and killing it (137).',
      docker: { target: 'commands', files: API, setup: ['docker build -t api .'], after: ['docker stop api', 'docker ps -a --format "{{.Names}}: {{.Status}}"'], compare: ['output'] },
    },
    {
      id: 'd09-p10',
      kind: 'write',
      conceptIds: ['d09-routine'],
      prompt: '`api` keeps restarting. Show its **last 10 log lines**, then print **only its environment** (as JSON) with inspect. (Look only: change nothing.)',
      solution: 'docker logs --tail 10 api\ndocker inspect -f "{{json .Config.Env}}" api',
      wrongExample: 'docker logs api\ndocker inspect api',
      hints: ['`--tail N` limits the log lines.', '`-f "{{json .Config.Env}}"` picks one field.'],
      explanation: 'The logs say the password is missing; the env confirms there\'s no POSTGRES_PASSWORD.',
      docker: { target: 'commands', setup: ['docker run -d --name api --restart unless-stopped postgres:16-alpine'], compare: ['stdout'] },
    },
    {
      id: 'd09-p11',
      kind: 'write',
      conceptIds: ['d09-cleanup'],
      prompt: 'The disk is filling up. Remove all **stopped containers** and all **dangling images**, without being asked for confirmation. Leave volumes alone.',
      solution: 'docker container prune -f\ndocker image prune -f',
      wrongExample: 'docker system prune -af --volumes',
      hints: ['Two prune commands, each with -f.', '`docker container prune -f` and `docker image prune -f`'],
      explanation: '`system prune -a --volumes` would also delete every unused image and anonymous volume: far more than asked.',
      docker: { target: 'commands', files: { Dockerfile: 'FROM alpine:3.22\nCMD ["echo", "v2"]\n' }, setup: ['docker volume create keepme', 'docker pull nginx:alpine', 'echo \'FROM alpine:3.22\' > Dockerfile', 'echo \'CMD ["echo", "v1"]\' >> Dockerfile', 'docker build -t tool .', 'echo \'CMD ["echo", "v2"]\' >> Dockerfile', 'docker build -t tool .', 'docker run --name old tool', 'docker run --name older alpine:3.22 true'], compare: ['containers', 'images', 'volumes'] },
    },
  ],
  test: [
    {
      id: 'd09-t1',
      kind: 'write',
      conceptIds: ['d09-restart', 'd09-limits'],
      prompt: 'Run **redis:alpine** in the background as **cache**: it should survive crashes and reboots (unless you stop it), with at most **128 MB** of memory.',
      solution: 'docker run -d --name cache --restart unless-stopped --memory 128m redis:alpine',
      wrongExample: 'docker run -d --name cache --memory 128m redis:alpine',
      hints: [],
      explanation: 'A policy and a limit: the two basics for every production container.',
      docker: { target: 'commands', after: ['docker inspect -f "{{.HostConfig.RestartPolicy.Name}} {{.HostConfig.Memory}}" cache'] },
    },
    {
      id: 'd09-t2',
      kind: 'readQuery',
      conceptIds: ['d09-exitcodes'],
      prompt: 'A container shows **Exited (137)** and `OOMKilled` is **false**. What happened most likely?',
      choices: ['It ran out of memory', 'Someone ran `docker kill`, or `docker stop` timed out and killed it', 'The command wasn\'t found', 'It finished normally'],
      answer: 1,
      hints: [],
      explanation: '137 is SIGKILL. Without OOMKilled, it was killed from outside, e.g. a stop on an app that ignores SIGTERM.',
    },
    {
      id: 'd09-t3',
      kind: 'fixBug',
      conceptIds: ['d09-routine'],
      prompt: '`db` (postgres:16-alpine) keeps restarting. Find the cause, then replace it: remove it and start **db** again, on the network **shop**, with the password `secret`, restarting unless-stopped.',
      starterSql: 'docker rm -f db\ndocker run -d --name db --network shop --restart unless-stopped postgres:16-alpine',
      solution: 'docker logs --tail 10 db\ndocker rm -f db\ndocker run -d --name db --network shop --restart unless-stopped -e POSTGRES_PASSWORD=secret postgres:16-alpine',
      wrongExample: 'docker restart db',
      hints: [],
      explanation: 'The logs name the missing POSTGRES_PASSWORD. Restarting can\'t fix missing configuration.',
      docker: { target: 'commands', setup: ['docker network create shop', 'docker run -d --name db --network shop --restart unless-stopped postgres:16-alpine'] },
    },
    {
      id: 'd09-t4',
      kind: 'readQuery',
      conceptIds: ['d09-cleanup'],
      prompt: 'Which command could delete your database\'s data?',
      choices: ['docker image prune -a', 'docker container prune', 'docker volume prune -a (while the db container is removed)', 'docker system df'],
      answer: 2,
      hints: [],
      explanation: 'With no container using it at that moment, the named volume counts as unused, and -a includes named volumes.',
    },
    {
      id: 'd09-t5',
      kind: 'write',
      conceptIds: ['d09-health'],
      prompt: 'Run **nginx:alpine** in the background as **web** with a healthcheck (at run time) that runs `wget -qO- http://localhost/ || exit 1`.',
      solution: 'docker run -d --name web --health-cmd "wget -qO- http://localhost/ || exit 1" nginx:alpine',
      wrongExample: 'docker run -d --name web nginx:alpine wget -qO- http://localhost/',
      hints: [],
      explanation: '`--health-cmd` adds the check; anything after the image would replace nginx\'s own command.',
      docker: { target: 'commands', after: ['sleep 31', 'docker ps --format "{{.Names}}: {{.Status}}"'] },
    },
    {
      id: 'd09-t6',
      kind: 'readQuery',
      conceptIds: ['d09-limits'],
      prompt: 'An API container is given `--cpus 0.25`. Under heavy load, what happens?',
      choices: ['It\'s killed with exit 137', 'It gets slow: it can use only a quarter of a core', 'Docker moves it to another core', 'Nothing: CPU limits are only advisory'],
      answer: 1,
      hints: [],
      explanation: 'CPU limits throttle; memory limits kill.',
    },
  ],
};
