/**
 * What the settings panel shows for each component and connection: a short explanation
 * of every setting and its default (from engine/defaults.ts), so the canvas teaches too.
 */
import { DEFAULTS, type NodeKind } from '../engine';

export interface FieldInfo {
  help: string;
  /** Shown as the placeholder when the setting is left at its default. */
  def?: string;
  /** Sub-settings of a group (autoscale, quorum…). */
  sub?: Record<string, { help: string; def?: string }>;
}

const D = DEFAULTS;

export const ICONS: Record<NodeKind, string> = {
  client: '👥',
  cdn: '🌍',
  ratelimiter: '🚦',
  lb: '⚖️',
  app: '🖥️',
  cache: '⚡',
  db: '🗄️',
  queue: '📬',
  worker: '⚙️',
  objectstore: '🪣',
  external: '🔌',
};

export const KIND_HELP: Record<NodeKind, string> = {
  client: 'Where the traffic comes from: your users’ browsers and apps.',
  cdn: 'Edge servers near users that cache static files (and optionally API reads).',
  ratelimiter: 'Lets through a set rate of requests (a token bucket) and rejects the rest with 429.',
  lb: 'Spreads requests over app server instances and stops sending to unhealthy ones.',
  app: 'Your service: instances with threads and CPU that handle requests.',
  cache: 'An in-memory key-value store (like Redis) in front of the database.',
  db: 'The database: a primary for writes, optional read replicas, optional shards.',
  queue: 'A message broker: producers add messages, workers take them later.',
  worker: 'Background consumers that process messages from a queue.',
  objectstore: 'File/blob storage (like S3): large objects, slower than a cache.',
  external: 'A third-party API you call: its own latency, failures and rate limit.',
};

const COMMON: Record<string, FieldInfo> = {
  label: { help: 'A display name.' },
  azs: { help: 'Availability zones the instances are spread over, e.g. a, b. Losing one zone then leaves the others.', def: 'a' },
  mtbfMs: { help: 'Random crashes: mean time between failures per instance (ms).', def: 'never' },
  mttrMs: { help: 'How long a crashed instance takes to come back (ms).', def: '—' },
};

const AUTOSCALE_APP = {
  min: { help: 'Fewest instances.' },
  max: { help: 'Most instances.' },
  targetCpu: { help: 'Add instances above this CPU use (0–1).', def: String(D.autoscale.targetCpu) },
  bootMs: { help: 'Time for a new instance to start serving (ms).', def: String(D.autoscale.bootMs) },
};

