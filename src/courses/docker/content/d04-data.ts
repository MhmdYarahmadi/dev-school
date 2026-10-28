import type { Module } from '../../../content/types';

const SITE = { 'site/index.html': '<h1>My site</h1>\n' };

export const d04: Module = {
  id: 'd04',
  number: 4,
  title: 'Data',
  tagline: 'Containers are disposable; your data must not be. Volumes and bind mounts keep it outside.',
  games: ['datarescue'],
  concepts: [
    {
      id: 'd04-layer',
      title: 'Containers forget',
      card: `Every container gets a thin **writable layer** on top of its image. Files it creates or changes go there, and **\`docker rm\` deletes that layer**.

\`\`\`
docker run --name a alpine sh -c "echo hi > /note.txt"
docker rm a
docker run --rm alpine cat /note.txt     # No such file or directory
\`\`\`

The second container starts from the **image**, which never changed. That's a feature: containers are cheap to replace, because the image is the same every time.

The problem: a database or an upload folder must **survive** the container. For that, data has to live **outside** the container.`,
      predict: {
        sql: 'docker run --name a alpine sh -c "echo hi > /note.txt"\ndocker rm a\ndocker run --rm alpine cat /note.txt',
        question: 'The first container wrote /note.txt. What does the new container print?',
        choices: ['hi', 'An error: No such file or directory', 'An empty line'],
        answer: 1,
        why: 'The file lived in container `a`\'s writable layer, which `docker rm` deleted. The new container starts fresh from the alpine image.',
        expectError: true,
      },
      example: { sql: 'docker run --name a alpine sh -c "echo hi > /note.txt && cat /note.txt"\ndocker start -a a\ndocker rm a', note: 'While `a` exists, its file exists, even across restarts. `rm` is what deletes it.' },
      cheat: { syntax: 'docker rm NAME  →  its files are gone', note: 'Writes outside a volume live and die with the container.' },
    },
    {
      id: 'd04-volume',
      title: 'Named volumes: -v NAME:/path',
      card: `A **volume** is storage that Docker manages **outside** any container. Mount it at a path, and everything written there goes into the volume:

\`\`\`
docker volume create notes
docker run --rm -v notes:/data alpine sh -c "echo hello > /data/hello.txt"
docker run --rm -v notes:/data alpine cat /data/hello.txt     # hello
\`\`\`

- \`-v NAME:/path/in/container\`: the volume \`NAME\` appears at that path.
- If the volume doesn't exist yet, \`docker run\` **creates it** for you. (\`docker volume create\` is optional.)
- \`docker volume ls\` lists volumes; \`docker volume inspect NAME\` shows where Docker keeps it.
- The long form does the same: \`--mount type=volume,source=notes,target=/data\`.`,
      predict: {
        sql: 'docker run --rm -v notes:/data alpine sh -c "echo hello > /data/hello.txt"\ndocker run --rm -v notes:/data alpine cat /data/hello.txt',
        question: 'Two different containers, both removed right away. What does the second one print?',
        choices: ['hello', 'An error: No such file or directory', 'An error: volume notes does not exist'],
        answer: 0,
        why: 'The file was written into the volume `notes`, not into the container. The second container mounts the same volume and finds it.',
      },
      example: { sql: 'docker volume create notes\ndocker run --rm -v notes:/data alpine sh -c "echo hello > /data/hello.txt"\ndocker run --rm -v notes:/data alpine cat /data/hello.txt\ndocker volume ls', note: 'The containers are gone; the volume and its file remain.' },
      cheat: { syntax: 'docker run -v NAME:/path IMAGE\ndocker volume create|ls|inspect NAME', note: 'Named volume: Docker-managed storage that outlives containers.' },
    },
    {
      id: 'd04-db',
      title: 'Databases need a volume',
      card: `A database keeps its files in a **data directory**. Mount a volume **there**, and you can delete, upgrade or replace the container without losing anything:

| Image | Data directory |
|---|---|
| \`postgres:16\` | \`/var/lib/postgresql/data\` |
| \`redis\` | \`/data\` |
| \`mysql\` | \`/var/lib/mysql\` |

\`\`\`
docker run -d --name cache -v cachedata:/data redis
docker exec cache redis-cli set visits 41
docker stop cache                                   # Redis saves to /data as it shuts down
docker rm cache                                     # container gone…
docker run -d --name cache -v cachedata:/data redis
docker exec cache redis-cli get visits              # …data still there: 41
\`\`\`

- The path must be **exactly** the data directory the image uses. Mount the volume anywhere else, and the database writes beside it, into the container.
- **Stop, don't kill.** Redis keeps recent changes in memory and writes them to disk on a clean shutdown (\`docker stop\`). \`docker rm -f\` or \`docker kill\` skip that, and the latest changes are lost. (PostgreSQL and MySQL write every committed change to disk straight away, but stopping cleanly is still the safe habit.)`,
      predict: {
        sql: 'docker run -d --name cache -v cachedata:/data redis\ndocker exec cache redis-cli set visits 41\ndocker stop cache\ndocker rm cache\ndocker run -d --name cache -v cachedata:/data redis\ndocker exec cache redis-cli get visits',
        question: 'The first cache container was stopped and removed. What does the new one answer?',
        choices: ['41', 'An empty answer: the key is gone', 'An error: the name cache is taken'],
        answer: 0,
        why: 'On `docker stop`, Redis saved its data to /data, which is the volume `cachedata`. The new container mounts the same volume and loads it. The name was freed by `rm`.',
      },
      example: { sql: 'docker run -d --name cache -v cachedata:/data redis\ndocker exec cache redis-cli set visits 41\ndocker stop cache\ndocker logs cache\ndocker rm cache\ndocker run -d --name cache -v cachedata:/data redis:alpine\ndocker exec cache redis-cli get visits', note: 'The logs show Redis saving on shutdown. Even a different version of the image (redis:alpine) picks up the data: this is how you upgrade.' },
      cheat: { syntax: '-v pgdata:/var/lib/postgresql/data\n-v cachedata:/data', note: 'Mount the volume at the database\'s data directory. Stop (don\'t kill) before removing.' },
    },
    {
      id: 'd04-bind',
      title: 'Bind mounts: a folder from your machine',
      card: `A **bind mount** puts a folder **from your machine** inside the container. Both sides see the same files, live:

\`\`\`
docker run -d --name web -p 8080:80 -v ./site:/usr/share/nginx/html nginx
echo "<h1>v2</h1>" > site/index.html
curl localhost:8080                  # <h1>v2</h1>, no restart needed
\`\`\`

How Docker tells them apart: a source starting with \`/\`, \`./\` or \`~\` is a **path** (bind mount). A plain name is a **volume**.

| | Named volume \`-v data:/x\` | Bind mount \`-v ./data:/x\` |
|---|---|---|
| Lives in | Docker's storage | Your folder |
| Best for | Databases, app data | Code and config you edit |
| Starts with | The image's files at that path | Your folder's files |

The long form: \`--mount type=bind,source=./site,target=/usr/share/nginx/html\`. \`$(pwd)/site\` and \`"$PWD/site"\` also work.`,
      env: { files: SITE },
      predict: {
        sql: 'docker run -d --name web -p 8080:80 -v ./site:/usr/share/nginx/html nginx\necho "<h1>v2</h1>" > site/index.html\ncurl -s localhost:8080',
        question: 'nginx is already running when you change site/index.html on your machine. What does curl get?',
        choices: ['<h1>My site</h1>: the container has a copy from when it started', '<h1>v2</h1>: it\'s the same folder', 'The "Welcome to nginx!" page'],
        answer: 1,
        why: 'A bind mount isn\'t a copy. The container looks straight into your folder, so changes show up immediately.',
      },
      example: { sql: 'cat site/index.html\ndocker run -d --name web -p 8080:80 -v ./site:/usr/share/nginx/html nginx\ncurl -s localhost:8080\ndocker inspect -f "{{range .Mounts}}{{.Type}} {{.Source}}{{end}}" web', note: 'The page comes from your site folder; inspect shows the absolute path.' },
      cheat: { syntax: '-v ./dir:/path   (or $(pwd)/dir)', note: 'Starts with / . or ~ → bind mount of your folder. Plain name → volume.' },
    },
    {
      id: 'd04-ro',
      title: 'Read-only mounts: :ro',
      card: `Add \`:ro\` to make a mount **read-only** inside the container. The container can read the files but not change or delete them:

\`\`\`
docker run -d --name web -p 8080:80 -v ./site:/usr/share/nginx/html:ro nginx
docker exec web sh -c "echo hacked > /usr/share/nginx/html/index.html"
# cannot create …: Read-only file system
\`\`\`

Use it whenever the container only needs to **read**: website files, config files, certificates. If the app is ever compromised, it can't overwrite them. You can still edit the files from your machine.

Long form: \`--mount type=bind,source=./site,target=/usr/share/nginx/html,readonly\`.`,
      env: { files: SITE },
      predict: {
        sql: 'docker run -d --name web -p 8080:80 -v ./site:/usr/share/nginx/html:ro nginx\ndocker exec web sh -c "echo hacked > /usr/share/nginx/html/index.html"',
        question: 'What happens to the write from inside the container?',
        choices: ['It works: the container runs as root', 'It fails: Read-only file system', 'It works, but only inside the container'],
        answer: 1,
        why: '`:ro` is enforced by the mount itself, so even root inside the container can\'t write there.',
        expectError: true,
      },
      example: { sql: 'docker run -d --name web -p 8080:80 -v ./site:/usr/share/nginx/html:ro nginx\ndocker exec web cat /usr/share/nginx/html/index.html\necho "<h1>edited on the host</h1>" > site/index.html\ncurl -s localhost:8080', note: 'Read-only for the container; you can still edit from your machine.' },
      cheat: { syntax: '-v ./site:/path:ro', note: 'The container can read but not write.' },
    },
    {
      id: 'd04-cleanup',
      title: 'Cleaning up volumes',
      card: `Volumes are **never** deleted by accident. That's the point, but they pile up.

- \`docker volume rm NAME\`: delete a volume. It refuses while **any container** (even a stopped one) uses it: *volume is in use*. Remove the container first.
- **Anonymous volumes**: some images (postgres, redis, mysql) declare a \`VOLUME\`. If you don't mount anything there, Docker creates a volume with a long random name. Spot them in \`docker volume ls\`.
- \`docker rm -v NAME\` removes a container **and** its anonymous volumes. \`docker run --rm\` does the same when it exits. Named volumes are always kept.
- \`docker volume prune -f\` deletes unused anonymous volumes; add \`-a\` to delete **all** unused volumes, named ones too.

Deleting a volume deletes its data for good. Check \`docker volume ls\` before pruning.`,
      predict: {
        sql: 'docker run -d --name db -e POSTGRES_PASSWORD=secret -v pgdata:/var/lib/postgresql/data postgres:16\ndocker stop db\ndocker volume rm pgdata',
        question: 'db is stopped. Can you delete its volume?',
        choices: ['Yes: the container is stopped', 'No: volume is in use, because the stopped container still references it', 'Yes, but the container is deleted too'],
        answer: 1,
        why: 'A stopped container still owns its mounts. `docker rm db` first, then `docker volume rm pgdata`.',
        expectError: true,
      },
      example: { sql: 'docker run -d --name db -e POSTGRES_PASSWORD=secret postgres:16\ndocker volume ls\ndocker rm -f -v db\ndocker volume ls', note: 'postgres declares a VOLUME, so Docker made an anonymous one; `rm -v` removed it with the container.' },
      cheat: { syntax: 'docker volume rm NAME\ndocker rm -v NAME\ndocker volume prune -f [-a]', note: 'In use → remove the container first. -v also removes anonymous volumes.' },
    },
  ],
  practice: [
    {
      id: 'd04-p1',
      kind: 'readQuery',
      conceptIds: ['d04-layer'],
      prompt: 'A container wrote a log file to `/var/log/app.log` (no volumes). Which command deletes that file?',
      choices: ['docker stop', 'docker restart', 'docker rm', 'docker start'],
      answer: 2,
      hints: [],
      explanation: 'Stopping and restarting keep the writable layer. Only `docker rm` throws it away.',
    },
    {
      id: 'd04-p2',
      kind: 'write',
      conceptIds: ['d04-volume'],
      prompt: 'Using a throwaway **alpine** container (`--rm`), write the word `hello` into `/data/hello.txt` so that the file is kept in a volume named **notes**.',
      solution: 'docker run --rm -v notes:/data alpine sh -c "echo hello > /data/hello.txt"',
      wrongExample: 'docker run --rm alpine sh -c "mkdir /data && echo hello > /data/hello.txt"',
      hints: ['Mount the volume at /data with `-v`.', '`-v notes:/data`, then `sh -c "echo hello > /data/hello.txt"`.'],
      explanation: 'With `-v notes:/data`, writes to /data go into the volume, which outlives the container.',
      docker: { target: 'commands', after: ['docker run --rm -v notes:/data alpine cat /data/hello.txt'] },
    },
    {
      id: 'd04-p3',
      kind: 'fillBlank',
      conceptIds: ['d04-db'],
      prompt: 'Run **postgres:16** as `db`, keeping its data in a volume named **pgdata**.',
      starterSql: 'docker run -d --name db -e POSTGRES_PASSWORD=secret -v ___:___ postgres:16',
      solution: 'docker run -d --name db -e POSTGRES_PASSWORD=secret -v pgdata:/var/lib/postgresql/data postgres:16',
      wrongExample: 'docker run -d --name db -e POSTGRES_PASSWORD=secret -v pgdata:/data postgres:16',
      hints: ['Volume name first, then the path in the container.', 'postgres keeps its data in `/var/lib/postgresql/data`.'],
      explanation: 'The volume must be mounted at the exact directory the database writes to.',
      docker: { target: 'commands' },
    },
    {
      id: 'd04-p4',
      kind: 'write',
      conceptIds: ['d04-db', 'd04-volume'],
      prompt: '`cache` runs **redis** with its data in the volume `cachedata`, and holds the key `user:1`. Replace it with a new container, also named `cache`, running **redis:alpine**, **without losing the data**.',
      solution: 'docker stop cache\ndocker rm cache\ndocker run -d --name cache -v cachedata:/data redis:alpine',
      wrongExample: 'docker rm -f cache\ndocker run -d --name cache -v cachedata:/data redis:alpine',
      hints: ['Stop it cleanly first, so Redis saves its data; then remove it to free the name.', 'Mount the same volume at /data in the new one.'],
      explanation: 'Stop (Redis saves to the volume), remove, and start the new version on the same volume. With `rm -f`, Redis is killed before it can save.',
      docker: { target: 'commands', setup: ['docker run -d --name cache -v cachedata:/data redis', 'docker exec cache redis-cli set user:1 Ada'], after: ['docker exec cache redis-cli get user:1'], compare: ['containers', 'volumes', 'output'] },
    },
    {
      id: 'd04-p5',
      kind: 'write',
      conceptIds: ['d04-bind'],
      prompt: 'Your website is in the folder **./site**. Serve it with **nginx** as `web` on host port **8080**, using a bind mount at `/usr/share/nginx/html`.',
      solution: 'docker run -d --name web -p 8080:80 -v ./site:/usr/share/nginx/html nginx',
      wrongExample: 'docker run -d --name web -p 8080:80 -v site:/usr/share/nginx/html nginx',
      hints: ['A bind mount source is a path: it starts with `./`, `/` or `~`.', '`-v ./site:/usr/share/nginx/html`'],
      explanation: '`./site` is a path, so it\'s a bind mount. Plain `site` would create a new, empty volume named site.',
      docker: { target: 'commands', files: SITE, after: ['curl -s localhost:8080'] },
    },
    {
      id: 'd04-p6',
      kind: 'write',
      conceptIds: ['d04-ro'],
      prompt: 'Serve **./site** with **nginx** as `web` on port **8080** again, but this time the container must **not** be able to change the files.',
      solution: 'docker run -d --name web -p 8080:80 -v ./site:/usr/share/nginx/html:ro nginx',
      wrongExample: 'docker run -d --name web -p 8080:80 -v ./site:/usr/share/nginx/html nginx',
      hints: ['There\'s a suffix for read-only.', 'End the -v value with `:ro`.'],
      explanation: '`:ro` makes the mount read-only inside the container.',
      docker: { target: 'commands', files: SITE, after: ['curl -s localhost:8080'] },
    },
    {
      id: 'd04-p7',
      kind: 'parsons',
      conceptIds: ['d04-volume'],
      prompt: 'Create the volume `shared`, write `42` into `/v/answer.txt` from one alpine container, then read it from **another** one. Both containers should be removed when they exit.',
      blocks: ['docker volume create shared', 'docker run --rm -v shared:/v alpine sh -c "echo 42 > /v/answer.txt"', 'docker run --rm -v shared:/v alpine cat /v/answer.txt'],
      distractors: ['docker run --rm alpine cat /v/answer.txt', 'docker run --rm -v ./shared:/v alpine cat /v/answer.txt'],
      wrongOrder: ['docker volume create shared', 'docker run --rm -v shared:/v alpine cat /v/answer.txt', 'docker run --rm -v shared:/v alpine sh -c "echo 42 > /v/answer.txt"'],
      hints: [],
      explanation: 'Both containers mount the same volume, so the second sees what the first wrote.',
      docker: { target: 'commands', compare: ['volumes', 'stdout'] },
    },
    {
      id: 'd04-p8',
      kind: 'readQuery',
      conceptIds: ['d04-bind'],
      prompt: 'Which of these creates a **bind mount**?',
      choices: ['-v appdata:/app/data', '-v ./appdata:/app/data', '-v /app/data', '--mount type=volume,source=appdata,target=/app/data'],
      answer: 1,
      hints: [],
      explanation: '`./appdata` is a path on your machine. `appdata` is a named volume, and `-v /app/data` alone makes an anonymous volume.',
    },
    {
      id: 'd04-p9',
      kind: 'write',
      conceptIds: ['d04-cleanup'],
      prompt: 'The stopped container `tmp` uses the volume `scratch`. Delete **both**.',
      solution: 'docker rm tmp\ndocker volume rm scratch',
      wrongExample: 'docker volume rm scratch',
      hints: ['Try `docker volume rm scratch` alone and read the error.', 'Remove the container first.'],
      explanation: 'A volume can\'t be removed while any container, even a stopped one, uses it.',
      docker: { target: 'commands', setup: ['docker run --name tmp -v scratch:/s alpine touch /s/x'] },
    },
    {
      id: 'd04-p10',
      kind: 'write',
      conceptIds: ['d04-cleanup'],
      prompt: '`db` (postgres, stopped) was started without a volume, so Docker gave it an **anonymous** volume. Remove `db` **and** that volume with one command.',
      solution: 'docker rm -v db',
      wrongExample: 'docker rm db',
      hints: ['`docker rm` has an option for this.', '`-v` (`--volumes`).'],
      explanation: '`docker rm -v` also removes the anonymous volumes the container created. Named volumes are never removed this way.',
      docker: { target: 'commands', setup: ['docker run -d --name db -e POSTGRES_PASSWORD=secret postgres:16', 'docker stop db'], after: ['docker volume ls -q'] },
    },
    {
      id: 'd04-p11',
      kind: 'fixBug',
      conceptIds: ['d04-layer', 'd04-volume'],
      prompt: 'This counter app should keep its count in the volume `counter` across container restarts **and** removals, but every new container starts again from 1. Fix the command.',
      starterSql: 'docker run --rm alpine sh -c "mkdir -p /count && echo 1 >> /count/log && wc -l < /count/log"',
      solution: 'docker run --rm -v counter:/count alpine sh -c "mkdir -p /count && echo 1 >> /count/log && wc -l < /count/log"',
      wrongExample: 'docker run --rm -v counter:/data alpine sh -c "mkdir -p /count && echo 1 >> /count/log && wc -l < /count/log"',
      hints: ['Where does the app write?', 'Mount the volume at /count.'],
      explanation: 'The volume must be mounted where the app writes: /count.',
      docker: { target: 'commands', after: ['docker run --rm -v counter:/count alpine cat /count/log'] },
    },
  ],
  test: [
    {
      id: 'd04-t1',
      kind: 'write',
      conceptIds: ['d04-db'],
      prompt: 'Run **redis** in the background as `store`, keeping its data in a volume named **storedata**.',
      solution: 'docker run -d --name store -v storedata:/data redis',
      wrongExample: 'docker run -d --name store -v storedata:/var/lib/redis redis',
      hints: [],
      explanation: 'redis writes to `/data`.',
      docker: { target: 'commands' },
    },
    {
      id: 'd04-t2',
      kind: 'readQuery',
      conceptIds: ['d04-layer', 'd04-volume'],
      prompt: '`docker run -d --name app -v appdata:/data myapp`. The app writes to `/data/users.db` and `/tmp/cache`. After `docker rm -f app`, what is left?',
      choices: ['Both files', '/data/users.db only (in the volume appdata)', '/tmp/cache only', 'Nothing'],
      answer: 1,
      hints: [],
      explanation: '/data is the volume, which survives. /tmp was in the container\'s writable layer.',
    },
    {
      id: 'd04-t3',
      kind: 'write',
      conceptIds: ['d04-bind', 'd04-ro'],
      prompt: '**httpd** serves files from `/usr/local/apache2/htdocs`. Run it as `docs` on host port **8081**, serving the folder **./public** read-only.',
      solution: 'docker run -d --name docs -p 8081:80 -v ./public:/usr/local/apache2/htdocs:ro httpd',
      wrongExample: 'docker run -d --name docs -p 8081:80 -v public:/usr/local/apache2/htdocs:ro httpd',
      hints: [],
      explanation: '`./public` (a path) makes it a bind mount; `:ro` makes it read-only.',
      docker: { target: 'commands', files: { 'public/index.html': '<h1>Docs</h1>\n' }, after: ['curl -s localhost:8081'] },
    },
    {
      id: 'd04-t4',
      kind: 'write',
      conceptIds: ['d04-volume'],
      prompt: 'The volume `appdata` holds `/report.txt`. Print it with a throwaway **alpine** container.',
      solution: 'docker run --rm -v appdata:/data alpine cat /data/report.txt',
      wrongExample: 'docker run --rm alpine cat /data/report.txt',
      hints: [],
      explanation: 'Mount the volume anywhere and read the file from there.',
      docker: { target: 'commands', setup: ['docker run --rm -v appdata:/x alpine sh -c "echo Q3 sales: 1200 > /x/report.txt"'], compare: ['containers', 'volumes', 'stdout'] },
    },
    {
      id: 'd04-t5',
      kind: 'fixBug',
      conceptIds: ['d04-cleanup'],
      prompt: 'You want to delete the postgres container `db` **and** its data in the volume `pgdata`, but this fails with "volume is in use". Fix it.',
      starterSql: 'docker volume rm pgdata',
      solution: 'docker rm -f db\ndocker volume rm pgdata',
      wrongExample: 'docker stop db\ndocker volume rm pgdata',
      hints: [],
      explanation: 'Remove the container first (stopping isn\'t enough), then the volume.',
      docker: { target: 'commands', setup: ['docker run -d --name db -e POSTGRES_PASSWORD=secret -v pgdata:/var/lib/postgresql/data postgres:16'] },
    },
    {
      id: 'd04-t6',
      kind: 'readQuery',
      conceptIds: ['d04-bind', 'd04-volume'],
      prompt: 'You\'re developing a website and want every edit to show up in the running container immediately. What should you mount?',
      choices: ['A named volume: -v site:/usr/share/nginx/html', 'A bind mount of your folder: -v ./site:/usr/share/nginx/html', 'Nothing: rebuild the image after each edit', 'An anonymous volume: -v /usr/share/nginx/html'],
      answer: 1,
      hints: [],
      explanation: 'A bind mount shows your folder live inside the container. A named volume is separate storage that your editor doesn\'t touch.',
    },
  ],
};
