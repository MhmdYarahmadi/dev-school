import type { Module } from '../../../content/types';

export const d01: Module = {
  id: 'd01',
  number: 1,
  title: 'Images & containers',
  tagline: 'What Docker is for, and the two words everything else builds on: image and container.',
  games: ['enginematch'],
  concepts: [
    {
      id: 'd01-what',
      title: 'Why Docker? Images and containers',
      card: `Software needs more than its own code: the right language version, libraries, settings… "It works on my machine" happens when those differ between machines.

Docker packages an app **together with everything it needs** into an **image**. An image is a read-only template, like an installer that never changes.

A **container** is a *running copy* of an image: a process that thinks it has its own computer (its own files, network and process list), isolated from the rest of the machine.

- One image → as many containers as you like.
- Images are shared on a **registry**. The default one is **Docker Hub**.

The simulator on this site behaves like the real \`docker\` command (Docker 29). Try your first container:

\`\`\`
docker run hello-world
\`\`\``,
      predict: {
        sql: 'docker run hello-world',
        question: 'Your machine has no images yet. What happens when you run this?',
        choices: ['An error: image "hello-world" not found', 'Docker downloads the image from Docker Hub, then runs it', 'Docker asks you to confirm the download first', 'Nothing: you must create the container first'],
        answer: 1,
        why: '`docker run` looks for the image locally ("Unable to find image … locally"), **pulls** it from Docker Hub automatically, creates a container from it and starts it. hello-world just prints a message and exits.',
      },
      example: { sql: 'docker run hello-world', note: 'Read the message: it describes exactly the four steps that just happened.' },
      cheat: { syntax: 'docker run IMAGE', note: 'Pull the image if needed, create a container, start it.' },
    },
    {
      id: 'd01-images',
      title: 'Pulling images and tags',
      card: `\`docker pull\` downloads an image without running it. \`docker images\` lists the images you have.

An image name has a **tag** after a colon, usually a version or a variant:

| You write | It means |
|---|---|
| \`nginx\` | \`nginx:latest\` (no tag = \`latest\`) |
| \`nginx:1.27\` | version 1.27 |
| \`nginx:alpine\` | built on Alpine Linux: much smaller |
| \`postgres:16-alpine\` | version 16, Alpine variant |

Each tag is a **separate image**. \`latest\` is just the default name; it doesn't guarantee the newest version and can change at any time. Real projects pin a specific tag.`,
      predict: {
        sql: 'docker pull nginx\ndocker pull nginx:alpine\ndocker images',
        question: 'How many images will `docker images` list?',
        choices: ['1: both are nginx', '2: different tags are different images', '3: alpine counts as its own image too'],
        answer: 1,
        why: '`nginx` (= `nginx:latest`) and `nginx:alpine` are two separate images. Compare their sizes: the Alpine variant is less than a third of the size.',
      },
      example: { sql: 'docker pull nginx\ndocker pull nginx:alpine\ndocker images', note: 'Two images. Look at the DISK USAGE column.' },
      cheat: { syntax: 'docker pull IMAGE:TAG\ndocker images', note: 'Download an image; list local images. No tag means :latest.' },
    },
    {
      id: 'd01-run',
      title: 'docker run IMAGE COMMAND',
      card: `\`docker run\` does three things: **create** a new container from the image, **start** it, and show you its output.

Every image has a *default command* (hello-world prints its message, \`alpine\` starts a shell). Anything you write **after the image name** replaces it:

\`\`\`
docker run alpine echo hello
\`\`\`

runs \`echo hello\` inside a fresh Alpine Linux container. When the command finishes, the container **stops**, but it isn't deleted.

⚠️ Every \`docker run\` creates a **new** container. Running the same line twice gives you two containers.`,
      predict: {
        sql: 'docker run alpine echo hello\ndocker run alpine echo hello\ndocker ps -a',
        question: 'How many containers does `docker ps -a` show?',
        choices: ['0: they finished', '1: the second run reused the first', '2'],
        answer: 2,
        why: 'Each `docker run` creates a brand-new container. Both finished (Exited (0)) but still exist, and `ps -a` shows stopped containers too.',
      },
      example: { sql: 'docker run alpine echo hello\ndocker run alpine cat /etc/os-release', note: 'Two commands, two containers, one image (pulled only once).' },
      cheat: { syntax: 'docker run IMAGE COMMAND ARGS…', note: 'Run a command in a new container. Options go before IMAGE.' },
    },
    {
      id: 'd01-ps',
      title: 'Listing containers: docker ps',
      card: `\`docker ps\` lists **running** containers. Add \`-a\` (\`--all\`) to include stopped ones.

The columns:
- **CONTAINER ID**: the start of its unique id (you can use it instead of the name)
- **IMAGE** and **COMMAND**: what it runs
- **STATUS**: \`Up 5 minutes\` (running), \`Exited (0) …\` (stopped; the number is the *exit code*, 0 = success), or \`Created\` (never started)
- **PORTS** and **NAMES**`,
      predict: {
        sql: 'docker run alpine echo hi\ndocker ps',
        question: 'What does `docker ps` show?',
        choices: ['The alpine container, status Up', 'Only the header line: no containers', 'The alpine container, status Exited (0)'],
        answer: 1,
        why: '`echo hi` finished in an instant, so the container stopped. `docker ps` shows only running containers. `docker ps -a` would show it as Exited (0).',
      },
      example: { sql: 'docker run alpine echo hi\ndocker ps\ndocker ps -a', note: 'Same container, seen with and without -a.' },
      cheat: { syntax: 'docker ps\ndocker ps -a', note: 'Running containers; all containers (including stopped).' },
    },
    {
      id: 'd01-detach',
      title: 'Servers: -d and --name',
      card: `Some programs never finish on their own: web servers, databases. For those, two options matter:

- \`-d\` (detached) runs the container **in the background** and prints its id, so you get your prompt back.
- \`--name web\` gives it a name. Without one, Docker invents a name like \`vibrant_lovelace\`.

\`\`\`
docker run -d --name web nginx
\`\`\`

**Options go before the image name.** Everything after the image is the command for the container.

Names are **unique**: a second container can't be called \`web\`, even if the first one is stopped.`,
      predict: {
        sql: 'docker run -d --name web nginx\ndocker run -d --name web nginx',
        question: 'What does the second line do?',
        choices: ['Starts a second nginx called web', 'Replaces the first container', 'Fails: the name "web" is already in use', 'Nothing: web is already running'],
        answer: 2,
        why: 'Container names are unique. Docker refuses with a "Conflict… already in use" error. Remove the old container (or pick another name) first.',
        expectError: true,
      },
      example: { sql: 'docker run -d --name web nginx\ndocker ps', note: 'A running server, in the background, with a name you chose.' },
      cheat: { syntax: 'docker run -d --name NAME IMAGE', note: 'Run in the background with a name.' },
    },
  ],
  practice: [
    {
      id: 'd01-p1',
      kind: 'write',
      conceptIds: ['d01-images'],
      prompt: 'Download the **redis** image, without running it.',
      solution: 'docker pull redis',
      wrongExample: 'docker run redis',
      hints: ['There is a command that only downloads.', '`docker pull IMAGE`'],
      explanation: '`docker pull` only downloads. `docker run redis` would also start a container.',
      docker: { target: 'commands' },
    },
    {
      id: 'd01-p2',
      kind: 'write',
      conceptIds: ['d01-images'],
      prompt: 'Download the **alpine** variant of nginx (its tag is `alpine`).',
      solution: 'docker pull nginx:alpine',
      wrongExample: 'docker pull nginx',
      hints: ['The tag goes after the image name.', 'Separate name and tag with a colon: `IMAGE:TAG`.'],
      explanation: '`nginx:alpine` is a separate image from `nginx` (`nginx:latest`).',
      docker: { target: 'commands' },
    },
    {
      id: 'd01-p3',
      kind: 'readQuery',
      conceptIds: ['d01-images'],
      prompt: 'Which part of this image name is the **tag**?',
      sql: 'postgres:16-alpine',
      choices: ['`postgres`', '`16`', '`16-alpine`', '`alpine`'],
      answer: 2,
      hints: [],
      explanation: 'Everything after the colon is the tag: `16-alpine` means "version 16, Alpine variant".',
    },
    {
      id: 'd01-p4',
      kind: 'write',
      conceptIds: ['d01-run'],
      prompt: 'Use the **alpine** image to print `hello docker`.',
      solution: 'docker run alpine echo hello docker',
      wrongExample: 'docker run alpine echo hello',
      hints: ['`docker run IMAGE COMMAND`', 'The command is `echo hello docker`.'],
      explanation: 'The words after the image name are the command the container runs.',
      docker: { target: 'commands', compare: ['stdout', 'images'] },
    },
    {
      id: 'd01-p5',
      kind: 'write',
      conceptIds: ['d01-ps'],
      prompt: 'A container ran a moment ago and finished. List **all** containers, including stopped ones.',
      solution: 'docker ps -a',
      wrongExample: 'docker ps',
      hints: ['`docker ps` alone shows only running containers.', 'Add the "all" option.'],
      explanation: '`-a` (or `--all`) includes stopped containers.',
      docker: { target: 'commands', setup: ['docker run --name finished alpine echo done'], compare: ['stdout'] },
    },
    {
      id: 'd01-p6',
      kind: 'fillBlank',
      conceptIds: ['d01-detach'],
      prompt: 'Start **nginx** in the background, with the name `web`.',
      starterSql: 'docker run ___ --name ___ nginx',
      solution: 'docker run -d --name web nginx',
      wrongExample: 'docker run -d --name webserver nginx',
      hints: ['Background = detached.', 'The first blank is `-d`.'],
      explanation: '`-d` runs it in the background; `--name web` names it.',
      docker: { target: 'commands' },
    },
    {
      id: 'd01-p7',
      kind: 'write',
      conceptIds: ['d01-detach'],
      prompt: 'Run a container from the **nginx** image in the background and call it `site`.',
      solution: 'docker run -d --name site nginx',
      wrongExample: 'docker run -d nginx',
      hints: ['You need two options: one for background, one for the name.', '`docker run -d --name … IMAGE`'],
      explanation: 'Without `--name`, Docker would pick a random name.',
      docker: { target: 'commands' },
    },
    {
      id: 'd01-p8',
      kind: 'fixBug',
      conceptIds: ['d01-detach', 'd01-run'],
      prompt: 'This was meant to start **redis** in the background as `cache`, but the container exits straight away. Check `docker logs` in the scratch terminal if you like. Fix the command.',
      starterSql: 'docker run redis -d --name cache',
      solution: 'docker run -d --name cache redis',
      wrongExample: 'docker run redis -d --name cache',
      hints: ['Where do Docker\'s options go?', 'Everything after the image name is passed to the container, not to Docker.'],
      explanation: 'Options must come **before** the image. Here, `-d --name cache` went to redis-server, which doesn\'t understand them and quits.',
      docker: { target: 'commands' },
    },
    {
      id: 'd01-p9',
      kind: 'parsons',
      conceptIds: ['d01-images', 'd01-run', 'd01-ps'],
      prompt: 'Download **alpine**, use it to print `hi`, then list **all** containers.',
      blocks: ['docker pull alpine', 'docker run alpine echo hi', 'docker ps -a'],
      distractors: ['docker ps', 'docker run hi alpine'],
      wrongOrder: ['docker ps -a', 'docker pull alpine', 'docker run alpine echo hi'],
      hints: [],
      explanation: 'Pull, run, then look. `docker ps` alone would miss the finished container.',
      docker: { target: 'commands', compare: ['stdout', 'containers', 'images'] },
    },
    {
      id: 'd01-p10',
      kind: 'readQuery',
      conceptIds: ['d01-ps', 'd01-run'],
      prompt: 'You ran `docker run alpine echo hi`, then `docker ps` shows no containers. Why?',
      choices: ['The run failed', 'The container finished its command and stopped; `docker ps` shows only running containers', 'Containers are deleted as soon as they finish', 'alpine containers are hidden'],
      answer: 1,
      hints: [],
      explanation: 'It exists but is stopped (Exited (0)). `docker ps -a` shows it.',
    },
    {
      id: 'd01-p11',
      kind: 'readQuery',
      conceptIds: ['d01-what'],
      prompt: 'Which sentence describes images and containers correctly?',
      choices: [
        'An image is a running program; a container stores it on disk',
        'An image is a read-only package of an app and everything it needs; a container is a running (or stopped) copy made from it',
        'Images and containers are two names for the same thing',
        'A container can only be made once from each image',
      ],
      answer: 1,
      hints: [],
      explanation: 'Image = template (read-only). Container = an instance created from it. One image can give you many containers.',
    },
  ],
  test: [
    {
      id: 'd01-t1',
      kind: 'write',
      conceptIds: ['d01-images'],
      prompt: 'Download **postgres**, version tag `16-alpine`.',
      solution: 'docker pull postgres:16-alpine',
      wrongExample: 'docker pull postgres',
      hints: [],
      explanation: 'IMAGE:TAG.',
      docker: { target: 'commands' },
    },
    {
      id: 'd01-t2',
      kind: 'write',
      conceptIds: ['d01-detach'],
      prompt: 'Start **redis** in the background with the name `cache`.',
      solution: 'docker run -d --name cache redis',
      wrongExample: 'docker run -d redis',
      hints: [],
      explanation: '`-d` for background, `--name` for the name, both before the image.',
      docker: { target: 'commands' },
    },
    {
      id: 'd01-t3',
      kind: 'readQuery',
      conceptIds: ['d01-what', 'd01-run'],
      prompt: 'On a fresh machine you run `docker run nginx` three times (in three terminals). How many **images** and **containers** do you have?',
      choices: ['1 image, 1 container', '3 images, 3 containers', '1 image, 3 containers', '3 images, 1 container'],
      answer: 2,
      hints: [],
      explanation: 'The image is downloaded once; each `docker run` creates a new container from it.',
    },
    {
      id: 'd01-t4',
      kind: 'write',
      conceptIds: ['d01-run'],
      prompt: 'Print the word `ready` using the **busybox** image.',
      solution: 'docker run busybox echo ready',
      wrongExample: 'docker run busybox echo steady',
      hints: [],
      explanation: 'The command after the image name replaces the default one.',
      docker: { target: 'commands', compare: ['stdout', 'images'] },
    },
    {
      id: 'd01-t5',
      kind: 'readQuery',
      conceptIds: ['d01-ps'],
      prompt: 'In `docker ps -a`, a container\'s STATUS is `Exited (0) 2 minutes ago`. What does that tell you?',
      choices: ['It crashed two minutes ago', 'It stopped two minutes ago, and its command succeeded', 'It will restart in two minutes', 'It has been running for two minutes'],
      answer: 1,
      hints: [],
      explanation: 'Exited = stopped; (0) is the exit code, and 0 means success.',
    },
    {
      id: 'd01-t6',
      kind: 'readQuery',
      conceptIds: ['d01-detach'],
      prompt: 'What does this error mean?',
      sql: 'docker: Error response from daemon: Conflict. The container name "/web" is already in use by container "3f2a…".',
      choices: ['The web server crashed', 'A container called web already exists (running or stopped)', 'Port 80 is already used', 'The image "web" doesn\'t exist'],
      answer: 1,
      hints: [],
      explanation: 'Names are unique, and a stopped container still owns its name. Remove it or choose another name.',
    },
  ],
};
