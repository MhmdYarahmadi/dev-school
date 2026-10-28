/** Data model of the simulated Docker engine. Pure data: easy to snapshot and compare. */

/** What a container's main process does once started. */
export type Behavior =
  | { kind: 'server'; port?: number; response?: string; stopExit?: number } // runs until stopped
  | { kind: 'shell' } // interactive shell: exits 0 immediately without -it
  | { kind: 'oneshot'; output: string[]; exitCode?: number } // prints and exits
  | { kind: 'sleep'; stopExit?: number }; // `sleep N` and friends (PID 1 ignores SIGTERM → 137)

export interface ImageConfig {
  cmd: string[];
  entrypoint: string[];
  workdir: string;
  user: string;
  env: string[];
  exposed: number[];
  healthcheck?: string;
  /** VOLUME paths: each run gets an anonymous volume there unless something else is mounted. */
  volumes?: string[];
}

export interface Layer {
  createdBy: string;
  size: number; // MB
}

export interface Image {
  id: string; // 64 hex chars
  repo: string;
  tags: string[]; // e.g. ['latest', '1.27']
  size: number; // MB, total
  layers: Layer[];
  config: ImageConfig;
  /** Files inside the image: absolute path → content. */
  files: Record<string, string>;
  created: number;
  /** Set for images built from a Dockerfile (the build cache key of the final layer). */
  buildKey?: string;
  /** Catalog image this came from (built images: their base). Decides tools/OS family. */
  origin: string;
  /** Content size in MB (the "CONTENT SIZE" column). */
  contentSize: number;
}

export interface PortBinding {
  hostIp: string; // '0.0.0.0'
  hostPort: number;
  containerPort: number;
  proto: 'tcp' | 'udp';
}

export interface Mount {
  type: 'volume' | 'bind';
  source: string; // volume name, or host path relative to the project
  target: string;
  readOnly: boolean;
  /** Created for this container (`-v /path` or an image VOLUME): removed by --rm and rm -v. */
  anonymous?: boolean;
}

export type ContainerStatus = 'created' | 'running' | 'exited' | 'restarting';
export type RestartPolicy = 'no' | 'always' | 'unless-stopped' | 'on-failure';

export interface Container {
  id: string;
  name: string;
  image: string; // reference as given, e.g. 'nginx' or 'myapp:1.0'
  imageId: string;
  cmd: string[]; // effective command
  status: ContainerStatus;
  exitCode: number | null;
  ports: PortBinding[];
  mounts: Mount[];
  networks: string[];
  /** IP address on each network the container is attached to. */
  ips: Record<string, string>;
  /** Extra DNS names on user-defined networks (Compose service names). */
  aliases: string[];
  env: string[];
  workdir: string;
  user: string;
  restart: RestartPolicy;
  /** on-failure:N limit (0 = unlimited). */
  maxRetries: number;
  restartCount: number;
  /** Healthcheck command (shell form), if any. */
  healthcheck?: string;
  /** Consecutive failed health checks. */
  failingStreak?: number;
  /** --memory limit in bytes (0 = none) and --cpus in billionths of a CPU. */
  memory: number;
  nanoCpus: number;
  /** Memory the main process uses (MiB), and whether the kernel killed it for exceeding the limit. */
  memUsage?: number;
  oomKilled?: boolean;
  /** Crash loop under a restart policy: when it began, the count then, and the logs each attempt repeats. */
  loop?: { since: number; base: number; logs: string[] };
  autoRemove: boolean;
  /** --init: a tiny init process is PID 1 and forwards signals to the app. */
  init?: boolean;
  /** Docker picked the name (no --name). */
  autoNamed?: boolean;
  /** Started with `docker run` without -d (the terminal is attached to it). */
  attached?: boolean;
  tty: boolean;
  interactive: boolean;
  created: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Writes made inside the container (its writable layer): path → content. */
  rootfs: Record<string, string>;
  logs: string[];
  health?: 'starting' | 'healthy' | 'unhealthy';
  labels: Record<string, string>;
  /** Set when the container was stopped by `docker stop` (affects unless-stopped). */
  manuallyStopped: boolean;
  /** Runtime of the main process (derived when the container starts). */
  proc: Proc | null;
}

/** What the container's main process is doing right now. */
export type Proc =
  | { kind: 'server'; port: number; docroot?: string; response?: string; listing?: string; kv?: Record<string, string>; /** A Node/Python app: as PID 1 it ignores SIGTERM (no handler). */ app?: boolean }
  | { kind: 'idle' } // runs until stopped, serves nothing (sleep infinity, tail -f, interactive shell)
  | { kind: 'timer'; until: number }; // `sleep N`: exits 0 at `until`

export interface Volume {
  name: string;
  files: Record<string, string>;
  created: number;
  labels: Record<string, string>;
}

export interface Network {
  name: string;
  id: string;
  driver: 'bridge' | 'host' | 'null';
  builtIn: boolean;
  labels: Record<string, string>;
  /** Second octet of the 172.x.0.0/16 subnet, and the next host number to hand out. */
  subnet: number;
  nextHost: number;
  created: number;
}

export interface EngineState {
  images: Image[];
  containers: Container[];
  volumes: Volume[];
  networks: Network[];
  /** The learner's project folder on the "host": relative path → content. */
  files: Record<string, string>;
  /** Build cache: keys of layers built before (for CACHED lines). */
  buildCache: string[];
}

export type LineKind = 'out' | 'err' | 'dim' | 'ok' | 'info';

export interface Line {
  text: string;
  kind: LineKind;
}

export interface ExecResult {
  lines: Line[];
  exitCode: number;
}
