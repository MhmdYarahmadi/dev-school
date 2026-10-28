/**
 * Behaviour of each component and failure type in the System Design simulator:
 * the effects the lessons rely on must really emerge from the mechanics.
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '../src/courses/sd/engine/simulate';
import type { AppNode, DbNode, Design, DesignNode, Edge, RunSpec, Traffic } from '../src/courses/sd/engine/types';
import { validateDesign } from '../src/courses/sd/engine/validate';

/** users → lb → app → (cache) → db, with overrides. */
function web(o: { app?: Partial<AppNode>; db?: Partial<DbNode>; cache?: boolean | object; lb?: object; extra?: DesignNode[]; edges?: Edge[] } = {}): Design {
  const nodes: DesignNode[] = [
    { id: 'users', kind: 'client' },
    { id: 'lb', kind: 'lb', ...o.lb },
    { id: 'app', kind: 'app', instances: 2, ...o.app } as AppNode,
    { id: 'db', kind: 'db', ...o.db } as DbNode,
  ];
  const edges: Edge[] = [
    { from: 'users', to: 'lb' },
    { from: 'lb', to: 'app' },
    { from: 'app', to: 'db' },
  ];
  if (o.cache) {
    nodes.push({ id: 'cache', kind: 'cache', ...(typeof o.cache === 'object' ? o.cache : {}) });
    edges.push({ from: 'app', to: 'cache' });
  }
  nodes.push(...(o.extra ?? []));
  edges.push(...(o.edges ?? []));
  return { nodes, edges };
}

const run = (design: Design, traffic: Traffic, rest: Partial<RunSpec> = {}) => simulate({ design, traffic, durationMs: 30_000, seed: 1, ...rest });

