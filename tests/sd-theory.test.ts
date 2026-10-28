/**
 * Proof of accuracy for the System Design simulator: long seeded runs must
 * reproduce known closed-form results within a small tolerance.
 */
import { describe, expect, it } from 'vitest';
import { zipf } from '../src/courses/sd/engine/rng';
import { simulate } from '../src/courses/sd/engine/simulate';
import { availability, cheHitRatio, drainTime, erlangC, mmc, movedShare, parallelAvailability, retryAttempts } from '../src/courses/sd/engine/theory';
import type { AppNode, Design, RunSpec, Size } from '../src/courses/sd/engine/types';

const within = (actual: number, expected: number, rel: number) => {
  expect(Math.abs(actual - expected) / expected, `${actual} vs ${expected}`).toBeLessThan(rel);
};

/** One app server pool with c threads in front of nothing: exactly an M/M/c queue. */
function queueDesign(c: number, cpuMs: number, size: Size): Design {
  const app: AppNode = { id: 'app', kind: 'app', threads: c, size, cpuMs, maxQueue: 1e9 };
  return { nodes: [{ id: 'users', kind: 'client' }, app], edges: [{ from: 'users', to: 'app' }] };
}

function runMany(spec: Omit<RunSpec, 'seed'>, seeds: number) {
  return Array.from({ length: seeds }, (_, i) => simulate({ ...spec, seed: i + 1 }));
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('the formulas themselves', () => {
  it('Erlang C matches textbook values', () => {
    expect(erlangC(1, 0.5)).toBeCloseTo(0.5, 10); // M/M/1: P(wait) = ρ
    expect(erlangC(2, 1)).toBeCloseTo(1 / 3, 10);
    expect(erlangC(10, 8)).toBeCloseTo(0.409, 3);
  });
  it('retries and redundancy', () => {
    expect(retryAttempts(0.5, 1)).toBeCloseTo(1.5);
    expect(parallelAvailability(0.99, 2)).toBeCloseTo(0.9999);
  });
});

describe('queueing: the simulator behaves like M/M/c', () => {
  it('M/M/1 at 70% load: mean, p99 and utilisation', () => {
    // λ = 140/s, service 5 ms (μ = 200/s): W = 1/(μ−λ) = 16.7 ms; time in system is exponential, so p99 = ln(100)·W
    const runs = runMany({ design: queueDesign(1, 5, 'small'), traffic: { rps: 140, rttMs: 0 }, durationMs: 200_000, warmupMs: 10_000 }, 6);
    const th = mmc(140, 200, 1);
    within(avg(runs.map((r) => r.mean)), th.w * 1000, 0.03);
    within(avg(runs.map((r) => r.p99)), Math.log(100) * th.w * 1000, 0.06);
    // one thread on a 2-core machine: CPU utilisation is ρ/2
    within(avg(runs.map((r) => r.nodes.app.utilisation)), th.rho / 2, 0.02);
  });

  it('M/M/4 at 75% load (Erlang C)', () => {
    const runs = runMany({ design: queueDesign(4, 5, 'medium'), traffic: { rps: 600, rttMs: 0 }, durationMs: 150_000, warmupMs: 10_000 }, 6);
    const th = mmc(600, 200, 4);
    within(avg(runs.map((r) => r.mean)), th.w * 1000, 0.03);
    within(avg(runs.map((r) => r.nodes.app.utilisation)), th.rho, 0.02);
  });

  it('M/M/8 at 94% load: waiting dominates near saturation', () => {
    const runs = runMany({ design: queueDesign(8, 5, 'large'), traffic: { rps: 1500, rttMs: 0 }, durationMs: 200_000, warmupMs: 20_000 }, 6);
    const th = mmc(1500, 200, 8);
    within(avg(runs.map((r) => r.mean)), th.w * 1000, 0.08);
    expect(th.wq).toBeGreaterThan(1 / 200); // more waiting than working
  });

  it("Little's law: average in system = arrival rate × time in system", () => {
    const [r] = runMany({ design: queueDesign(4, 5, 'medium'), traffic: { rps: 650, rttMs: 0 }, durationMs: 200_000, warmupMs: 10_000 }, 1);
    const inSystem = r.nodes.app.avgQueue + r.nodes.app.utilisation * 4;
    const lambda = r.requests / ((200_000 - 10_000) / 1000);
    within(inSystem, (lambda * r.mean) / 1000, 0.03);
  });

  it('overload: above capacity the queue fills and requests are rejected', () => {
    const d = queueDesign(1, 5, 'small');
    (d.nodes[1] as AppNode).maxQueue = 50;
    const r = simulate({ design: d, traffic: { rps: 300, rttMs: 0 }, durationMs: 60_000, seed: 1 });
    // capacity 200/s of 300/s offered: about a third is rejected
    within(r.errorRate, 1 / 3, 0.06);
    expect(Object.keys(r.byError)).toEqual(['overloaded@app']);
    within(r.throughput, 200, 0.03);
  });
});

describe('caching: LRU hit ratio matches Che’s approximation', () => {
  for (const [skew, capacity] of [
    [0.8, 1000],
    [1.0, 200],
    [0.6, 3000],
  ] as const) {
    it(`Zipf s=${skew}, ${capacity} of 10 000 items fit`, () => {
      const design: Design = {
        nodes: [
          { id: 'users', kind: 'client' },
          { id: 'app', kind: 'app', size: 'xlarge', cpuMs: 0.1 },
          { id: 'cache', kind: 'cache', memoryMb: capacity / 1024 },
          { id: 'db', kind: 'db', size: 'xlarge', readMs: 0.5 },
        ],
        edges: [
          { from: 'users', to: 'app' },
          { from: 'app', to: 'cache' },
          { from: 'app', to: 'db' },
        ],
      };
      const r = simulate({ design, traffic: { rps: 1500, mix: { read: 1 }, keys: 10_000, skew, rttMs: 0 }, durationMs: 120_000, warmupMs: 30_000, seed: 3 });
      const expected = cheHitRatio(zipf(10_000, skew), capacity);
      expect(Math.abs(r.cache.hitRatio! - expected), `${r.cache.hitRatio} vs ${expected}`).toBeLessThan(0.015);
    });
  }
});

describe('reliability', () => {
  it('one instance is up MTBF/(MTBF+MTTR) of the time; two independent ones 1−(1−a)²', () => {
    const one = (n: number) =>
      simulate({
        design: {
          nodes: [
            { id: 'users', kind: 'client' },
            { id: 'lb', kind: 'lb' },
            { id: 'app', kind: 'app', instances: n, mtbfMs: 9_000, mttrMs: 1_000 },
          ],
          edges: [
            { from: 'users', to: 'lb' },
            { from: 'lb', to: 'app' },
          ],
        },
        traffic: { rps: 0 },
        durationMs: 40_000_000,
        seed: 11,
      }).nodes.app.uptime;
    const a = availability(9_000, 1_000);
    expect(Math.abs(one(1) - a)).toBeLessThan(0.006);
    expect(Math.abs(one(2) - parallelAvailability(a, 2))).toBeLessThan(0.002);
    expect(Math.abs(one(3) - parallelAvailability(a, 3))).toBeLessThan(0.0008);
  });

  it('retries multiply calls: (1 − f^(r+1)) / (1 − f) attempts per call', () => {
    for (const [f, retries] of [
      [0.3, 2],
      [0.5, 3],
    ] as const) {
      const r = simulate({
        design: {
          nodes: [
            { id: 'users', kind: 'client' },
            { id: 'app', kind: 'app', size: 'xlarge' },
            { id: 'ext', kind: 'external', failRate: f, latencyMs: 5 },
          ],
          edges: [
            { from: 'users', to: 'app' },
            { from: 'app', to: 'ext', retries },
          ],
        },
        traffic: { rps: 200, mix: { read: 1 } },
        durationMs: 120_000,
        seed: 5,
      });
      const perRequest = r.edges['app->ext'].calls / r.requests;
      within(perRequest, retryAttempts(f, retries), 0.02);
      // a request fails only if every attempt fails
      expect(Math.abs(r.errorRate - Math.pow(f, retries + 1))).toBeLessThan(0.01);
    }
  });

  it('a token bucket lets through its rate (plus one burst) and rejects the rest', () => {
    const r = simulate({
      design: {
        nodes: [
          { id: 'users', kind: 'client' },
          { id: 'limit', kind: 'ratelimiter', rate: 100, burst: 200 },
          { id: 'app', kind: 'app', size: 'xlarge' },
        ],
        edges: [
          { from: 'users', to: 'limit' },
          { from: 'limit', to: 'app' },
        ],
      },
      traffic: { rps: 300, mix: { read: 1 } },
      durationMs: 100_000,
      seed: 2,
    });
    within(r.ok, 100 * 100 + 200, 0.01);
  });
});

describe('queues', () => {
  it('a backlog drains in B / (μ − λ)', () => {
    const r = simulate({
      design: {
        nodes: [
          { id: 'users', kind: 'client' },
          { id: 'api', kind: 'app', size: 'xlarge', writeVia: 'queue' },
          { id: 'jobs', kind: 'queue' },
          { id: 'workers', kind: 'worker', instances: 4, concurrency: 2, cpuMs: 10 },
        ],
        edges: [
          { from: 'users', to: 'api' },
          { from: 'api', to: 'jobs' },
          { from: 'jobs', to: 'workers' },
        ],
      },
      traffic: { rps: 200, mix: { write: 1 } },
      backlog: { jobs: 10_000 },
      durationMs: 40_000,
      seed: 4,
    });
    // 4 workers × 2 cores × 100 msg/s = 800/s against 200/s arriving
    within(r.messages.drainedAtMs! / 1000, drainTime(10_000, 800, 200), 0.05);
  });
});

describe('partitioning', () => {
  it('adding a 5th shard moves ~4/5 of keys with hash mod N, ~1/5 with consistent hashing', () => {
    const moved = (partitioning: 'hash' | 'consistent') =>
      simulate({
        design: {
          nodes: [
            { id: 'users', kind: 'client' },
            { id: 'app', kind: 'app' },
            { id: 'db', kind: 'db', shards: 4, partitioning },
          ],
          edges: [
            { from: 'users', to: 'app' },
            { from: 'app', to: 'db' },
          ],
        },
        traffic: { rps: 0, keys: 20_000 },
        events: [{ atMs: 1000, action: 'addShard', node: 'db' }],
        durationMs: 2000,
      }).keysMoved / 20_000;
    expect(Math.abs(moved('hash') - movedShare(4, 'mod'))).toBeLessThan(0.02);
    expect(Math.abs(moved('consistent') - movedShare(4, 'consistent'))).toBeLessThan(0.05);
  });
});
