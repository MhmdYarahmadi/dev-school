import { describe, expect, it } from 'vitest';
import { checkRequirements, diagnose, formatValue, parseRequirement } from '../src/courses/sd/engine/requirements';
import { simulate } from '../src/courses/sd/engine/simulate';
import { toData } from '../src/courses/sd/engine/run';
import type { Design } from '../src/courses/sd/engine/types';
import { designToYaml, yamlToDesign } from '../src/courses/sd/engine/yaml';

const design: Design = {
  nodes: [
    { id: 'users', kind: 'client' },
    { id: 'lb', kind: 'lb', algorithm: 'least_conn' },
    { id: 'app', kind: 'app', instances: 2 },
    { id: 'db', kind: 'db', replicas: 1, azs: ['a', 'b'] },
  ],
  edges: [
    { from: 'users', to: 'lb' },
    { from: 'lb', to: 'app' },
    { from: 'app', to: 'db', timeoutMs: 200, retries: 2, jitter: true },
  ],
};

describe('requirements', () => {
  it('reads requirements the way engineers write them', () => {
    expect(parseRequirement('p99 < 200ms')).toMatchObject({ metric: 'p99', op: '<', value: 200 });
    expect(parseRequirement('p99 < 2s').value).toBe(2000);
    expect(parseRequirement('errors < 0.1%').value).toBeCloseTo(0.001);
    expect(parseRequirement('availability >= 99.9%').value).toBeCloseTo(0.999);
    expect(parseRequirement('cost < $900')).toMatchObject({ metric: 'cost', value: 900 });
    expect(parseRequirement('staleReads = 0')).toMatchObject({ metric: 'staleReads', op: '=', value: 0 });
    expect(parseRequirement('util(db) < 70%')).toMatchObject({ metric: 'util', node: 'db', value: 0.7 });
    expect(parseRequirement('during outage: errors < 1%')).toMatchObject({ phase: 'outage', metric: 'errors', value: 0.01 });
    expect(parseRequirement('throughput >= 1k/s')).toMatchObject({ metric: 'throughput', value: 1000 });
    expect(parseRequirement('throughput >= 800/s').value).toBe(800);
    expect(parseRequirement('keysMoved < 30000')).toMatchObject({ metric: 'keysMoved', value: 30000 });
    expect(parseRequirement('moved < 10')).toMatchObject({ metric: 'keysMoved', value: 10 });
    expect(() => parseRequirement('speed fast')).toThrow(/Can't read/);
    expect(() => parseRequirement('wow < 3')).toThrow(/Unknown measure/);
  });

  it('formats values for people', () => {
    expect(formatValue('p99', 412.3)).toBe('412 ms');
    expect(formatValue('p99', 15_000)).toBe('15.0 s');
    expect(formatValue('errors', 0.0004)).toBe('0.040%');
    expect(formatValue('availability', 0.9995)).toBe('99.950%');
    expect(formatValue('cost', 1234.5)).toBe('$1,235/month');
  });

  it('checks a run and explains failures', () => {
    const r = simulate({ design, traffic: { rps: 1500, mix: { read: 1 } }, durationMs: 15_000, seed: 1, phases: [{ name: 'late', fromMs: 10_000, toMs: 15_000 }] });
    const checks = checkRequirements(r, ['p99 < 200ms', 'errors < 1%', 'cost < $10000', 'late: errors < 1%']);
    expect(checks.map((c) => c.ok)).toEqual([false, false, true, false]);
    expect(checks[1].line).toMatch(/^Error rate: [\d.]+% \(needs < 1.0%\)$/);
    expect(checks[3].line).toMatch(/during late/);
    const why = diagnose(r);
    expect(why[0]).toMatch(/App servers "app" is overloaded/);
    expect(why.some((w) => /bottleneck/.test(w))).toBe(true);
  });

  it('works on plain data from the worker too', () => {
    const r = toData(simulate({ design, traffic: { rps: 50 }, durationMs: 5000, seed: 1 }), [[0, 2500]]);
    expect(r.windows[0].requests).toBeGreaterThan(80);
    expect(checkRequirements(r, ['errors = 0'])[0].ok).toBe(true);
    expect(JSON.parse(JSON.stringify(r)).p99).toBe(r.p99);
  });
});

describe('YAML', () => {
  it('round-trips a design, one line per component', () => {
    const text = designToYaml(design);
    expect(text).toContain('  lb: { type: lb, algorithm: least_conn }');
    expect(text).toContain('  - users -> lb');
    expect(text).toContain('  - app -> db: { timeoutMs: 200, retries: 2, jitter: true }');
    expect(yamlToDesign(text)).toEqual({ design, errors: [] });
  });

  it('explains mistakes in hand-written YAML', () => {
    expect(yamlToDesign('components:\n  app: { type: server }').errors[0]).toMatch(/type must be one of/);
    expect(yamlToDesign('components:\n  app: { type: app, instance: 3 }').errors[0]).toBe('Component "app" (app) has no setting "instance".');
    expect(yamlToDesign('components:\n  app: { type: app, size: huge }').errors[0]).toMatch(/one of small, medium, large, xlarge/);
    expect(yamlToDesign('components:\n  app: { type: app }\nconnections:\n  - app to db').errors[0]).toMatch(/from -> to/);
    expect(yamlToDesign('components: [').errors[0]).toMatch(/can't be read/);
    expect(yamlToDesign('components:\n  a: { type: client }\nconnections:\n  - a -> b: { retry: 2 }').errors[0]).toMatch(/no setting "retry"/);
  });
});