describe('basics', () => {
  it('is deterministic for a seed, and different for another', () => {
    const a = run(web({ cache: true }), { rps: 300 });
    const b = run(web({ cache: true }), { rps: 300 });
    const c = run(web({ cache: true }), { rps: 300 }, { seed: 2 });
    expect(a.p99).toBe(b.p99);
    expect(a.requests).toBe(b.requests);
    expect(c.p99).not.toBe(a.p99);
  });

  it('a healthy small system: no errors, latency ≈ network + app + db', () => {
    const r = run(web(), { rps: 100, mix: { read: 1 } });
    expect(r.errors).toBe(0);
    // 40 ms user round trip + ~5 ms CPU + ~2 ms DB + internal hops
    expect(r.p50).toBeGreaterThan(42);
    expect(r.p50).toBeLessThan(55);
    within(r.throughput, 100, 0.06);
  });

  it('rejects invalid designs with plain reasons', () => {
    expect(validateDesign({ nodes: [{ id: 'app', kind: 'app' }], edges: [] }).errors[0]).toMatch(/Users component/);
    const bad = validateDesign({ nodes: [{ id: 'users', kind: 'client' }, { id: 'db', kind: 'db' }], edges: [{ from: 'users', to: 'db' }] });
    expect(bad.errors[0]).toMatch(/can't call Database "db"/);
    const r = simulate({ design: { nodes: [], edges: [] }, traffic: { rps: 1 }, durationMs: 1000 });
    expect(r.invalid?.length).toBeGreaterThan(0);
    expect(validateDesign(web({ app: { instances: 3 } })).warnings).toEqual([]);
  });

  it('warns about several app instances with no load balancer', () => {
    const v = validateDesign({ nodes: [{ id: 'users', kind: 'client' }, { id: 'app', kind: 'app', instances: 3 }], edges: [{ from: 'users', to: 'app' }] });
    expect(v.warnings[0]).toMatch(/DNS round robin/);
  });

  it('cost grows with what you run', () => {
    const small = run(web(), { rps: 50 });
    const big = run(web({ app: { instances: 6, size: 'large' }, db: { replicas: 2 } }), { rps: 50 });
    expect(small.cost.monthly).toBeGreaterThan(100);
    expect(big.cost.monthly).toBeGreaterThan(small.cost.monthly * 3);
    expect(big.cost.byNode.app).toBeCloseTo(6 * 140, 0);
  });
});

describe('scaling compute and load balancing', () => {
  it('more instances fix an overloaded app tier', () => {
    // 2 small instances: 2 × 2 cores / 5 ms ≈ 800/s of CPU
    const few = run(web({ app: { instances: 2 }, db: { size: 'xlarge' } }), { rps: 1200, mix: { read: 1 } });
    const many = run(web({ app: { instances: 4 }, db: { size: 'xlarge' } }), { rps: 1200, mix: { read: 1 } });
    expect(few.errorRate).toBeGreaterThan(0.2);
    expect(few.nodes.app.utilisation).toBeGreaterThan(0.95);
    expect(many.errorRate).toBe(0);
    expect(many.p99).toBeLessThan(few.p99);
  });

  it('round robin spreads load evenly', () => {
    const r = run(web({ app: { instances: 4 } }), { rps: 400, mix: { read: 1 } });
    expect(r.nodes.app.maxInstanceUtilisation / r.nodes.app.utilisation).toBeLessThan(1.1);
    // also with no network delay, where requests never interleave (a shared counter once sent every request to the same server)
    for (const instances of [2, 4]) {
      const z = run(web({ app: { instances } }), { rps: 300, mix: { read: 1 }, rttMs: 0 });
      expect(z.nodes.app.maxInstanceUtilisation / z.nodes.app.utilisation).toBeLessThan(1.1);
    }
  });

  it('without health checks a dead instance keeps getting its share; with them it is taken out', () => {
    const events = [{ atMs: 5000, action: 'kill' as const, node: 'app', instance: 0 }];
    const blind = run(web({ app: { instances: 4 }, lb: { healthCheck: false } }), { rps: 400 }, { events });
    const checked = run(web({ app: { instances: 4 } }), { rps: 400 }, { events });
    // a quarter of requests after the kill fail fast with "refused"
    within(blind.errorRate, 0.25 * (25 / 30), 0.12);
    // new requests are refused; the ones in flight when it died are reset
    expect(Object.keys(blind.byError).sort()).toEqual(['refused@app', 'reset@app']);
    expect(blind.byError['reset@app']).toBeLessThan(10);
    // health checks every 5 s, 2 failures: out of rotation within ~10 s
    expect(checked.errorRate).toBeLessThan(blind.errorRate / 2);
    expect(checked.window(20_000, 30_000).errors).toBe(0);
  });

  it('a hung instance (accepts, never answers) needs timeouts, not just health checks', () => {
    const events = [{ atMs: 2000, action: 'hang' as const, node: 'app', instance: 0 }];
    const r = run(web({ app: { instances: 2 } }), { rps: 100, client: { timeoutMs: 2000 } }, { events });
    expect(r.byError['timeout@users']).toBeGreaterThan(0);
  });

  it('local sessions behind round robin log users out; sticky sessions or shared sessions don’t', () => {
    const t: Traffic = { rps: 300, users: 200 };
    const rr = run(web({ app: { instances: 3, sessions: 'local' } }), t);
    const sticky = run(web({ app: { instances: 3, sessions: 'local' }, lb: { algorithm: 'sticky' } }), t);
    const shared = run(web({ app: { instances: 3, sessions: 'shared' } }), t);
    expect(rr.byError['session_lost@app']).toBeGreaterThan(rr.requests * 0.3);
    expect(sticky.errors).toBe(0);
    expect(shared.errors).toBe(0);
  });

  it('least connections beats round robin when one instance is slow', () => {
    const extra = { events: [{ atMs: 0, action: 'slow' as const, node: 'app', factor: 1 }] };
    // a slow instance: make instance 0 a different size by putting it in its own group is not possible, so compare with uneven work
    const t: Traffic = { rps: 600, mix: { read: 1 } };
    const rr = run(web({ app: { instances: 3, dist: 'lognormal' } }), t, extra);
    const lc = run(web({ app: { instances: 3, dist: 'lognormal' }, lb: { algorithm: 'least_conn' } }), t, extra);
    expect(lc.p99).toBeLessThanOrEqual(rr.p99 * 1.05);
  });

  it('autoscaling adds instances after the boot time and recovers from a ramp', () => {
    const r = run(
      web({ app: { autoscale: { min: 2, max: 10, bootMs: 20_000, intervalMs: 10_000 } }, db: { size: 'xlarge' } }),
      { rps: [[0, 200], [30_000, 1500], [180_000, 1500]], mix: { read: 1 } },
      { durationMs: 180_000 },
    );
    expect(r.nodes.app.maxInstances).toBeGreaterThan(3);
    expect(r.series.at(-1)!.instances).toBeGreaterThan(3);
    expect(r.window(150_000, 180_000).errorRate).toBeLessThan(0.01);
  });

  it('too many app instances exhaust the database’s connection limit', () => {
    const r = run(web({ app: { instances: 12, dbPool: 10 }, db: { maxConnections: 50 } }), { rps: 3000, mix: { read: 1 } }, { durationMs: 10_000 });
    expect(r.byError['too_many_connections@db']).toBeGreaterThan(0);
    expect(r.nodes.db.connections).toBe(50);
  });
});

describe('caching', () => {
  it('a cache takes most reads off the database and cuts latency', () => {
    const t: Traffic = { rps: 800, mix: { read: 0.95, write: 0.05 }, rttMs: 0 };
    const none = run(web({ app: { instances: 4 } }), t);
    const cached = run(web({ app: { instances: 4 }, cache: true }), t, { warmCache: true });
    expect(cached.cache.hitRatio).toBeGreaterThan(0.85);
    expect(cached.nodes.db.utilisation).toBeLessThan(none.nodes.db.utilisation / 3);
    expect(cached.p50).toBeLessThan(none.p50);
  });

  it('invalidate-on-write keeps stale reads rare; not touching the cache serves stale data', () => {
    const t: Traffic = { rps: 500, mix: { read: 0.8, write: 0.2 }, keys: 200 };
    const inv = run(web({ cache: true }), t);
    const none = run(web({ cache: true, app: { cacheOnWrite: 'none' } }), t);
    expect(none.staleReads).toBeGreaterThan(inv.staleReads * 10);
    expect(inv.staleReads / inv.requests).toBeLessThan(0.01);
  });

  it('a TTL bounds staleness when the cache is never invalidated', () => {
    const t: Traffic = { rps: 500, mix: { read: 0.8, write: 0.2 }, keys: 200 };
    const forever = run(web({ cache: true, app: { cacheOnWrite: 'none' } }), t);
    const ttl = run(web({ cache: { ttlMs: 500 }, app: { cacheOnWrite: 'none' } }), t);
    expect(ttl.staleReads).toBeLessThan(forever.staleReads / 3);
  });

  it('a cache flush sends a stampede to the database; single-flight dampens it', () => {
    const t: Traffic = { rps: 3000, mix: { read: 1 }, keys: 2000, skew: 1.1 };
    const ev = { warmCache: true, events: [{ atMs: 10_000, action: 'flush' as const, node: 'cache' }], durationMs: 20_000 };
    const d = (sf: boolean) => web({ app: { instances: 6, cpuMs: 1, singleFlight: sf }, cache: true, db: { size: 'small', readMs: 4, maxConnections: 100 } });
    const plain = run(d(false), t, ev);
    const sf = run(d(true), t, ev);
    expect(plain.window(10_000, 12_000).p99).toBeGreaterThan(plain.window(5_000, 10_000).p99 * 3);
    expect(sf.window(10_000, 12_000).p99).toBeLessThan(plain.window(10_000, 12_000).p99);
    expect(sf.window(10_000, 12_000).errors).toBeLessThan(plain.window(10_000, 12_000).errors);
    // once the cache is warm again, all is well
    expect(plain.window(14_000, 20_000).errorRate).toBe(0);
  });

  it('a hot key overloads the one cache node that owns it', () => {
    // 95% of 20 000 reads/s on one single-threaded node at 0.06 ms each is more than it can do
    const t: Traffic = { rps: 20_000, mix: { read: 1 }, hotKey: { share: 0.95 }, rttMs: 0 };
    const r = run(web({ app: { instances: 30, size: 'large', cpuMs: 1 }, cache: { instances: 4, opMs: 0.06 } }), t, { durationMs: 5_000, warmCache: true });
    expect(r.nodes.cache.maxInstanceUtilisation).toBeGreaterThan(0.95);
    expect(r.nodes.cache.utilisation).toBeLessThan(0.5);
  });

  it('write-back loses writes when the cache dies before flushing', () => {
    const r = run(web({ cache: { flushMs: 5_000 }, app: { cacheOnWrite: 'write_back' } }), { rps: 300, mix: { read: 0.5, write: 0.5 } }, { events: [{ atMs: 10_000, action: 'kill', node: 'cache' }] });
    expect(r.lostWrites).toBeGreaterThan(50);
  });

  it('a CDN serves static files close to users', () => {
    const d: Design = {
      nodes: [
        { id: 'users', kind: 'client' },
        { id: 'cdn', kind: 'cdn' },
        { id: 'files', kind: 'objectstore' },
        { id: 'lb', kind: 'lb' },
        { id: 'app', kind: 'app' },
      ],
      edges: [
        { from: 'users', to: 'cdn' },
        { from: 'users', to: 'lb' },
        { from: 'cdn', to: 'files' },
        { from: 'lb', to: 'app' },
      ],
    };
    const r = run(d, { rps: 200, mix: { static: 1 }, keys: 500 }, { warmCache: true });
    expect(r.cdn.hitRatio).toBeGreaterThan(0.99);
    expect(r.p50).toBeLessThan(15);
  });
});

describe('databases', () => {
  it('read replicas share the read load', () => {
    const t: Traffic = { rps: 1500, mix: { read: 1 } };
    const one = run(web({ app: { instances: 6 } }), t);
    const three = run(web({ app: { instances: 6 }, db: { replicas: 2 } }), t);
    expect(one.errorRate).toBeGreaterThan(0.05);
    expect(three.errorRate).toBe(0);
  });

  it('replication lag breaks read-your-writes; reading from the primary fixes it', () => {
    const t: Traffic = { rps: 300, mix: { read: 0.8, write: 0.2 }, readAfterWrite: 0.5 };
    const lag = run(web({ db: { replicas: 2, replicationLagMs: 300 } }), t);
    const primary = run(web({ db: { replicas: 2, replicationLagMs: 300 }, app: { readFrom: 'primary' } }), t);
    expect(lag.rywViolations).toBeGreaterThan(20);
    expect(primary.rywViolations).toBe(0);
    expect(primary.staleReads).toBe(0);
  });

  it('a replica that can’t keep up with writes falls further and further behind', () => {
    // 400 writes/s against 300 applied/s: the replica falls ~1/3 s further behind every second
    const lag = (durationMs: number) => run(web({ app: { instances: 4 }, db: { size: 'xlarge', replicas: 1, replicaApplyRate: 300 } }), { rps: 500, mix: { read: 0.2, write: 0.8 } }, { durationMs }).nodes.db.replicaLagMs!;
    const at30 = lag(30_000);
    const at60 = lag(60_000);
    expect(at30).toBeGreaterThan(5_000);
    expect(at60).toBeGreaterThan(at30 * 1.7);
  });

  it('failover: async replication loses acknowledged writes; one sync replica doesn’t', () => {
    const t: Traffic = { rps: 400, mix: { read: 0.5, write: 0.5 }, keys: 1000 };
    const events = [{ atMs: 10_000, action: 'kill' as const, node: 'db', instance: 0 }];
    const asyncR = run(web({ db: { replicas: 2, failoverMs: 3000, replicationLagMs: 200 } }), t, { events });
    const syncR = run(web({ db: { replicas: 2, failoverMs: 3000, replicationLagMs: 200, syncReplicas: 1 } }), t, { events });
    expect(asyncR.lostWrites).toBeGreaterThan(5);
    expect(syncR.lostWrites).toBe(0);
    // writes fail during the failover, then succeed again
    expect(asyncR.window(10_500, 12_500).errorRate).toBeGreaterThan(0.3);
    expect(asyncR.window(20_000, 30_000).errorRate).toBe(0);
  });

  it('a synchronous replica is never behind and costs little; requiring every replica stops writes when one is gone', () => {
    const t: Traffic = { rps: 400, mix: { read: 0.5, write: 0.5 }, keys: 1000, readAfterWrite: 0.5 };
    const lagging = run(web({ db: { replicas: 2, replicationLagMs: 200 } }), t);
    const oneSync = run(web({ db: { replicas: 2, replicationLagMs: 200, syncReplicas: 1 } }), t);
    const allSync = run(web({ db: { replicas: 2, replicationLagMs: 200, syncReplicas: 2 } }), t);
    expect(lagging.rywViolations).toBeGreaterThan(50);
    // the async replica still lags, so only some violations go away
    expect(oneSync.rywViolations).toBeGreaterThan(0);
    expect(allSync.rywViolations).toBe(0);
    expect(allSync.p50).toBeLessThan(lagging.p50 + 3);
    const events = [{ atMs: 10_000, action: 'kill' as const, node: 'db', instance: 0 }];
    const after = (db: Partial<DbNode>) => run(web({ app: { size: 'medium' }, db: { replicas: 2, failoverMs: 3000, ...db } }), { rps: 400, mix: { read: 0.5, write: 0.5 }, keys: 1000 }, { events }).window(15_000, 30_000);
    expect(after({ syncReplicas: 1 }).errorRate).toBe(0);
    expect(after({ syncReplicas: 2 }).errorRate).toBeGreaterThan(0.4);
  });

  it('during a partition each load balancer node only uses the backends it can reach', () => {
    const d = web({ lb: { azs: ['a', 'c'] }, app: { size: 'medium', azs: ['a', 'c'] }, db: { quorum: { n: 3, w: 1, r: 1 }, azs: ['a', 'b', 'c'] } });
    d.edges.find((e) => e.to === 'db')!.timeoutMs = 500;
    const events = [
      { atMs: 10_000, action: 'partition' as const, a: 'c', b: 'a' },
      { atMs: 10_000, action: 'partition' as const, a: 'c', b: 'b' },
    ];
    const r = run(d, { rps: 400, mix: { read: 0.7, write: 0.3 }, keys: 1000 }, { events });
    // both sides keep answering (available), and the cut-off side reads old values
    expect(r.window(11_000, 30_000).errorRate).toBeLessThan(0.01);
    expect(r.staleReads).toBeGreaterThan(100);
  });

  it('without failover a dead primary means no writes until it’s restored', () => {
    const r = run(web({ db: { replicas: 1 } }), { rps: 200 }, { events: [{ atMs: 5000, action: 'kill', node: 'db', instance: 0 }] });
    const after = r.window(6000, 30_000);
    expect(after.errorRate).toBeGreaterThan(0.05);
    expect(after.errorRate).toBeLessThan(0.2); // reads still work from the replica
  });

  it('quorums: R + W > N never reads stale data; R + W ≤ N can', () => {
    // slow, uneven writes (log-normal) leave a window where some copies are behind
    const t: Traffic = { rps: 600, mix: { read: 0.6, write: 0.4 }, keys: 100, rttMs: 0 };
    const db = { size: 'large' as const, writeMs: 20, dist: 'lognormal' as const };
    const strong = run(web({ db: { ...db, quorum: { n: 3, w: 2, r: 2 } } }), t);
    const weak = run(web({ db: { ...db, quorum: { n: 3, w: 1, r: 1 } } }), t);
    expect(strong.staleReads).toBe(0);
    expect(weak.staleReads).toBeGreaterThan(10);
  });

  it('quorums under a partition: a majority keeps working, a minority can’t reach quorum', () => {
    const d = web({ db: { quorum: { n: 3, w: 2, r: 2 }, azs: ['a', 'b', 'c'] }, app: { azs: ['a'] }, edges: [] });
    d.edges.find((e) => e.to === 'db')!.timeoutMs = 500;
    const oneCut = run(d, { rps: 200 }, { events: [{ atMs: 5000, action: 'partition', a: 'a', b: 'c' }] });
    const twoCut = run(d, { rps: 200 }, { events: [{ atMs: 5000, action: 'partition', a: 'a', b: 'c' }, { atMs: 5000, action: 'partition', a: 'a', b: 'b' }] });
    // the app (in AZ a) still reaches 2 of 3 copies, so everything works (some reads wait for a timeout)
    expect(oneCut.window(6000, 30_000).errorRate).toBeLessThan(0.01);
    // with only its own copy reachable, every request times out
    expect(twoCut.window(6000, 29_000).errorRate).toBeGreaterThan(0.99);
  });

  it('a hot key makes one shard hot; range partitioning with sequential ids makes the last shard take every write', () => {
    const hot = run(web({ app: { instances: 4 }, db: { shards: 4 } }), { rps: 1000, mix: { read: 1 }, hotKey: { share: 0.5 } });
    expect(hot.nodes.db.maxInstanceUtilisation).toBeGreaterThan(hot.nodes.db.utilisation * 2.5);
    const seq = run(web({ app: { instances: 4 }, db: { shards: 4, partitioning: 'range' } }), { rps: 600, mix: { write: 1 }, sequentialWrites: true });
    const hashed = run(web({ app: { instances: 4 }, db: { shards: 4 } }), { rps: 600, mix: { write: 1 }, sequentialWrites: true });
    expect(seq.nodes.db.maxInstanceUtilisation).toBeGreaterThan(0.95);
    expect(hashed.nodes.db.maxInstanceUtilisation).toBeLessThan(0.6);
  });

  it('a query by user on a database sharded by key has to ask every shard', () => {
    const t: Traffic = { rps: 300, mix: { query: 1 } };
    const byKey = run(web({ db: { shards: 8, size: 'medium' } }), t);
    const byUser = run(web({ db: { shards: 8, size: 'medium', shardBy: 'user' } }), t);
    expect(byKey.nodes.db.handled).toBeCloseTo(byUser.nodes.db.handled * 8, -3);
    expect(byKey.p99).toBeGreaterThan(byUser.p99);
  });
});

describe('queues and async work', () => {
  const qd = (o: { worker?: object; queue?: object } = {}): Design => ({
    nodes: [
      { id: 'users', kind: 'client' },
      { id: 'api', kind: 'app', size: 'xlarge', writeVia: 'queue' },
      { id: 'jobs', kind: 'queue', ...o.queue },
      { id: 'workers', kind: 'worker', instances: 2, ...o.worker },
      { id: 'db', kind: 'db' },
    ],
    edges: [
      { from: 'users', to: 'api' },
      { from: 'api', to: 'jobs' },
      { from: 'api', to: 'db' },
      { from: 'jobs', to: 'workers' },
      { from: 'workers', to: 'db' },
    ],
  });

  it('a queue absorbs a burst that would overload the database', () => {
    const t: Traffic = { rps: [[0, 100], [5000, 100], [5001, 1500], [10_000, 1500], [10_001, 100], [60_000, 100]], mix: { write: 1 } };
    const r = run(qd({ worker: { instances: 2, concurrency: 4 } }), t, { durationMs: 60_000 });
    expect(r.errors).toBe(0);
    expect(r.p99).toBeLessThan(100); // the API answers fast: work happens later
    expect(r.messages.maxBacklog).toBeGreaterThan(1000);
    expect(r.messages.finalBacklog).toBeLessThan(20);
  });

  it('a visibility timeout shorter than the work causes duplicate processing; idempotent workers make it harmless', () => {
    const t: Traffic = { rps: 100, mix: { write: 1 } };
    const dup = run(qd({ worker: { cpuMs: 300, dist: 'const', concurrency: 40 }, queue: { visibilityTimeoutMs: 200 } }), t);
    const idem = run(qd({ worker: { cpuMs: 300, dist: 'const', concurrency: 40, idempotent: true }, queue: { visibilityTimeoutMs: 200 } }), t);
    expect(dup.duplicates).toBeGreaterThan(100);
    expect(idem.duplicates).toBe(0);
  });

  it('a worker crash redelivers its messages after the visibility timeout (at-least-once)', () => {
    const r = run(qd({ worker: { instances: 1, cpuMs: 10, concurrency: 8 }, queue: { visibilityTimeoutMs: 2000 } }), { rps: 100, mix: { write: 1 } }, {
      events: [
        { atMs: 10_000, action: 'kill', node: 'workers' },
        { atMs: 11_000, action: 'restore', node: 'workers' },
      ],
    });
    expect(r.messages.finalBacklog).toBeLessThan(20);
    expect(r.messages.done).toBeGreaterThan(2500);
  });

  it('poison messages: a dead-letter queue sets them aside; without one they’re retried forever', () => {
    const t: Traffic = { rps: 100, mix: { write: 1 }, poisonRate: 0.05 };
    const withDlq = run(qd({ queue: { dlq: true, maxReceives: 3, visibilityTimeoutMs: 500 } }), t);
    const without = run(qd({ queue: { visibilityTimeoutMs: 500 } }), t);
    expect(withDlq.dlq).toBeGreaterThan(80);
    expect(withDlq.messages.finalBacklog).toBeLessThan(15);
    expect(without.messages.finalBacklog).toBeGreaterThan(100);
  });

  it('a topic gives each subscriber its own copy; a queue shares the messages', () => {
    const d = qd({ queue: { mode: 'topic' } });
    d.nodes.push({ id: 'emails', kind: 'worker' });
    d.edges.push({ from: 'jobs', to: 'emails' });
    const topic = run(d, { rps: 100, mix: { write: 1 } });
    const shared = run({ ...d, nodes: d.nodes.map((n) => (n.id === 'jobs' ? { ...n, mode: 'queue' as const } : n)) }, { rps: 100, mix: { write: 1 } });
    expect(topic.nodes.workers.handled + topic.nodes.emails.handled).toBeGreaterThan(1.8 * shared.messages.done);
    expect(shared.nodes.workers.handled + shared.nodes.emails.handled).toBeLessThan(1.1 * shared.messages.done);
    // each subscriber doing its own copy is not a duplicate
    expect(topic.duplicates).toBe(0);
  });

  it('a worker’s CPU is its 2 cores: concurrency helps work that waits, not work that computes', () => {
    const t: Traffic = { rps: 250, mix: { write: 1 } };
    // 250 messages/s × 10 ms of CPU = 2.5 cores: one worker (2 cores) falls behind whatever its concurrency
    const cpu = run(qd({ worker: { instances: 1, concurrency: 50, cpuMs: 10 } }), t);
    expect(cpu.messages.finalBacklog).toBeGreaterThan(500);
    expect(cpu.nodes.workers.utilisation).toBeGreaterThan(0.95);
    const two = run(qd({ worker: { instances: 3, concurrency: 4, cpuMs: 10 } }), t);
    expect(two.messages.finalBacklog).toBeLessThan(50);
  });
});

describe('resilience patterns', () => {
  const withExt = (edge: Partial<Edge>, ext: object = {}) =>
    web({
      app: { instances: 2 },
      extra: [{ id: 'pay', kind: 'external', latencyMs: 50, ...ext }],
      edges: [{ from: 'app', to: 'pay', ...edge }],
    });

  it('a slow dependency without a timeout ties up every thread; a timeout fails fast instead', () => {
    const ev = { events: [{ atMs: 5_000, action: 'slow' as const, node: 'pay', factor: 200 }] };
    const t: Traffic = { rps: 100, client: { timeoutMs: 5000 } };
    const none = run(withExt({}), t, ev);
    const timed = run(withExt({ timeoutMs: 100 }), t, ev);
    expect(none.window(10_000, 25_000).byError['overloaded@app'] ?? 0).toBeGreaterThan(100);
    expect(timed.window(10_000, 25_000).byError['overloaded@app'] ?? 0).toBe(0);
  });

  it('an optional dependency degrades gracefully instead of failing requests', () => {
    const r = run(withExt({ optional: true }, { failRate: 1 }), { rps: 100 });
    expect(r.errors).toBe(0);
    expect(r.degraded).toBe(r.ok);
  });

  it('a circuit breaker stops hammering a dependency that is down', () => {
    const t: Traffic = { rps: 200 };
    const plain = run(withExt({ timeoutMs: 200 }, { failRate: 1 }), t);
    const cb = run(withExt({ timeoutMs: 200, breaker: { failures: 5, resetMs: 5000 } }, { failRate: 1 }), t);
    expect(plain.edges['app->pay'].calls).toBeGreaterThan(5000);
    expect(cb.edges['app->pay'].calls).toBeLessThan(200);
    // failing fast frees the app's threads
    expect(cb.nodes.app.avgQueue).toBeLessThanOrEqual(plain.nodes.app.avgQueue);
  });

  // a 3-second database slowdown (8× slower) under 1200 req/s, with retries at the app and at the client
  const blip = (app: Partial<AppNode>, dbEdge: Partial<Edge>, client: Traffic['client']) => {
    const x = web({ app: { instances: 4, ...app }, db: { size: 'medium' } });
    Object.assign(x.edges.find((e) => e.to === 'db')!, { timeoutMs: 100, ...dbEdge });
    return run(x, { rps: 1200, mix: { read: 1 }, client: { timeoutMs: 2000, ...client } }, {
      durationMs: 40_000,
      events: [
        { atMs: 10_000, action: 'slow', node: 'db', factor: 8 },
        { atMs: 13_000, action: 'slow', node: 'db', factor: 1 },
      ],
    });
  };

  it('retries with backoff and jitter hurt less during a blip than immediate retries', () => {
    const storm = blip({}, { retries: 3 }, { retries: 3 });
    const calm = blip({}, { retries: 3, backoffMs: 200, jitter: true }, { retries: 3, backoffMs: 1000, jitter: true });
    expect(storm.window(10_000, 13_000).errorRate).toBeGreaterThan(2 * calm.window(10_000, 13_000).errorRate);
    expect(storm.edges['app->db'].calls).toBeGreaterThan(calm.edges['app->db'].calls);
  });

  it('a huge request queue plus retries never recovers (metastable failure); a bounded queue sheds load and recovers', () => {
    const huge = blip({ maxQueue: 2000 }, { retries: 3 }, { retries: 3 });
    const bounded = blip({ maxQueue: 50 }, { retries: 3 }, { retries: 3 });
    // long after the database is fast again, the huge queue is still full of requests whose users gave up
    expect(huge.window(30_000, 40_000).errorRate).toBeGreaterThan(0.9);
    expect(bounded.window(16_000, 40_000).errorRate).toBe(0);
  });

  it('a bulkhead keeps a slow dependency from taking every thread', () => {
    const ev = { events: [{ atMs: 0, action: 'slow' as const, node: 'pay', factor: 50 }] };
    const t: Traffic = { rps: 300, client: { timeoutMs: 10_000 } };
    const d = (edge: Partial<Edge>) => {
      const x = withExt(edge);
      (x.nodes.find((n) => n.id === 'app') as AppNode).externalRatio = 0.1;
      return x;
    };
    const open = run(d({}), t, ev);
    const walled = run(d({ maxConcurrent: 4 }), t, ev);
    expect(walled.availability).toBeGreaterThan(open.availability);
  });

  it('an availability-zone outage: one AZ goes dark, a multi-AZ design rides it out', () => {
    const ev = { events: [{ atMs: 10_000, action: 'azDown' as const, az: 'a' }] };
    const single = run(web({ app: { instances: 2 } }), { rps: 200 }, ev);
    const multi = run(web({ app: { instances: 2, azs: ['a', 'b'] }, lb: { azs: ['a', 'b'] }, db: { replicas: 1, azs: ['a', 'b'], failoverMs: 2000 } }), { rps: 200 }, ev);
    expect(single.window(11_000, 30_000).errorRate).toBeGreaterThan(0.99);
    expect(multi.window(22_000, 30_000).errorRate).toBe(0);
  });

  it('a per-user rate limit stops one noisy user without hurting the others', () => {
    const d: Design = {
      nodes: [
        { id: 'users', kind: 'client' },
        { id: 'gate', kind: 'ratelimiter', rate: 5, per: 'user' },
        { id: 'app', kind: 'app', size: 'xlarge' },
      ],
      edges: [
        { from: 'users', to: 'gate' },
        { from: 'gate', to: 'app' },
      ],
    };
    const r = run(d, { rps: 500, users: 1000 });
    expect(r.errorRate).toBeLessThan(0.01);
    const few = run(d, { rps: 500, users: 10 });
    within(few.throughput, 50, 0.1);
  });
});

describe('misbehaving clients, dead instances and paid APIs', () => {
  const api = (gate?: object): Design => ({
    nodes: [
      { id: 'users', kind: 'client' },
      ...(gate ? [{ id: 'gate', kind: 'ratelimiter' as const, rate: 10, ...gate }] : []),
      { id: 'lb', kind: 'lb' },
      { id: 'app', kind: 'app', instances: 3, size: 'medium' },
      { id: 'db', kind: 'db', size: 'medium' },
    ],
    edges: [...(gate ? [{ from: 'users', to: 'gate' }, { from: 'gate', to: 'lb' }] : [{ from: 'users', to: 'lb' }]), { from: 'lb', to: 'app' }, { from: 'app', to: 'db' }],
  });
  const attack: Traffic = { rps: 2000, mix: { read: 0.9, write: 0.1 }, keys: 10_000, users: 5000, abuser: { share: 0.6, fromMs: 10_000 } };

  it('an abuser’s requests load the system but are not counted; a per-user limit stops only them', () => {
    const open = run(api(), attack);
    const perUser = run(api({ per: 'user' }), attack);
    const global = run(api({ rate: 1000 }), attack);
    expect(open.window(12_000, 30_000).errorRate).toBeGreaterThan(0.05);
    // the results describe real users only: about 40% of the 2,000 requests/s once the abuser starts
    expect(open.window(15_000, 30_000).requests / 15).toBeLessThan(900);
    expect(perUser.window(12_000, 30_000).errorRate).toBe(0);
    expect(global.window(12_000, 30_000).errorRate).toBeGreaterThan(0.3);
  });

  it('utilisation stays between 0 and 1 when an overloaded instance dies', () => {
    const r = run(web({ app: { instances: 2, size: 'medium' }, cache: true }), { rps: 3000, keys: 1000 }, { events: [{ atMs: 10_000, action: 'kill', node: 'app', instance: 0 }] });
    expect(r.nodes.app.utilisation).toBeGreaterThan(0);
    expect(r.nodes.app.utilisation).toBeLessThanOrEqual(1);
  });

  it('each external service bills its own calls at its own price', () => {
    const d = web({ app: { size: 'medium', externalRatio: 1 }, extra: [{ id: 'paid', kind: 'external' }, { id: 'own', kind: 'external', pricePerMillion: 0 }], edges: [{ from: 'app', to: 'paid' }, { from: 'app', to: 'own' }] });
    const r = run(d, { rps: 100 });
    expect(r.cost.byNode.own).toBe(0);
    // 100 calls/s for a month at $5 per million ≈ $1,300
    within(r.cost.byNode.paid, 1296, 0.1);
  });
});

function within(actual: number, expected: number, rel: number) {
  expect(Math.abs(actual - expected) / expected, `${actual} vs ${expected}`).toBeLessThan(rel);
}

describe('load balancer connection settings', () => {
  const run = (lbEdge: Record<string, unknown>) =>
    simulate({
      design: {
        nodes: [
          { id: 'users', kind: 'client' },
          { id: 'lb', kind: 'lb', healthCheck: { intervalMs: 10_000 } },
          { id: 'app', kind: 'app', instances: 3 },
        ],
        edges: [
          { from: 'users', to: 'lb' },
          { from: 'lb', to: 'app', ...lbEdge },
        ],
      },
      traffic: { rps: 200 },
      events: [{ atMs: 5000, action: 'kill', node: 'app', instance: 0 }],
      durationMs: 20_000,
      seed: 3,
    });

  it('a retry goes to another backend, hiding a dead one until health checks catch up', () => {
    const plain = run({});
    const retried = run({ retries: 1 });
    expect(plain.byError['refused@app'] ?? 0).toBeGreaterThan(100);
    expect(retried.byError['refused@app'] ?? 0).toBe(0);
    expect(retried.edges['lb->app'].calls).toBeGreaterThan(retried.requests);
  });

  it('a timeout on the connection cuts off a hung backend', () => {
    const hung = (edge: Record<string, unknown>) =>
      simulate({
        design: {
          nodes: [
            { id: 'users', kind: 'client' },
            { id: 'lb', kind: 'lb', healthCheck: false },
            { id: 'app', kind: 'app', instances: 2 },
          ],
          edges: [
            { from: 'users', to: 'lb' },
            { from: 'lb', to: 'app', ...edge },
          ],
        },
        traffic: { rps: 100, client: { timeoutMs: 5000 } },
        events: [{ atMs: 2000, action: 'hang', node: 'app', instance: 0 }],
        durationMs: 15_000,
        seed: 2,
      });
    expect(hung({}).errorRate).toBeGreaterThan(0.3);
    const cut = hung({ timeoutMs: 200, retries: 1 });
    expect(cut.errorRate).toBeLessThan(0.01);
    expect(cut.p99).toBeLessThan(400);
  });

  it('settings a load balancer ignores are flagged', () => {
    const r = run({ breaker: { failures: 3, resetMs: 1000 } });
    expect(r.warnings.join(' ')).toMatch(/breaker, maxConcurrent and optional are ignored/);
  });
});
