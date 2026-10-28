import type { Module } from '../../../content/types';

const HELLO_JS = { 'hello.js': 'console.log("Hello from Node!");\n' };
const SERVER_JS = { 'server.js': 'const http = require("http");\nhttp.createServer((req, res) => res.end("Hello from the server!\\n")).listen(3000);\n' };
const APP_PY = { 'app.py': 'import os\nprint("Report for", os.environ.get("TEAM", "nobody"))\n' };

export const d06: Module = {
  id: 'd06',
  number: 6,
  title: 'Dockerfile basics',
  tagline: 'Write a recipe, build your own image, and run your app anywhere.',
  games: ['kitchen'],
  concepts: [
    {
      id: 'd06-build',
      title: 'A Dockerfile and docker build',
      card: `A **Dockerfile** is a text file with the recipe for an image. Each line is an **instruction**:

\`\`\`dockerfile
FROM alpine
CMD ["echo", "Hello, Docker!"]
\`\`\`

- \`FROM\` picks the **base image** to start from. Every Dockerfile begins with it.
- \`CMD\` sets the **default command** for containers made from the image.

Build it, naming (tagging) the image with \`-t\`:

\`\`\`
docker build -t hello .
docker run --rm hello          # Hello, Docker!
\`\`\`

The \`.\` at the end is the **build context**: the folder whose files the build can use. Docker reads \`./Dockerfile\` by default (\`-f\` picks another file). Tag versions with \`-t hello:1.0\`; without a tag it's \`:latest\`.`,
      env: { files: { Dockerfile: 'FROM alpine\nCMD ["echo", "Hello, Docker!"]\n' } },
      predict: {
        sql: 'docker build -t hello .\ndocker run --rm hello',
        question: 'The Dockerfile is `FROM alpine` + `CMD ["echo", "Hello, Docker!"]`. What does the run print?',
        choices: ['Hello, Docker!', 'Nothing: alpine exits straight away', 'An error: the image hello isn\'t on Docker Hub'],
        answer: 0,
        why: 'The build created `hello:latest` locally, so run doesn\'t need to pull. Its default command is the CMD: echo Hello, Docker!',
      },
      example: { sql: 'cat Dockerfile\ndocker build -t hello:1.0 .\ndocker images\ndocker run --rm hello:1.0', note: 'The build output lists each step. The new image appears in docker images.' },
      cheat: { syntax: 'docker build -t NAME[:TAG] .', note: 'Build ./Dockerfile with the current folder as context.' },
    },
    {
      id: 'd06-run',
      title: 'RUN: commands at build time',
      card: `\`RUN\` executes a command **while building**, and saves the result in the image as a new **layer**. It's how you install software:

\`\`\`dockerfile
FROM alpine
RUN apk add --no-cache curl
CMD ["curl", "--version"]
\`\`\`

Don't confuse it with \`CMD\`:

| | \`RUN\` | \`CMD\` |
|---|---|---|
| When | during \`docker build\` | each \`docker run\` |
| How many | as many as you need | one (the last one counts) |
| Typical | install packages, create folders | start the app |

Package managers depend on the base: **Alpine** uses \`apk add\`; **Debian/Ubuntu** use \`apt-get update && apt-get install -y …\`. The wrong one fails with \`not found\`.`,
      env: { files: { Dockerfile: 'FROM alpine\nRUN apk add --no-cache curl\nCMD ["curl", "--version"]\n' } },
      predict: {
        sql: 'docker build -t tools .\ndocker run --rm tools',
        question: 'Alpine doesn\'t include curl. Does `curl --version` work in the container?',
        choices: ['Yes: RUN installed curl into the image during the build', 'No: RUN only ran during the build and left nothing behind', 'No: you have to install it again with docker run'],
        answer: 0,
        why: 'Whatever RUN changes is saved as an image layer. Every container from the image has curl.',
      },
      example: { sql: 'docker build -t tools .\ndocker run --rm tools\ndocker history tools', note: 'History shows the RUN layer and its size.' },
      cheat: { syntax: 'RUN apk add --no-cache PKG     (Alpine)\nRUN apt-get update && apt-get install -y PKG   (Debian)', note: 'Runs at build time; the result becomes a layer.' },
    },
    {
      id: 'd06-copy',
      title: 'COPY and WORKDIR: put your app inside',
      card: `\`COPY\` copies files from the **build context** (your folder) into the image. \`WORKDIR\` sets the folder that later instructions, and the container, work in (it's created if needed):

\`\`\`dockerfile
FROM node:22-alpine
WORKDIR /app
COPY hello.js .
CMD ["node", "hello.js"]
\`\`\`

- \`COPY hello.js .\` copies into the current WORKDIR, \`/app\`.
- \`COPY . .\` copies the **whole** build context.
- A path that isn't in the build context fails the build: *"/missing.txt": not found*.
- Use \`WORKDIR\` instead of \`RUN cd …\`: each RUN starts fresh, so a \`cd\` doesn't carry over.`,
      env: { files: { Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY hello.js .\nCMD ["node", "hello.js"]\n', ...HELLO_JS } },
      predict: {
        sql: 'docker build -t hello .\ndocker run --rm hello pwd',
        question: 'The command `pwd` replaces the CMD. Which folder does it print?',
        choices: ['/', '/app', '/home/learner/myapp'],
        answer: 1,
        why: 'WORKDIR /app is also the container\'s working directory.',
      },
      example: { sql: 'docker build -t hello .\ndocker run --rm hello\ndocker run --rm hello ls /app', note: 'The script was copied into /app, and node runs it from there.' },
      cheat: { syntax: 'WORKDIR /app\nCOPY SRC DEST   (COPY . .)', note: 'Copy files from the build context into the image.' },
    },
    {
      id: 'd06-env',
      title: 'ENV and EXPOSE',
      card: `\`ENV\` sets an **environment variable** in the image, as a default. \`docker run -e\` can override it:

\`\`\`dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY app.py .
ENV TEAM=blue
CMD ["python3", "app.py"]
\`\`\`

\`EXPOSE\` **documents** which port the app listens on. It doesn't publish anything: you still need \`-p\`. It's what \`docker ps\` shows as \`3000/tcp\`, and what \`-P\` publishes.

\`\`\`dockerfile
EXPOSE 3000
\`\`\``,
      env: { files: { Dockerfile: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY app.py .\nENV TEAM=blue\nCMD ["python3", "app.py"]\n', ...APP_PY } },
      predict: {
        sql: 'docker build -t report .\ndocker run --rm -e TEAM=red report',
        question: 'The image says `ENV TEAM=blue`. What does this run print?',
        choices: ['Report for blue', 'Report for red', 'Report for nobody'],
        answer: 1,
        why: '`-e` at run time overrides the image\'s ENV default.',
      },
      example: { sql: 'docker build -t report .\ndocker run --rm report\ndocker run --rm -e TEAM=red report\ndocker image inspect -f "{{json .Config.Env}}" report', note: 'The ENV default ends up in the image config.' },
      cheat: { syntax: 'ENV KEY=value\nEXPOSE PORT', note: 'ENV: default variable (override with -e). EXPOSE: documentation; publish with -p.' },
    },
    {
      id: 'd06-cmd',
      title: 'CMD: exec form vs shell form',
      card: `CMD has two forms:

\`\`\`dockerfile
CMD ["node", "server.js"]        # exec form (JSON list): runs the program directly
CMD node server.js               # shell form: runs /bin/sh -c "node server.js"
\`\`\`

**Prefer the exec form.** The program is the container's main process, so it receives \`docker stop\`'s signal and shuts down cleanly.

The catch: in exec form **no shell is involved**, so \`$VARIABLES\` are **not** expanded. \`CMD ["echo", "$HOME"]\` prints \`$HOME\` literally. Need a variable? Use \`CMD ["sh", "-c", "echo $HOME"]\`, or let the app read the variable itself.

Anything after the image name in \`docker run\` **replaces** CMD: \`docker run --rm hello ls /\`.`,
      env: { files: { Dockerfile: 'FROM alpine\nENV GREETING=hello\nCMD ["echo", "$GREETING"]\n' } },
      predict: {
        sql: 'docker build -t greet .\ndocker run --rm greet',
        question: 'ENV GREETING=hello, and CMD ["echo", "$GREETING"]. What is printed?',
        choices: ['hello', '$GREETING', 'An empty line'],
        answer: 1,
        why: 'The exec form runs echo directly, without a shell, and only a shell expands `$GREETING`.',
      },
      example: { sql: 'docker build -t greet .\ndocker run --rm greet\ndocker run --rm greet sh -c \'echo $GREETING\'', note: 'Passing `sh -c` replaces CMD and expands the variable inside the container. Single quotes keep your own shell from expanding it first.' },
      cheat: { syntax: 'CMD ["prog", "arg"]   (exec form, preferred)', note: 'No shell: no $VAR expansion. docker run IMAGE CMD… replaces it.' },
    },
    {
      id: 'd06-entrypoint',
      title: 'ENTRYPOINT + CMD',
      card: `\`ENTRYPOINT\` sets the **fixed** program. CMD then provides its **default arguments**, which \`docker run\` arguments replace:

\`\`\`dockerfile
FROM alpine
ENTRYPOINT ["echo", "Hello"]
CMD ["world"]
\`\`\`

\`\`\`
docker run --rm greeter          # Hello world
docker run --rm greeter Ada      # Hello Ada
\`\`\`

With only CMD, \`docker run greeter Ada\` would try to **run a program called Ada**. Use ENTRYPOINT when the image is a tool (the "program") and users pass it arguments. To replace the entrypoint itself: \`docker run --entrypoint sh …\`.`,
      env: { files: { Dockerfile: 'FROM alpine\nENTRYPOINT ["echo", "Hello"]\nCMD ["world"]\n' } },
      predict: {
        sql: 'docker build -t greeter .\ndocker run --rm greeter Ada',
        question: 'What does `docker run --rm greeter Ada` print?',
        choices: ['Hello world', 'Hello Ada', 'Hello world Ada', 'An error: Ada is not a command'],
        answer: 1,
        why: '`Ada` replaces CMD (the default argument `world`). ENTRYPOINT `echo Hello` stays.',
      },
      example: { sql: 'docker build -t greeter .\ndocker run --rm greeter\ndocker run --rm greeter Ada\ndocker run --rm --entrypoint date greeter', note: '`--entrypoint` swaps the program itself.' },
      cheat: { syntax: 'ENTRYPOINT ["prog"]\nCMD ["default-arg"]', note: 'ENTRYPOINT is fixed; CMD is the replaceable default argument.' },
    },
  ],
  practice: [
    {
      id: 'd06-p1',
      kind: 'write',
      conceptIds: ['d06-build'],
      prompt: 'Write a Dockerfile, based on **alpine**, for an image that prints `Hello, Docker!` when it runs.',
      starterSql: 'FROM ',
      solution: 'FROM alpine\nCMD ["echo", "Hello, Docker!"]',
      wrongExample: 'FROM alpine\nRUN echo "Hello, Docker!"',
      hints: ['FROM picks the base; another instruction sets the default command.', '`CMD ["echo", "Hello, Docker!"]`'],
      explanation: 'CMD runs when a container starts. RUN would print only during the build.',
      docker: { target: 'dockerfile', after: ['docker run --rm app'] },
    },
    {
      id: 'd06-p2',
      kind: 'write',
      conceptIds: ['d06-build'],
      prompt: 'This folder has a Dockerfile. Build it as the image **myapp** with the tag **1.0**.',
      solution: 'docker build -t myapp:1.0 .',
      wrongExample: 'docker build -t myapp .',
      hints: ['`-t NAME:TAG`', 'Don\'t forget the build context at the end: `.`'],
      explanation: 'Without `:1.0` the tag would be `latest`.',
      docker: { target: 'commands', files: { Dockerfile: 'FROM alpine\nCMD ["echo", "myapp v1.0"]\n' }, compare: ['images'] },
    },
    {
      id: 'd06-p3',
      kind: 'fillBlank',
      conceptIds: ['d06-copy'],
      prompt: 'Package `hello.js` with Node: work in **/app**, copy the script there, and run it.',
      starterSql: 'FROM node:22-alpine\nWORKDIR ___\nCOPY ___ .\nCMD ["node", "hello.js"]',
      solution: 'FROM node:22-alpine\nWORKDIR /app\nCOPY hello.js .\nCMD ["node", "hello.js"]',
      wrongExample: 'FROM node:22-alpine\nWORKDIR /app\nCMD ["node", "hello.js"]',
      hints: ['WORKDIR takes a folder.', 'COPY takes the file from your folder, then where to put it (`.` = the WORKDIR).'],
      explanation: 'COPY brings the file from the build context into /app.',
      docker: { target: 'dockerfile', files: HELLO_JS, after: ['docker run --rm app'], compare: ['output', 'config'] },
    },
    {
      id: 'd06-p4',
      kind: 'fixBug',
      conceptIds: ['d06-run'],
      prompt: 'This build fails with `apt-get: not found`. Fix it so the image has curl.',
      starterSql: 'FROM alpine\nRUN apt-get update && apt-get install -y curl\nCMD ["curl", "--version"]',
      solution: 'FROM alpine\nRUN apk add --no-cache curl\nCMD ["curl", "--version"]',
      wrongExample: 'FROM alpine\nCMD ["curl", "--version"]',
      hints: ['Which Linux is alpine? Which package manager does it use?', '`RUN apk add --no-cache curl`'],
      explanation: 'Alpine uses apk. (Or switch the base to a Debian image and keep apt-get.)',
      docker: { target: 'dockerfile', after: ['docker run --rm app'] },
    },
    {
      id: 'd06-p5',
      kind: 'readQuery',
      conceptIds: ['d06-run', 'd06-cmd'],
      prompt: 'A Dockerfile contains `RUN date > /built-at.txt` and `CMD ["date"]`. You build once, then start three containers on different days. Which is true?',
      choices: ['All three /built-at.txt files hold the same time; each container prints a different date', 'Each container gets a new /built-at.txt', 'RUN and CMD both run on every start', 'Neither runs until you call docker exec'],
      answer: 0,
      hints: [],
      explanation: 'RUN ran once, during the build, and its result is part of the image. CMD runs at each start.',
    },
    {
      id: 'd06-p6',
      kind: 'write',
      conceptIds: ['d06-env'],
      prompt: 'Package `app.py` with **python:3.12-slim** in **/app**, and set the default **TEAM** to `green`. `docker run --rm app` should print `Report for green`.',
      solution: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY app.py .\nENV TEAM=green\nCMD ["python3", "app.py"]',
      wrongExample: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY app.py .\nCMD ["python3", "app.py"]',
      hints: ['The app reads the variable TEAM.', '`ENV TEAM=green`'],
      explanation: 'ENV sets a default that `docker run -e TEAM=…` can still override.',
      docker: { target: 'dockerfile', files: APP_PY, after: ['docker run --rm app', 'docker run --rm -e TEAM=red app'] },
    },
    {
      id: 'd06-p7',
      kind: 'fixBug',
      conceptIds: ['d06-cmd'],
      prompt: 'This image should print `hello` (the value of GREETING), but it prints `$GREETING`. Fix the CMD, keeping the variable.',
      starterSql: 'FROM alpine\nENV GREETING=hello\nCMD ["echo", "$GREETING"]',
      solution: 'FROM alpine\nENV GREETING=hello\nCMD ["sh", "-c", "echo $GREETING"]',
      wrongExample: 'FROM alpine\nENV GREETING=hello\nCMD ["echo", "${GREETING}"]',
      hints: ['Who expands `$VARIABLES`?', 'A shell does: `CMD ["sh", "-c", "echo $GREETING"]` (or the shell form `CMD echo $GREETING`).'],
      explanation: 'The exec form has no shell, so nothing expands `$GREETING`. Run it through `sh -c`.',
      docker: { target: 'dockerfile', after: ['docker run --rm app', 'docker run --rm -e GREETING=hi app'] },
    },
    {
      id: 'd06-p8',
      kind: 'write',
      conceptIds: ['d06-entrypoint'],
      prompt: 'Build an **alpine** image where `docker run --rm app` prints `Hello world` and `docker run --rm app Ada` prints `Hello Ada`.',
      solution: 'FROM alpine\nENTRYPOINT ["echo", "Hello"]\nCMD ["world"]',
      wrongExample: 'FROM alpine\nCMD ["echo", "Hello", "world"]',
      hints: ['The fixed part is `echo Hello`; the replaceable part is `world`.', 'ENTRYPOINT for the fixed part, CMD for the default argument.'],
      explanation: 'Run arguments replace CMD only; ENTRYPOINT stays.',
      docker: { target: 'dockerfile', after: ['docker run --rm app', 'docker run --rm app Ada'] },
    },
    {
      id: 'd06-p9',
      kind: 'parsons',
      conceptIds: ['d06-copy', 'd06-env'],
      prompt: 'Order the Dockerfile for `server.js`, a Node web server on port 3000.',
      blocks: ['FROM node:22-alpine', 'WORKDIR /app', 'COPY server.js .', 'EXPOSE 3000', 'CMD ["node", "server.js"]'],
      distractors: ['RUN node server.js', 'EXPOSE 3000:3000'],
      wrongOrder: ['WORKDIR /app', 'FROM node:22-alpine', 'COPY server.js .', 'EXPOSE 3000', 'CMD ["node", "server.js"]'],
      hints: [],
      explanation: 'FROM comes first. The server starts with CMD (at run time), not RUN (which would block the build).',
      docker: { target: 'dockerfile', files: SERVER_JS, after: ['docker run -d --name s -p 3000:3000 app', 'curl -s localhost:3000'], compare: ['output', 'config'] },
    },
    {
      id: 'd06-p10',
      kind: 'readQuery',
      conceptIds: ['d06-build'],
      prompt: 'What does the `.` in `docker build -t app .` mean?',
      choices: ['Tag the image as the current version', 'The build context: this folder\'s files are sent to the build (and ./Dockerfile is used)', 'Build every Dockerfile in all subfolders', 'Put the image in the current folder'],
      answer: 1,
      hints: [],
      explanation: 'COPY can only use files inside the build context.',
    },
    {
      id: 'd06-p11',
      kind: 'write',
      conceptIds: ['d06-cmd'],
      prompt: 'The image `greeter` (already built) prints a greeting by default. Run it once, removing the container afterwards, but make it run `echo bye` instead.',
      solution: 'docker run --rm greeter echo bye',
      wrongExample: 'docker run --rm greeter',
      hints: ['Whatever follows the image name replaces CMD.', '`docker run --rm greeter echo bye`'],
      explanation: 'Arguments after the image name replace the default command.',
      docker: { target: 'commands', files: { Dockerfile: 'FROM alpine\nCMD ["echo", "Hi there!"]\n' }, setup: ['docker build -t greeter .'], compare: ['containers', 'stdout'] },
    },
  ],
  test: [
    {
      id: 'd06-t1',
      kind: 'write',
      conceptIds: ['d06-copy', 'd06-build'],
      prompt: 'Package `app.py` with **python:3.12-slim**: work in `/app`, copy the script, and run it with `python3 app.py` by default.',
      solution: 'FROM python:3.12-slim\nWORKDIR /app\nCOPY app.py .\nCMD ["python3", "app.py"]',
      wrongExample: 'FROM python:3.12-slim\nWORKDIR /app\nCMD ["python3", "app.py"]',
      hints: [],
      explanation: 'FROM, WORKDIR, COPY, CMD.',
      docker: { target: 'dockerfile', files: APP_PY, after: ['docker run --rm app'], compare: ['output', 'config'] },
    },
    {
      id: 'd06-t2',
      kind: 'readQuery',
      conceptIds: ['d06-cmd'],
      prompt: 'Image `x` has `CMD ["ls", "/"]`. What does `docker run --rm x echo hi` run?',
      choices: ['ls /, then echo hi', 'echo hi (it replaces CMD)', 'ls / echo hi', 'Nothing: CMD can\'t be changed'],
      answer: 1,
      hints: [],
      explanation: 'Arguments after the image name replace CMD.',
    },
    {
      id: 'd06-t3',
      kind: 'write',
      conceptIds: ['d06-build'],
      prompt: 'Build the Dockerfile in this folder as **site:2**, then run it in the background as `site`, published on host port **8080** (nginx inside listens on 80).',
      solution: 'docker build -t site:2 .\ndocker run -d --name site -p 8080:80 site:2',
      wrongExample: 'docker build -t site .\ndocker run -d --name site -p 8080:80 site',
      hints: [],
      explanation: 'Build with the tag, then run that exact tag.',
      docker: { target: 'commands', files: { Dockerfile: 'FROM nginx:alpine\nCOPY index.html /usr/share/nginx/html/\n', 'index.html': '<h1>Site v2</h1>\n' }, after: ['curl -s localhost:8080'] },
    },
    {
      id: 'd06-t4',
      kind: 'fixBug',
      conceptIds: ['d06-copy'],
      prompt: 'The container crashes with `Cannot find module \'/app/hello.js\'`. Fix the Dockerfile.',
      starterSql: 'FROM node:22-alpine\nWORKDIR /app\nCOPY hello.js /\nCMD ["node", "hello.js"]',
      solution: 'FROM node:22-alpine\nWORKDIR /app\nCOPY hello.js .\nCMD ["node", "hello.js"]',
      wrongExample: 'FROM node:22-alpine\nWORKDIR /app\nCOPY hello.js /\nCMD ["node", "hello.js"]',
      hints: [],
      explanation: 'The file was copied to `/`, but node looks in the WORKDIR, `/app`.',
      docker: { target: 'dockerfile', files: HELLO_JS, after: ['docker run --rm app'] },
    },
    {
      id: 'd06-t5',
      kind: 'readQuery',
      conceptIds: ['d06-entrypoint'],
      prompt: 'An image has `ENTRYPOINT ["ping", "-c", "1"]` and `CMD ["localhost"]`. What does `docker run img 8.8.8.8` run?',
      choices: ['ping -c 1 localhost', 'ping -c 1 8.8.8.8', '8.8.8.8', 'ping -c 1 localhost 8.8.8.8'],
      answer: 1,
      hints: [],
      explanation: 'The run argument replaces CMD; ENTRYPOINT stays.',
    },
    {
      id: 'd06-t6',
      kind: 'write',
      conceptIds: ['d06-run', 'd06-env'],
      prompt: 'Write an **alpine**-based Dockerfile that installs **curl** (keep the image small: no apk cache), documents port **8080**, and runs `curl --version` by default.',
      solution: 'FROM alpine\nRUN apk add --no-cache curl\nEXPOSE 8080\nCMD ["curl", "--version"]',
      wrongExample: 'FROM alpine\nRUN apk add --no-cache curl\nCMD ["curl", "--version"]',
      hints: [],
      explanation: '`apk add --no-cache` installs without keeping the package index; EXPOSE documents the port.',
      docker: { target: 'dockerfile', after: ['docker run --rm app'], compare: ['output', 'config'] },
    },
  ],
};
