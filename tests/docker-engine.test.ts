/** Behaviour the course relies on, beyond what the golden replay recorded. */
import { describe, expect, it } from 'vitest';
import { DockerEngine, lintDockerfile } from '../src/courses/docker/engine';

const run = (e: DockerEngine, cmd: string) => {
  const r = e.exec(cmd);
  return { text: r.lines.map((l) => l.text).join('\n'), code: r.exitCode };
};

describe('containers', () => {
  it('alpine exits straight away without -it, stays up with -it', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name a alpine');
    run(e, 'docker run -dit --name b alpine');
    expect(e.findContainer('a')!.status).toBe('exited');
    expect(e.findContainer('b')!.status).toBe('running');
  });
  it('sleep N ends after N seconds of simulated time', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name s alpine sleep 5');
    expect(e.findContainer('s')!.status).toBe('running');
    run(e, 'sleep 6');
    expect(e.findContainer('s')!.status).toBe('exited');
    expect(e.findContainer('s')!.exitCode).toBe(0);
  });
  it('--rm removes the container when it exits', () => {
    const e = new DockerEngine();
    expect(run(e, 'docker run --rm --name t alpine echo hi').text).toContain('hi');
    expect(e.findContainer('t')).toBeUndefined();
  });
  it('a missing program fails at start and leaves the container Created', () => {
    const e = new DockerEngine();
    const r = run(e, 'docker run --name x alpine frobnicate');
    expect(r.code).toBe(127);
    expect(r.text).toContain('exec: "frobnicate": executable file not found in $PATH');
    expect(e.findContainer('x')!.status).toBe('created');
  });
  it('unless-stopped restarts a crashing container but not one stopped by hand', () => {
    const e = new DockerEngine();
    run(e, "docker run -d --name c --restart unless-stopped alpine sh -c 'exit 1'");
    expect(e.findContainer('c')!.status).toBe('restarting');
    run(e, 'docker stop c');
    expect(e.findContainer('c')!.status).toBe('exited');
  });
});

describe('ports and HTTP', () => {
  it('serves nginx on the published port; nothing on others', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name web -p 8080:80 nginx');
    expect(run(e, 'curl -s localhost:8080').text).toContain('Welcome to nginx!');
    expect(run(e, 'curl localhost:9999').code).toBe(7);
  });
  it('a wrong container port publishes but nothing answers (connection reset)', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name web -p 8080:8080 nginx');
    const r = run(e, 'curl localhost:8080');
    expect(r.code).toBe(56);
    expect(r.text).toContain('Connection reset by peer');
  });
  it('a bind mount replaces the web root', () => {
    const e = new DockerEngine({ files: { '/home/learner/myapp/site/index.html': '<h1>My own site</h1>\n' } });
    run(e, 'docker run -d --name web -p 8080:80 -v ./site:/usr/share/nginx/html:ro nginx');
    expect(run(e, 'curl -s localhost:8080').text).toBe('<h1>My own site</h1>');
    // Edit on the host → visible immediately.
    e.files['/home/learner/myapp/site/index.html'] = '<h1>Edited</h1>\n';
    expect(run(e, 'curl -s localhost:8080').text).toBe('<h1>Edited</h1>');
    // Read-only inside the container.
    expect(run(e, "docker exec web sh -c 'echo x > /usr/share/nginx/html/x.html'").code).not.toBe(0);
  });
});

describe('data', () => {
  it('data in a named volume survives the container; the writable layer does not', () => {
    const e = new DockerEngine();
    run(e, "docker run --name w1 -v notes:/data alpine sh -c 'echo keep > /data/a.txt; echo lost > /tmp/b.txt'");
    run(e, 'docker rm w1');
    expect(run(e, 'docker run --rm -v notes:/data alpine cat /data/a.txt').text).toBe('keep');
    expect(run(e, 'docker run --rm alpine cat /tmp/b.txt').code).not.toBe(0);
  });
  it('postgres initialises its data directory inside the volume', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name db -e POSTGRES_PASSWORD=x -v pgdata:/var/lib/postgresql/data postgres:16-alpine');
    expect(e.state.volumes.find((v) => v.name === 'pgdata')!.files['/PG_VERSION']).toBeDefined();
  });
});

