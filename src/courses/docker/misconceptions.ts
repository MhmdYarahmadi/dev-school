/** Common Docker mistakes, detected from the answer text and its outcome. */
import type { DockerSpec } from '../../content/types';
import type { DockerOutcome } from './check';

export interface DockerMisconception {
  id: string;
  title: string;
  explain: string;
}

interface Ctx {
  answer: string;
  spec: DockerSpec;
  outcome: DockerOutcome;
}

type Rule = DockerMisconception & { test: (c: Ctx) => boolean };

const has = (c: Ctx, re: RegExp) => re.test(c.answer);
const said = (c: Ctx, re: RegExp) => c.outcome.feedback.some((f) => re.test(f)) || c.outcome.transcript.some((t) => t.lines.some((l) => re.test(l.text)));

const RULES: Rule[] = [
  {
    id: 'port-order',
    title: '-p is HOST:CONTAINER',
    explain: 'The first number is the port on *your machine*, the second is the port the app listens on *inside* the container. nginx listens on 80, so `-p 8080:80` makes it reachable at localhost:8080.',
    test: (c) => said(c, /host port goes first/),
  },
  {
    id: 'alpine-exits',
    title: 'A container lives only as long as its main process',
    explain: '`alpine`, `ubuntu`, `node` and `python` start a shell or REPL by default. Without a terminal attached (`-it`) it has nothing to do and exits immediately. Give it a long-running command (e.g. `sleep 3600`) or use `-dit`.',
    test: (c) => said(c, /is Exited \(0\) but should be running/) && has(c, /\b(alpine|ubuntu|debian|busybox|node|python)\b/),
  },
  {
    id: 'missing-d',
    title: 'Forgot -d (detached)?',
    explain: 'Without `-d`, `docker run` keeps the container in the foreground: your terminal shows its output and is busy until you press Ctrl+C, which usually stops the container too. Add `-d` (detached) to run it in the background and get your prompt back.',
    test: (c) => said(c, /started in the foreground/),
  },
  {
    id: 'options-after-image',
    title: 'Options go before the image name',
    explain: 'Everything after the image name is the **command for the container**, not an option for Docker. `docker run -d --name web nginx` is right; `docker run nginx -d --name web` hands `-d --name web` to the container.',
    test: (c) => /docker (container )?run\b[^\n]*\s(nginx|redis|alpine|busybox|httpd|postgres|mysql|node|python|ubuntu|debian|traefik\/whoami|hello-world)(:\S+)?\s+--?[a-z]/.test(c.answer),
  },
  {
    id: 'name-taken',
    title: 'Container names are unique',
    explain: 'A stopped container still owns its name. Remove it first (`docker rm NAME`), or pick another name.',
    test: (c) => said(c, /is already in use by container/),
  },
  {
    id: 'rm-running',
    title: 'Stop before removing (or use -f)',
    explain: '`docker rm` refuses to remove a running container. Run `docker stop NAME` first, or `docker rm -f NAME` to stop and remove in one go.',
    test: (c) => said(c, /container is running: stop the container before removing/),
  },
  {
    id: 'image-in-use',
    title: 'An image used by a container can\'t be deleted',
    explain: 'Even a *stopped* container keeps a reference to its image. Remove the container(s) first, then `docker rmi` the image.',
    test: (c) => said(c, /unable to delete .* \(must be forced\)/),
  },
  {
    id: 'localhost-between',
    title: 'localhost means "this container"',
    explain: 'Inside a container, `localhost` is the container itself, not your machine and not other containers. To reach another container, use its **name** on a shared user-defined network (e.g. `http://db:5432`).',
    test: (c) => has(c, /\blocalhost\b/) && (c.spec.target === 'compose' || /exec/.test(c.answer)) && said(c, /should give/),
  },
  {
    id: 'default-bridge-dns',
    title: 'No DNS on the default bridge network',
    explain: 'Containers on the default `bridge` network can\'t find each other by name. Create a network (`docker network create app`) and run both containers with `--network app`.',
    test: (c) => said(c, /bad address|Could not resolve host/) && !has(c, /--network|network connect/),
  },
  {
    id: 'bind-vs-volume',
    title: 'Volume or bind mount?',
    explain: '`-v name:/path` uses a **named volume** managed by Docker. `-v ./dir:/path` (starting with `.` or `/`) mounts a **folder from your machine** (a bind mount). Pick the one the task asks for.',
    test: (c) => said(c, /mounts .* but should mount/),
  },
  {
    id: 'data-in-container',
    title: 'Data written inside a container dies with it',
    explain: 'Anything a container writes outside a volume lives in its writable layer, which `docker rm` deletes. Mount a volume at the data directory to keep it.',
    test: (c) => said(c, /The volume .* is missing|There's no volume called/),
  },
  {
    id: 'kill-loses-redis',
    title: 'Killing Redis loses its latest changes',
    explain: 'Redis keeps changes in memory and saves them to `/data` on a clean shutdown. `docker rm -f` and `docker kill` skip that. Run `docker stop` first, then `docker rm`.',
    test: (c) => /docker (rm\s+(-\w*f|--force)|kill)\b/.test(c.answer) && /redis-cli/.test([...(c.spec.setup ?? []), ...(c.spec.after ?? [])].join(' ')) && said(c, /should give/),
  },
  {
    id: 'pg-password',
    title: 'postgres needs POSTGRES_PASSWORD',
    explain: 'The official postgres image refuses to start without a superuser password: it exits with code 1. Add `-e POSTGRES_PASSWORD=…`.',
    test: (c) => said(c, /superuser password is not specified|POSTGRES_PASSWORD/),
  },
  {
    id: 'copy-order',
    title: 'Order layers from least to most frequently changing',
    explain: 'Copy the dependency manifest (`package*.json`) and install **before** `COPY . .`. Otherwise every code change re-runs the slow install, because the cache stops at the first changed layer.',
    test: (c) => c.spec.target === 'dockerfile' && /^\s*COPY\s+\.\s+\S+/im.test(c.answer.split(/RUN\s+(npm\s+(ci|install)|pip3?\s+install)/i)[0] ?? '') && /npm\s+(ci|install)|pip3?\s+install/i.test(c.answer),
  },
  {
    id: 'layers-only-add',
    title: 'A later RUN can\'t shrink an earlier layer',
    explain: 'Each RUN saves a new layer on top of the old ones. `RUN rm …` in a separate step hides the files, but they still sit in the layer that created them. Clean up **in the same RUN** (`… && rm -rf /var/lib/apt/lists/*`), or leave the tools behind in a multi-stage build.',
    test: (c) => c.spec.target === 'dockerfile' && /^\s*RUN\s+(rm|apt-get\s+(clean|purge|remove)|apk\s+del)\b/im.test(c.answer) && said(c, /should be under/),
  },
  {
    id: 'user-before-root',
    title: 'Install as root, then switch USER',
    explain: 'After `USER app`, every following RUN runs as `app`, which may not install packages or create users ("Permission denied", "are you root?"). Do the installing and `adduser` first, and put `USER` near the end, just before CMD.',
    test: (c) => c.spec.target === 'dockerfile' && said(c, /Permission denied|are you root/),
  },
  {
    id: 'user-missing',
    title: 'USER needs an existing user',
    explain: '`USER app` only switches to a user the image already has. Create it first: `RUN adduser -D app` on Alpine, `RUN useradd -r app` on Debian/Ubuntu. (Node images already have `node`.)',
    test: (c) => said(c, /unable to find user/),
  },
  {
    id: 'apt-family',
    title: 'apt vs apk',
    explain: 'Debian/Ubuntu images use `apt-get`; Alpine images use `apk add`. Running the wrong one fails with "not found".',
    test: (c) => said(c, /(apt-get|apk): not found/),
  },
  {
    id: 'missing-copy',
    title: 'Did you copy your code into the image?',
    explain: '"Cannot find module" / "can\'t open file" means the file your CMD runs isn\'t in the image. Check your `COPY` lines and `WORKDIR`.',
    test: (c) => said(c, /Cannot find module|can't open file/),
  },
  {
    id: 'cmd-vs-entrypoint',
    title: 'CMD vs ENTRYPOINT',
    explain: '`CMD` is the default command, replaced by anything you put after the image name in `docker run`. `ENTRYPOINT` is the fixed program; `CMD` then supplies its default arguments.',
    test: (c) => c.spec.target === 'dockerfile' && has(c, /ENTRYPOINT/) && said(c, /should give/),
  },
  {
    id: 'run-vs-cmd',
    title: 'RUN happens at build time, CMD at run time',
    explain: '`RUN` executes **once, while building** and saves the result in the image. To make something happen **each time a container starts**, use `CMD` (or `ENTRYPOINT`).',
    test: (c) => c.spec.target === 'dockerfile' && /^\s*RUN\s+(echo|node|python3?|npm\s+start)\b/im.test(c.answer) && !/^\s*(CMD|ENTRYPOINT)\b/im.test(c.answer),
  },
  {
    id: 'exec-form-vars',
    title: 'No $VARIABLES in the exec form',
    explain: '`CMD ["echo", "$NAME"]` runs echo directly, with no shell to expand `$NAME`. Use `CMD ["sh", "-c", "echo $NAME"]` or the shell form, or let the program read the variable itself.',
    test: (c) => c.spec.target === 'dockerfile' && /^\s*(CMD|ENTRYPOINT)\s*\[[^\]]*\$/im.test(c.answer) && !/"(sh|bash|\/bin\/sh)"\s*,\s*"-c"/.test(c.answer),
  },
  {
    id: 'oom-137',
    title: 'Exit 137 with a memory limit: out of memory',
    explain: 'A process that needs more memory than `--memory` allows is killed by the kernel with SIGKILL: exit code 137, usually with nothing in the logs. `docker inspect -f "{{.State.OOMKilled}}"` confirms it. A restart policy doesn\'t help (it gets killed again); give it more memory or make it use less.',
    test: (c) => has(c, /--memory|\s-m\s|mem_limit/) && said(c, /\(137\)|\b137\b/),
  },
  {
    id: 'restart-not-a-fix',
    title: 'Restarting doesn\'t fix configuration',
    explain: 'A container that exits because of its configuration (a missing variable, a wrong command, too little memory) fails the same way every time it restarts. Read `docker logs`, fix the cause, and recreate the container (`docker rm -f` + `docker run`, or `docker compose up -d`).',
    test: (c) => has(c, /docker (re)?start|docker restart|--restart/) && said(c, /Restarting|is Exited \(1\)/),
  },
  {
    id: 'compose-healthy',
    title: 'service_healthy needs a healthcheck',
    explain: '`condition: service_healthy` makes Compose wait until the dependency reports **healthy**, which only happens if that service has a `healthcheck:` (or its image defines one). Plain `depends_on: [db]` only orders the start; it doesn\'t wait for readiness.',
    test: (c) => c.spec.target === 'compose' && (said(c, /has no healthcheck configured|is unhealthy/) || (has(c, /depends_on/) && said(c, /\(healthy\)/))),
  },
  {
    id: 'compose-bind-dot',
    title: 'A bind mount in Compose starts with ./ or /',
    explain: 'In `volumes:`, `site:/path` means a **named volume** called site (a new, empty one). To mount your folder, write a path: `./site:/path`.',
    test: (c) => c.spec.target === 'compose' && said(c, /mounts `volume:[^`]*` but should mount `bind:/),
  },
  {
    id: 'compose-indent',
    title: 'YAML indentation matters',
    explain: 'In compose.yaml, nesting is shown by indentation (spaces, never tabs). Each service\'s settings must be indented one level under the service name.',
    test: (c) => c.spec.target === 'compose' && said(c, /failed to parse|additional properties/),
  },
];

export function detectDockerMisconceptions(ctx: Ctx): DockerMisconception[] {
  if (ctx.outcome.status === 'correct') return [];
  return RULES.filter((r) => {
    try {
      return r.test(ctx);
    } catch {
      return false;
    }
  }).map(({ id, title, explain }) => ({ id, title, explain }));
}
