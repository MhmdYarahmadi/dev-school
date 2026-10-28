/**
 * The System Design course framework: the scenario format, answer checking,
 * canvas edits and the misconception detector.
 */
import { describe, expect, it } from 'vitest';
import type { Exercise } from '../src/content/types';
import { checkEstimate, evaluateSd, fmtNumber, parseEstimate, prepareDesign, runDesignSync } from '../src/courses/sd/check';
import { designToYaml, yamlToDesign, type Design } from '../src/courses/sd/engine';
import { fmtMs, runToYaml, scenarioFromYaml, scenarioToYaml, toMs, type SdRun } from '../src/courses/sd/engine/scenario';
import { detectSdMisconceptions } from '../src/courses/sd/misconceptions';
import { addNode, connect, disconnect, edgeSummary, layout, nodeSummary, removeNode, renameNode, setEdgeField, setField } from '../src/courses/sd/ui/designOps';

const WEB = `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> db: { timeoutMs: 200, retries: 1 }
`;

describe('scenario YAML', () => {
  it('times with units', () => {
    expect(toMs('20s')).toBe(20_000);
    expect(toMs('500ms')).toBe(500);
    expect(toMs('2m')).toBe(120_000);
    expect(toMs(1500)).toBe(1500);
    expect(toMs('soon')).toBeNaN();
    expect(fmtMs(20_000)).toBe('20s');
    expect(fmtMs(120_000)).toBe('2m');
    expect(fmtMs(250)).toBe('250ms');
    expect(fmtMs(1500)).toBe('1.5s');
  });

  it('reads a whole scenario', () => {
    const s = scenarioFromYaml(`${WEB}traffic: { rps: [[0, 100], [30s, 500]], mix: { read: 0.8, write: 0.2 }, hotKey: { share: 0.3, from: 10s } }
run: { duration: 1m, warmup: 5s, seed: 7, warmCache: true }
events:
  - { at: 20s, action: kill, node: app, instance: 0 }
  - { at: 40s, action: azDown, az: a }
phases:
  - { name: outage, from: 20s, to: 40s }
requirements:
  - p99 < 200ms
  - "outage: errors < 1%"
`);
    expect(s.errors).toEqual([]);
    const sc = s.scenario!;
    expect(sc.design.nodes).toHaveLength(4);
    expect(sc.design.edges[2]).toMatchObject({ from: 'app', to: 'db', timeoutMs: 200, retries: 1 });
    expect(sc.traffic.rps).toEqual([
      [0, 100],
      [30_000, 500],
    ]);
    expect(sc.traffic.hotKey).toEqual({ share: 0.3, fromMs: 10_000 });
    expect(sc).toMatchObject({ durationMs: 60_000, warmupMs: 5000, seed: 7, warmCache: true });
    expect(sc.events).toEqual([
      { atMs: 20_000, action: 'kill', node: 'app', instance: 0 },
      { atMs: 40_000, action: 'azDown', az: 'a' },
    ]);
    expect(sc.phases).toEqual([{ name: 'outage', fromMs: 20_000, toMs: 40_000 }]);
    expect(sc.requirements).toEqual(['p99 < 200ms', 'outage: errors < 1%']);
    // and back: the text form round-trips
    const again = scenarioFromYaml(scenarioToYaml(sc));
    expect(again.errors).toEqual([]);
    expect(again.scenario).toEqual(sc);
  });

  it('explains mistakes in plain words', () => {
    const errs = (y: string) => scenarioFromYaml(WEB + y).errors.join(' | ');
    expect(errs('traffic: { rps: lots }')).toMatch(/requests per second/);
    expect(errs('traffic: { rps: 10, speed: 3 }')).toMatch(/no setting "speed"/);
    expect(errs('run: { duration: forever }')).toMatch(/should be a time/);
    expect(errs('events:\n  - { at: 5s, action: explode, node: app }')).toMatch(/Unknown event "explode"/);
    expect(errs('events:\n  - { action: kill, node: app }')).toMatch(/needs a time/);
    expect(errs('events:\n  - { at: 1s, action: slow, node: app }')).toMatch(/needs "factor"/);
    expect(errs('requirements:\n  - p99 is small')).toMatch(/Can't read the requirement/);
    expect(errs('requirements:\n  - "peak: p99 < 1s"')).toMatch(/phase "peak" that isn't defined/);
    expect(errs('extras: 1')).toMatch(/Unknown section "extras"/);
    expect(scenarioFromYaml('components: [').errors[0]).toMatch(/can't be read/);
  });

  it('defaults: a design alone is a valid scenario', () => {
    const s = scenarioFromYaml(WEB).scenario!;
    expect(s.traffic.rps).toBe(100);
    expect(s.durationMs).toBe(30_000);
  });

  it('the run part as YAML uses readable times', () => {
    const y = runToYaml({ traffic: { rps: 50 }, durationMs: 60_000, events: [{ atMs: 20_000, action: 'kill', node: 'app' }], requirements: ['p99 < 1s'] });
    expect(y).toContain('duration: 1m');
    expect(y).toContain('at: 20s');
  });
});

describe('estimates', () => {
  it('reads numbers the way people write them', () => {
    expect(parseEstimate('1200')).toBe(1200);
    expect(parseEstimate('1,200')).toBe(1200);
    expect(parseEstimate('86 400')).toBe(86400);
    expect(parseEstimate('1.2k')).toBe(1200);
    expect(parseEstimate('3.5 million')).toBe(3_500_000);
    expect(parseEstimate('2M')).toBe(2_000_000);
    expect(parseEstimate('2e6')).toBe(2_000_000);
    expect(parseEstimate('~12 req/s')).toBe(12);
    expect(parseEstimate('10 GB')).toBe(10);
    expect(parseEstimate('1.5 MB')).toBe(1.5);
    expect(parseEstimate('lots')).toBeNull();
  });

  it('tolerance and direction', () => {
    expect(checkEstimate({}, '100', '120').status).toBe('correct');
    expect(checkEstimate({}, '100', '130').status).toBe('wrong');
    expect(checkEstimate({ tolerance: 0.5 }, '100', '140').status).toBe('correct');
    expect(checkEstimate({}, '100', '1000').feedback[0]).toMatch(/1 order of magnitude too high/);
    expect(checkEstimate({}, '100', '40').feedback[0]).toMatch(/2\.5× too low/);
    expect(checkEstimate({}, '100', 'many').status).toBe('error');
    expect(fmtNumber(2_500_000)).toBe('2.5 million');
    expect(fmtNumber(86_400)).toBe('86,400');
    expect(fmtNumber(11.57)).toBe('11.6');
  });
});

describe('checking designs', () => {
  const run: SdRun = { traffic: { rps: 200 }, durationMs: 10_000, warmupMs: 1000, requirements: ['p99 < 150ms', 'errors < 0.1%'] };

  it('blanks, broken YAML and changed topology are caught before running', () => {
    expect(prepareDesign('components:\n  users: { type: client, x: ___ }').outcome?.feedback[0]).toMatch(/Fill in every blank/);
    expect(prepareDesign('components:\n  users: { type: banana }').outcome?.status).toBe('error');
    const more = WEB.replace('  db: { type: db }\n', '  db: { type: db }\n  cache: { type: cache }\n').replace('  - lb -> app\n', '  - lb -> app\n  - app -> cache\n');
    expect(prepareDesign(more, { tuneOnly: true, starter: WEB }).outcome?.feedback[0]).toMatch(/keep the same components/);
    const settingsOnly = WEB.replace('instances: 2', 'instances: 5');
    expect(prepareDesign(settingsOnly, { tuneOnly: true, starter: WEB }).outcome).toBeUndefined();
  });

  it('runs and judges: any design that meets the requirements passes', () => {
    const ok = runDesignSync(yamlToDesign(WEB).design!, run);
    expect(ok.status).toBe('correct');
    // a different, also valid design: no load balancer, one bigger server
    const other = runDesignSync(yamlToDesign('components:\n  users: { type: client }\n  app: { type: app, size: large }\nconnections:\n  - users -> app\n').design!, run);
    expect(other.status).toBe('correct');
    const slow = runDesignSync(yamlToDesign(WEB.replace('instances: 2', 'instances: 1, cpuMs: 9')).design!, run);
    expect(slow.status).toBe('wrong');
    expect(slow.feedback[1]).toMatch(/P99 latency: .* \(needs < 150 ms\)/);
    expect(slow.diagnosis!.join(' ')).toMatch(/bottleneck/);
  });

  it('an invalid design is an error, with the reason', () => {
    const o = runDesignSync({ nodes: [{ id: 'users', kind: 'client' }], edges: [] }, run);
    expect(o.status).toBe('error');
    expect(o.feedback.join(' ')).toMatch(/Connect Users/);
  });

  it('evaluateSd dispatches on the exercise', async () => {
    const est = { id: 'x', kind: 'write', conceptIds: [], prompt: '', explanation: '', hints: [], solution: '11.6', wrongExample: '1000', sd: { target: 'estimate' } } as Exercise;
    expect((await evaluateSd(est, '12', true)).status).toBe('correct');
    const des = { ...est, solution: WEB, sd: { target: 'design', run } } as Exercise;
    expect((await evaluateSd(des, WEB, true)).status).toBe('correct');
  });
});

describe('canvas edits', () => {
  const d0 = yamlToDesign(WEB).design!;

  it('add, rename, connect, disconnect, remove', () => {
    const a = addNode(d0, 'cache');
    if ('error' in a) throw new Error(a.error);
    expect(a.id).toBe('cache');
    const a2 = addNode(a.design, 'cache') as { design: Design; id: string };
    expect(a2.id).toBe('cache2');
    expect(addNode(d0, 'client')).toEqual({ error: expect.stringMatching(/one Users/) });
    const c = connect(a.design, 'app', 'cache') as Design;
    expect(c.edges.some((e) => e.from === 'app' && e.to === 'cache')).toBe(true);
    expect(connect(c, 'app', 'cache')).toEqual({ error: expect.stringMatching(/already connected/) });
    expect(connect(c, 'cache', 'app')).toEqual({ error: expect.stringMatching(/drag from App servers "app"/) });
    expect(connect(c, 'db', 'cache')).toEqual({ error: expect.stringMatching(/can’t call/) });
    const r = renameNode(c, 'app', 'api') as Design;
    expect(r.edges.filter((e) => e.from === 'api' || e.to === 'api')).toHaveLength(3);
    expect(renameNode(c, 'app', 'db')).toEqual({ error: expect.stringMatching(/already a component/) });
    expect(renameNode(c, 'app', 'no spaces')).toEqual({ error: expect.any(String) });
    expect(disconnect(r, 'api', 'cache').edges).toHaveLength(3);
    const rm = removeNode(r, 'api');
    expect(rm.nodes.map((n) => n.id)).toEqual(['users', 'lb', 'db', 'cache']);
    expect(rm.edges).toEqual([{ from: 'users', to: 'lb' }]);
  });

  it('settings: set and clear; the YAML follows', () => {
    const s = setField(d0, 'app', 'size', 'large');
    expect(designToYaml(s)).toContain('app: { type: app, instances: 2, size: large }');
    expect(designToYaml(setField(s, 'app', 'instances', undefined))).toContain('app: { type: app, size: large }');
    const e = setEdgeField(d0, 'app', 'db', 'backoffMs', 50);
    expect(designToYaml(e)).toContain('app -> db: { timeoutMs: 200, retries: 1, backoffMs: 50 }');
    expect(edgeSummary(e.edges[2])).toBe('⏱ 200ms ↻ 1 +50ms');
  });

  it('layout puts callers left of what they call', () => {
    const p = layout(d0);
    expect(p.users.x).toBeLessThan(p.lb.x);
    expect(p.lb.x).toBeLessThan(p.app.x);
    expect(p.app.x).toBeLessThan(p.db.x);
  });

  it('summaries', () => {
    expect(nodeSummary({ id: 'a', kind: 'app', instances: 3, size: 'medium' })).toBe('3 × medium');
    expect(nodeSummary({ id: 'd', kind: 'db', replicas: 2, shards: 4, failoverMs: 5000 })).toBe('small · 4 shards · +2 replicas · failover');
    expect(nodeSummary({ id: 'c', kind: 'cache', memoryMb: 512, ttlMs: 60_000 })).toBe('512 MB · TTL 60s');
    expect(nodeSummary({ id: 'w', kind: 'app', autoscale: { min: 2, max: 8 }, azs: ['a', 'b'] })).toBe('2–8 × small (auto) · zones a,b');
  });
});

describe('misconceptions', () => {
  const detect = (yaml: string, run: SdRun) => {
    const design = yamlToDesign(yaml).design!;
    const outcome = runDesignSync(design, run);
    return detectSdMisconceptions({ design, run, outcome }).map((m) => m.id);
  };

  it('local sessions behind a load balancer', () => {
    const y = WEB.replace('instances: 2', 'instances: 3, sessions: local');
    expect(detect(y, { traffic: { rps: 100 }, durationMs: 10_000, requirements: ['errors < 0.1%'] })).toContain('local-sessions');
  });

  it('retries without backoff during overload', () => {
    const y = `components:
  users: { type: client }
  app: { type: app, size: large }
  db: { type: db, maxConnections: 20 }
connections:
  - users -> app
  - app -> db: { timeoutMs: 50, retries: 3 }
`;
    const ids = detect(y, { traffic: { rps: 600, mix: { write: 1 } }, durationMs: 15_000, requirements: ['errors < 0.1%'] });
    expect(ids).toContain('retry-storm');
  });

  it('a single instance that crashes', () => {
    const y = `components:
  users: { type: client }
  app: { type: app }
connections:
  - users -> app
`;
    const ids = detect(y, { traffic: { rps: 50 }, durationMs: 20_000, events: [{ atMs: 5000, action: 'kill', node: 'app' }], requirements: ['errors < 1%'] });
    expect(ids).toContain('single-point-of-failure');
  });

  it('p99 vs average', () => {
    const y = `components:
  users: { type: client }
  app: { type: app, cpuMs: 20 }
connections:
  - users -> app
`;
    const ids = detect(y, { traffic: { rps: 85 }, durationMs: 30_000, warmupMs: 3000, requirements: ['p99 < 150ms'] });
    expect(ids).toContain('p99-vs-average');
  });

  it('too many connections', () => {
    const y = `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 8, dbPool: 10, cpuMs: 1 }
  db: { type: db, readMs: 20, size: xlarge, maxConnections: 40 }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`;
    expect(detect(y, { traffic: { rps: 800, mix: { read: 1 } }, durationMs: 10_000, requirements: ['errors < 0.1%'] })).toContain('pool-math');
  });

  it('read-your-writes and idempotency', () => {
    const ryw = `components:
  users: { type: client }
  app: { type: app, size: large }
  db: { type: db, replicas: 1, replicationLagMs: 300 }
connections:
  - users -> app
  - app -> db
`;
    expect(detect(ryw, { traffic: { rps: 200, mix: { read: 0.7, write: 0.3 }, readAfterWrite: 1 }, durationMs: 10_000, requirements: ['rywViolations = 0'] })).toContain('read-your-writes');
    const queue = `components:
  users: { type: client }
  api: { type: app, writeVia: queue }
  jobs: { type: queue, visibilityTimeoutMs: 50 }
  workers: { type: worker, cpuMs: 60, dist: lognormal }
  db: { type: db }
connections:
  - users -> api
  - api -> jobs
  - jobs -> workers
  - workers -> db
`;
    expect(detect(queue, { traffic: { rps: 30, mix: { write: 1 } }, durationMs: 10_000, requirements: ['duplicates = 0'] })).toContain('idempotency');
    expect(detect(queue.replace('cpuMs: 60, dist: lognormal', 'cpuMs: 60, dist: lognormal, idempotent: true'), { traffic: { rps: 30, mix: { write: 1 } }, durationMs: 10_000, requirements: ['p99 < 1ms'] })).not.toContain('idempotency');
  });

  it('nothing is flagged when the design passes', () => {
    expect(detect(WEB, { traffic: { rps: 100 }, durationMs: 5000, requirements: ['errors < 1%'] })).toEqual([]);
  });
});