describe('networks and DNS', () => {
  it('names resolve on user-defined networks only', () => {
    const e = new DockerEngine();
    run(e, 'docker network create app');
    run(e, 'docker run -d --name api --network app alpine sleep 1000');
    run(e, 'docker run -d --name db --network app alpine sleep 1000');
    run(e, 'docker run -d --name loner alpine sleep 1000');
    expect(run(e, 'docker exec api ping -c1 db').code).toBe(0);
    expect(run(e, 'docker exec loner ping -c1 db').text).toBe("ping: bad address 'db'");
    run(e, 'docker network connect app loner');
    expect(run(e, 'docker exec loner ping -c1 db').code).toBe(0);
  });
  it('containers reach each other by name over HTTP (not via localhost)', () => {
    const e = new DockerEngine();
    run(e, 'docker network create app');
    run(e, 'docker run -d --name web --network app nginx');
    run(e, 'docker run -d --name client --network app alpine sleep 1000');
    expect(run(e, 'docker exec client wget -qO- http://web').text).toContain('Welcome to nginx!');
    expect(run(e, 'docker exec client wget -qO- http://localhost').code).not.toBe(0);
  });
});

describe('build', () => {
  const app = {
    '/home/learner/myapp/package.json': '{"name":"app","scripts":{"start":"node server.js"},"dependencies":{"express":"^4"}}',
    '/home/learner/myapp/package-lock.json': '{}',
    '/home/learner/myapp/server.js': "require('http').createServer((q, r) => r.end('hello from node')).listen(3000);\n",
  };
  it('builds and runs a Node app that answers on its port', () => {
    const e = new DockerEngine({
      files: { ...app, '/home/learner/myapp/Dockerfile': 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nEXPOSE 3000\nCMD ["node", "server.js"]\n' },
    });
    expect(run(e, 'docker build -t myapp:1.0 .').code).toBe(0);
    run(e, 'docker run -d --name app -p 3000:3000 myapp:1.0');
    expect(run(e, 'curl -s localhost:3000').text).toBe('hello from node');
  });
  it('forgetting to COPY the code: the container exits with "Cannot find module"', () => {
    const e = new DockerEngine({ files: { ...app, '/home/learner/myapp/Dockerfile': 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCMD ["node", "server.js"]\n' } });
    run(e, 'docker build -t broken .');
    run(e, 'docker run -d --name app broken');
    expect(e.findContainer('app')!.exitCode).toBe(1);
    expect(run(e, 'docker logs app').text).toContain("Cannot find module '/app/server.js'");
  });
  it('apt-get on alpine fails; install without -y aborts; npm ci needs a lock file', () => {
    const mk = (df: string, extra: Record<string, string> = {}) => new DockerEngine({ files: { ...app, ...extra, '/home/learner/myapp/Dockerfile': df } });
    expect(run(mk('FROM alpine:3.20\nRUN apt-get update\n'), 'docker build .').text).toContain('apt-get: not found');
    expect(run(mk('FROM debian:12\nRUN apt-get update && apt-get install curl\n'), 'docker build .').text).toContain('exit code: 1');
    const noLock = mk('FROM node:22-alpine\nWORKDIR /app\nCOPY package.json ./\nRUN npm ci\n');
    expect(run(noLock, 'docker build .').text).toContain('can only install with an existing package-lock.json');
  });
  it('code changes invalidate only the layers after COPY . .', () => {
    const e = new DockerEngine({ files: { ...app, '/home/learner/myapp/Dockerfile': 'FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nCMD ["node", "server.js"]\n' } });
    run(e, 'docker build -t a .');
    e.files['/home/learner/myapp/server.js'] += '// change\n';
    const r = run(e, 'docker build -t a .').text;
    expect(r).toMatch(/RUN npm ci\n#\d+ CACHED/);
    expect(r).not.toMatch(/COPY \. \.\n#\d+ CACHED/);
  });
  it('.dockerignore keeps files out of the image', () => {
    const e = new DockerEngine({ files: { ...app, '/home/learner/myapp/.env': 'SECRET=1', '/home/learner/myapp/.dockerignore': '.env\n', '/home/learner/myapp/Dockerfile': 'FROM alpine:3.20\nWORKDIR /app\nCOPY . .\n' } });
    run(e, 'docker build -t a .');
    expect(run(e, 'docker run --rm a ls -a /app').text).not.toContain('.env');
  });
  it('multi-stage: the final image only has what was copied from the build stage', () => {
    const e = new DockerEngine({
      files: { '/home/learner/myapp/package.json': '{"scripts":{"build":"vite build"},"dependencies":{},"devDependencies":{"vite":"1"}}', '/home/learner/myapp/package-lock.json': '{}', '/home/learner/myapp/Dockerfile': 'FROM node:22-alpine AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM nginx:alpine\nCOPY --from=build /app/dist /usr/share/nginx/html\n' },
    });
    expect(run(e, 'docker build -t site .').code).toBe(0);
    const img = e.findImage('site')!;
    expect(img.size).toBeLessThan(100);
    run(e, 'docker run -d -p 8080:80 site');
    expect(run(e, 'curl -s localhost:8080').text).toContain('Hello from the built app');
  });
});

describe('compose', () => {
  it('service names resolve; down -v removes the volume', () => {
    const e = new DockerEngine({
      files: { '/home/learner/myapp/compose.yaml': 'services:\n  web:\n    image: nginx\n    ports: ["8080:80"]\n  client:\n    image: alpine\n    command: sleep 1000\n    volumes: [data:/data]\nvolumes:\n  data: {}\n' },
    });
    expect(run(e, 'docker compose up -d').code).toBe(0);
    expect(run(e, 'docker exec myapp-client-1 wget -qO- http://web').text).toContain('nginx');
    expect(run(e, 'curl -s localhost:8080').text).toContain('nginx');
    run(e, 'docker compose down -v');
    expect(e.state.volumes.some((v) => v.name === 'myapp_data')).toBe(false);
    expect(e.state.containers).toHaveLength(0);
  });
  it('reports undefined services, typos and unhealthy dependencies', () => {
    const typo = new DockerEngine({ files: { '/home/learner/myapp/compose.yaml': 'services:\n  web:\n    imagee: nginx\n' } });
    expect(run(typo, 'docker compose up -d').text).toContain("additional properties 'imagee' not allowed");
    const unhealthy = new DockerEngine({ files: { '/home/learner/myapp/compose.yaml': 'services:\n  web:\n    image: nginx\n    depends_on:\n      db:\n        condition: service_healthy\n  db:\n    image: postgres:16-alpine\n    healthcheck:\n      test: ["CMD", "pg_isready"]\n' } });
    // No POSTGRES_PASSWORD → db exits → never healthy.
    const r = run(unhealthy, 'docker compose up -d');
    expect(r.code).toBe(1);
    expect(r.text).toContain('is unhealthy');
  });
});

describe('linter', () => {
  it('catches the classic mistakes (incl. the apt bug in the original prototype)', () => {
    const issues = lintDockerfile('FROM ubuntu:latest\nRUN apt-get update\nRUN apt-get install -y curl\nRUN apt-get install -y git\nCOPY . /app\nCMD /app/start.sh\n');
    const text = issues.map((i) => i.message).join('\n');
    expect(text).toContain(':latest');
    expect(text).toContain('Consecutive package-manager RUNs');
    expect(text).toContain('without `apt-get update` in the same RUN');
    expect(text).toContain('exec form');
  });
  it('praises a good Dockerfile', () => {
    const issues = lintDockerfile('FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nUSER node\nCMD ["node", "server.js"]\n');
    expect(issues[0].kind).toBe('ok');
  });
});

describe('shell features and entrypoint scripts', () => {
  it('$(…) substitutes command output', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name a alpine sleep 100');
    run(e, 'docker run -d --name b alpine sleep 100');
    expect(run(e, 'docker rm -f $(docker ps -aq)').code).toBe(0);
    expect(e.state.containers).toHaveLength(0);
    expect(run(e, "echo '$(not run)'").text).toBe('$(not run)');
  });
  it('options after the image go to the program: redis rejects them and exits 1', () => {
    const e = new DockerEngine();
    expect(run(e, 'docker run -d redis --name cache').code).toBe(0);
    const c = e.state.containers[0];
    expect(c.status).toBe('exited');
    expect(c.exitCode).toBe(1);
    expect(run(e, `docker logs ${c.name}`).text).toContain('Bad directive or wrong number of arguments');
  });
  it('redis accepts real config options after the image', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name r redis --appendonly yes');
    expect(e.findContainer('r')!.status).toBe('running');
  });
  it('an unknown program behind an entrypoint script starts, then exits 127 with the script error', () => {
    const e = new DockerEngine();
    expect(run(e, 'docker run -d --name x nginx frobnicate').code).toBe(0);
    expect(e.findContainer('x')!.exitCode).toBe(127);
    expect(run(e, 'docker logs x').text).toContain('exec: frobnicate: not found');
  });
  it('whoami echoes the request like the real one', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name w -p 9000:80 traefik/whoami');
    const t = run(e, 'curl -s localhost:9000/hi').text;
    expect(t).toContain('GET /hi HTTP/1.1');
    expect(t).toContain('Host: localhost:9000');
    expect(t).toContain('RemoteAddr: 172.17.0.1:');
  });
  it('a request from inside a container to itself comes from 127.0.0.1', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name web nginx');
    run(e, 'docker exec web curl -s localhost');
    expect(run(e, 'docker logs --tail 1 web').text).toMatch(/^127\.0\.0\.1 - - /);
  });
});

describe('container filesystem', () => {
  it('mkdir creates an empty directory you can write into; without -p it needs the parent', () => {
    const e = new DockerEngine();
    run(e, 'docker pull alpine');
    expect(run(e, 'docker run --rm alpine sh -c "mkdir -p /data/x && echo hi > /data/x/f.txt && cat /data/x/f.txt"').text).toBe('hi');
    expect(run(e, 'docker run --rm alpine mkdir /a/b').text).toContain("can't create directory '/a/b': No such file or directory");
    expect(run(e, 'docker run --rm alpine mkdir /etc').text).toContain('File exists');
    run(e, 'docker run -d --name k alpine sh -c "mkdir /empty && sleep 100"');
    expect(run(e, 'docker exec k ls /empty')).toEqual({ text: '', code: 0 });
  });
});

describe('networks and templates', () => {
  it('range in --format, and -f on volume/network inspect', () => {
    const e = new DockerEngine();
    run(e, 'docker network create appnet');
    run(e, 'docker run -d --name c --network appnet alpine sleep 100');
    expect(run(e, 'docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" c').text).toMatch(/^172\.18\.0\.\d+$/);
    expect(run(e, 'docker network inspect -f "{{range .Containers}}{{.Name}} {{end}}" appnet').text.trim()).toBe('c');
    run(e, 'docker volume create v');
    expect(run(e, 'docker volume inspect -f "{{.Mountpoint}}" v').text).toBe('/var/lib/docker/volumes/v/_data');
    expect(run(e, 'docker ps --format "{{.Names}}\\t{{.Image}}"').text).toBe('c\talpine');
  });
  it('busybox wget identifies itself as Wget', () => {
    const e = new DockerEngine();
    run(e, 'docker network create n');
    run(e, 'docker run -d --name api --network n traefik/whoami');
    const t = run(e, 'docker run --rm --network n alpine wget -qO- api').text;
    expect(t).toContain('User-Agent: Wget');
    expect(t).not.toContain('curl/');
  });
  it('--network none has no way out; the bridge reaches outside addresses', () => {
    const e = new DockerEngine();
    expect(run(e, 'docker run --rm --network none alpine ping -c 1 8.8.8.8').text).toContain('Network unreachable');
    expect(run(e, 'docker run --rm alpine ping -c 1 8.8.8.8').code).toBe(0);
  });
  it('--network host: the app is on the host port directly', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name h --network host nginx');
    expect(run(e, 'curl -s localhost').text).toContain('Welcome to nginx!');
  });
});

describe('data', () => {
  it('redis saves to /data on docker stop (not on a kill), so a volume carries the keys to a new container', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name r -v rdata:/data redis');
    expect(run(e, 'docker exec r redis-cli set visits 5').text).toBe('OK');
    expect(run(e, 'docker exec r redis-cli incr visits').text).toBe('6');
    expect(run(e, 'docker exec r redis-cli get nope').text).toBe('');
    run(e, 'docker run -d --name k -v kdata:/data redis');
    run(e, 'docker exec k redis-cli set lost yes');
    run(e, 'docker rm -f k');
    run(e, 'docker run -d --name k2 -v kdata:/data redis');
    expect(run(e, 'docker exec k2 redis-cli get lost').text).toBe('');
    run(e, 'docker run -d --name a -v adata:/data redis redis-server --appendonly yes');
    run(e, 'docker exec a redis-cli set kept yes');
    run(e, 'docker kill a');
    run(e, 'docker start a');
    expect(run(e, 'docker exec a redis-cli get kept').text).toBe('yes');
    run(e, 'docker stop r');
    expect(run(e, 'docker logs r').text).toContain('DB saved on disk');
    run(e, 'docker rm r');
    run(e, 'docker run -d --name r2 -v rdata:/data redis');
    expect(run(e, 'docker exec r2 redis-cli get visits').text).toBe('6');
    run(e, 'docker run -d --name r3 redis');
    expect(run(e, 'docker exec r3 redis-cli get visits').text).toBe('');
  });
  it('bind paths become absolute; -v creates a missing folder, --mount refuses', () => {
    const e = new DockerEngine({ files: { '/home/learner/myapp/site/index.html': 'hi\n' } });
    run(e, 'docker run -d --name a -v ./site:/s alpine sleep 100');
    run(e, 'docker run -d --name b -v /home/learner/myapp/site:/s alpine sleep 100');
    const [a, b] = ['a', 'b'].map((n) => e.snapshot().containers.find((c) => c.name === n)!.mounts);
    expect(a).toEqual(b);
    run(e, 'docker run --rm -v ./new:/x alpine true');
    expect(run(e, 'ls').text).toBe('new\nsite');
    const r = run(e, 'docker run --rm --mount type=bind,source=./zzz,target=/x alpine true');
    expect(r.code).toBe(125);
    expect(r.text).toContain('bind source path does not exist: /home/learner/myapp/zzz');
  });
  it('volume prune -a removes unused named volumes', () => {
    const e = new DockerEngine();
    run(e, 'docker volume create keep');
    run(e, 'docker volume create old');
    run(e, 'docker run -d --name k -v keep:/k alpine sleep 100');
    expect(run(e, 'docker volume prune -f').text).toBe('Total reclaimed space: 0B');
    expect(run(e, 'docker volume prune -af').text).toContain('Deleted Volumes:\nold');
    expect(run(e, 'docker volume ls -q').text).toBe('keep');
  });
});