export const FIELD_INFO: Record<NodeKind, Record<string, FieldInfo>> = {
  client: {},
  cdn: {
    capacity: { help: 'Objects each edge can hold.', def: String(D.cdn.capacity) },
    ttlMs: { help: 'How long a cached object stays fresh (ms).', def: '1 hour' },
    cacheReads: { help: 'Also cache API reads, not only static files.', def: 'false' },
  },
  ratelimiter: {
    rate: { help: 'Requests let through per second.' },
    burst: { help: 'Bucket size: how many can pass at once after a quiet spell.', def: 'same as rate' },
    per: { help: 'One bucket for everyone, or one per user.', def: 'global' },
  },
  lb: {
    algorithm: { help: 'How a server is chosen: in turn, the least busy, at random, or always the same one per user (sticky).', def: 'round_robin' },
    healthCheck: { help: 'Probe each server; take it out after failed checks.', def: 'every 5 s, 2 failures', sub: { intervalMs: { help: 'Time between checks (ms).', def: String(D.lb.healthInterval) }, unhealthy: { help: 'Failed checks before a server is taken out.', def: String(D.lb.unhealthy) } } },
  },
  app: {
    instances: { help: 'Servers running the service.', def: '1' },
    size: { help: 'Machine size: small 2 cores, medium 4, large 8, xlarge 16.', def: 'small' },
    threads: { help: 'Requests handled at once per instance.', def: `${D.app.threadsPerCore} × cores` },
    maxQueue: { help: 'Requests that may wait for a thread; more get 503.', def: String(D.app.maxQueue) },
    cpuMs: { help: 'CPU time per request (ms).', def: String(D.app.cpuMs) },
    dist: { help: 'How much request times vary: exponential (realistic), constant, or log-normal (long tail).', def: 'exp' },
    sessions: { help: 'Where login sessions live: none (stateless), in each server\'s memory (local), or a shared store.', def: 'none' },
    readFrom: { help: 'Read from the primary database or from its replicas.', def: 'replicas, when there are any' },
    cacheOnWrite: { help: 'What a write does to the cache: delete the key (invalidate), update it (write-through), write only the cache and flush later (write-back), or nothing.', def: 'invalidate' },
    singleFlight: { help: 'Only one database read per key at a time; others wait for its answer (stops a cache stampede).', def: 'false' },
    writeVia: { help: 'Writes go to the database, or onto a queue (answered 202 Accepted, done later).', def: 'db' },
    dbPool: { help: 'Database connections each instance keeps open.', def: String(D.app.dbPool) },
    externalRatio: { help: 'Share of requests that call the external API (0–1).', def: '1' },
    autoscale: { help: 'Add and remove instances with load.', sub: AUTOSCALE_APP },
  },
  cache: {
    memoryMb: { help: 'Memory per cache node (MB). An item is about 1 KB.', def: String(D.cache.memoryMb) },
    instances: { help: 'Cache nodes; keys are spread across them.', def: '1' },
    ttlMs: { help: 'Items expire after this long (ms).', def: 'never' },
    opMs: { help: 'Time per operation (ms).', def: String(D.cache.opMs) },
    flushMs: { help: 'Write-back: longest time a write waits in the cache before reaching the database (ms).', def: String(D.cache.flushMs) },
  },
  db: {
    size: { help: 'Machine size: bigger is faster and accepts more connections (50/100/200/400).', def: 'small' },
    replicas: { help: 'Read replicas per shard: copies that serve reads, a little behind.', def: '0' },
    shards: { help: 'Split the data over this many primaries.', def: '1' },
    shardBy: { help: 'Shard key: the item\'s key, or the user who owns it.', def: 'key' },
    partitioning: { help: 'How keys map to shards: hash mod N, ranges of keys, or consistent hashing (a ring).', def: 'hash' },
    readMs: { help: 'Work per read on a small machine (ms).', def: String(D.db.readMs) },
    writeMs: { help: 'Work per write on a small machine (ms).', def: String(D.db.writeMs) },
    dist: { help: 'How much query times vary.', def: 'exp' },
    maxConnections: { help: 'Connections accepted per database instance.', def: 'by size' },
    replicationLagMs: { help: 'Typical delay before a replica has a write (ms).', def: String(D.db.replicationLagMs) },
    replicaApplyRate: { help: 'Writes per second a replica can apply.', def: String(D.db.replicaApplyRate) },
    syncReplicas: { help: 'Replicas that must confirm each write before it counts (semi-synchronous).', def: '0' },
    failoverMs: { help: 'Promote a replica automatically this long after the primary dies (ms).', def: 'no automatic failover' },
    quorum: { help: 'Leaderless replication: n copies, a write needs w acks, a read asks r copies.', sub: { n: { help: 'Copies of each item.' }, w: { help: 'Acks a write waits for.' }, r: { help: 'Copies a read asks.' } } },
  },
  queue: {
    mode: { help: 'queue: workers share the messages. topic: every subscriber gets each one.', def: 'queue' },
    maxBacklog: { help: 'Messages it can hold; more are rejected.', def: '1,000,000' },
    visibilityTimeoutMs: { help: 'If a worker doesn\'t finish within this time, the message is delivered again (ms).', def: String(D.queue.visibilityTimeoutMs) },
    maxReceives: { help: 'Deliveries before a failing message goes to the dead-letter queue.', def: String(D.queue.maxReceives) },
    dlq: { help: 'Move messages that keep failing to a dead-letter queue.', def: 'false' },
  },
  worker: {
    instances: { help: 'Worker processes.', def: '1' },
    concurrency: { help: 'Messages each instance works on at once. Each worker has 2 CPU cores, so more helps while messages wait on the database or an API.', def: String(D.worker.concurrency) },
    cpuMs: { help: 'CPU time per message (ms).', def: String(D.worker.cpuMs) },
    dist: { help: 'How much processing times vary.', def: 'exp' },
    fanout: { help: 'Database writes per message.', def: '1' },
    idempotent: { help: 'Processing a message twice has no second effect.', def: 'false' },
    autoscale: { help: 'Add and remove workers with the backlog.', sub: { min: { help: 'Fewest instances.' }, max: { help: 'Most instances.' }, targetBacklog: { help: 'Messages waiting per instance before adding one.' }, bootMs: { help: 'Start-up time (ms).', def: String(D.autoscale.bootMs) } } },
  },
  objectstore: { latencyMs: { help: 'Time per request (ms).', def: String(D.objectstore.latencyMs) } },
  external: {
    latencyMs: { help: 'Its response time (ms).', def: String(D.external.latencyMs) },
    failRate: { help: 'Share of calls that fail (0–1).', def: '0' },
    rateLimit: { help: 'Calls per second it accepts before answering 429.', def: 'none' },
    pricePerMillion: { help: 'US$ per million calls: a paid API bills each one; 0 for a service of your own.', def: '5' },
  },
};

export const COMMON_INFO = COMMON;

export const EDGE_INFO: Record<string, FieldInfo> = {
  timeoutMs: { help: 'Give up on a call after this long (ms).', def: 'none (users give up at 30 s)' },
  retries: { help: 'Extra attempts after a failure or timeout.', def: '0' },
  backoffMs: { help: 'Wait before retrying; doubles each time (ms).', def: '0: retry at once' },
  jitter: { help: 'Randomise each wait so callers don\'t retry in sync.', def: 'false' },
  breaker: { help: 'Circuit breaker: after N failures in a row, fail fast for a while.', sub: { failures: { help: 'Consecutive failures that open it.' }, resetMs: { help: 'Time before trying again (ms).' } } },
  maxConcurrent: { help: 'Bulkhead: calls in flight per caller instance; more fail fast.', def: 'no limit' },
  optional: { help: 'A failure here doesn\'t fail the request (graceful degradation).', def: 'false' },
};

/** Settings a new component starts with (only what's required). */
export const NEW_NODE: Partial<Record<NodeKind, Record<string, unknown>>> = {
  ratelimiter: { rate: 100 },
};
