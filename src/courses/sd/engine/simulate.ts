/**
 * Runs a design under traffic and a scenario, request by request.
 *
 * Every request is a process that walks the graph (client → … → database) and
 * competes for real, finite resources on the way: worker threads, CPU cores,
 * DB connections and DB work slots, a single-threaded cache, a replica's apply
 * thread. Queueing, timeouts, retries, stale reads and lost writes are not
 * scripted: they emerge from those mechanics. tests/sd-theory.test.ts checks
 * the results against queueing theory.
 */
import { DEFAULTS, MONTH_MS, NET, PRICES, SIZES } from './defaults';
import { Resource, Signal, Sim, type Proc } from './kernel';
import { Rng, hash32, zipf, type Zipf } from './rng';
import type {
  AppNode,
  CacheNode,
  CdnNode,
  DbNode,
  DesignNode,
  Dist,
  Edge,
  EdgePolicy,
  ExternalNode,
  LbNode,
  NodeKind,
  QueueNode,
  RateLimiterNode,
  RunSpec,
  ScenarioEvent,
  Traffic,
  WorkerNode,
} from './types';
import { validateDesign } from './validate';

// ------------------------------------------------------------------ results

export interface NodeStats {
  kind: NodeKind;
  label: string;
  /** Instances at the end (and the most at any time). */
  instances: number;
  maxInstances: number;
  /** Busy share of the main resource (CPU, DB work slots, cache thread) over the measured window, 0–1. */
  utilisation: number;
  /** The busiest single instance (hot spots). */
  maxInstanceUtilisation: number;
  /** Average and largest number waiting. */
  avgQueue: number;
  maxQueue: number;
  handled: number;
  /** Errors that started here (by type). */
  errors: Record<string, number>;
  /** Share of time at least one instance was up. */
  uptime: number;
  hits?: number;
  misses?: number;
  /** DB: open connections at the end / limit. */
  connections?: number;
  maxConnections?: number;
  /** Queue: messages waiting at the end, the most waiting, dead-lettered. */
  backlog?: number;
  maxBacklog?: number;
  dlq?: number;
  /** Replica lag at the end (ms, the worst replica). */
  replicaLagMs?: number;
}

export interface WindowStats {
  requests: number;
  ok: number;
  errors: number;
  /** 0–1 */
  errorRate: number;
  availability: number;
  /** Successful requests per second. */
  throughput: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  max: number;
  staleReads: number;
  rywViolations: number;
  degraded: number;
  byError: Record<string, number>;
}

export interface SeriesPoint {
  t: number;
  rps: number;
  errRate: number;
  p50: number;
  p99: number;
  backlog: number;
  instances: number;
  hitRatio: number | null;
}

export interface SimResult extends WindowStats {
  durationMs: number;
  measuredMs: number;
  /** Invalid designs don't run: these explain why. */
  invalid?: string[];
  warnings: string[];
  cache: { hits: number; misses: number; hitRatio: number | null };
  cdn: { hits: number; misses: number; hitRatio: number | null };
  lostWrites: number;
  duplicates: number;
  dlq: number;
  messages: { done: number; p50: number; p99: number; maxBacklog: number; finalBacklog: number; drainedAtMs: number | null };
  keysMoved: number;
  nodes: Record<string, NodeStats>;
  edges: Record<string, { calls: number; failures: number }>;
  cost: { monthly: number; byNode: Record<string, number> };
  phases: Record<string, WindowStats>;
  series: SeriesPoint[];
  events: number;
  /** Stats over any window of the run (ms from the start). */
  window(fromMs: number, toMs: number): WindowStats;
}

// ------------------------------------------------------------------ runtime model

type Op = 'read' | 'write' | 'static' | 'query';

interface Req {
  op: Op;
  key: number;
  user: number;
  /** Newest version acknowledged to any client before this request started (for stale-read detection). */
  fresh: number;
  /** The version this user wrote and read back (read-after-write). */
  ryw: number;
  /** Write-back: the version assigned by the cache. */
  ver?: number;
}

interface Resp {
  ok: boolean;
  err?: string;
  at?: string;
  ver?: number;
  hit?: boolean;
  degraded?: boolean;
}

const OK: Resp = { ok: true };
const fail = (err: string, at: string): Resp => ({ ok: false, err, at });
const NEVER = new Signal<any>();
const RETRYABLE = new Set(['overloaded', 'refused', 'timeout', 'reset', 'unavailable', 'external_error', 'too_many_connections', 'no_backend', 'no_quorum', 'queue_full']);

type State = 'up' | 'down' | 'hung' | 'booting' | 'retired';

interface LruEntry {
  key: number;
  ver: number;
  exp: number;
  prev: LruEntry | null;
  next: LruEntry | null;
}

/** Least-recently-used cache: a map plus a linked list, so a hit only moves pointers (no map churn on hot keys). */
class Lru {
  private map = new Map<number, LruEntry>();
  /** Least recently used first. */
  private head: LruEntry | null = null;
  private tail: LruEntry | null = null;
  constructor(public cap: number) {}
  get(k: number, now: number): { ver: number; exp: number } | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp <= now) {
      this.delete(k);
      return undefined;
    }
    if (e !== this.tail) {
      this.unlink(e);
      this.append(e);
    }
    return e;
  }
  set(k: number, ver: number, exp: number): void {
    const e = this.map.get(k);
    if (e) {
      e.ver = ver;
      e.exp = exp;
      if (e !== this.tail) {
        this.unlink(e);
        this.append(e);
      }
      return;
    }
    const n: LruEntry = { key: k, ver, exp, prev: null, next: null };
    this.map.set(k, n);
    this.append(n);
    while (this.map.size > this.cap && this.head) this.delete(this.head.key);
  }
  delete(k: number): void {
    const e = this.map.get(k);
    if (!e) return;
    this.map.delete(k);
    this.unlink(e);
  }
  clear(): void {
    this.map.clear();
    this.head = this.tail = null;
  }
  private unlink(e: LruEntry): void {
    if (e.prev) e.prev.next = e.next;
    else this.head = e.next;
    if (e.next) e.next.prev = e.prev;
    else this.tail = e.prev;
    e.prev = e.next = null;
  }
  private append(e: LruEntry): void {
    e.prev = this.tail;
    if (this.tail) this.tail.next = e;
    else this.head = e;
    this.tail = e;
  }
}

class Inst {
  state: State = 'up';
  active = 0;
  /** app/worker: threads and cores; db/cache/external: work slots in `cores`. */
  threads!: Resource;
  cores!: Resource;
  pool?: Resource;
  conns = new Map<Inst, { open: number; inUse: number }>();
  connsIn = 0;
  store?: Map<number, number>;
  lru?: Lru;
  dirty?: Map<number, number>;
  applier?: Resource;
  inflight?: Map<number, Signal<Resp>>;
  bulk?: Map<Edge, number>;
  role: 'primary' | 'replica' | 'peer' | 'none' = 'none';
  shard = 0;
  killedByAz = false;
  needsResync = false;
  /** Bumped when the instance dies: replication still in flight from it is lost. */
  epoch = 0;
  /** Replica: writes shipped but not applied yet (seq → commit time), for lag. */
  pending = new Map<number, number>();
  lastLag = 0;
  streamT = 0;
  appliedSeq = 0;
  upSince = 0;
  upTime = 0;
  bornAt: number;
  diedAt: number | null = null;
  baseline = { busy: 0, queue: 0 };
  /** Consumers waiting for the instance to come back. */
  wake: Signal<void>[] = [];
  constructor(
    public g: Group,
    public idx: number,
    public az: string,
    now: number,
  ) {
    this.bornAt = now;
    this.upSince = now;
  }
  get id(): string {
    return `${this.g.id}#${this.idx}`;
  }
}

interface Shard {
  primary: Inst | null;
  replicas: Inst[];
  peers: Inst[];
  failoverAt: number | null;
}

interface Msg {
  id: number;
  key: number;
  user: number;
  poison: boolean;
  receives: number;
  tEnq: number;
  receipt: number;
}

/** A line of messages; competing consumer groups share one, topic subscribers each get their own. */
interface Box {
  ready: Msg[];
  head: number;
  inflight: Map<number, Msg>;
  waiters: Signal<Msg | null>[];
}

interface Sub {
  worker: Group;
  box: Box;
}

class Group {
  insts: Inst[] = [];
  out: Edge[] = [];
  rr = 0;
  /** Separate counter for choosing which of this group's own instances takes a call (vs. rr for its backends). */
  pick = 0;
  slow = 1;
  failRate = 0;
  handled = 0;
  errors: Record<string, number> = {};
  health = new Map<Inst, { fails: number; healthy: boolean }>();
  shards: Shard[] = [];
  /** Workers: times each message's side effect happened (per consumer group: every topic subscriber does its own). */
  effects = new Map<number, number>();
  /** Token bucket(s). */
  tokens = 0;
  lastRefill = 0;
  buckets = new Map<number, { tokens: number; last: number }>();
  subs: Sub[] = [];
  dlq = 0;
  hits = 0;
  misses = 0;
  maxBacklog = 0;
  lastScale = -Infinity;
  upCount = 0;
  anyUpArea = 0;
  lastUpT = 0;
  ring: { pos: number; shard: number }[] = [];
  constructor(
    public node: DesignNode,
    public rng: Rng,
  ) {}
  get id(): string {
    return this.node.id;
  }
  get kind(): NodeKind {
    return this.node.kind;
  }
  live(): Inst[] {
    return this.insts.filter((i) => i.state !== 'retired');
  }
  edgesTo(kind: NodeKind): Edge[] {
    return this.out.filter((e) => this.world.groups.get(e.to)!.kind === kind);
  }
  world!: World;
}

interface World {
  sim: Sim;
  groups: Map<string, Group>;
  spec: RunSpec;
  traffic: Required<Pick<Traffic, 'keys' | 'skew' | 'users' | 'rttMs' | 'readKb' | 'staticKb'>> & Traffic;
}

// ------------------------------------------------------------------ the simulation

/** The simulator handles up to this many requests per run (about 2–3 s of work in a browser). */
export const MAX_REQUESTS = 400_000;

/** Average rate × duration: how many requests a run will make. */
export function expectedRequests(spec: Pick<RunSpec, 'traffic' | 'durationMs'>): number {
  const r = spec.traffic.rps;
  const d = spec.durationMs;
  if (typeof r === 'number') return (r * d) / 1000;
  let area = 0;
  let prevT = 0;
  let prevV = r.length ? r[0][1] : 0;
  for (const [t, v] of r) {
    const t1 = Math.min(t, d);
    if (t1 > prevT) area += ((prevV + v) / 2) * (t1 - prevT);
    prevT = Math.max(prevT, t1);
    prevV = v;
  }
  if (d > prevT) area += prevV * (d - prevT);
  return area / 1000;
}

export function simulate(spec: RunSpec): SimResult {
  const invalid = validateDesign(spec.design);
  const n = expectedRequests(spec);
  if (n > MAX_REQUESTS) invalid.errors.push(`This run would make about ${Math.round(n).toLocaleString('en')} requests; the simulator handles up to ${MAX_REQUESTS.toLocaleString('en')}. Lower the rate or shorten the run.`);
  if (invalid.errors.length) return emptyResult(spec, invalid.errors, invalid.warnings);
  return new Runner(spec, invalid.warnings).run();
}