describe('image VOLUMEs', () => {
  it('postgres gets an anonymous volume; rm keeps it, rm -v removes it', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name db -e POSTGRES_PASSWORD=pw postgres:16');
    const id = run(e, 'docker volume ls -q').text;
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(run(e, `docker run --rm -v ${id}:/d alpine ls /d`).text).toContain('PG_VERSION');
    run(e, 'docker rm -f db');
    expect(run(e, 'docker volume ls -q').text).toBe(id);
    run(e, 'docker run -d --name db2 -e POSTGRES_PASSWORD=pw postgres:16');
    run(e, 'docker rm -fv db2');
    expect(run(e, 'docker volume ls -q').text).toBe(id);
    run(e, 'docker run -d --name db3 -e POSTGRES_PASSWORD=pw -v pgdata:/var/lib/postgresql/data postgres:16');
    expect(run(e, 'docker volume ls -q').text.split('\n')).toEqual([id, 'pgdata']);
  });
  it('a Dockerfile VOLUME is recorded in the image', () => {
    const e = new DockerEngine({ files: { '/home/learner/myapp/Dockerfile': 'FROM alpine\nVOLUME /cache\nCMD ["sleep","100"]\n' } });
    run(e, 'docker build -t v .');
    expect(run(e, 'docker image inspect -f "{{json .Config.Volumes}}" v').text).toBe('{"/cache":{}}');
    run(e, 'docker run -d --name c v');
    expect(run(e, 'docker inspect -f "{{range .Mounts}}{{.Type}} {{.Destination}}{{end}}" c').text).toBe('volume /cache');
  });
});

