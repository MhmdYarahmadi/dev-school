/**
 * The images the simulator can "pull". Sizes, commands, files and log text
 * were taken from real Docker 29.7.2 where calibrated (alpine, busybox,
 * nginx, hello-world, postgres errors); the rest follow the official images.
 */
import type { Behavior, ImageConfig, Layer } from './types';

export interface CatalogEntry {
  repo: string;
  /** tag → [disk MB, content MB]. The first tag is the default ("latest" when present). */
  tags: Record<string, [number, number]>;
  config: ImageConfig;
  layers: Layer[];
  /** Tag-specific history (e.g. an older base layer). */
  tagLayers?: Record<string, Layer[]>;
  /** How the default command behaves. */
  behavior: Behavior;
  files: Record<string, string>;
  /** Commands available inside the container (for `docker exec`). */
  tools: string[];
  /** Lines logged when the default command starts ({TS} = log timestamp). */
  startLogs?: string[];
  /** Required environment (any one of the names), with the error logged and exit code when missing. */
  requiredEnv?: { anyOf: string[]; logs: string[]; exitCode: number };
  /** Data directory initialised on first start (written to a mounted volume if there is one). */
  dataDir?: { path: string; files: string[] };
  /** Exit code when stopped with SIGTERM (default 0 for servers that handle it). */
  stopExit?: number;
  /** Extra files a built image gets for its OS family (decides apt vs apk). */
  family: 'alpine' | 'debian' | 'scratch';
  user?: string;
  /** Memory the default server uses when idle (MiB). */
  memMb?: number;
}

const SH_TOOLS = ['ls', 'cat', 'echo', 'env', 'hostname', 'sh', 'sleep', 'mkdir', 'touch', 'rm', 'getent', 'id', 'whoami', 'pwd', 'true', 'false', 'test', 'exit', 'printenv', 'head', 'tail', 'grep', 'wc', 'sort', 'date'];
const BUSYBOX_TOOLS = [...SH_TOOLS, 'ping', 'wget', 'nslookup', 'ps', 'top', 'nc'];
const DEBIAN_TOOLS = [...SH_TOOLS, 'bash'];