class Runner {
  sim = new Sim();
  rng: Rng;
  groups = new Map<string, Group>();
  world: World;
  t: World['traffic'];
  keyZipf: Zipf;
  // truth
  acked = new Map<number, number>();
  verCounter = new Map<number, number>();
  seenUsers = new Set<number>();
  sessionAt = new Map<number, Inst>();
  replSeq = 0;
  nextNewKey: number;
  lostWrites = 0;
  duplicates = 0;
  keysMoved = 0;
  partitions: [string, string][] = [];
  edgeStats = new Map<string, { calls: number; failures: number }>();
  breakers = new Map<string, { fails: number; openUntil: number; halfOpen: boolean }>();
  // per-request records
  n = 0;
  tStart = new Float64Array(1 << 14);
  lat = new Float32Array(1 << 14);
  flags = new Uint8Array(1 << 14); // 1 ok, 2 stale, 4 ryw violation, 8 degraded, 16 read-op, 32 hit
  errCode = new Uint16Array(1 << 14);
  errNames: string[] = [''];
  errIndex = new Map<string, number>();
  // messages
  msgSeq = 0;
  msgLat: number[] = [];
  drainedAt: number | null = null;
  series: { t: number; backlog: number; instances: number; hits: number; misses: number }[] = [];
  warmupMs: number;
  warnings: string[];
  measuredFrom = 0;
  cdnHits = 0;
  cdnMisses = 0;
  bytesOut = 0;
  bytesCdn = 0;
  queueOps = 0;
  objectGets = 0;

  constructor(
    public spec: RunSpec,
    warnings: string[],
  ) {
    this.warnings = [...warnings];
    this.rng = new Rng(spec.seed ?? 1);
    const tr = spec.traffic;
    this.t = {
      ...tr,
      keys: tr.keys ?? DEFAULTS.traffic.keys,
      skew: tr.skew ?? DEFAULTS.traffic.skew,
      users: tr.users ?? DEFAULTS.traffic.users,
      rttMs: tr.rttMs ?? NET.rtt,
      readKb: tr.readKb ?? DEFAULTS.traffic.readKb,
      staticKb: tr.staticKb ?? DEFAULTS.traffic.staticKb,
    };
    this.keyZipf = zipf(this.t.keys, this.t.skew);
    this.nextNewKey = this.t.keys;
    this.warmupMs = spec.warmupMs ?? 0;
    this.world = { sim: this.sim, groups: this.groups, spec, traffic: this.t };
    spec.design.nodes.forEach((node, i) => {
      const g = new Group(node, this.rng.fork(i + 1));
      g.world = this.world;
      this.groups.set(node.id, g);
    });
    for (const e of spec.design.edges) this.groups.get(e.from)!.out.push(e);
    for (const g of this.groups.values()) this.build(g);
  }

  // ---------------------------------------------------------------- construction

  private build(g: Group): void {
    const node = g.node;
    const azs = node.azs?.length ? node.azs : ['a'];
    const add = (idx: number) => {
      const inst = new Inst(g, idx, azs[idx % azs.length], this.sim.now);
      g.insts.push(inst);
      this.equip(inst);
      return inst;
    };
    switch (node.kind) {
      case 'app':
      case 'worker': {
        const n = node.autoscale ? Math.max(node.autoscale.min, node.instances ?? node.autoscale.min) : (node.instances ?? 1);
        for (let i = 0; i < n; i++) add(i);
        break;
      }
      case 'cache':
        for (let i = 0; i < (node.instances ?? 1); i++) add(i);
        break;
      case 'db': {
        const shards = node.shards ?? 1;
        let idx = 0;
        for (let s = 0; s < shards; s++) g.shards.push(this.makeShard(g, s, () => add(idx++)));
        this.buildRing(g);
        break;
      }
      case 'client': {
        const c = new Inst(g, 0, 'users', 0);
        this.equip(c);
        g.insts.push(c);
        break;
      }
      case 'lb':
      case 'ratelimiter':
        azs.forEach((_, i) => add(i));
        break;
      default:
        add(0);
    }
    if (node.kind === 'ratelimiter') g.tokens = node.burst ?? node.rate;
    if (node.kind === 'external' && node.rateLimit) g.tokens = node.rateLimit;
    g.upCount = g.insts.filter((i) => i.state === 'up').length;
  }

  private makeShard(g: Group, s: number, add: () => Inst): Shard {
    const node = g.node as DbNode;
    const shard: Shard = { primary: null, replicas: [], peers: [], failoverAt: null };
    if (node.quorum) {
      for (let i = 0; i < node.quorum.n; i++) {
        const p = add();
        p.role = 'peer';
        p.shard = s;
        shard.peers.push(p);
      }
    } else {
      const p = add();
      p.role = 'primary';
      p.shard = s;
      shard.primary = p;
      for (let i = 0; i < (node.replicas ?? 0); i++) {
        const r = add();
        r.role = 'replica';
        r.shard = s;
        shard.replicas.push(r);
      }
    }
    return shard;
  }

  /** Gives an instance its resources for its kind. */
  private equip(inst: Inst): void {
    const node = inst.g.node;
    const sim = this.sim;
    switch (node.kind) {
      case 'app': {
        const cores = SIZES[node.size ?? DEFAULTS.app.size].cores;
        inst.cores = new Resource(sim, cores);
        inst.threads = new Resource(sim, node.threads ?? cores * DEFAULTS.app.threadsPerCore, node.maxQueue ?? DEFAULTS.app.maxQueue);
        inst.pool = new Resource(sim, node.dbPool ?? DEFAULTS.app.dbPool);
        inst.inflight = new Map();
        break;
      }
      case 'worker': {
        // a worker is a small instance: its CPU is limited by its cores; concurrency is how many messages it works on at once (waiting on the DB or an API)
        const c = node.concurrency ?? DEFAULTS.worker.concurrency;
        inst.cores = new Resource(sim, SIZES.small.cores);
        inst.threads = new Resource(sim, c);
        inst.pool = new Resource(sim, c);
        break;
      }
      case 'db': {
        const sz = SIZES[node.size ?? DEFAULTS.db.size];
        inst.cores = new Resource(sim, sz.cores, DEFAULTS.db.maxQueue);
        inst.threads = inst.cores;
        inst.store = new Map();
        inst.applier = new Resource(sim, 1);
        break;
      }
      case 'cache': {
        inst.cores = new Resource(sim, 1, 100_000);
        inst.threads = inst.cores;
        const mem = node.memoryMb ?? DEFAULTS.cache.memoryMb;
        inst.lru = new Lru(Math.max(1, Math.floor((mem * 1024) / DEFAULTS.cache.itemKb)));
        inst.dirty = new Map();
        break;
      }
      case 'cdn':
        inst.lru = new Lru(node.capacity ?? DEFAULTS.cdn.capacity);
        inst.cores = new Resource(sim, Infinity);
        inst.threads = inst.cores;
        break;
      default:
        inst.cores = new Resource(sim, Infinity);
        inst.threads = inst.cores;
    }
    inst.bulk = new Map();
  }

  // ---------------------------------------------------------------- run

  run(): SimResult {
    const { sim, spec } = this;
    const dur = spec.durationMs;
    if (spec.warmCache) this.warmCaches();
    for (const [qid, count] of Object.entries(spec.backlog ?? {})) {
      const q = this.groups.get(qid);
      if (q?.kind === 'queue') for (let i = 0; i < count; i++) this.enqueueRaw(q, this.sampleKey('write'), this.rng.int(this.t.users));
    }
    this.startClients(dur);
    for (const g of this.groups.values()) {
      if (g.kind === 'lb') this.startHealthChecks(g);
      if (g.kind === 'worker') for (const inst of g.insts) this.startConsumers(inst);
      if ((g.kind === 'app' || g.kind === 'worker') && g.node.kind !== 'client' && (g.node as AppNode | WorkerNode).autoscale) this.startAutoscaler(g);
      if (g.node.mtbfMs && g.node.mttrMs) for (const inst of g.insts) this.startChaos(inst);
    }
    for (const ev of spec.events ?? []) sim.at(ev.atMs, () => this.apply(ev));
    // sampling for the time series
    const bucket = this.bucketMs();
    for (let t = 0; t < dur; t += bucket) {
      sim.at(t + bucket - 1e-6, () => this.sample(t));
    }
    if (this.warmupMs > 0) sim.at(this.warmupMs, () => this.snapshotBaselines());
    sim.run(dur);
    return this.result();
  }

  private bucketMs(): number {
    const d = this.spec.durationMs;
    return Math.max(1000, Math.ceil(d / 120 / 1000) * 1000);
  }

  private sample(t: number): void {
    let backlog = 0;
    let instances = 0;
    let hits = 0;
    let misses = 0;
    for (const g of this.groups.values()) {
      if (g.kind === 'queue') backlog += this.backlogOf(g);
      if (g.kind === 'app') instances += g.insts.filter((i) => i.state === 'up').length;
      if (g.kind === 'cache') {
        hits += g.hits;
        misses += g.misses;
      }
    }
    this.series.push({ t, backlog, instances, hits, misses });
  }

  private snapshotBaselines(): void {
    this.measuredFrom = this.sim.now;
    for (const g of this.groups.values()) {
      g.handled = 0;
      g.errors = {};
      g.hits = 0;
      g.misses = 0;
      this.touchUp(g);
      g.anyUpArea = 0;
      for (const inst of g.insts) {
        const s = inst.cores.stats();
        inst.baseline = { busy: s.busyArea, queue: inst.threads.stats().queueArea };
        this.closeUp(inst);
        inst.upTime = 0;
        inst.upSince = this.sim.now;
      }
    }
    this.cdnHits = this.cdnMisses = 0;
    this.edgeStats.clear();
    this.bytesOut = this.bytesCdn = this.queueOps = this.objectGets = 0;
  }

  private warmCaches(): void {
    for (const g of this.groups.values()) {
      if (g.kind !== 'cache' && g.kind !== 'cdn') continue;
      const ttl = (g.node as CacheNode).ttlMs ?? Infinity;
      for (const inst of g.insts) {
        const cap = inst.lru!.cap;
        // fill in reverse popularity so the hottest keys are the most recently used
        const n = Math.min(this.t.keys, g.kind === 'cache' ? cap * g.insts.length : cap);
        for (let r = n - 1; r >= 0; r--) {
          const key = this.keyOfRank(r);
          if (g.kind === 'cache' && this.cacheInst(g, key) !== inst) continue;
          if (g.kind === 'cdn') {
            inst.lru!.set(-1 - key, 0, ttl);
            if ((g.node as CdnNode).cacheReads) inst.lru!.set(key, 0, ttl);
          } else inst.lru!.set(key, 0, ttl);
        }
      }
    }
  }

  // ---------------------------------------------------------------- traffic