describe('volume copy-up and host variables', () => {
  it('a new named volume starts with the image files at its mount point', () => {
    const e = new DockerEngine();
    run(e, 'docker pull alpine');
    run(e, 'docker run -d --name a -p 8080:80 -v site:/usr/share/nginx/html nginx');
    expect(run(e, 'curl -s localhost:8080').text).toContain('Welcome to nginx!');
    expect(run(e, 'docker run --rm -v site:/x alpine ls /x').text).toBe('50x.html\nindex.html');
  });
  it('$PWD, $HOME and $USER expand on the host', () => {
    const e = new DockerEngine({ files: { '/home/learner/myapp/public/i.html': 'x\n' } });
    run(e, 'docker run -d --name c -v "$PWD/public":/p alpine sleep 9');
    expect(run(e, 'docker inspect -f "{{range .Mounts}}{{.Source}}{{end}}" c').text).toBe('/home/learner/myapp/public');
    expect(run(e, 'echo $HOME ${USER}').text).toBe('/home/learner learner');
  });
});

describe('shell details', () => {
  it('input redirection, wc FILE, and missing files inside a volume', () => {
    const e = new DockerEngine();
    run(e, 'docker pull alpine');
    expect(run(e, 'docker run --rm -v c:/count alpine sh -c "mkdir -p /count && echo 1 >> /count/log && wc -l < /count/log"').text).toBe('1');
    expect(run(e, 'docker run --rm -v c:/count alpine wc -l /count/log').text).toBe('1 /count/log');
    expect(run(e, 'docker run --rm -v c:/count alpine cat /count/nope').text).toBe("cat: can't open '/count/nope': No such file or directory");
    expect(e.snapshot().volumes).toEqual([{ name: 'c', files: ['/log'] }]);
  });
  it('docker start -a prints the new output and returns the exit code', () => {
    const e = new DockerEngine();
    run(e, 'docker pull alpine');
    run(e, 'docker run --name a alpine sh -c "echo hi"');
    expect(run(e, 'docker start -a a')).toEqual({ text: 'hi', code: 0 });
    run(e, 'docker run --name b alpine sh -c "exit 3"');
    expect(run(e, 'docker start -a b').code).toBe(3);
  });
});

