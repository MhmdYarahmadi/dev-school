import type { Module } from '../../../content/types';

export const d02: Module = {
  id: 'd02',
  number: 2,
  title: 'Container lifecycle',
  tagline: 'Start, stop, restart, remove. Why containers exit, and how to look inside one.',
  games: ['lifecycle'],
  concepts: [
    {
      id: 'd02-main',
      title: 'A container lives as long as its main process',
      card: `Each container runs **one main process**: the image's default command, or the one you give. The rule:

> When the main process ends, the container stops.

- \`nginx\` runs a web server that never ends, so its container stays **Up**.
- \`alpine\` and \`ubuntu\` start a **shell** by default. With no terminal attached, the shell has nothing to read and exits at once, even with \`-d\`.
- \`alpine sleep 300\` stays up for 300 seconds, then stops.

To keep a shell container alive for experiments, attach a terminal with \`-it\` (interactive + tty), or give it a long-running command.`,
      predict: {
        sql: 'docker run -d --name box alpine\ndocker run -d --name nap alpine sleep 300\ndocker ps',
        question: 'Which containers does `docker ps` (running only) show?',
        choices: ['box and nap', 'Only nap', 'Only box', 'Neither'],
        answer: 1,
        why: '`box` runs alpine\'s default shell, which exits immediately because no terminal is attached. `nap` runs `sleep 300`, so it\'s Up for 5 minutes.',
      },
      example: { sql: 'docker run -d --name box alpine\ndocker run -d --name nap alpine sleep 300\ndocker ps -a', note: 'box: Exited (0). nap: Up.' },
      cheat: { syntax: 'docker run -d alpine sleep 3600', note: 'A container stops when its main process ends.' },
    },
    {
      id: 'd02-stop',
      title: 'stop, start, restart',
      card: `\`docker stop NAME\` asks the main process to quit (signal SIGTERM). If it hasn't stopped after **10 seconds**, Docker kills it (SIGKILL).

\`docker start NAME\` starts a stopped container again, with the **same settings and files** it had. \`docker restart NAME\` = stop + start.

A stopped container isn't gone: it keeps its name, configuration and any files written inside it, until you **remove** it.

Exit codes tell you how it ended: **0** = finished normally, **137** = killed (128 + 9, SIGKILL), **143** = ended by SIGTERM (128 + 15), others = the program's own error code.`,
      predict: {
        sql: 'docker run -d --name nap alpine sleep 300\ndocker stop nap\ndocker ps -a',
        question: '`sleep` running as a container\'s main process ignores SIGTERM. What STATUS will nap have?',
        choices: ['Exited (0)', 'Exited (137)', 'Exited (143)', 'Up'],
        answer: 1,
        why: 'Docker sent SIGTERM, waited 10 seconds, then killed it with SIGKILL: exit code 128 + 9 = 137. nginx, which handles the stop signal, exits with 0.',
      },
      example: { sql: 'docker run -d --name web nginx\ndocker stop web\ndocker ps -a\ndocker start web\ndocker ps', note: 'Stopped (Exited (0)) and started again: same container, same name.' },
      cheat: { syntax: 'docker stop NAME\ndocker start NAME\ndocker restart NAME', note: 'stop waits up to 10 s, then kills (137).' },
    },
    {
      id: 'd02-rm',
      title: 'Removing containers',
      card: `\`docker rm NAME\` deletes a **stopped** container, including the files written inside it.

- A **running** container can't be removed: stop it first, or force it with \`docker rm -f NAME\` (stop + remove).
- \`docker container prune -f\` removes **all** stopped containers.
- \`docker run --rm …\` removes the container **automatically** when it stops. Perfect for one-off commands.
- \`docker rmi IMAGE\` removes an image, but only if no container (even a stopped one) uses it.`,
      predict: {
        sql: 'docker run -d --name web nginx\ndocker rm web',
        question: 'What happens?',
        choices: ['web is stopped and removed', 'An error: you can\'t remove a running container', 'web is removed but keeps running', 'Docker asks for confirmation'],
        answer: 1,
        why: 'Docker refuses to remove a running container. Use `docker stop web` first, or `docker rm -f web`.',
        expectError: true,
      },
      example: { sql: 'docker run --rm alpine echo one-off\ndocker run -d --name web nginx\ndocker rm -f web\ndocker ps -a', note: 'The --rm container cleaned itself up; rm -f stopped and removed web.' },
      cheat: { syntax: 'docker rm NAME\ndocker rm -f NAME\ndocker run --rm IMAGE CMD\ndocker container prune -f', note: 'Remove; force-remove a running one; auto-remove on exit; remove all stopped.' },
    },
    {
      id: 'd02-logs',
      title: 'Logs',
      card: `Whatever a container's main process prints is kept as its **logs**, even after it has stopped:

\`\`\`
docker logs NAME
docker logs --tail 20 NAME     # only the last 20 lines
docker logs -f NAME            # keep following new lines (Ctrl+C to stop)
\`\`\`

Logs are your first stop when a container exits unexpectedly: the program usually says why.`,
      predict: {
        sql: 'docker run -d --name greeter alpine echo hello\ndocker logs greeter',
        question: 'greeter has already stopped. What does `docker logs greeter` print?',
        choices: ['Nothing: it has stopped', 'An error: container is not running', 'hello'],
        answer: 2,
        why: 'Logs belong to the container and survive until it\'s removed. That\'s why `-d` didn\'t lose the output: it\'s in the logs.',
      },
      example: { sql: 'docker run -d --name web nginx\ndocker logs --tail 5 web', note: 'The last 5 lines nginx printed while starting.' },
      cheat: { syntax: 'docker logs [--tail N] [-f] NAME', note: 'What the main process printed.' },
    },
    {
      id: 'd02-exec',
      title: 'Running commands inside: docker exec',
      card: `\`docker exec NAME COMMAND\` runs an **extra** command inside a **running** container. It's how you look around:

\`\`\`
docker exec web ls /usr/share/nginx/html
docker exec web cat /etc/os-release
\`\`\`

For an interactive shell, add \`-it\`: \`docker exec -it web sh\` (type \`exit\` to leave; the container keeps running).

Compare with \`docker run\`, which creates a **new** container. \`exec\` works inside an existing one, and only while it's running.`,
      predict: {
        sql: 'docker run -d --name web nginx\ndocker stop web\ndocker exec web ls',
        question: 'What happens?',
        choices: ['It lists the files', 'It starts web, then lists the files', 'An error: the container is not running'],
        answer: 2,
        why: '`exec` needs a running container: it runs alongside the main process. Start it first.',
        expectError: true,
      },
      example: { sql: 'docker run -d --name web nginx\ndocker exec web ls /usr/share/nginx/html\ndocker exec web hostname', note: 'The hostname is the container\'s short id.' },
      cheat: { syntax: 'docker exec NAME CMD\ndocker exec -it NAME sh', note: 'Run a command inside a running container.' },
    },
  ],
  practice: [
    {
      id: 'd02-p1',
      kind: 'write',
      conceptIds: ['d02-stop'],
      prompt: 'The nginx container `web` is running. **Stop** it gracefully.',
      solution: 'docker stop web',
      wrongExample: 'docker kill web',
      hints: ['The graceful command sends SIGTERM first.', '`docker stop NAME`'],
      explanation: '`stop` lets nginx shut down cleanly (exit 0). `kill` would end it immediately (exit 137).',
      docker: { target: 'commands', setup: ['docker run -d --name web nginx'] },
    },
    {
      id: 'd02-p2',
      kind: 'write',
      conceptIds: ['d02-rm'],
      prompt: 'The container `web` is running. **Remove** it with a single command.',
      solution: 'docker rm -f web',
      wrongExample: 'docker rm web',
      hints: ['Plain `docker rm` refuses running containers.', 'Force it.'],
      explanation: '`-f` stops and removes in one go. (`docker stop web` then `docker rm web` is fine too, but that\'s two commands.)',
      docker: { target: 'commands', setup: ['docker run -d --name web nginx'] },
    },
    {
      id: 'd02-p3',
      kind: 'write',
      conceptIds: ['d02-stop'],
      prompt: 'The nginx container `web` is stopped. Get it **running again**.',
      solution: 'docker start web',
      wrongExample: 'docker run -d --name web nginx',
      hints: ['Don\'t create a new container: the old one still exists.', '`docker start NAME`'],
      explanation: '`docker start` revives the existing container. `docker run` would try to create a new one, and the name is taken.',
      docker: { target: 'commands', setup: ['docker run -d --name web nginx', 'docker stop web'] },
    },
    {
      id: 'd02-p4',
      kind: 'write',
      conceptIds: ['d02-rm'],
      prompt: 'Use **alpine** to print `bye`, so that the container is **removed automatically** when it finishes.',
      solution: 'docker run --rm alpine echo bye',
      wrongExample: 'docker run alpine echo bye',
      hints: ['There\'s a `docker run` option for this.', '`--rm`'],
      explanation: '`--rm` deletes the container as soon as it stops. Nothing is left in `docker ps -a`.',
      docker: { target: 'commands', compare: ['stdout', 'containers'] },
    },
    {
      id: 'd02-p5',
      kind: 'write',
      conceptIds: ['d02-logs'],
      prompt: 'The container `app` has finished. Show only the **last line** of its logs.',
      solution: 'docker logs --tail 1 app',
      wrongExample: 'docker logs app',
      hints: ['`docker logs` has an option to limit lines.', '`--tail N`'],
      explanation: '`--tail 1` shows only the last line.',
      docker: { target: 'commands', setup: ['docker run --name app alpine sh -c "echo starting; echo loading config; echo ready"'], compare: ['stdout'] },
    },
    {
      id: 'd02-p6',
      kind: 'write',
      conceptIds: ['d02-exec'],
      prompt: 'List the files in `/usr/share/nginx/html` inside the **running** container `web`.',
      solution: 'docker exec web ls /usr/share/nginx/html',
      wrongExample: 'docker run nginx ls /usr/share/nginx/html',
      hints: ['Run a command *inside an existing* container.', '`docker exec NAME COMMAND`'],
      explanation: '`exec` runs inside `web`. `docker run` would create a whole new container just to run `ls`.',
      docker: { target: 'commands', setup: ['docker run -d --name web nginx'], compare: ['stdout', 'containers'] },
    },
    {
      id: 'd02-p7',
      kind: 'fixBug',
      conceptIds: ['d02-main'],
      prompt: 'This should start an alpine container named `worker` that **keeps running for an hour**, but it stops straight away. Fix it.',
      starterSql: 'docker run -d --name worker alpine',
      solution: 'docker run -d --name worker alpine sleep 3600',
      wrongExample: 'docker run -d --name worker alpine',
      hints: ['What is the container\'s main process here, and when does it end?', 'Give it a command that lasts an hour: `sleep 3600`.'],
      explanation: 'alpine\'s default shell exits at once without a terminal. `sleep 3600` keeps the main process (and the container) alive for an hour.',
      docker: { target: 'commands' },
    },
    {
      id: 'd02-p8',
      kind: 'readQuery',
      conceptIds: ['d02-stop'],
      prompt: '`docker ps -a` shows a container with STATUS `Exited (137)`. What most likely happened?',
      choices: ['Its program finished successfully', 'It was killed (SIGKILL): by `docker kill`, or because it ignored `docker stop` for 10 seconds, or ran out of memory', 'It is restarting', 'Its program reported error number 137'],
      answer: 1,
      hints: [],
      explanation: '137 = 128 + 9: the process was killed by signal 9 (SIGKILL).',
    },
    {
      id: 'd02-p9',
      kind: 'parsons',
      conceptIds: ['d02-stop', 'd02-rm'],
      prompt: '`web` runs `nginx:1.27`. **Replace** it with a container of the same name running `nginx:alpine` (in the background).',
      blocks: ['docker stop web', 'docker rm web', 'docker run -d --name web nginx:alpine'],
      distractors: ['docker start web', 'docker run -d --name web nginx:1.27'],
      wrongOrder: ['docker run -d --name web nginx:alpine', 'docker stop web', 'docker rm web'],
      hints: [],
      explanation: 'Stop, remove (freeing the name), then run the new one. Running first fails because the name is still taken.',
      docker: { target: 'commands', setup: ['docker run -d --name web nginx:1.27'] },
    },
    {
      id: 'd02-p10',
      kind: 'write',
      conceptIds: ['d02-rm'],
      prompt: 'Two stopped containers are cluttering your machine; `web` is running. Remove **all stopped containers** with one command (no confirmation prompt), and keep `web`.',
      solution: 'docker container prune -f',
      wrongExample: 'docker rm old1',
      hints: ['There\'s a "prune" command for containers.', 'Add `-f` to skip the "Are you sure?" question.'],
      explanation: '`docker container prune -f` removes every stopped container. (`docker rm old1 old2` works too.)',
      docker: { target: 'commands', setup: ['docker run --name old1 alpine echo 1', 'docker run --name old2 alpine echo 2', 'docker run -d --name web nginx'] },
    },
  ],
  test: [
    {
      id: 'd02-t1',
      kind: 'write',
      conceptIds: ['d02-rm'],
      prompt: '`api` is running and `old` is stopped. Remove **`old`**.',
      solution: 'docker rm old',
      wrongExample: 'docker rm -f api',
      hints: [],
      explanation: 'A stopped container can be removed with plain `docker rm`.',
      docker: { target: 'commands', setup: ['docker run -d --name api nginx', 'docker run --name old alpine echo bye'] },
    },
    {
      id: 'd02-t2',
      kind: 'write',
      conceptIds: ['d02-rm', 'd01-run'],
      prompt: 'Use **busybox** to print `done`, cleaning up the container automatically afterwards.',
      solution: 'docker run --rm busybox echo done',
      wrongExample: 'docker run busybox echo done',
      hints: [],
      explanation: '`--rm` removes the container when it exits.',
      docker: { target: 'commands', compare: ['stdout', 'containers'] },
    },
    {
      id: 'd02-t3',
      kind: 'write',
      conceptIds: ['d02-exec'],
      prompt: 'Print the **hostname** of the running container `web`, by running `hostname` inside it.',
      solution: 'docker exec web hostname',
      wrongExample: 'docker run nginx hostname',
      hints: [],
      explanation: '`docker exec` runs the command inside the existing container.',
      docker: { target: 'commands', setup: ['docker run -d --name web nginx'], compare: ['stdout', 'containers'] },
    },
    {
      id: 'd02-t4',
      kind: 'readQuery',
      conceptIds: ['d02-main'],
      prompt: 'Right after `docker run -d --name box ubuntu`, what is box\'s status?',
      choices: ['Up: -d keeps it running', 'Exited (0): its default shell had no terminal and ended', 'Created: it waits for a command', 'Restarting'],
      answer: 1,
      hints: [],
      explanation: '`-d` only puts it in the background. The main process (bash) ends immediately without a terminal, so the container stops.',
    },
    {
      id: 'd02-t5',
      kind: 'fixBug',
      conceptIds: ['d02-rm'],
      prompt: 'This fails with "container is running: stop the container before removing". Make it remove the running container `web`.',
      starterSql: 'docker rm web',
      solution: 'docker rm -f web',
      wrongExample: 'docker rm web',
      hints: [],
      explanation: 'Force it with `-f`, or stop it first.',
      docker: { target: 'commands', setup: ['docker run -d --name web nginx'] },
    },
    {
      id: 'd02-t6',
      kind: 'readQuery',
      conceptIds: ['d02-logs'],
      prompt: 'A container you started with `-d` exited with code 1 right away. What is the best first step?',
      choices: ['`docker rm` it and run it again', '`docker logs NAME` to read what the program printed', '`docker exec NAME sh` to look inside', 'Pull the image again'],
      answer: 1,
      hints: [],
      explanation: 'The logs survive the exit and usually contain the error. `exec` won\'t work: it isn\'t running.',
    },
  ],
};