  private rateAt(t: number): number {
    const r = this.t.rps;
    if (typeof r === 'number') return r;
    if (!r.length) return 0;
    if (t <= r[0][0]) return r[0][1];
    for (let i = 1; i < r.length; i++) {
      if (t <= r[i][0]) {
        const [t0, v0] = r[i - 1];
        const [t1, v1] = r[i];
        return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
      }
    }
    return r[r.length - 1][1];
  }

  private startClients(dur: number): void {
    const client = [...this.groups.values()].find((g) => g.kind === 'client');
    if (!client) return;
    const r = this.t.rps;
    const maxRate = typeof r === 'number' ? r : Math.max(0, ...r.map((p) => p[1]));
    if (maxRate <= 0) return;
    const rng = client.rng;
    const meanGap = 1000 / maxRate;
    const next = () => {
      const t = this.sim.now;
      if (t >= dur) return;
      if (typeof r === 'number' || rng.next() * maxRate <= this.rateAt(t)) this.issue(client);
      this.sim.after(rng.exp(meanGap), next);
    };
    this.sim.at(rng.exp(meanGap), next);
  }

  private keyOfRank(rank: number): number {
    const n = this.t.keys;
    // a fixed permutation so popularity isn't tied to key order (range partitioning stays honest)
    return Number((BigInt(rank) * 2654435761n + 12345n) % BigInt(n));
  }

  private sampleKey(op: Op): number {
    const t = this.t;
    if (op === 'write' && t.sequentialWrites) return this.nextNewKey++;
    const hot = t.hotKey;
    if (hot && op !== 'write' && this.sim.now >= (hot.fromMs ?? 0) && this.sim.now < (hot.toMs ?? Infinity) && this.rng.next() < hot.share) return this.keyOfRank(0);
    return this.keyOfRank(this.keyZipf.sample(this.rng));
  }

  private pickOp(): Op {
    const m = this.t.mix ?? {};
    const parts: [Op, number][] = [
      ['read', m.read ?? (m.write !== undefined || m.static !== undefined || m.query !== undefined ? 0 : 0.9)],
      ['write', m.write ?? (m.read !== undefined || m.static !== undefined || m.query !== undefined ? 0 : 0.1)],
      ['static', m.static ?? 0],
      ['query', m.query ?? 0],
    ];
    const total = parts.reduce((s, p) => s + p[1], 0) || 1;
    let u = this.rng.next() * total;
    for (const [op, w] of parts) {
      if (u < w) return op;
      u -= w;
    }
    return 'read';
  }

  private issue(client: Group, forced?: { op: Op; key: number; user: number; ryw: number }): void {
    const op = forced?.op ?? this.pickOp();
    const key = forced?.key ?? this.sampleKey(op);
    const ab = this.t.abuser;
    const abusive = !forced && !!ab && this.sim.now >= (ab.fromMs ?? 0) && this.sim.now < (ab.toMs ?? Infinity) && this.rng.next() < ab.share;
    // the abuser is one extra user, outside the range of real users
    const user = forced?.user ?? (abusive ? this.t.users : this.rng.int(this.t.users));
    const req: Req = { op, key, user, fresh: this.acked.get(key) ?? 0, ryw: forced?.ryw ?? 0 };
    const t0 = this.sim.now;
    const edge = this.clientEdge(client, op);
    const policy: Edge = { timeoutMs: DEFAULTS.traffic.clientTimeoutMs, ...this.t.client, from: client.id, to: edge.to };
    this.sim.spawn(this.callEdge(client.insts[0], policy, req)).on((res) => this.record(t0, req, res, client));
  }

  private clientEdge(client: Group, op: Op): Edge {
    const outs = client.out;
    if (outs.length === 1) return outs[0];
    const cdn = outs.find((e) => this.groups.get(e.to)!.kind === 'cdn');
    const other = outs.find((e) => this.groups.get(e.to)!.kind !== 'cdn') ?? outs[0];
    if (cdn && (op === 'static' || (op === 'read' && (this.groups.get(cdn.to)!.node as CdnNode).cacheReads))) return cdn;
    return other;
  }

  private record(t0: number, req: Req, res: Resp, client: Group): void {
    const now = this.sim.now;
    // the misbehaving client's requests load the system, but the results describe real users
    if (req.user === this.t.users) return;
    if (t0 >= this.warmupMs) {
      if (this.n === this.tStart.length) this.grow();
      const i = this.n++;
      this.tStart[i] = t0;
      this.lat[i] = now - t0;
      let f = res.ok ? 1 : 0;
      if (res.ok && req.op === 'read' && res.ver !== undefined) {
        if (res.ver < req.fresh) f |= 2;
        if (req.ryw && res.ver < req.ryw) f |= 4;
      }
      if (res.degraded) f |= 8;
      if (req.op === 'read') f |= 16;
      this.flags[i] = f;
      if (!res.ok) {
        const name = `${res.err ?? 'error'}@${res.at ?? '?'}`;
        let code = this.errIndex.get(name);
        if (code === undefined) {
          code = this.errNames.length;
          this.errNames.push(name);
          this.errIndex.set(name, code);
        }
        this.errCode[i] = code;
      }
    }
    if (res.ok) {
      if (req.op === 'read') this.bytesOut += this.t.readKb;
      if (req.op === 'write' && res.ver !== undefined) {
        if ((this.acked.get(req.key) ?? 0) < res.ver) this.acked.set(req.key, res.ver);
        const raw = this.t.readAfterWrite ?? 0;
        if (raw > 0 && this.rng.next() < raw) {
          const ver = res.ver;
          this.sim.after(this.rng.exp(100), () => this.issue(client, { op: 'read', key: req.key, user: req.user, ryw: ver }));
        }
      }
    }
  }

  private grow(): void {
    const n = this.tStart.length * 2;
    const g = <T extends Float64Array | Float32Array | Uint8Array | Uint16Array>(a: T, C: new (n: number) => T): T => {
      const b = new C(n);
      b.set(a);
      return b;
    };
    this.tStart = g(this.tStart, Float64Array);
    this.lat = g(this.lat, Float32Array);
    this.flags = g(this.flags, Uint8Array);
    this.errCode = g(this.errCode, Uint16Array);
  }

  // ---------------------------------------------------------------- calls, network, policies

  private latency(a: Inst, b: Inst): number {
    if (a.g.kind === 'client' || b.g.kind === 'client') {
      const other = a.g.kind === 'client' ? b : a;
      return other.g.kind === 'cdn' ? NET.edgeRtt / 2 : this.t.rttMs / 2;
    }
    if (a === b) return 0;
    return a.az === b.az ? NET.sameAz : NET.crossAz;
  }

  private blocked(a: Inst, b: Inst): boolean {
    for (const [x, y] of this.partitions) {
      const m = (s: string, i: Inst) => i.az === s || i.g.id === s;
      if ((m(x, a) && m(y, b)) || (m(y, a) && m(x, b))) return true;
    }
    return false;
  }

  /** Network to an instance and back around `body`. Dead instances refuse; hung or cut-off ones never answer. */
  private *hop(from: Inst, to: Inst, body: () => Proc<Resp>): Proc<Resp> {
    if (this.blocked(from, to)) return yield NEVER;
    const l = this.latency(from, to);
    if (l > 0) yield this.sim.sleep(l);
    if (to.state === 'hung') return yield NEVER;
    if (to.state !== 'up') {
      if (l > 0) yield this.sim.sleep(l);
      return fail('refused', to.g.id);
    }
    const r = yield* body();
    const now = to.state as State;
    if (now === 'hung' || this.blocked(from, to)) return yield NEVER;
    if (now !== 'up') return fail('reset', to.g.id);
    if (l > 0) yield this.sim.sleep(l);
    return r;
  }