describe('clients across the network', () => {
  it('redis-cli -h, pg_isready -h, nc -z and psql reach containers by name on a user-defined network', () => {
    const e = new DockerEngine();
    run(e, 'docker network create appnet');
    run(e, 'docker run -d --name cache --network appnet redis');
    run(e, 'docker run -d --name db --network appnet -e POSTGRES_PASSWORD=pw postgres:16');
    expect(run(e, 'docker run --rm --network appnet redis redis-cli -h cache set a 1').text).toBe('OK');
    expect(run(e, 'docker exec cache redis-cli get a').text).toBe('1');
    expect(run(e, 'docker run --rm redis redis-cli -h cache ping')).toEqual({ text: 'Could not connect to Redis at cache:6379: Name or service not known', code: 1 });
    expect(run(e, 'docker run --rm --network appnet postgres:16 pg_isready -h db').text).toBe('db:5432 - accepting connections');
    expect(run(e, 'docker run --rm --network appnet postgres:16 pg_isready -h cache').code).toBe(2);
    run(e, 'docker pull alpine');
    expect(run(e, 'docker run --rm --network appnet alpine nc -z db 5432').code).toBe(0);
    expect(run(e, 'docker run --rm --network appnet alpine nc -z db 5433').code).toBe(1);
    expect(run(e, 'docker run --rm --network appnet postgres:16 psql -h nope -U postgres').text).toContain('could not translate host name "nope"');
  });
  it('template variables in range', () => {
    const e = new DockerEngine();
    run(e, 'docker network create appnet');
    run(e, 'docker run -d --name api traefik/whoami');
    run(e, 'docker network connect appnet api');
    expect(run(e, "docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}{{$.Name}}' api").text).toBe('appnet bridge /api');
  });
});

