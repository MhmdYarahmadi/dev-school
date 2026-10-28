/**
 * The design model: what learners build on the canvas (or write as YAML),
 * plus the traffic and the scenario (failures over time) it is tested with.
 * Every field has a documented default in defaults.ts, so a design only
 * states what matters for the lesson.
 */

export type NodeKind =
  | 'client'
  | 'cdn'
  | 'ratelimiter'
  | 'lb'
  | 'app'
  | 'cache'
  | 'db'
  | 'queue'
  | 'worker'
  | 'objectstore'
  | 'external';

export type Size = 'small' | 'medium' | 'large' | 'xlarge';

/** Service-time distribution: exponential by default (classic queueing), or fixed, or log-normal. */
export type Dist = 'exp' | 'const' | 'lognormal';

/** Settings on a connection (edge) from the caller's side. */
export interface EdgePolicy {
  /** Give up after this many ms (default: none, except the client's 30 s). */
  timeoutMs?: number;
  /** Extra attempts after a failure or timeout (default 0). */
  retries?: number;
  /** Wait before retry n: backoffMs × 2^(n-1) (default 0 = immediately). */
  backoffMs?: number;
  /** Randomise each backoff between 0 and its value ("full jitter"). */
  jitter?: boolean;
  /** Circuit breaker: open after `failures` consecutive failures, try again after `resetMs`. */
  breaker?: { failures: number; resetMs: number };
  /** Bulkhead: at most this many calls in flight per calling instance; more fail fast. */
  maxConcurrent?: number;
  /** A failure here doesn't fail the request (graceful degradation, e.g. recommendations). */
  optional?: boolean;
}

export interface Edge extends EdgePolicy {
  from: string;
  to: string;
}

interface Base {
  id: string;
  label?: string;
  /** Availability zones the instances are spread over, e.g. ['a', 'b']. Default ['a']. */
  azs?: string[];
  /** Random failures: mean time between failures / to repair, per instance (ms). */
  mtbfMs?: number;
  mttrMs?: number;
}

export interface ClientNode extends Base {
  kind: 'client';
}

export interface CdnNode extends Base {
  kind: 'cdn';
  /** Objects the edge cache can hold (default 10 000). */
  capacity?: number;
  ttlMs?: number;
  /** Also cache API reads (not just static files). Default false. */
  cacheReads?: boolean;
}

export interface RateLimiterNode extends Base {
  kind: 'ratelimiter';
  /** Tokens per second. */
  rate: number;
  /** Bucket size (default = rate, i.e. one second of burst). */
  burst?: number;
  /** One bucket for everyone, or one per user. Default 'global'. */
  per?: 'global' | 'user';
}

export interface LbNode extends Base {
  kind: 'lb';
  algorithm?: 'round_robin' | 'least_conn' | 'random' | 'sticky';
  /** Health checks every intervalMs; a backend is taken out after `unhealthy` failed checks. */
  healthCheck?: { intervalMs?: number; unhealthy?: number } | false;
}

export interface AppNode extends Base {
  kind: 'app';
  instances?: number;
  size?: Size;
  /** Worker threads per instance (default 2 × cores … see defaults). */
  threads?: number;
  /** Requests waiting for a thread, per instance, before new ones get 503. */
  maxQueue?: number;
  /** Mean CPU time per request (ms). */
  cpuMs?: number;
  dist?: Dist;
  /** Where sessions live. 'local' + a non-sticky LB logs users out. Default 'none' (stateless). */
  sessions?: 'none' | 'local' | 'shared';
  /** Read from the primary, the replicas, or both (default: replicas when there are any). */
  readFrom?: 'primary' | 'replicas';
  /** What a write does to the cache. Default 'invalidate'. */
  cacheOnWrite?: 'invalidate' | 'write_through' | 'write_back' | 'none';
  /** Only one DB read per key at a time per instance; others wait for it (request coalescing). */
  singleFlight?: boolean;
  /** Writes go onto the queue instead of the DB (the API answers 202 Accepted). */
  writeVia?: 'db' | 'queue';
  /** DB connections per instance (default 10). */
  dbPool?: number;
  /** Fraction of requests that call the external API (default 1 when connected). */
  externalRatio?: number;
  autoscale?: { min: number; max: number; targetCpu?: number; bootMs?: number; intervalMs?: number; cooldownMs?: number };
}

export interface CacheNode extends Base {
  kind: 'cache';
  /** Memory per cache node in MB. */
  memoryMb?: number;
  /** Cache nodes; keys are spread across them by hash. Default 1. */
  instances?: number;
  ttlMs?: number;
  /** Mean time per operation (ms, default 0.02: one thread, ~50k ops/s). */
  opMs?: number;
  /** Write-back: how long a write may sit in the cache before it is flushed to the DB. */
  flushMs?: number;
}