  /** A call along an edge, with the caller's timeout, retries, backoff, circuit breaker and bulkhead. */
  private *callEdge(from: Inst, edge: Edge, req: Req, extra?: Partial<Req> & { cacheOp?: string }): Proc<Resp> {
    const target = this.groups.get(edge.to)!;
    const ek = `${edge.from}->${edge.to}`;
    let st = this.edgeStats.get(ek);
    if (!st) this.edgeStats.set(ek, (st = { calls: 0, failures: 0 }));
    const bk = `${ek}@${from.idx}`;
    const retries = edge.retries ?? 0;
    let res: Resp = fail('error', edge.to);
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const base = (edge.backoffMs ?? 0) * Math.pow(2, attempt - 1);
        const wait = edge.jitter ? this.rng.next() * base : base;
        if (wait > 0) yield this.sim.sleep(wait);
      }
      if (edge.breaker) {
        const b = this.breakers.get(bk);
        if (b && b.openUntil > this.sim.now) {
          res = fail('circuit_open', edge.from);
          break;
        }
        if (b && b.openUntil > 0 && !b.halfOpen) b.halfOpen = true;
      }
      if (edge.maxConcurrent !== undefined) {
        const inUse = from.bulk!.get(edge) ?? 0;
        if (inUse >= edge.maxConcurrent) {
          res = fail('bulkhead_full', edge.from);
          break;
        }
        from.bulk!.set(edge, inUse + 1);
      }
      st.calls++;
      if (edge.timeoutMs === undefined && edge.maxConcurrent === undefined) {
        // no timer and no slot to track: run the call inline (the common, fast path)
        res = yield* this.deliver(from, target, req, extra);
        if (!res.ok) st.failures++;
        if (edge.breaker) this.updateBreaker(bk, edge.breaker, res.ok);
        if (res.ok || !RETRYABLE.has(res.err!)) break;
        continue;
      }
      const sig = this.sim.spawn(this.deliver(from, target, req, extra));
      res = edge.timeoutMs !== undefined ? yield this.sim.race(sig, edge.timeoutMs, fail('timeout', edge.from)) : yield sig;
      if (edge.maxConcurrent !== undefined) {
        // the slot is held until the call really finishes (a timed-out call still occupies it)
        if (sig.done) from.bulk!.set(edge, from.bulk!.get(edge)! - 1);
        else sig.on(() => from.bulk!.set(edge, from.bulk!.get(edge)! - 1));
      }
      if (!res.ok) st.failures++;
      if (edge.breaker) this.updateBreaker(bk, edge.breaker, res.ok);
      if (res.ok || !RETRYABLE.has(res.err!)) break;
    }
    if (!res.ok && edge.optional) return { ok: true, degraded: true };
    return res;
  }

  private updateBreaker(key: string, cfg: NonNullable<EdgePolicy['breaker']>, ok: boolean): void {
    let b = this.breakers.get(key);
    if (!b) this.breakers.set(key, (b = { fails: 0, openUntil: 0, halfOpen: false }));
    if (ok) {
      b.fails = 0;
      b.openUntil = 0;
      b.halfOpen = false;
      return;
    }
    b.fails++;
    if (b.halfOpen || b.fails >= cfg.failures) {
      b.openUntil = this.sim.now + cfg.resetMs;
      b.halfOpen = false;
      b.fails = 0;
    }
  }

  /** Routes a call into a group (choosing the instance) and runs it there. */
  private *deliver(from: Inst, g: Group, req: Req, extra?: Partial<Req> & { cacheOp?: string }): Proc<Resp> {
    switch (g.kind) {
      case 'lb':
      case 'ratelimiter': {
        const inst = this.pickAny(g, from);
        if (!inst) return fail('refused', g.id);
        return yield* this.hop(from, inst, () => (g.kind === 'lb' ? this.lbHandle(inst, req) : this.limiterHandle(inst, req)));
      }
      case 'app': {
        // called directly (no load balancer): plain DNS round robin, no health checks
        const live = g.live().filter((i) => i.state !== 'booting');
        if (!live.length) return fail('refused', g.id);
        const inst = live[g.rr++ % live.length];
        return yield* this.hop(from, inst, () => this.appHandle(inst, req));
      }
      case 'cache': {
        const inst = this.cacheInst(g, req.key);
        return yield* this.hop(from, inst, () => this.cacheHandle(inst, req, extra?.cacheOp ?? 'get', extra?.ver));
      }
      case 'cdn': {
        const inst = g.insts[0];
        return yield* this.hop(from, inst, () => this.cdnHandle(inst, req));
      }
      case 'db':
        return yield* this.dbRoute(from, g, req);
      case 'queue': {
        const inst = g.insts[0];
        return yield* this.hop(from, inst, () => this.queueHandle(inst, req));
      }
      case 'objectstore':
      case 'external': {
        const inst = g.insts[0];
        return yield* this.hop(from, inst, () => (g.kind === 'external' ? this.externalHandle(inst) : this.objectHandle(inst)));
      }
      default:
        return fail('unsupported', g.id);
    }
  }

  private pickAny(g: Group, from: Inst): Inst | undefined {
    const up = g.insts.filter((i) => i.state === 'up' && !this.blocked(from, i));
    if (up.length) return up[g.pick++ % up.length];
    return g.insts.find((i) => i.state === 'hung') ?? undefined;
  }

  // ---------------------------------------------------------------- component behaviour

  /** CPU work on one core; false when the instance died while the work waited for a core. */
  private *cpu(inst: Inst, mean: number, dist: Dist = 'exp'): Proc<boolean> {
    if (!(yield inst.cores.acquire())) return false;
    const t = this.sampleDist(dist, mean, inst.g.rng) * inst.g.slow;
    if (t > 0) yield this.sim.sleep(t);
    inst.cores.release();
    return true;
  }

  private sampleDist(dist: Dist, mean: number, rng: Rng): number {
    if (dist === 'const') return mean;
    if (dist === 'lognormal') return rng.lognormal(mean, 1);
    return rng.exp(mean);
  }

  private *lbHandle(inst: Inst, req: Req): Proc<Resp> {
    const g = inst.g;
    const node = g.node as LbNode;
    g.handled++;
    // a load balancer's own work (~50 µs) is folded into the network hop: it never limits throughput here
    const backends: Inst[] = [];
    // each load balancer node checks its backends itself: during a network partition it only sees the ones it can reach
    for (const e of g.out) for (const b of this.groups.get(e.to)!.insts) if (b.state !== 'retired' && b.state !== 'booting' && !this.blocked(inst, b)) backends.push(b);
    const hc = node.healthCheck !== false;
    const pool = hc ? backends.filter((b) => g.health.get(b)?.healthy ?? b.bornAt === 0) : backends;
    if (!pool.length) {
      this.countErr(g, 'no_backend');
      return fail('no_backend', g.id);
    }
    const choose = (from: Inst[]): Inst => {
      switch (node.algorithm ?? 'round_robin') {
        case 'least_conn': {
          const start = g.rr++ % from.length;
          let b = from[start];
          for (let k = 1; k < from.length; k++) {
            const c = from[(start + k) % from.length];
            if (c.active < b.active) b = c;
          }
          return b;
        }
        case 'random':
          return from[g.rng.int(from.length)];
        case 'sticky':
          return from[hash32(req.user) % from.length];
        default:
          return from[g.rr++ % from.length];
      }
    };
    // The connection's timeout, retries and backoff apply per attempt; a retry goes to another backend when there is one.
    const tried: Inst[] = [];
    let res: Resp = fail('no_backend', g.id);
    for (let attempt = 0; ; attempt++) {
      const fresh = tried.length ? pool.filter((b) => !tried.includes(b)) : pool;
      const target = choose(fresh.length ? fresh : pool);
      const edge = g.out.find((e) => e.to === target.g.id)!;
      const ek = `${edge.from}->${edge.to}`;
      let st = this.edgeStats.get(ek);
      if (!st) this.edgeStats.set(ek, (st = { calls: 0, failures: 0 }));
      st.calls++;
      if (edge.timeoutMs === undefined) res = yield* this.hop(inst, target, () => this.appHandle(target, req));
      else res = yield this.sim.race(this.sim.spawn(this.hop(inst, target, () => this.appHandle(target, req))), edge.timeoutMs, fail('timeout', g.id));
      if (res.ok) return res;
      st.failures++;
      if (!RETRYABLE.has(res.err!) || attempt >= (edge.retries ?? 0)) return res;
      tried.push(target);
      const base = (edge.backoffMs ?? 0) * Math.pow(2, attempt);
      const wait = edge.jitter ? this.rng.next() * base : base;
      if (wait > 0) yield this.sim.sleep(wait);
    }
  }

  private startHealthChecks(g: Group): void {
    const node = g.node as LbNode;
    if (node.healthCheck === false) return;
    const interval = node.healthCheck?.intervalMs ?? DEFAULTS.lb.healthInterval;
    const limit = node.healthCheck?.unhealthy ?? DEFAULTS.lb.unhealthy;
    const check = () => {
      for (const e of g.out) {
        for (const b of this.groups.get(e.to)!.insts) {
          if (b.state === 'retired') continue;
          let h = g.health.get(b);
          if (!h) g.health.set(b, (h = { fails: 0, healthy: b.bornAt === 0 && b.state === 'up' }));
          if (b.state === 'up') {
            h.fails = 0;
            h.healthy = true;
          } else if (b.state !== 'booting') {
            h.fails++;
            if (h.fails >= limit) h.healthy = false;
          }
        }
      }
      this.sim.after(interval, check);
    };
    // the first check runs at t=0 so everyone starts healthy
    check();
  }

  private *limiterHandle(inst: Inst, req: Req): Proc<Resp> {
    const g = inst.g;
    const node = g.node as RateLimiterNode;
    g.handled++;
    const now = this.sim.now;
    const burst = node.burst ?? node.rate;
    let ok: boolean;
    if ((node.per ?? 'global') === 'global') {
      g.tokens = Math.min(burst, g.tokens + ((now - g.lastRefill) * node.rate) / 1000);
      g.lastRefill = now;
      ok = g.tokens >= 1;
      if (ok) g.tokens -= 1;
    } else {
      let b = g.buckets.get(req.user);
      if (!b) g.buckets.set(req.user, (b = { tokens: burst, last: now }));
      b.tokens = Math.min(burst, b.tokens + ((now - b.last) * node.rate) / 1000);
      b.last = now;
      ok = b.tokens >= 1;
      if (ok) b.tokens -= 1;
    }
    yield this.sim.sleep(0.1);
    if (!ok) {
      this.countErr(g, 'rate_limited');
      return fail('rate_limited', g.id);
    }
    const e = g.out[0];
    return yield* this.callEdge(inst, e, req);
  }

  private *cdnHandle(inst: Inst, req: Req): Proc<Resp> {
    const g = inst.g;
    const node = g.node as CdnNode;
    g.handled++;
    const cacheable = req.op === 'static' || (req.op === 'read' && node.cacheReads);
    const key = req.op === 'static' ? -1 - req.key : req.key;
    if (cacheable) {
      const e = inst.lru!.get(key, this.sim.now);
      if (e) {
        this.cdnHits++;
        g.hits++;
        this.bytesCdn += req.op === 'static' ? this.t.staticKb : this.t.readKb;
        return { ok: true, ver: e.ver, hit: true };
      }
      this.cdnMisses++;
      g.misses++;
    }
    const origin = g.out[0];
    if (!origin) return fail('no_origin', g.id);
    const r = yield* this.callEdge(inst, origin, req);
    if (r.ok && cacheable) {
      inst.lru!.set(key, r.ver ?? 0, this.sim.now + (node.ttlMs ?? DEFAULTS.cdn.ttlMs));
      this.bytesCdn += req.op === 'static' ? this.t.staticKb : this.t.readKb;
    }
    return r;
  }

  private *appHandle(inst: Inst, req: Req): Proc<Resp> {
    const g = inst.g;
    const node = g.node as AppNode;
    g.handled++;
    if (!(yield inst.threads.acquire())) {
      this.countErr(g, 'overloaded');
      return fail('overloaded', g.id);
    }
    inst.active++;
    let res: Resp;
    try {
      if (!(yield* this.cpu(inst, node.cpuMs ?? DEFAULTS.app.cpuMs, node.dist))) return fail('reset', g.id);
      if (node.sessions === 'local') {
        // the session lives in this one server's memory; anywhere else the user is logged out and logs in again here
        const at = this.sessionAt.get(req.user);
        this.sessionAt.set(req.user, inst);
        if (at !== inst && this.seenUsers.has(req.user)) {
          this.countErr(g, 'session_lost');
          return fail('session_lost', g.id);
        }
        this.seenUsers.add(req.user);
      }
      if (req.op === 'read') res = yield* this.readPath(inst, req);
      else if (req.op === 'write') res = yield* this.writePath(inst, req);
      else if (req.op === 'query') res = yield* this.queryPath(inst, req);
      else res = yield* this.staticPath(inst, req);
      if (res.ok) {
        for (const e of g.edgesTo('external')) {
          if (g.rng.next() >= (node.externalRatio ?? 1)) continue;
          const r = yield* this.callEdge(inst, e, req);
          if (!r.ok) {
            res = r;
            break;
          }
          if (r.degraded) res = { ...res, degraded: true };
        }
      }
    } finally {
      inst.active--;
      inst.threads.release();
    }
    if (!res.ok && res.at === g.id) this.countErr(g, res.err!);
    return res;
  }

  private *staticPath(inst: Inst, req: Req): Proc<Resp> {
    const os = inst.g.edgesTo('objectstore')[0];
    if (os) return yield* this.callEdge(inst, os, req);
    this.bytesOut += this.t.staticKb;
    return OK;
  }

  private *readPath(inst: Inst, req: Req): Proc<Resp> {
    const g = inst.g;
    const node = g.node as AppNode;
    const cache = g.edgesTo('cache')[0];
    const db = g.edgesTo('db')[0];
    let cacheOk = false;
    if (cache) {
      const r = yield* this.callEdge(inst, cache, req, { cacheOp: 'get' });
      if (r.ok && r.hit) return { ok: true, ver: r.ver, hit: true };
      cacheOk = r.ok;
    }
    if (!db) return { ok: true, ver: this.verCounter.get(req.key) ?? 0 };
    if (node.singleFlight) {
      const pending = inst.inflight!.get(req.key);
      if (pending) return yield pending;
    }
    const sig = new Signal<Resp>();
    if (node.singleFlight) inst.inflight!.set(req.key, sig);
    const r = yield* this.dbCall(inst, db, req);
    if (node.singleFlight) {
      inst.inflight!.delete(req.key);
      sig.resolve(r);
    }
    if (r.ok && cache && cacheOk) yield* this.callEdge(inst, cache, req, { cacheOp: 'set', ver: r.ver });
    return r;
  }

  private *writePath(inst: Inst, req: Req): Proc<Resp> {
    const g = inst.g;
    const node = g.node as AppNode | WorkerNode;
    const cache = g.edgesTo('cache')[0];
    const db = g.edgesTo('db')[0];
    const appNode = node.kind === 'app' ? node : undefined;
    if (appNode?.writeVia === 'queue') {
      const q = g.edgesTo('queue')[0];
      if (q) return yield* this.callEdge(inst, q, req);
    }
    const mode = appNode?.cacheOnWrite ?? 'invalidate';
    if (cache && mode === 'write_back') {
      const ver = this.nextVer(req.key);
      const r = yield* this.callEdge(inst, cache, req, { cacheOp: 'setDirty', ver });
      return r.ok ? { ok: true, ver } : r;
    }
    if (!db) return { ok: true, ver: this.nextVer(req.key) };
    const r = yield* this.dbCall(inst, db, req);
    if (r.ok && cache) {
      if (mode === 'invalidate') yield* this.callEdge(inst, cache, req, { cacheOp: 'del' });
      else if (mode === 'write_through') yield* this.callEdge(inst, cache, req, { cacheOp: 'set', ver: r.ver });
    }
    return r;
  }

  private *queryPath(inst: Inst, req: Req): Proc<Resp> {
    const db = inst.g.edgesTo('db')[0];
    if (!db) return OK;
    return yield* this.dbCall(inst, db, req);
  }

  /** A DB call holds one of the caller's pooled connections. */
  private *dbCall(inst: Inst, edge: Edge, req: Req): Proc<Resp> {
    const pool = inst.pool!;
    yield pool.acquire();
    try {
      return yield* this.callEdge(inst, edge, req);
    } finally {
      pool.release();
    }
  }

  private nextVer(key: number): number {
    const v = (this.verCounter.get(key) ?? 0) + 1;
    this.verCounter.set(key, v);
    return v;
  }

  // ---- cache

  private cacheInst(g: Group, key: number): Inst {
    return g.insts[hash32(key) % g.insts.length];
  }

  private *cacheHandle(inst: Inst, req: Req, op: string, ver?: number): Proc<Resp> {
    const g = inst.g;
    const node = g.node as CacheNode;
    g.handled++;
    if (!(yield inst.cores.acquire())) {
      this.countErr(g, 'overloaded');
      return fail('overloaded', g.id);
    }
    yield this.sim.sleep(this.sampleDist('exp', node.opMs ?? DEFAULTS.cache.opMs, g.rng) * g.slow);
    inst.cores.release();
    const now = this.sim.now;
    const ttl = node.ttlMs ?? Infinity;
    switch (op) {
      case 'get': {
        const e = inst.lru!.get(req.key, now);
        if (e) {
          g.hits++;
          return { ok: true, hit: true, ver: e.ver };
        }
        g.misses++;
        return { ok: true, hit: false };
      }
      case 'set':
        inst.lru!.set(req.key, ver ?? 0, now + ttl);
        return OK;
      case 'del':
        inst.lru!.delete(req.key);
        return OK;
      case 'setDirty': {
        inst.lru!.set(req.key, ver!, now + ttl);
        const first = !inst.dirty!.has(req.key);
        inst.dirty!.set(req.key, ver!);
        if (first) this.sim.after(node.flushMs ?? DEFAULTS.cache.flushMs, () => this.flushDirty(inst, req.key));
        return OK;
      }
    }
    return OK;
  }

  /** Write-back: the cache writes a dirty key to the database (via the app's DB edge). */
  private flushDirty(inst: Inst, key: number): void {
    if (inst.state !== 'up') return;
    const ver = inst.dirty!.get(key);
    if (ver === undefined) return;
    inst.dirty!.delete(key);
    const dbG = [...this.groups.values()].find((x) => x.kind === 'db');
    if (!dbG) return;
    const req: Req = { op: 'write', key, user: 0, fresh: 0, ryw: 0, ver };
    this.sim.spawn(this.deliver(inst, dbG, req));
  }

  // ---- database

  private shardOf(g: Group, req: Req): number {
    const node = g.node as DbNode;
    const n = g.shards.length;
    if (n === 1) return 0;
    // sharded by user: a user's items live with the user (an item's id says whose it is), and per-user queries hit one shard
    const k = (node.shardBy ?? 'key') === 'user' ? (req.op === 'query' ? req.user : this.ownerOf(req.key)) : req.key;
    switch (node.partitioning ?? 'hash') {
      case 'range': {
        const span = Math.ceil(this.t.keys / n);
        return Math.min(n - 1, Math.floor(k / span));
      }
      case 'consistent':
        return this.ringLookup(g, hash32(k));
      default:
        return hash32(k) % n;
    }
  }

  /** The user an item belongs to. */
  private ownerOf(key: number): number {
    return hash32(key ^ 0x2545f491) % this.t.users;
  }

  private buildRing(g: Group): void {
    g.ring = [];
    g.shards.forEach((_, s) => {
      for (let v = 0; v < 100; v++) g.ring.push({ pos: hash32(s * 1000 + v + 0x5bd1e995), shard: s });
    });
    g.ring.sort((a, b) => a.pos - b.pos);
  }

  private ringLookup(g: Group, h: number): number {
    const r = g.ring;
    let lo = 0;
    let hi = r.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (r[mid].pos < h) lo = mid + 1;
      else hi = mid;
    }
    return r[lo % r.length].shard;
  }

  private *dbRoute(from: Inst, g: Group, req: Req): Proc<Resp> {
    const node = g.node as DbNode;
    if (req.op === 'query' && g.shards.length > 1 && (node.shardBy ?? 'key') !== 'user') {
      // the query can't be answered by one shard: ask all of them and wait for the slowest
      const sigs = g.shards.map((_, s) => this.sim.spawn(this.dbShard(from, g, s, req)));
      let worst: Resp = OK;
      for (const s of sigs) {
        const r: Resp = yield s;
        if (!r.ok) worst = r;
      }
      return worst;
    }
    return yield* this.dbShard(from, g, this.shardOf(g, req), req);
  }

  private *dbShard(from: Inst, g: Group, s: number, req: Req): Proc<Resp> {
    const node = g.node as DbNode;
    const shard = g.shards[s];
    if (node.quorum) return yield* this.quorumOp(from, g, shard, req);
    if (req.op === 'write') {
      const p = shard.primary;
      if (!p) return fail('unavailable', g.id);
      return yield* this.hop(from, p, () => this.dbWork(from, p, req));
    }
    // reads and queries
    let target: Inst | null = shard.primary;
    const fromApp = from.g.node.kind === 'app' ? (from.g.node as AppNode) : undefined;
    const useReplicas = (fromApp?.readFrom ?? 'replicas') === 'replicas' && shard.replicas.length > 0;
    if (useReplicas) {
      const up = shard.replicas.filter((r) => r.state === 'up' && !this.blocked(from, r));
      if (up.length) target = up[g.rr++ % up.length];
    }
    if (!target) return fail('unavailable', g.id);
    const t = target;
    return yield* this.hop(from, t, () => this.dbWork(from, t, req));
  }

  /** Work on one DB instance: a connection, a work slot, then the read or write itself. */
  private *dbWork(from: Inst, inst: Inst, req: Req): Proc<Resp> {
    const g = inst.g;
    const node = g.node as DbNode;
    g.handled++;
    // connections: callers keep their connections open (a pool), up to the DB's limit
    if (from.g.kind === 'app' || from.g.kind === 'worker') {
      let c = from.conns.get(inst);
      if (!c) from.conns.set(inst, (c = { open: 0, inUse: 0 }));
      if (c.inUse >= c.open) {
        const max = node.maxConnections ?? SIZES[node.size ?? DEFAULTS.db.size].dbConns;
        if (inst.connsIn >= max) {
          this.countErr(g, 'too_many_connections');
          return fail('too_many_connections', g.id);
        }
        inst.connsIn++;
        c.open++;
      }
      c.inUse++;
      try {
        return yield* this.dbExec(inst, req);
      } finally {
        c.inUse--;
      }
    }
    return yield* this.dbExec(inst, req);
  }

  private *dbExec(inst: Inst, req: Req): Proc<Resp> {
    const g = inst.g;
    const node = g.node as DbNode;
    if (!(yield inst.cores.acquire())) {
      this.countErr(g, 'overloaded');
      return fail('overloaded', g.id);
    }
    const mean = req.op === 'write' ? (node.writeMs ?? DEFAULTS.db.writeMs) : req.op === 'query' ? 2 * (node.readMs ?? DEFAULTS.db.readMs) : (node.readMs ?? DEFAULTS.db.readMs);
    yield this.sim.sleep(this.sampleDist(node.dist ?? 'exp', mean, g.rng) * g.slow);
    inst.cores.release();
    if (inst.state !== 'up') return fail('reset', g.id);
    if (req.op !== 'write') return { ok: true, ver: inst.store!.get(req.key) ?? 0 };
    // a write on the primary
    const ver = req.ver ?? this.nextVer(req.key);
    if ((inst.store!.get(req.key) ?? 0) < ver) inst.store!.set(req.key, ver);
    const shard = g.shards[inst.shard];
    const wseq = ++this.replSeq;
    const need = Math.min(node.syncReplicas ?? 0, shard.replicas.length);
    // the first `need` replicas that are up are synchronous (PostgreSQL's FIRST n): when one is down, the next one takes its place
    const sync = new Set<Inst>();
    for (const pass of [true, false])
      for (const r of shard.replicas) if (sync.size < need && (r.state === 'up' && !this.blocked(inst, r)) === pass) sync.add(r);
    const acks = shard.replicas.filter((r) => sync.has(r)).map((r) => this.replicate(inst, r, req.key, ver, wseq, true));
    for (const r of shard.replicas) if (!sync.has(r)) this.replicate(inst, r, req.key, ver, wseq, false);
    if (need > 0) {
      let got = 0;
      const done = new Signal<void>();
      for (const a of acks)
        a.on(() => {
          if (++got >= need) done.resolve();
        });
      yield done;
    }
    return { ok: true, ver };
  }

  /**
   * Ships a write to a replica: network, a lag, then the replica's single apply thread.
   * A synchronous replica (one of the first `syncReplicas`, like PostgreSQL's FIRST n standbys)
   * applies each write as it arrives, while the primary waits; the others lag behind.
   */
  private replicate(primary: Inst, replica: Inst, key: number, ver: number, seq: number, sync: boolean): Signal<void> {
    const node = primary.g.node as DbNode;
    const done = new Signal<void>();
    const lag = sync ? 0 : primary.g.rng.exp(node.replicationLagMs ?? DEFAULTS.db.replicationLagMs);
    const self = this;
    const epoch = primary.epoch;
    const committed = this.sim.now;
    replica.pending.set(seq, committed);
    // the replication stream is ordered: a write never overtakes an earlier one, so a replica always holds a prefix of the primary's log
    const arrival = Math.max(replica.streamT, committed + this.latency(primary, replica) + lag);
    replica.streamT = arrival;
    this.sim.spawn(
      (function* (): Proc<void> {
        yield self.sim.sleep(arrival - committed);
        // the primary crashed before shipping this write: it never reaches the replica
        if (primary.epoch !== epoch) {
          replica.pending.delete(seq);
          return;
        }
        // a dead or cut-off replica misses the write; it copies everything when it's back (see resync)
        if (replica.state !== 'up' || self.blocked(primary, replica)) {
          replica.pending.delete(seq);
          replica.needsResync = true;
          return;
        }
        yield replica.applier!.acquire();
        yield self.sim.sleep(1000 / (node.replicaApplyRate ?? DEFAULTS.db.replicaApplyRate));
        replica.applier!.release();
        replica.pending.delete(seq);
        replica.lastLag = self.sim.now - committed;
        if (seq > replica.appliedSeq) replica.appliedSeq = seq;
        if ((replica.store!.get(key) ?? 0) < ver) replica.store!.set(key, ver);
        yield self.sim.sleep(self.latency(primary, replica));
        done.resolve();
      })(),
    );
    return done;
  }

  private *quorumOp(from: Inst, g: Group, shard: Shard, req: Req): Proc<Resp> {
    const q = (g.node as DbNode).quorum!;
    const peers = shard.peers;
    const isWrite = req.op === 'write';
    const need = isWrite ? q.w : q.r;
    // writes go to every copy; reads to r of them (chosen at random)
    let targets = peers;
    if (!isWrite) {
      // the coordinator knows (by failure detection) which copies are reachable and asks those first
      const order = peers.map((p) => ({ p, k: g.rng.next() + (p.state === 'up' && !this.blocked(from, p) ? 0 : 2) }));
      order.sort((a, b) => a.k - b.k);
      targets = order.slice(0, q.r).map((o) => o.p);
    }
    const ver = isWrite ? this.nextVer(req.key) : 0;
    const sub: Req = { ...req, ver };
    const done = new Signal<Resp>();
    let oks = 0;
    let fails = 0;
    let best = -1;
    for (const p of targets) {
      this.sim.spawn(this.hop(from, p, () => this.dbWork(from, p, sub))).on((r) => {
        if (r.ok) {
          oks++;
          if ((r.ver ?? 0) > best) best = r.ver ?? 0;
          if (oks >= need) done.resolve(isWrite ? { ok: true, ver } : { ok: true, ver: best });
        } else if (++fails > targets.length - need) done.resolve(fail('no_quorum', g.id));
      });
    }
    return yield done;
  }

  private promote(shard: Shard): void {
    shard.failoverAt = null;
    if (shard.primary && shard.primary.state === 'up') return;
    const old = shard.primary;
    const candidates = shard.replicas.filter((r) => r.state === 'up');
    if (!candidates.length) return;
    // the most up-to-date replica (furthest along the replication log) wins
    let best = candidates[0];
    for (const c of candidates) if (c.appliedSeq > best.appliedSeq) best = c;
    // acknowledged writes the new primary never received are lost (shard-local keys only)
    const g = best.g;
    const mine = (k: number) => g.shards.length === 1 || g.shards[this.shardOf(g, { op: 'write', key: k, user: k, fresh: 0, ryw: 0 })] === shard;
    for (const [k, v] of this.acked) {
      if (!mine(k)) continue;
      const nv = best.store!.get(k) ?? 0;
      if (v > nv) this.lostWrites += v - nv;
    }
    if (old) old.role = 'replica';
    best.role = 'primary';
    shard.replicas = shard.replicas.filter((r) => r !== best);
    if (old) shard.replicas.push(old);
    shard.primary = best;
    // writes acknowledged by the old primary but never replicated are gone: the truth rolls back
    for (const [k, v] of this.verCounter) {
      if (!mine(k)) continue;
      const nv = best.store!.get(k) ?? 0;
      if (v > nv) {
        this.verCounter.set(k, nv);
        if ((this.acked.get(k) ?? 0) > nv) this.acked.set(k, nv);
      }
    }
  }

  // ---- queue and workers

  private subsFor(g: Group): Sub[] {
    if (g.subs.length) return g.subs;
    const node = g.node as QueueNode;
    const workers = g.out.map((e) => this.groups.get(e.to)!).filter((w) => w.kind === 'worker');
    const box = (): Box => ({ ready: [], head: 0, inflight: new Map(), waiters: [] });
    if ((node.mode ?? 'queue') === 'topic') g.subs = workers.map((w) => ({ worker: w, box: box() }));
    else {
      const shared = box();
      g.subs = workers.map((w) => ({ worker: w, box: shared }));
    }
    return g.subs;
  }

  private subFor(q: Group, worker: Group): Sub | undefined {
    return this.subsFor(q).find((s) => s.worker === worker);
  }

  private *queueHandle(inst: Inst, req: Req): Proc<Resp> {
    const g = inst.g;
    g.handled++;
    yield this.sim.sleep(this.sampleDist('exp', DEFAULTS.queue.opMs, g.rng));
    const node = g.node as QueueNode;
    const backlog = this.backlogOf(g);
    if (backlog >= (node.maxBacklog ?? DEFAULTS.queue.maxBacklog)) {
      this.countErr(g, 'queue_full');
      return fail('queue_full', g.id);
    }
    this.enqueueRaw(g, req.key, req.user);
    return OK;
  }

  private backlogOf(g: Group): number {
    let n = 0;
    const seen = new Set<Box>();
    for (const s of this.subsFor(g)) {
      if (seen.has(s.box)) continue;
      seen.add(s.box);
      n += s.box.ready.length - s.box.head + s.box.inflight.size;
    }
    return n;
  }

  private enqueueRaw(g: Group, key: number, user: number): void {
    const id = ++this.msgSeq;
    const poison = this.rng.next() < (this.t.poisonRate ?? 0);
    const seen = new Set<Box>();
    this.queueOps++;
    for (const s of this.subsFor(g)) {
      if (seen.has(s.box)) continue;
      seen.add(s.box);
      this.offer(s, { id, key, user, poison, receives: 0, tEnq: this.sim.now, receipt: 0 });
    }
    const b = this.backlogOf(g);
    if (b > g.maxBacklog) g.maxBacklog = b;
  }

  private offer(s: Sub, m: Msg): void {
    // waiters are shared between subs that share a `ready` list (competing consumer groups)
    while (s.box.waiters.length) {
      const w = s.box.waiters.shift()!;
      if (!w.done) {
        w.resolve(m);
        return;
      }
    }
    s.box.ready.push(m);
  }

  private receive(s: Sub): Signal<Msg | null> {
    if (s.box.head < s.box.ready.length) {
      const m = s.box.ready[s.box.head++];
      if (s.box.head > 4096 && s.box.head * 2 > s.box.ready.length) {
        s.box.ready.splice(0, s.box.head);
        s.box.head = 0;
      }
      return Signal.of<Msg | null>(m);
    }
    const w = new Signal<Msg | null>();
    s.box.waiters.push(w);
    return w;
  }

  private startConsumers(inst: Inst): void {
    const w = inst.g;
    const node = w.node as WorkerNode;
    const queues = [...this.groups.values()].filter((g) => g.kind === 'queue' && g.out.some((e) => e.to === w.id));
    for (const q of queues) {
      const n = node.concurrency ?? DEFAULTS.worker.concurrency;
      for (let i = 0; i < n; i++) this.sim.spawn(this.consumer(inst, q));
    }
  }

  private *consumer(inst: Inst, q: Group): Proc<void> {
    const qNode = q.node as QueueNode;
    const vt = qNode.visibilityTimeoutMs ?? DEFAULTS.queue.visibilityTimeoutMs;
    const maxReceives = qNode.maxReceives ?? DEFAULTS.queue.maxReceives;
    for (;;) {
      if (inst.state === 'retired') return;
      if (inst.state !== 'up') {
        const s = new Signal<void>();
        inst.wake.push(s);
        yield s;
        continue;
      }
      if (q.insts[0].state !== 'up') {
        yield this.sim.sleep(1000);
        continue;
      }
      const sub = this.subFor(q, inst.g);
      if (!sub) return;
      const m: Msg | null = yield this.receive(sub);
      if (!m) continue;
      if (inst.state !== 'up') {
        // came back to a dead consumer: put it back
        this.offer(sub, m);
        continue;
      }
      this.queueOps++;
      m.receives++;
      const receipt = ++m.receipt;
      sub.box.inflight.set(m.id, m);
      this.sim.after(vt, () => {
        if (sub.box.inflight.get(m.id) === m && m.receipt === receipt) {
          sub.box.inflight.delete(m.id);
          this.offer(sub, m);
        }
      });
      const ok: boolean = yield* this.process(inst, m);
      if (inst.state !== 'up') continue;
      if (ok) {
        if (m.receipt === receipt && sub.box.inflight.get(m.id) === m) {
          sub.box.inflight.delete(m.id);
          this.queueOps++;
          if (this.sim.now >= this.warmupMs) this.msgLat.push(this.sim.now - m.tEnq);
          this.checkDrained(q);
        }
      } else if (m.receives >= maxReceives && qNode.dlq) {
        if (sub.box.inflight.get(m.id) === m) {
          sub.box.inflight.delete(m.id);
          q.dlq++;
          this.checkDrained(q);
        }
      }
    }
  }

  private checkDrained(q: Group): void {
    if (this.drainedAt === null && this.backlogOf(q) === 0) this.drainedAt = this.sim.now;
  }

  private *process(inst: Inst, m: Msg): Proc<boolean> {
    const g = inst.g;
    const node = g.node as WorkerNode;
    g.handled++;
    if (!(yield* this.cpu(inst, node.cpuMs ?? DEFAULTS.worker.cpuMs, node.dist)) || inst.state !== 'up') return false;
    if (m.poison) {
      this.countErr(g, 'poison_message');
      return false;
    }
    const db = g.edgesTo('db')[0];
    const cache = g.edgesTo('cache')[0];
    const req: Req = { op: 'write', key: m.key, user: m.user, fresh: 0, ryw: 0 };
    if (node.idempotent && g.effects.has(m.id) && db) {
      // the dedupe check: one read, no second effect
      const r = yield* this.dbCall(inst, db, { ...req, op: 'read' });
      return r.ok;
    }
    for (const e of g.edgesTo('external')) {
      const r = yield* this.callEdge(inst, e, req);
      if (!r.ok) {
        this.countErr(g, r.err ?? 'error');
        return false;
      }
    }
    if (db) {
      const fan = node.fanout ?? 1;
      for (let i = 0; i < fan; i++) {
        const key = fan === 1 ? m.key : hash32(m.key * 7919 + i) % this.t.keys;
        const r = yield* this.dbCall(inst, db, { ...req, key });
        if (!r.ok) {
          this.countErr(g, r.err ?? 'error');
          return false;
        }
        if (cache) yield* this.callEdge(inst, cache, { ...req, key }, { cacheOp: 'del' });
      }
    }
    const prev = g.effects.get(m.id) ?? 0;
    if (prev > 0) this.duplicates++;
    g.effects.set(m.id, prev + 1);
    return true;
  }

  // ---- other components

  private *externalHandle(inst: Inst): Proc<Resp> {
    const g = inst.g;
    const node = g.node as ExternalNode;
    g.handled++;
    if (node.rateLimit) {
      const now = this.sim.now;
      g.tokens = Math.min(node.rateLimit, g.tokens + ((now - g.lastRefill) * node.rateLimit) / 1000);
      g.lastRefill = now;
      if (g.tokens < 1) {
        this.countErr(g, 'rate_limited');
        return fail('rate_limited', g.id);
      }
      g.tokens -= 1;
    }
    yield this.sim.sleep(g.rng.lognormal(node.latencyMs ?? DEFAULTS.external.latencyMs, 0.5) * g.slow);
    const rate = g.failRate || node.failRate || 0;
    if (rate > 0 && g.rng.next() < rate) {
      this.countErr(g, 'external_error');
      return fail('external_error', g.id);
    }
    return OK;
  }

  private *objectHandle(inst: Inst): Proc<Resp> {
    const g = inst.g;
    g.handled++;
    this.objectGets++;
    yield this.sim.sleep(g.rng.lognormal((g.node as { latencyMs?: number }).latencyMs ?? DEFAULTS.objectstore.latencyMs, 0.5) * g.slow);
    this.bytesOut += this.t.staticKb;
    return { ok: true, ver: 0 };
  }

  private countErr(g: Group, err: string): void {
    g.errors[err] = (g.errors[err] ?? 0) + 1;
  }

  // ---------------------------------------------------------------- failures, scaling

  private setState(inst: Inst, state: State): void {
    const was = inst.state;
    if (was === state) return;
    this.touchUp(inst.g);
    if (was === 'up') {
      this.closeUp(inst);
      inst.g.upCount--;
    }
    if (state === 'up') inst.g.upCount++;
    inst.state = state;
    if (state === 'up') {
      inst.upSince = this.sim.now;
      const w = inst.wake;
      inst.wake = [];
      for (const s of w) s.resolve();
      if (inst.g.kind === 'db') this.resync(inst);
    }
    if (state === 'down' || state === 'retired') {
      inst.epoch++;
      inst.threads.failWaiters();
      if (inst.cores !== inst.threads) inst.cores.failWaiters();
      // memory is lost with the process
      if (inst.lru) {
        inst.lru.clear();
        if (inst.dirty) {
          this.lostWrites += inst.dirty.size;
          for (const k of inst.dirty.keys()) this.rollback(k);
          inst.dirty.clear();
        }
      }
      if (inst.g.kind === 'app') for (const [u, at] of this.sessionAt) if (at === inst) this.sessionAt.delete(u);
      // its connections to databases close
      for (const [db, c] of inst.conns) db.connsIn -= c.open;
      inst.conns.clear();
      if (state === 'retired') inst.diedAt = this.sim.now;
      // DB connections into a dead DB are gone too
      if (inst.g.kind === 'db') {
        inst.connsIn = 0;
        for (const g of this.groups.values()) for (const i of g.insts) i.conns.delete(inst);
      }
      if (inst.g.kind === 'db' && inst.role === 'primary') {
        const node = inst.g.node as DbNode;
        const shard = inst.g.shards[inst.shard];
        if (node.failoverMs !== undefined && shard.failoverAt === null) {
          shard.failoverAt = this.sim.now + node.failoverMs;
          this.sim.after(node.failoverMs, () => this.promote(shard));
        }
      }
    }
  }

  /** A replica that missed writes (it was down or cut off) catches up by copying its primary. */
  private resync(inst: Inst): void {
    if (inst.role !== 'replica' || !inst.needsResync) return;
    const p = inst.g.shards[inst.shard].primary;
    if (!p || p.state !== 'up') return;
    inst.store = new Map(p.store!);
    inst.needsResync = false;
  }

  /** A lost write-back: the key's truth goes back to what the database has. */
  private rollback(key: number): void {
    const db = [...this.groups.values()].find((g) => g.kind === 'db');
    const dbVer = db?.shards.length ? (db.shards[0].primary?.store?.get(key) ?? 0) : 0;
    this.verCounter.set(key, dbVer);
    if ((this.acked.get(key) ?? 0) > dbVer) this.acked.set(key, dbVer);
  }

  /** Accumulates the time this group had at least one instance up. */
  private touchUp(g: Group): void {
    if (g.upCount > 0) g.anyUpArea += this.sim.now - g.lastUpT;
    g.lastUpT = this.sim.now;
  }

  private closeUp(inst: Inst): void {
    if (inst.state === 'up') inst.upTime += this.sim.now - inst.upSince;
    inst.upSince = this.sim.now;
  }

  private targets(node: string, instance?: number): Inst[] {
    const g = this.groups.get(node);
    if (!g) return [];
    return instance === undefined ? g.insts.filter((i) => i.state !== 'retired') : g.insts.filter((i) => i.idx === instance);
  }

  private apply(ev: ScenarioEvent): void {
    switch (ev.action) {
      case 'kill':
        for (const i of this.targets(ev.node, ev.instance)) this.setState(i, 'down');
        break;
      case 'hang':
        for (const i of this.targets(ev.node, ev.instance)) this.setState(i, 'hung');
        break;
      case 'restore':
        for (const i of this.targets(ev.node, ev.instance)) if (i.state === 'down' || i.state === 'hung') this.setState(i, 'up');
        break;
      case 'slow': {
        const g = this.groups.get(ev.node);
        if (g) g.slow = ev.factor;
        break;
      }
      case 'flush':
        for (const i of this.targets(ev.node)) if (i.lru) i.lru.clear();
        break;
      case 'azDown':
        for (const g of this.groups.values())
          for (const i of g.insts)
            if (i.az === ev.az && i.state === 'up') {
              i.killedByAz = true;
              this.setState(i, 'down');
            }
        break;
      case 'azUp':
        for (const g of this.groups.values())
          for (const i of g.insts)
            if (i.killedByAz && i.az === ev.az) {
              i.killedByAz = false;
              this.setState(i, 'up');
            }
        break;
      case 'partition':
        this.partitions.push([ev.a, ev.b]);
        break;
      case 'heal':
        this.partitions = [];
        for (const g of this.groups.values()) if (g.kind === 'db') for (const i of g.insts) if (i.state === 'up') this.resync(i);
        break;
      case 'failRate': {
        const g = this.groups.get(ev.node);
        if (g) g.failRate = ev.rate;
        break;
      }
      case 'scale': {
        const g = this.groups.get(ev.node);
        if (g) this.scaleTo(g, ev.instances, 0);
        break;
      }
      case 'addShard': {
        const g = this.groups.get(ev.node);
        if (g?.kind === 'db') this.addShard(g);
        break;
      }
    }
  }

  private scaleTo(g: Group, n: number, bootMs: number): void {
    const live = g.insts.filter((i) => i.state !== 'retired');
    if (n > live.length) {
      const azs = g.node.azs?.length ? g.node.azs : ['a'];
      for (let k = live.length; k < n; k++) {
        const inst = new Inst(g, g.insts.length, azs[g.insts.length % azs.length], this.sim.now);
        this.equip(inst);
        g.insts.push(inst);
        if (bootMs > 0) {
          inst.state = 'booting';
          this.sim.after(bootMs, () => {
            if (inst.state === 'booting') this.setState(inst, 'up');
          });
        }
        if (g.kind === 'worker') this.startConsumers(inst);
      }
    } else if (n < live.length) {
      // remove the newest instances first
      const extra = live.slice(n).reverse();
      for (const i of extra) this.setState(i, 'retired');
    }
  }

  private startAutoscaler(g: Group): void {
    const node = g.node as AppNode | WorkerNode;
    const a = node.autoscale!;
    const interval = a.intervalMs ?? DEFAULTS.autoscale.intervalMs;
    const boot = a.bootMs ?? DEFAULTS.autoscale.bootMs;
    const cooldown = a.cooldownMs ?? DEFAULTS.autoscale.cooldownMs;
    const last = new Map<Inst, number>();
    const tick = () => {
      const live = g.insts.filter((i) => i.state !== 'retired');
      const up = live.filter((i) => i.state === 'up');
      let desired = live.length;
      if (node.kind === 'app') {
        const target = (a as NonNullable<AppNode['autoscale']>).targetCpu ?? DEFAULTS.autoscale.targetCpu;
        let busy = 0;
        let cap = 0;
        for (const i of up) {
          const s = i.cores.stats().busyArea;
          busy += s - (last.get(i) ?? 0);
          last.set(i, s);
          cap += i.cores.capacity * interval;
        }
        const util = cap > 0 ? busy / cap : 1;
        desired = Math.ceil((up.length * util) / target) || 1;
      } else {
        const per = (a as NonNullable<WorkerNode['autoscale']>).targetBacklog ?? 100;
        let backlog = 0;
        for (const q of this.groups.values()) if (q.kind === 'queue' && q.out.some((e) => e.to === g.id)) backlog += this.backlogOf(q);
        desired = Math.ceil(backlog / per);
      }
      desired = Math.max(a.min, Math.min(a.max, desired));
      if (desired > live.length) {
        this.scaleTo(g, desired, boot);
        g.lastScale = this.sim.now;
      } else if (desired < live.length && this.sim.now - g.lastScale >= cooldown) {
        this.scaleTo(g, desired, 0);
        g.lastScale = this.sim.now;
      }
      this.sim.after(interval, tick);
    };
    // first measurement after one interval
    for (const i of g.insts) last.set(i, 0);
    this.sim.after(interval, tick);
  }

  private startChaos(inst: Inst): void {
    const g = inst.g;
    const mtbf = g.node.mtbfMs!;
    const mttr = g.node.mttrMs!;
    const cycle = () => {
      this.sim.after(g.rng.exp(mtbf), () => {
        if (inst.state === 'up') this.setState(inst, 'down');
        this.sim.after(g.rng.exp(mttr), () => {
          if (inst.state === 'down') this.setState(inst, 'up');
          cycle();
        });
      });
    };
    cycle();
  }

  private addShard(g: Group): void {
    const before = g.shards.length;
    const old = new Map<number, number>();
    const keys = Math.max(this.t.keys, this.nextNewKey);
    const probe = (k: number) => this.shardOf(g, { op: 'read', key: k, user: k, fresh: 0, ryw: 0 });
    for (let k = 0; k < keys; k++) old.set(k, probe(k));
    let idx = g.insts.length;
    const add = () => {
      const node = g.node;
      const azs = node.azs?.length ? node.azs : ['a'];
      const inst = new Inst(g, idx, azs[idx % azs.length], this.sim.now);
      idx++;
      this.equip(inst);
      g.insts.push(inst);
      return inst;
    };
    g.shards.push(this.makeShard(g, before, add));
    this.buildRing(g);
    let moved = 0;
    const movedKeys: [number, number, number][] = [];
    for (let k = 0; k < keys; k++) {
      const s = probe(k);
      const from = old.get(k)!;
      if (s !== from) {
        moved++;
        movedKeys.push([k, from, s]);
      }
    }
    this.keysMoved += moved;
    // copy the data, and charge the destination for the writes (migration load)
    for (const [k, from, to] of movedKeys) {
      const v = g.shards[from].primary?.store?.get(k);
      const dest = g.shards[to].primary;
      if (v !== undefined && dest) dest.store!.set(k, v);
    }
    const self = this;
    const work = movedKeys.slice();
    for (let w = 0; w < 4; w++) {
      this.sim.spawn(
        (function* (): Proc<void> {
          while (work.length) {
            const [k, from, to] = work.pop()!;
            for (const s of [from, to]) {
              const p = g.shards[s].primary;
              if (p && p.state === 'up') yield* self.dbExec(p, { op: s === to ? 'write' : 'read', key: k, user: 0, fresh: 0, ryw: 0, ver: p.store!.get(k) ?? 0 });
            }
          }
        })(),
      );
    }
  }

  // ---------------------------------------------------------------- results

  private result(): SimResult {
    const end = this.spec.durationMs;
    const measured = end - this.measuredFrom;
    const nodes: Record<string, NodeStats> = {};
    let monthly = 0;
    const byNode: Record<string, number> = {};
    const monthScale = MONTH_MS / Math.max(1, measured);
    for (const g of this.groups.values()) {
      let busy = 0;
      let capTime = 0;
      let queue = 0;
      let maxQ = 0;
      let maxInst = 0;
      let instTime = 0;
      for (const i of g.insts) {
        this.closeUp(i);
        const s = i.cores.stats();
        const b = s.busyArea - i.baseline.busy;
        const born = Math.max(i.bornAt, this.measuredFrom);
        const died = i.diedAt ?? end;
        const life = Math.max(0, died - born);
        instTime += life;
        if (Number.isFinite(i.cores.capacity)) {
          busy += b;
          capTime += i.cores.capacity * life;
          if (life > 0) maxInst = Math.max(maxInst, b / (i.cores.capacity * life));
        }
        queue += i.threads.stats().queueArea - i.baseline.queue;
        maxQ = Math.max(maxQ, i.threads.maxQueueSeen);
      }
      const live = g.insts.filter((i) => i.state !== 'retired');
      const anyUp = this.anyUpShare(g);
      const st: NodeStats = {
        kind: g.kind,
        label: g.node.label ?? g.id,
        instances: live.length,
        maxInstances: g.insts.length,
        utilisation: capTime > 0 ? busy / capTime : 0,
        maxInstanceUtilisation: maxInst,
        avgQueue: measured > 0 ? queue / measured : 0,
        maxQueue: maxQ,
        handled: g.handled,
        errors: { ...g.errors },
        uptime: anyUp,
      };
      if (g.kind === 'cache' || g.kind === 'cdn') {
        st.hits = g.hits;
        st.misses = g.misses;
      }
      if (g.kind === 'db') {
        const node = g.node as DbNode;
        st.connections = Math.max(0, ...g.insts.map((i) => i.connsIn));
        st.maxConnections = node.maxConnections ?? SIZES[node.size ?? DEFAULTS.db.size].dbConns;
        st.replicaLagMs = Math.max(0, ...g.shards.flatMap((sh) => sh.replicas.map((r) => this.replicaLag(r))));
      }
      if (g.kind === 'queue') {
        st.backlog = this.backlogOf(g);
        st.maxBacklog = g.maxBacklog;
        st.dlq = g.dlq;
      }
      nodes[g.id] = st;
      // cost
      const months = instTime / Math.max(1, measured);
      let c = 0;
      const node = g.node;
      switch (node.kind) {
        case 'app':
          c = months * PRICES.app[node.size ?? DEFAULTS.app.size];
          break;
        case 'worker':
          c = months * PRICES.app.small;
          break;
        case 'db':
          c = months * PRICES.db[node.size ?? DEFAULTS.db.size];
          break;
        case 'cache':
          c = months * PRICES.cacheGb * ((node.memoryMb ?? DEFAULTS.cache.memoryMb) / 1024);
          break;
        case 'lb':
          c = months * PRICES.lb;
          break;
        case 'cdn':
          c = (this.bytesCdn / 1024 / 1024) * PRICES.cdnGb * monthScale;
          break;
        case 'queue':
          c = (this.queueOps / 1e6) * PRICES.queuePerMillion * monthScale;
          break;
        case 'objectstore':
          c = (this.objectGets / 1e6) * PRICES.objectGetPerMillion * monthScale;
          break;
        case 'external':
          c = (g.handled / 1e6) * ((g.node as ExternalNode).pricePerMillion ?? PRICES.externalPerMillion) * monthScale;
          break;
        case 'ratelimiter':
          c = months * PRICES.rateLimiter;
          break;
      }
      byNode[g.id] = round2(c);
      monthly += c;
    }
    const egress = (this.bytesOut / 1024 / 1024) * PRICES.egressGb * monthScale;
    if (egress > 0.005) byNode['egress'] = round2(egress);
    monthly += egress;

    let cacheHits = 0;
    let cacheMisses = 0;
    for (const g of this.groups.values())
      if (g.kind === 'cache') {
        cacheHits += g.hits;
        cacheMisses += g.misses;
      }
    let dlq = 0;
    let finalBacklog = 0;
    let maxBacklog = 0;
    for (const g of this.groups.values())
      if (g.kind === 'queue') {
        dlq += g.dlq;
        finalBacklog += this.backlogOf(g);
        maxBacklog += g.maxBacklog;
      }
    const ml = Float64Array.from(this.msgLat).sort();
    const edges: Record<string, { calls: number; failures: number }> = {};
    for (const [k, v] of this.edgeStats) edges[k] = { ...v };

    const window = (a: number, b: number) => this.windowStats(a, b);
    const all = window(this.warmupMs, end);
    const phases: Record<string, WindowStats> = {};
    for (const p of this.spec.phases ?? []) phases[p.name] = window(p.fromMs, p.toMs);
    return {
      ...all,
      durationMs: end,
      measuredMs: measured,
      warnings: this.warnings,
      cache: { hits: cacheHits, misses: cacheMisses, hitRatio: cacheHits + cacheMisses ? cacheHits / (cacheHits + cacheMisses) : null },
      cdn: { hits: this.cdnHits, misses: this.cdnMisses, hitRatio: this.cdnHits + this.cdnMisses ? this.cdnHits / (this.cdnHits + this.cdnMisses) : null },
      lostWrites: this.lostWrites,
      duplicates: this.duplicates,
      dlq,
      messages: { done: ml.length, p50: pct(ml, 0.5), p99: pct(ml, 0.99), maxBacklog, finalBacklog, drainedAtMs: this.drainedAt },
      keysMoved: this.keysMoved,
      nodes,
      edges,
      cost: { monthly: round2(monthly), byNode },
      phases,
      series: this.buildSeries(),
      events: this.sim.events,
      window,
    };
  }

  /** How far behind a replica is now: the oldest write not yet applied, or the last applied write's delay. */
  private replicaLag(r: Inst): number {
    if (r.state !== 'up') return 0;
    const oldest = r.pending.values().next();
    return Math.max(r.lastLag, oldest.done ? 0 : this.sim.now - oldest.value);
  }

  private anyUpShare(g: Group): number {
    if (g.kind === 'client') return 1;
    this.touchUp(g);
    const span = this.spec.durationMs - this.measuredFrom;
    return span > 0 ? Math.min(1, g.anyUpArea / span) : 1;
  }

  private windowStats(a: number, b: number): WindowStats {
    const lats: number[] = [];
    let req = 0;
    let ok = 0;
    let stale = 0;
    let ryw = 0;
    let degraded = 0;
    let sum = 0;
    const byError: Record<string, number> = {};
    for (let i = 0; i < this.n; i++) {
      const t = this.tStart[i];
      if (t < a || t >= b) continue;
      req++;
      const f = this.flags[i];
      if (f & 1) {
        ok++;
        const l = this.lat[i];
        lats.push(l);
        sum += l;
        if (f & 2) stale++;
        if (f & 4) ryw++;
        if (f & 8) degraded++;
      } else {
        const name = this.errNames[this.errCode[i]];
        byError[name] = (byError[name] ?? 0) + 1;
      }
    }
    const sorted = Float64Array.from(lats).sort();
    const secs = Math.max(1e-9, (Math.min(b, this.spec.durationMs) - a) / 1000);
    return {
      requests: req,
      ok,
      errors: req - ok,
      errorRate: req ? (req - ok) / req : 0,
      availability: req ? ok / req : 1,
      throughput: ok / secs,
      p50: pct(sorted, 0.5),
      p95: pct(sorted, 0.95),
      p99: pct(sorted, 0.99),
      mean: ok ? sum / ok : 0,
      max: sorted.length ? sorted[sorted.length - 1] : 0,
      staleReads: stale,
      rywViolations: ryw,
      degraded,
      byError,
    };
  }

  private buildSeries(): SeriesPoint[] {
    const bucket = this.bucketMs();
    const nb = Math.ceil(this.spec.durationMs / bucket);
    const lats: number[][] = Array.from({ length: nb }, () => []);
    const reqs = new Array(nb).fill(0);
    const errs = new Array(nb).fill(0);
    for (let i = 0; i < this.n; i++) {
      const k = Math.min(nb - 1, Math.floor(this.tStart[i] / bucket));
      reqs[k]++;
      if (this.flags[i] & 1) lats[k].push(this.lat[i]);
      else errs[k]++;
    }
    const out: SeriesPoint[] = [];
    let prevHits = 0;
    let prevMisses = 0;
    for (let k = 0; k < nb; k++) {
      const s = this.series[k] ?? { backlog: 0, instances: 0, hits: prevHits, misses: prevMisses };
      const dh = s.hits - prevHits;
      const dm = s.misses - prevMisses;
      prevHits = s.hits;
      prevMisses = s.misses;
      const sorted = Float64Array.from(lats[k]).sort();
      out.push({
        t: k * bucket,
        rps: (reqs[k] * 1000) / bucket,
        errRate: reqs[k] ? errs[k] / reqs[k] : 0,
        p50: pct(sorted, 0.5),
        p99: pct(sorted, 0.99),
        backlog: s.backlog,
        instances: s.instances,
        hitRatio: dh + dm > 0 ? dh / (dh + dm) : null,
      });
    }
    return out;
  }
}

function pct(sorted: Float64Array, p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function emptyResult(spec: RunSpec, invalid: string[], warnings: string[]): SimResult {
  const w: WindowStats = { requests: 0, ok: 0, errors: 0, errorRate: 0, availability: 0, throughput: 0, p50: 0, p95: 0, p99: 0, mean: 0, max: 0, staleReads: 0, rywViolations: 0, degraded: 0, byError: {} };
  return {
    ...w,
    durationMs: spec.durationMs,
    measuredMs: 0,
    invalid,
    warnings,
    cache: { hits: 0, misses: 0, hitRatio: null },
    cdn: { hits: 0, misses: 0, hitRatio: null },
    lostWrites: 0,
    duplicates: 0,
    dlq: 0,
    messages: { done: 0, p50: 0, p99: 0, maxBacklog: 0, finalBacklog: 0, drainedAtMs: null },
    keysMoved: 0,
    nodes: {},
    edges: {},
    cost: { monthly: 0, byNode: {} },
    phases: {},
    series: [],
    events: 0,
    window: () => w,
  };
}