describe('network edge cases', () => {
  it('a stopped container does not block network rm, but cannot start afterwards', () => {
    const e = new DockerEngine();
    run(e, 'docker network create oldnet');
    run(e, 'docker run --name legacy --network oldnet alpine true');
    expect(run(e, 'docker network rm oldnet').code).toBe(0);
    const r = run(e, 'docker start legacy');
    expect(r.code).toBe(1);
    expect(r.text).toContain('network oldnet not found');
  });
  it('--network host discards -p and shows no ports', () => {
    const e = new DockerEngine();
    const r = run(e, 'docker run -d --name h --network host -p 8080:80 nginx');
    expect(r.text).toContain('WARNING: Published ports are discarded when using host network mode');
    expect(run(e, 'curl -s localhost:8080').code).toBe(7);
    expect(run(e, 'docker ps --format "[{{.Ports}}]"').text).toBe('[]');
  });
});

describe('app scripts', () => {
  const files = {
    '/home/learner/myapp/hello.js': 'console.log("Hello from Node!");\n',
    '/home/learner/myapp/greet.js': 'console.log(`Hi ${process.env.NAME}!`);\nconsole.log("Bye " + process.env.NAME);\n',
    '/home/learner/myapp/server.js': 'require("http").createServer((q, s) => s.end("hi\\n")).listen(3000);\n',
    '/home/learner/myapp/app.py': 'import os\nprint("Hello", os.environ.get("NAME", "world"))\n',
  };
  it('print-and-exit scripts print and exit; servers keep running', () => {
    const e = new DockerEngine({ files });
    run(e, 'docker pull node:22-alpine');
    run(e, 'docker pull python:3.12-slim');
    expect(run(e, 'docker run --rm -v ./:/app -w /app node:22-alpine node hello.js')).toEqual({ text: 'Hello from Node!', code: 0 });
    expect(run(e, 'docker run --rm -e NAME=Ada -v ./:/app -w /app node:22-alpine node greet.js').text).toBe('Hi Ada!\nBye Ada');
    expect(run(e, 'docker run --rm -v ./:/app -w /app python:3.12-slim python3 app.py').text).toBe('Hello world');
    expect(run(e, 'docker run --rm python:3.12-slim python3 -c "print(42)"').text).toBe('42');
    run(e, 'docker run -d --name s -p 3000:3000 -v ./:/app -w /app node:22-alpine node server.js');
    expect(run(e, 'curl -s localhost:3000').text).toBe('hi');
  });
  it('alpine tags are Alpine: busybox, no bash, Alpine base layer', () => {
    const e = new DockerEngine();
    run(e, 'docker pull node:22-alpine');
    expect(run(e, 'docker run --rm node:22-alpine cat /etc/os-release').text).toContain('Alpine Linux');
    expect(run(e, 'docker history node:22-alpine').text).toContain('alpine-minirootfs');
    run(e, 'docker pull node:22');
    expect(run(e, 'docker run --rm node:22 cat /etc/os-release').text).toContain('Debian');
  });
});