const ETC_OS_ALPINE = { '/etc/os-release': 'NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.22.1\n', '/etc/hostname': '' };
const ETC_OS_DEBIAN = { '/etc/os-release': 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nID=debian\n', '/etc/hostname': '' };

const NGINX_INDEX = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, nginx is successfully installed and working.
Further configuration is required for the web server to become fully online.</p>
</body>
</html>
`;

const NGINX_LOGS = [
  '/docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration',
  '/docker-entrypoint.sh: Looking for shell scripts in /docker-entrypoint.d/',
  '/docker-entrypoint.sh: Launching /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh',
  '10-listen-on-ipv6-by-default.sh: info: Getting the checksum of /etc/nginx/conf.d/default.conf',
  '10-listen-on-ipv6-by-default.sh: info: Enabled listen on IPv6 in /etc/nginx/conf.d/default.conf',
  '/docker-entrypoint.sh: Sourcing /docker-entrypoint.d/15-local-resolvers.envsh',
  '/docker-entrypoint.sh: Launching /docker-entrypoint.d/20-envsubst-on-templates.sh',
  '/docker-entrypoint.sh: Launching /docker-entrypoint.d/30-tune-worker-processes.sh',
  '/docker-entrypoint.sh: Configuration complete; ready for start up',
  '{NGINXTS} [notice] 1#1: using the "epoll" event method',
  '{NGINXTS} [notice] 1#1: nginx/1.31.6',
  '{NGINXTS} [notice] 1#1: built by gcc 14.2.0 (Debian 14.2.0-19) ',
  '{NGINXTS} [notice] 1#1: OS: Linux 7.0.0-30-generic',
  '{NGINXTS} [notice] 1#1: getrlimit(RLIMIT_NOFILE): 1024:524288',
  '{NGINXTS} [notice] 1#1: start worker processes',
  '{NGINXTS} [notice] 1#1: start worker process 29',
  '{NGINXTS} [notice] 1#1: start worker process 30',
  '{NGINXTS} [notice] 1#1: start worker process 31',
  '{NGINXTS} [notice] 1#1: start worker process 32',
];

const HELLO = [
  '',
  'Hello from Docker!',
  'This message shows that your installation appears to be working correctly.',
  '',
  'To generate this message, Docker took the following steps:',
  ' 1. The Docker client contacted the Docker daemon.',
  ' 2. The Docker daemon pulled the "hello-world" image from the Docker Hub.',
  '    (amd64)',
  ' 3. The Docker daemon created a new container from that image which runs the',
  '    executable that produces the output you are currently reading.',
  ' 4. The Docker daemon streamed that output to the Docker client, which sent it',
  '    to your terminal.',
  '',
  'To try something more ambitious, you can run an Ubuntu container with:',
  ' $ docker run -it ubuntu bash',
  '',
  'Share images, automate workflows, and more with a free Docker ID:',
  ' https://hub.docker.com/',
  '',
  'For more examples and ideas, visit:',
  ' https://docs.docker.com/get-started/',
  '',
];

const PG_NO_PASSWORD = [
  'Error: Database is uninitialized and superuser password is not specified.',
  '       You must specify POSTGRES_PASSWORD to a non-empty value for the',
  '       superuser. For example, "-e POSTGRES_PASSWORD=password" on "docker run".',
  '',
  '       You may also use "POSTGRES_HOST_AUTH_METHOD=trust" to allow all',
  '       connections without a password. This is *not* recommended.',
  '',
  '       See PostgreSQL documentation about "trust":',
  '       https://www.postgresql.org/docs/current/auth-trust.html',
];

const PG_DATA = ['PG_VERSION', 'base', 'global', 'pg_commit_ts', 'pg_dynshmem', 'pg_hba.conf', 'pg_ident.conf', 'pg_logical', 'pg_multixact', 'pg_notify', 'pg_replslot', 'pg_serial', 'pg_snapshots', 'pg_stat', 'pg_stat_tmp', 'pg_subtrans', 'pg_tblspc', 'pg_twophase', 'pg_wal', 'pg_xact', 'postgresql.auto.conf', 'postgresql.conf', 'postmaster.opts', 'postmaster.pid'];

const PATH_ENV = 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

const cfg = (c: Partial<ImageConfig>): ImageConfig => ({ cmd: [], entrypoint: [], workdir: '', user: '', env: [PATH_ENV], exposed: [], ...c });

export const CATALOG: Record<string, CatalogEntry> = {
  alpine: {
    repo: 'alpine',
    tags: { latest: [13, 3.94], '3.22': [13, 3.94], '3.20': [12.1, 3.63] },
    config: cfg({ cmd: ['/bin/sh'] }),
    layers: [{ createdBy: 'ADD alpine-minirootfs-3.22.1-x86_64.tar.gz / # buildkit', size: 8.47 }, { createdBy: 'CMD ["/bin/sh"]', size: 0 }],
    tagLayers: { '3.20': [{ createdBy: 'ADD alpine-minirootfs-3.20.10-x86_64.tar.gz / # buildkit', size: 8.47 }, { createdBy: 'CMD ["/bin/sh"]', size: 0 }] },
    behavior: { kind: 'shell' },
    files: { ...ETC_OS_ALPINE, '/bin/sh': '', '/root/': '', '/tmp/': '', '/home/': '', '/var/': '', '/usr/': '' },
    tools: BUSYBOX_TOOLS,
    family: 'alpine',
  },
  busybox: {
    repo: 'busybox',
    tags: { latest: [6.81, 2.23] },
    config: cfg({ cmd: ['sh'] }),
    layers: [{ createdBy: 'ADD busybox.tar.xz / # buildkit', size: 4.4 }, { createdBy: 'CMD ["sh"]', size: 0 }],
    behavior: { kind: 'shell' },
    files: { '/bin/sh': '', '/etc/': '', '/tmp/': '', '/root/': '' },
    tools: BUSYBOX_TOOLS,
    family: 'alpine',
  },
  ubuntu: {
    repo: 'ubuntu',
    tags: { latest: [117, 29.7], '24.04': [117, 29.7] },
    config: cfg({ cmd: ['/bin/bash'] }),
    layers: [{ createdBy: 'ADD file:ubuntu-noble-oci-amd64-root.tar.gz in / ', size: 78.1 }, { createdBy: 'CMD ["/bin/bash"]', size: 0 }],
    behavior: { kind: 'shell' },
    files: { '/etc/os-release': 'PRETTY_NAME="Ubuntu 24.04.3 LTS"\nNAME="Ubuntu"\nID=ubuntu\n', '/bin/bash': '', '/root/': '', '/tmp/': '' },
    tools: DEBIAN_TOOLS,
    family: 'debian',
  },
  debian: {
    repo: 'debian',
    tags: { latest: [139, 48.5], '12': [139, 48.5], '12-slim': [97.2, 28.2] },
    config: cfg({ cmd: ['bash'] }),
    layers: [{ createdBy: '# debian.sh --arch \'amd64\' out/ \'bookworm\'', size: 117 }, { createdBy: 'CMD ["bash"]', size: 0 }],
    behavior: { kind: 'shell' },
    files: { ...ETC_OS_DEBIAN, '/bin/bash': '', '/root/': '', '/tmp/': '' },
    tools: DEBIAN_TOOLS,
    family: 'debian',
  },
  'hello-world': {
    repo: 'hello-world',
    tags: { latest: [25.9, 9.49] },
    config: cfg({ cmd: ['/hello'], env: [] }),
    layers: [{ createdBy: 'COPY hello / # buildkit', size: 0.0136 }, { createdBy: 'CMD ["/hello"]', size: 0 }],
    behavior: { kind: 'oneshot', output: HELLO, exitCode: 0 },
    files: { '/hello': '' },
    tools: [],
    family: 'scratch',
  },
  nginx: {
    repo: 'nginx',
    memMb: 10,
    tags: { latest: [242, 66.3], alpine: [74.5, 21.9], '1.27-alpine': [74.5, 21.9], '1.27': [242, 66.3] },
    config: cfg({
      entrypoint: ['/docker-entrypoint.sh'],
      cmd: ['nginx', '-g', 'daemon off;'],
      exposed: [80],
      env: [PATH_ENV, 'NGINX_VERSION=1.31.6'],
    }),
    layers: [
      { createdBy: '# debian.sh --arch \'amd64\' out/ \'trixie\'', size: 87.4 },
      { createdBy: 'ENV NGINX_VERSION=1.31.6', size: 0 },
      { createdBy: 'RUN /bin/sh -c set -x && groupadd --system --gid 101 nginx …', size: 113 },
      { createdBy: 'COPY docker-entrypoint.sh / # buildkit', size: 0.0049 },
      { createdBy: 'ENTRYPOINT ["/docker-entrypoint.sh"]', size: 0 },
      { createdBy: 'EXPOSE map[80/tcp:{}]', size: 0 },
      { createdBy: 'STOPSIGNAL SIGQUIT', size: 0 },
      { createdBy: 'CMD ["nginx" "-g" "daemon off;"]', size: 0 },
    ],
    behavior: { kind: 'server', port: 80 },
    files: {
      ...ETC_OS_DEBIAN,
      '/usr/share/nginx/html/index.html': NGINX_INDEX,
      '/usr/share/nginx/html/50x.html': '<!DOCTYPE html>\n<html>\n<head>\n<title>Error</title>\n</head>\n<body>\n<h1>An error occurred.</h1>\n</body>\n</html>\n',
      '/etc/nginx/nginx.conf': 'user  nginx;\nworker_processes  auto;\n',
      '/etc/nginx/conf.d/default.conf': 'server {\n    listen       80;\n    server_name  localhost;\n    location / {\n        root   /usr/share/nginx/html;\n        index  index.html index.htm;\n    }\n}\n',
      '/docker-entrypoint.sh': '',
    },
    tools: [...DEBIAN_TOOLS, 'curl', 'nginx'],
    startLogs: NGINX_LOGS,
    family: 'debian',
  },
  httpd: {
    repo: 'httpd',
    memMb: 14,
    tags: { latest: [148, 44.6], alpine: [62.4, 19.1] },
    config: cfg({ cmd: ['httpd-foreground'], exposed: [80], workdir: '/usr/local/apache2', env: [PATH_ENV, 'HTTPD_PREFIX=/usr/local/apache2'] }),
    layers: [{ createdBy: '# debian.sh --arch \'amd64\' out/ \'trixie\'', size: 87.4 }, { createdBy: 'RUN /bin/sh -c set -eux; apt-get install httpd …', size: 60 }, { createdBy: 'CMD ["httpd-foreground"]', size: 0 }],
    behavior: { kind: 'server', port: 80 },
    files: { ...ETC_OS_DEBIAN, '/usr/local/apache2/htdocs/index.html': '<html><body><h1>It works!</h1></body></html>\n' },
    tools: [...DEBIAN_TOOLS],
    startLogs: ['AH00558: httpd: Could not reliably determine the server\'s fully qualified domain name, using 172.17.0.2. Set the \'ServerName\' directive globally to suppress this message', '[mpm_event:notice] [pid 1:tid 1] AH00489: Apache/2.4.65 (Unix) configured -- resuming normal operations'],
    family: 'debian',
  },
  redis: {
    repo: 'redis',
    memMb: 4,
    tags: { latest: [205, 52.8], alpine: [61.6, 17.4] },
    config: cfg({ entrypoint: ['docker-entrypoint.sh'], cmd: ['redis-server'], exposed: [6379], workdir: '/data', volumes: ['/data'] }),
    layers: [{ createdBy: '# debian.sh --arch \'amd64\' out/ \'trixie\'', size: 87.4 }, { createdBy: 'RUN /bin/sh -c set -eux; … redis …', size: 117 }, { createdBy: 'CMD ["redis-server"]', size: 0 }],
    behavior: { kind: 'server', port: 6379, response: '-ERR wrong number of arguments\r\n' },
    files: { ...ETC_OS_DEBIAN, '/data/': '' },
    tools: [...DEBIAN_TOOLS, 'redis-cli'],
    startLogs: ['1:C 05 Oct 2026 {HMS}.000 * oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo', '1:M 05 Oct 2026 {HMS}.000 * Server initialized', '1:M 05 Oct 2026 {HMS}.000 * Ready to accept connections tcp'],
    dataDir: { path: '/data', files: [] },
    family: 'debian',
  },
  postgres: {
    repo: 'postgres',
    memMb: 32,
    tags: { latest: [621, 162], '17': [621, 162], '16': [612, 159], '16-alpine': [393, 107], alpine: [395, 108] },
    config: cfg({ entrypoint: ['docker-entrypoint.sh'], cmd: ['postgres'], exposed: [5432], env: [PATH_ENV, 'PGDATA=/var/lib/postgresql/data'], volumes: ['/var/lib/postgresql/data'] }),
    layers: [{ createdBy: 'ADD alpine-minirootfs-3.22.1-x86_64.tar.gz / # buildkit', size: 8.47 }, { createdBy: 'RUN /bin/sh -c set -eux; … postgres …', size: 380 }, { createdBy: 'ENTRYPOINT ["docker-entrypoint.sh"]', size: 0 }, { createdBy: 'CMD ["postgres"]', size: 0 }],
    behavior: { kind: 'server', port: 5432 },
    files: { ...ETC_OS_ALPINE, '/var/lib/postgresql/data/': '' },
    tools: [...BUSYBOX_TOOLS, 'pg_isready', 'psql'],
    requiredEnv: { anyOf: ['POSTGRES_PASSWORD', 'POSTGRES_HOST_AUTH_METHOD'], logs: PG_NO_PASSWORD, exitCode: 1 },
    dataDir: { path: '/var/lib/postgresql/data', files: PG_DATA },
    startLogs: ['{PGTS} UTC [1] LOG:  starting PostgreSQL 16.10 on x86_64-pc-linux-musl', '{PGTS} UTC [1] LOG:  listening on IPv4 address "0.0.0.0", port 5432', '{PGTS} UTC [55] LOG:  database system was shut down at {PGTSS} UTC', '{PGTS} UTC [1] LOG:  database system is ready to accept connections'],
    family: 'alpine',
  },
  mysql: {
    repo: 'mysql',
    memMb: 420,
    tags: { latest: [1060, 233], '8': [1040, 228] },
    config: cfg({ entrypoint: ['docker-entrypoint.sh'], cmd: ['mysqld'], exposed: [3306, 33060], volumes: ['/var/lib/mysql'] }),
    layers: [{ createdBy: 'ADD oraclelinux-9-slim-amd64-rootfs.tar.xz / # buildkit', size: 115 }, { createdBy: 'RUN /bin/sh -c set -eux; … mysql …', size: 900 }, { createdBy: 'CMD ["mysqld"]', size: 0 }],
    behavior: { kind: 'server', port: 3306 },
    files: { '/etc/os-release': 'NAME="Oracle Linux Server"\n', '/var/lib/mysql/': '' },
    tools: [...SH_TOOLS, 'bash', 'mysql', 'mysqladmin'],
    requiredEnv: {
      anyOf: ['MYSQL_ROOT_PASSWORD', 'MYSQL_ALLOW_EMPTY_PASSWORD', 'MYSQL_RANDOM_ROOT_PASSWORD'],
      logs: [
        '{MYTS} [ERROR] [Entrypoint]: Database is uninitialized and password option is not specified',
        '    You need to specify one of the following as an environment variable:',
        '    - MYSQL_ROOT_PASSWORD',
        '    - MYSQL_ALLOW_EMPTY_PASSWORD',
        '    - MYSQL_RANDOM_ROOT_PASSWORD',
      ],
      exitCode: 1,
    },
    dataDir: { path: '/var/lib/mysql', files: ['auto.cnf', 'ibdata1', 'mysql', 'mysql.ibd', 'performance_schema', 'sys'] },
    startLogs: ['{MYTS} [System] [MY-010931] [Server] /usr/sbin/mysqld: ready for connections. Version: \'8.4.6\'  socket: \'/var/run/mysqld/mysqld.sock\'  port: 3306  MySQL Community Server - GPL.'],
    family: 'debian',
  },
  node: {
    repo: 'node',
    tags: { latest: [1120, 386], '22': [1120, 386], '22-alpine': [161, 47.6], '20': [1100, 380], '20-alpine': [137, 42.1] },
    config: cfg({ entrypoint: ['docker-entrypoint.sh'], cmd: ['node'], env: [PATH_ENV, 'NODE_VERSION=22.20.0'] }),
    layers: [{ createdBy: '# debian.sh --arch \'amd64\' out/ \'bookworm\'', size: 117 }, { createdBy: 'RUN /bin/sh -c … node …', size: 1000 }, { createdBy: 'CMD ["node"]', size: 0 }],
    behavior: { kind: 'shell' }, // the Node REPL exits straight away without -it
    files: { ...ETC_OS_DEBIAN, '/usr/local/bin/node': '', '/usr/local/bin/npm': '' },
    tools: [...DEBIAN_TOOLS, 'node', 'npm', 'curl'],
    family: 'debian',
  },
  python: {
    repo: 'python',
    tags: { latest: [1020, 375], '3.12': [1020, 375], '3.12-slim': [124, 41.3], '3.13-slim': [125, 41.6] },
    config: cfg({ cmd: ['python3'], env: [PATH_ENV, 'PYTHON_VERSION=3.12.11'] }),
    layers: [{ createdBy: '# debian.sh --arch \'amd64\' out/ \'bookworm\'', size: 117 }, { createdBy: 'RUN /bin/sh -c … python …', size: 900 }, { createdBy: 'CMD ["python3"]', size: 0 }],
    behavior: { kind: 'shell' },
    files: { ...ETC_OS_DEBIAN, '/usr/local/bin/python3': '' },
    tools: [...DEBIAN_TOOLS, 'python3', 'python', 'pip', 'curl'],
    family: 'debian',
  },
  'traefik/whoami': {
    repo: 'traefik/whoami',
    memMb: 3,
    tags: { latest: [6.75, 2.98] },
    config: cfg({ entrypoint: ['/whoami'], exposed: [80], env: [] }),
    layers: [{ createdBy: 'COPY /go/whoami/whoami /whoami # buildkit', size: 6.75 }, { createdBy: 'ENTRYPOINT ["/whoami"]', size: 0 }],
    behavior: { kind: 'server', port: 80, response: 'Hostname: {HOSTNAME}\nIP: 127.0.0.1\nIP: ::1\nIP: {IP}\nRemoteAddr: {REMOTE}:51234\nGET {PATH} HTTP/1.1\nHost: {HOST}\n{CLIENT}\n' },
    files: { '/whoami': '' },
    tools: [],
    startLogs: ['{WTS} Starting up on port 80'],
    family: 'scratch',
  },
};

/** Resolves "nginx", "nginx:alpine", "docker.io/library/nginx" … to a catalog entry and tag. */
const ALPINE_BASE: Layer = { createdBy: 'ADD alpine-minirootfs-3.22.1-x86_64.tar.gz / # buildkit', size: 8.47 };

/** An Alpine build of a Debian-based image (node:22-alpine, redis:alpine, nginx:alpine…). */
export function isAlpineTag(entry: CatalogEntry, tag: string): boolean {
  return entry.family === 'debian' && /(^|-)alpine/.test(tag);
}

const variants: Record<string, CatalogEntry> = {};

/** The catalog entry an image came from. `repo@alpine` is the Alpine variant: busybox tools, apk, Alpine base layer. */
export function catalogEntry(origin: string): CatalogEntry | undefined {
  const [repo, variant] = origin.split('@');
  const e = CATALOG[repo];
  if (!e || variant !== 'alpine') return e;
  return (variants[repo] ??= {
    ...e,
    family: 'alpine',
    files: { ...Object.fromEntries(Object.entries(e.files).filter(([k]) => k !== '/etc/os-release')), ...ETC_OS_ALPINE },
    tools: [...new Set([...BUSYBOX_TOOLS, ...e.tools.filter((t) => !DEBIAN_TOOLS.includes(t))])],
    layers: [ALPINE_BASE, ...e.layers.slice(1)],
  });
}

export function lookupCatalog(ref: string): { entry: CatalogEntry; tag: string } | null {
  let r = ref.replace(/^docker\.io\//, '').replace(/^library\//, '');
  let tag = 'latest';
  const at = r.indexOf('@');
  if (at >= 0) r = r.slice(0, at);
  const colon = r.lastIndexOf(':');
  if (colon > r.lastIndexOf('/')) {
    tag = r.slice(colon + 1);
    r = r.slice(0, colon);
  }
  const entry = CATALOG[r];
  if (!entry || !entry.tags[tag]) return null;
  return { entry, tag };
}

export function splitRef(ref: string): { repo: string; tag: string } {
  const r = ref.replace(/^docker\.io\//, '').replace(/^library\//, '');
  const colon = r.lastIndexOf(':');
  if (colon > r.lastIndexOf('/')) return { repo: r.slice(0, colon), tag: r.slice(colon + 1) };
  return { repo: r, tag: 'latest' };
}