export interface DbNode extends Base {
  kind: 'db';
  size?: Size;
  /** Read replicas per shard. */
  replicas?: number;
  /** Shards (each a primary plus its replicas). Default 1. */
  shards?: number;
  shardBy?: 'key' | 'user';
  partitioning?: 'hash' | 'range' | 'consistent';
  /** Mean ms of work per read and write (default by size). */
  readMs?: number;
  writeMs?: number;
  dist?: Dist;
  /** Max connections per DB instance (default by size). */
  maxConnections?: number;
  /** Mean replication delay (ms). */
  replicationLagMs?: number;
  /** Writes a replica can apply per second (single-threaded apply, default 5000). */
  replicaApplyRate?: number;
  /** Replicas that must confirm a write before it is acknowledged (semi-sync). Default 0 (async). */
  syncReplicas?: number;
  /** Promote a replica automatically when the primary dies, after this many ms. */
  failoverMs?: number;
  /** Leaderless quorum replication instead of a leader: n copies, w acks, r reads. */
  quorum?: { n: number; w: number; r: number };
}

export interface QueueNode extends Base {
  kind: 'queue';
  /** 'queue': consumers share the messages. 'topic': every subscriber gets each message. */
  mode?: 'queue' | 'topic';
  maxBacklog?: number;
  visibilityTimeoutMs?: number;
  /** After this many failed deliveries, a message goes to the dead-letter queue (if enabled). */
  maxReceives?: number;
  dlq?: boolean;
}

export interface WorkerNode extends Base {
  kind: 'worker';
  instances?: number;
  /** Messages processed at once per instance. */
  concurrency?: number;
  /** Mean CPU ms per message. */
  cpuMs?: number;
  dist?: Dist;
  /** DB writes per message (fan-out). Default 1. */
  fanout?: number;
  /** Deduplicate by message id so a redelivered message has no second effect. */
  idempotent?: boolean;
  autoscale?: { min: number; max: number; targetBacklog?: number; bootMs?: number; intervalMs?: number; cooldownMs?: number };
}

export interface ObjectStoreNode extends Base {
  kind: 'objectstore';
  latencyMs?: number;
}

export interface ExternalNode extends Base {
  kind: 'external';
  latencyMs?: number;
  /** Fraction of calls that fail (0–1). */
  failRate?: number;
  /** Calls per second it accepts before answering 429. */
  rateLimit?: number;
  /** US$ per million calls (default 5, a paid API); 0 for a service of your own. */
  pricePerMillion?: number;
}

export type DesignNode =
  | ClientNode
  | CdnNode
  | RateLimiterNode
  | LbNode
  | AppNode
  | CacheNode
  | DbNode
  | QueueNode
  | WorkerNode
  | ObjectStoreNode
  | ExternalNode;

/** Requests per second over time: a list of [atMs, rps] points, linearly interpolated. */
export type RateCurve = [number, number][];

export interface Traffic {
  /** Constant rate, or a curve. */
  rps: number | RateCurve;
  /** Share of each operation (default: 90% read, 10% write). */
  mix?: { read?: number; write?: number; static?: number; query?: number };
  /** Distinct keys (items) and how skewed their popularity is (Zipf s; 0 = uniform). */
  keys?: number;
  skew?: number;
  /** New writes create new keys in order (like auto-increment ids or timestamps) instead of updating popular ones. */
  sequentialWrites?: boolean;
  users?: number;
  /** After a write, this share of users read the same item back shortly after (default 0). */
  readAfterWrite?: number;
  /** Network round trip between the users and your system (ms, default 40). */
  rttMs?: number;
  /** The client's own policy: timeout (default 30 000 ms), retries… */
  client?: EdgePolicy;
  /** Share of queued messages that always fail (poison). */
  poisonRate?: number;
  /** One key gets this share of all reads from `hotKey.fromMs` (a viral item / celebrity). */
  hotKey?: { share: number; fromMs?: number; toMs?: number };
  /**
   * One misbehaving client (a scraper, a runaway script) sends this share of all requests from `fromMs`.
   * Its requests load the system but aren't counted in the results, which measure your real users.
   */
  abuser?: { share: number; fromMs?: number; toMs?: number };
  /** Average response/object sizes (KB) for bandwidth and CDN cost. */
  readKb?: number;
  staticKb?: number;
}

export type ScenarioAction =
  | { action: 'kill'; node: string; instance?: number }
  | { action: 'hang'; node: string; instance?: number }
  | { action: 'restore'; node: string; instance?: number }
  | { action: 'slow'; node: string; factor: number }
  | { action: 'flush'; node: string }
  | { action: 'azDown'; az: string }
  | { action: 'azUp'; az: string }
  | { action: 'partition'; a: string; b: string }
  | { action: 'heal' }
  | { action: 'failRate'; node: string; rate: number }
  | { action: 'scale'; node: string; instances: number }
  | { action: 'addShard'; node: string };

export type ScenarioEvent = ScenarioAction & { atMs: number };

export interface Phase {
  name: string;
  fromMs: number;
  toMs: number;
}

export interface Design {
  nodes: DesignNode[];
  edges: Edge[];
}

export interface RunSpec {
  design: Design;
  traffic: Traffic;
  durationMs: number;
  /** Stats ignore requests that start before this (warm-up). */
  warmupMs?: number;
  events?: ScenarioEvent[];
  phases?: Phase[];
  seed?: number;
  /** Fill caches with the most popular keys before starting. */
  warmCache?: boolean;
  /** Messages already waiting on each queue at the start. */
  backlog?: Record<string, number>;
}