describe('docker cp, --volumes-from and host redirection', () => {
  it('copies files and folders both ways, also from stopped containers', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name notes alpine sh -c "mkdir -p /data/sub && echo secret > /data/notes.txt && echo deep > /data/sub/x.txt && sleep 3600"');
    expect(run(e, 'docker cp notes:/data/notes.txt .').text).toBe('Successfully copied 2.05kB to /home/learner/myapp/.');
    expect(run(e, 'cat notes.txt').text).toBe('secret');
    run(e, 'docker cp notes:/data backup');
    expect(run(e, 'cat backup/sub/x.txt').text).toBe('deep');
    run(e, 'docker run -d --name keeper -v vault:/vault alpine sleep 3600');
    run(e, 'docker cp notes.txt keeper:/vault/');
    expect(run(e, 'docker run --rm --volumes-from keeper alpine cat /vault/notes.txt').text).toBe('secret');
    expect(run(e, 'docker cp nope.txt keeper:/vault/').code).toBe(1);
    expect(run(e, 'docker cp notes:/nope .').text).toBe('Error response from daemon: Could not find the file /nope in container notes');
    run(e, 'docker stop notes');
    run(e, 'docker cp notes:/data/notes.txt again.txt');
    expect(run(e, 'cat again.txt').text).toBe('secret');
  });
  it('> and >> write command output to a host file; >/dev/null discards it', () => {
    const e = new DockerEngine();
    run(e, 'docker run -d --name n alpine sh -c "echo one > /f && sleep 3600"');
    run(e, 'docker exec n cat /f > out.txt');
    run(e, 'docker exec n cat /f >> out.txt');
    expect(run(e, 'cat out.txt').text).toBe('one\none');
    expect(run(e, 'docker ps -q >/dev/null').text).toBe('');
    expect(run(e, 'ls').text).toBe('out.txt');
  });
});
