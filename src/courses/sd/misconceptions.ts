/**
 * Common system-design mix-ups, detected from the design, how it was run and what happened.
 * Shown under a failed check (never in tests), each with the idea that fixes it.
 */
import type { AppNode, DbNode, Design, WorkerNode } from './engine';
import type { SdRun } from './engine/scenario';
import type { SdOutcome } from './check';

export interface SdMisconception {
  id: string;
  title: string;
  explain: string;
}

interface Ctx {
  design: Design;
  run: SdRun;
  outcome: SdOutcome;
}

type Rule = SdMisconception & { test: (c: Ctx) => boolean };

const errShare = (c: Ctx, type: RegExp) => {
  const r = c.outcome.result;
  if (!r?.requests) return 0;
  return Object.entries(r.byError).reduce((s, [k, n]) => (type.test(k.split('@')[0]) ? s + n : s), 0) / r.requests;
};
const nodesOf = <K extends Design['nodes'][number]['kind']>(d: Design, kind: K) => d.nodes.filter((n) => n.kind === kind) as Extract<Design['nodes'][number], { kind: K }>[];
const failedCheck = (c: Ctx, metrics: string[]) => c.outcome.checks?.filter((x) => !x.ok && metrics.includes(x.req.metric)) ?? [];
const writeShare = (run: SdRun) => {
  const m = run.traffic.mix ?? { read: 0.9, write: 0.1 };
  const total = (m.read ?? 0) + (m.write ?? 0) + (m.static ?? 0) + (m.query ?? 0);
  return total ? (m.write ?? 0) / total : 0;
};

const RULES: Rule[] = [
  {
    id: 'p99-vs-average',
    title: 'p99 is not the average',
    explain:
      'The **average** hides the slow tail: if 1 request in 100 waits in a queue for 2 seconds, the average barely moves but **p99** (the time 99% of requests beat) does. Fix what makes the slowest requests slow: queueing near full capacity, cache misses, retries, a slow dependency.',
    test: (c) => failedCheck(c, ['p99', 'p95']).some((x) => (c.outcome.result?.mean ?? Infinity) < x.req.value),
  },
  {
    id: 'cache-writes',
    title: 'A cache speeds up reads, not writes',
    explain:
      'With cache-aside, every **write** still goes to the database (and then invalidates or updates the cache). When writes are the load, a bigger cache doesn\'t help: make writes cheaper (a bigger or sharded database) or smooth them out with a queue.',
    test: (c) =>
      nodesOf(c.design, 'cache').length > 0 &&
      writeShare(c.run) >= 0.4 &&
      c.outcome.status === 'wrong' &&
      nodesOf(c.design, 'db').some((d) => (c.outcome.result?.nodes[d.id]?.maxInstanceUtilisation ?? 0) > 0.8),
  },
  {
    id: 'local-sessions',
    title: 'Sessions in one server\'s memory',
    explain:
      'A load balancer sends each request to *any* app server, so a session stored in one server\'s memory is missing on the others and the user is logged out. Keep app servers **stateless**: store sessions in a shared store (`sessions: shared`). Sticky routing (`algorithm: sticky`) works too, until that server dies.',
    test: (c) => errShare(c, /^session_lost$/) > 0,
  },
  {
    id: 'retry-storm',
    title: 'Retries without backoff make overload worse',
    explain:
      'When a service is slow because it\'s overloaded, retrying **immediately** multiplies the load on it, so it gets slower and more calls time out and retry: a retry storm. Retry a little (1–2 times), wait between attempts (**backoff**, doubling each time) with **jitter** so clients don\'t retry in sync, and give up early with a timeout.',
    test: (c) => {
      const noBackoff = c.design.edges.some((e) => (e.retries ?? 0) > 0 && !e.backoffMs) || ((c.run.traffic.client?.retries ?? 0) > 0 && !c.run.traffic.client?.backoffMs);
      return noBackoff && errShare(c, /^(timeout|overloaded|queue_full)$/) > 0.01;
    },
  },
  {
    id: 'single-point-of-failure',
    title: 'A single point of failure',
    explain:
      'If one instance (or one zone) going down takes the whole service down, that part is a **single point of failure**. Run at least two instances of everything stateful *and* stateless, spread them over zones (`azs: [a, b]`), put a load balancer with health checks in front of app servers, and give the database a replica with automatic **failover**.',
    test: (c) => {
      const events = c.run.events ?? [];
      if (!events.some((e) => e.action === 'kill' || e.action === 'hang' || e.action === 'azDown')) return false;
      if (errShare(c, /^(refused|reset|no_backend|unavailable|timeout)$/) < 0.01) return false;
      return c.design.nodes.some((n) => {
        if (n.kind === 'client') return false;
        const single = n.kind === 'db' ? !(n.replicas && n.failoverMs !== undefined) && !n.quorum : ((n as AppNode).instances ?? 1) < 2 || (n.azs?.length ?? 1) < 2;
        return single && events.some((e) => ('node' in e && e.node === n.id) || e.action === 'azDown');
      });
    },
  },
  {
    id: 'read-your-writes',
    title: 'Reading your own write from a replica',
    explain:
      'Replicas copy the primary **a little later** (replication lag). A user who saves something and immediately reloads may read from a replica that hasn\'t got it yet. For read-your-writes: read from the primary for a short time after that user writes, or for that user\'s own data (`readFrom: primary`), or wait for the replica to catch up.',
    test: (c) => (c.outcome.result?.rywViolations ?? 0) > 0 && nodesOf(c.design, 'app').some((a) => a.readFrom !== 'primary') && nodesOf(c.design, 'db').some((d) => (d.replicas ?? 0) > 0),
  },
  {
    id: 'hot-shard',
    title: 'One shard gets most of the load',
    explain:
      'Sharding only spreads load if the **shard key** spreads it. A celebrity, a viral item or ever-increasing keys (timestamps, auto-increment ids with range partitioning) send most requests to one shard while the others idle. Pick a key with many evenly used values, hash it, or split the hot key (and cache it).',
    test: (c) =>
      nodesOf(c.design, 'db').some((d: DbNode) => {
        const s = c.outcome.result?.nodes[d.id];
        return (d.shards ?? 1) > 1 && !!s && s.maxInstanceUtilisation > 0.7 && s.maxInstanceUtilisation > 1.5 * s.utilisation;
      }),
  },
  {
    id: 'idempotency',
    title: 'At-least-once delivery needs idempotent consumers',
    explain:
      'Queues deliver a message **at least once**: if a worker is slow or dies before acknowledging, the message is delivered again. Without idempotency the side effect happens twice (two emails, two charges). Make processing idempotent: remember processed message ids, or make the effect naturally repeatable (`idempotent: true`).',
    test: (c) => (c.outcome.result?.duplicates ?? 0) > 0 && nodesOf(c.design, 'worker').some((w: WorkerNode) => !w.idempotent),
  },
  {
    id: 'pool-math',
    title: 'More app servers means more database connections',
    explain:
      'Every app instance keeps its **own** connection pool. 20 instances × a pool of 10 = 200 connections, and a database only accepts so many. Adding app servers can *break* the database. Keep instances × pool size under the limit: smaller pools, a bigger database, or a connection pooler.',
    test: (c) => errShare(c, /^too_many_connections$/) > 0,
  },
];

export function detectSdMisconceptions(c: Ctx): SdMisconception[] {
  if (!c.outcome.result || c.outcome.status === 'correct') return [];
  return RULES.filter((r) => {
    try {
      return r.test(c);
    } catch {
      return false;
    }
  }).map(({ id, title, explain }) => ({ id, title, explain }));
}
