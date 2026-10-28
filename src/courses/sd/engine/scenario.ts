/**
 * A scenario: a design plus everything it is tested with, in one YAML text.
 * Lessons, the sandbox and diagnose questions use it:
 *
 *   components: …            (the design, see yaml.ts)
 *   connections: …
 *   traffic: { rps: 300, mix: { read: 0.9, write: 0.1 } }
 *   run: { duration: 60s, warmup: 5s, seed: 1, warmCache: true }
 *   events:
 *     - { at: 20s, action: kill, node: app, instance: 0 }
 *   phases:
 *     - { name: outage, from: 20s, to: 40s }
 *   requirements:
 *     - p99 < 200ms
 *
 * Times may be written as numbers of ms or with a unit: 500ms, 20s, 2m.
 */
import { Document, isMap, isSeq, parse, type YAMLMap, type YAMLSeq } from 'yaml';
import { parseRequirement } from './requirements';
import type { Design, Phase, RunSpec, ScenarioEvent, Traffic } from './types';
import { designToYaml, yamlToDesign } from './yaml';

/** How a design is run and judged (everything in a scenario except the design). */
export interface SdRun extends Omit<RunSpec, 'design'> {
  requirements?: string[];
}

export interface Scenario extends SdRun {
  design: Design;
}

export const DEFAULT_RUN: SdRun = { traffic: { rps: 100 }, durationMs: 30_000, warmupMs: 2_000 };

/** "20s" → 20000, "500ms" → 500, "2m" → 120000, 1500 → 1500. NaN when unreadable. */
export function toMs(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(ms|s|m|min|h)?\s*$/.exec(v);
  if (!m) return NaN;
  const n = Number(m[1]);
  return n * ({ ms: 1, s: 1000, m: 60_000, min: 60_000, h: 3_600_000 }[m[2] ?? 'ms'] ?? 1);
}

/** 20000 → "20s", 500 → "500ms", 120000 → "2m". */
export function fmtMs(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000}s`;
  if (ms >= 1000) return `${ms / 1000}s`;
  return `${ms}ms`;
}

const ACTIONS: Record<ScenarioEvent['action'], string[]> = {
  kill: ['node', 'instance?'],
  hang: ['node', 'instance?'],
  restore: ['node', 'instance?'],
  slow: ['node', 'factor'],
  flush: ['node'],
  azDown: ['az'],
  azUp: ['az'],
  partition: ['a', 'b'],
  heal: [],
  failRate: ['node', 'rate'],
  scale: ['node', 'instances'],
  addShard: ['node'],
};

const TRAFFIC_KEYS = new Set(['rps', 'mix', 'keys', 'skew', 'sequentialWrites', 'users', 'readAfterWrite', 'rttMs', 'client', 'poisonRate', 'hotKey', 'abuser', 'readKb', 'staticKb']);

function readTraffic(raw: unknown, errors: string[]): Traffic | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('"traffic:" needs settings, at least { rps: 100 }.');
    return undefined;
  }
  const t = { ...(raw as Record<string, unknown>) };
  for (const k of Object.keys(t)) if (!TRAFFIC_KEYS.has(k)) errors.push(`traffic has no setting "${k}".`);
  if (Array.isArray(t.rps)) {
    const curve = (t.rps as unknown[]).map((p) => (Array.isArray(p) && p.length === 2 ? [toMs(p[0]), Number(p[1])] : [NaN, NaN]));
    if (curve.some(([a, b]) => !Number.isFinite(a) || !Number.isFinite(b) || b < 0)) errors.push('traffic.rps as a curve is a list of [time, rate] pairs, like [[0, 100], [30s, 500]].');
    t.rps = curve;
  } else if (typeof t.rps !== 'number' || t.rps < 0) errors.push('traffic.rps should be requests per second (a number), or a curve of [time, rate] pairs.');
  for (const f of ['hotKey', 'abuser'] as const)
    if (t[f] && typeof t[f] === 'object') {
      const hk = { ...(t[f] as Record<string, unknown>) };
      if ('from' in hk) hk.fromMs = toMs(hk.from);
      if ('to' in hk) hk.toMs = toMs(hk.to);
      delete hk.from;
      delete hk.to;
      t[f] = hk;
    }
  return t as unknown as Traffic;
}

/** Parses the run part of a scenario (no design). Used by scenarioFromYaml and by tests of content. */
export function readRun(doc: Record<string, unknown>, errors: string[]): SdRun {
  const run: SdRun = { ...DEFAULT_RUN };
  if ('traffic' in doc) {
    const t = readTraffic(doc.traffic, errors);
    if (t) run.traffic = t;
  }
  const r = (doc.run ?? {}) as Record<string, unknown>;
  if (typeof r !== 'object' || Array.isArray(r)) errors.push('"run:" should be settings, like { duration: 60s }.');
  else
    for (const [k, v] of Object.entries(r)) {
      switch (k) {
        case 'duration':
        case 'durationMs':
        case 'warmup':
        case 'warmupMs': {
          const ms = toMs(v);
          if (!Number.isFinite(ms) || ms < 0) errors.push(`run.${k} should be a time, like 30s.`);
          else if (k.startsWith('duration')) run.durationMs = ms;
          else run.warmupMs = ms;
          break;
        }
        case 'seed':
          if (typeof v !== 'number') errors.push('run.seed should be a number.');
          else run.seed = v;
          break;
        case 'warmCache':
          if (typeof v !== 'boolean') errors.push('run.warmCache should be true or false.');
          else run.warmCache = v;
          break;
        case 'backlog':
          if (!v || typeof v !== 'object') errors.push('run.backlog should map queue names to message counts, like { jobs: 5000 }.');
          else run.backlog = v as Record<string, number>;
          break;
        default:
          errors.push(`run has no setting "${k}" (use duration, warmup, seed, warmCache, backlog).`);
      }
    }
  if (run.durationMs > 600_000) errors.push('A run can last at most 10 minutes of simulated time.');
  if ('events' in doc) {
    if (!Array.isArray(doc.events)) errors.push('"events:" should be a list.');
    else {
      run.events = [];
      for (const raw of doc.events as unknown[]) {
        const e = { ...(raw as Record<string, unknown>) };
        const at = toMs(e.at ?? e.atMs);
        delete e.at;
        delete e.atMs;
        const action = e.action as ScenarioEvent['action'];
        if (!(action in ACTIONS)) {
          errors.push(`Unknown event "${String(action)}". Events: ${Object.keys(ACTIONS).join(', ')}.`);
          continue;
        }
        if (!Number.isFinite(at)) {
          errors.push(`The ${action} event needs a time: at: 20s.`);
          continue;
        }
        for (const f of ACTIONS[action]) if (!f.endsWith('?') && !(f in e)) errors.push(`The ${action} event needs "${f}".`);
        run.events.push({ ...e, atMs: at } as ScenarioEvent);
      }
    }
  }
  if ('phases' in doc) {
    if (!Array.isArray(doc.phases)) errors.push('"phases:" should be a list, like - { name: outage, from: 20s, to: 40s }.');
    else
      run.phases = (doc.phases as Record<string, unknown>[]).map((p) => {
        const ph: Phase = { name: String(p.name), fromMs: toMs(p.from ?? p.fromMs), toMs: toMs(p.to ?? p.toMs) };
        if (!p.name || !Number.isFinite(ph.fromMs) || !Number.isFinite(ph.toMs) || ph.toMs <= ph.fromMs) errors.push('Each phase needs a name and from < to, like { name: outage, from: 20s, to: 40s }.');
        return ph;
      });
  }
  if ('requirements' in doc) {
    if (!Array.isArray(doc.requirements)) errors.push('"requirements:" should be a list, like - p99 < 200ms.');
    else {
      run.requirements = (doc.requirements as unknown[]).map(String);
      for (const q of run.requirements) {
        try {
          const req = parseRequirement(q);
          if (req.phase && !run.phases?.some((p) => p.name === req.phase)) errors.push(`The requirement "${q}" names a phase "${req.phase}" that isn't defined under phases.`);
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
    }
  }
  return run;
}

const DESIGN_KEYS = new Set(['components', 'connections']);
const RUN_KEYS = new Set(['traffic', 'run', 'events', 'phases', 'requirements']);

export function scenarioFromYaml(text: string): { scenario?: Scenario; errors: string[] } {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    return { errors: [`The YAML can't be read: ${(e as Error).message.split('\n')[0]}`] };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { errors: ['Expected "components:" and "connections:".'] };
  const errors: string[] = [];
  const designPart: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    if (DESIGN_KEYS.has(k)) designPart[k] = v;
    else if (RUN_KEYS.has(k)) rest[k] = v;
    else errors.push(`Unknown section "${k}". Sections: components, connections, traffic, run, events, phases, requirements.`);
  }
  const d = yamlToDesign(new Document(designPart).toString());
  errors.push(...d.errors);
  const run = readRun(rest, errors);
  if (errors.length || !d.design) return { errors };
  return { scenario: { ...run, design: d.design }, errors };
}

/** Splits a run into the YAML-friendly form (times with units). */
function runToPlain(run: SdRun): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const t: Record<string, unknown> = { ...run.traffic };
  if (Array.isArray(t.rps)) t.rps = (t.rps as [number, number][]).map(([a, b]) => [fmtMs(a), b]);
  for (const f of ['hotKey', 'abuser'] as const)
    if (t[f]) {
      const { fromMs, toMs: to, ...hk } = t[f] as NonNullable<Traffic['hotKey']>;
      t[f] = { ...hk, ...(fromMs !== undefined && { from: fmtMs(fromMs) }), ...(to !== undefined && { to: fmtMs(to) }) };
    }
  out.traffic = t;
  const r: Record<string, unknown> = { duration: fmtMs(run.durationMs) };
  if (run.warmupMs) r.warmup = fmtMs(run.warmupMs);
  if (run.seed !== undefined) r.seed = run.seed;
  if (run.warmCache) r.warmCache = true;
  if (run.backlog) r.backlog = run.backlog;
  out.run = r;
  if (run.events?.length) out.events = run.events.map(({ atMs, ...e }) => ({ at: fmtMs(atMs), ...e }));
  if (run.phases?.length) out.phases = run.phases.map((p) => ({ name: p.name, from: fmtMs(p.fromMs), to: fmtMs(p.toMs) }));
  if (run.requirements?.length) out.requirements = run.requirements;
  return out;
}

/** The run part as YAML (traffic, run, events, phases, requirements). */
export function runToYaml(run: SdRun): string {
  const doc = new Document(runToPlain(run));
  const flowAll = (node: unknown) => {
    if (isSeq(node)) for (const it of node.items) if (isMap(it) || isSeq(it)) it.flow = true;
  };
  for (const pair of (doc.contents as YAMLMap).items) {
    const key = String((pair.key as { value?: unknown })?.value ?? pair.key);
    if (key === 'traffic' || key === 'run') (pair.value as YAMLMap).flow = true;
    if (key === 'events' || key === 'phases') flowAll(pair.value as YAMLSeq);
  }
  return doc.toString({ flowCollectionPadding: true, lineWidth: 0 });
}

export function scenarioToYaml(s: Scenario): string {
  const { design, ...run } = s;
  return `${designToYaml(design)}${runToYaml(run)}`;
}

/** The RunSpec to simulate a design under a run. */
export function toRunSpec(design: Design, run: SdRun): RunSpec {
  const { requirements: _r, ...rest } = run;
  return { ...rest, design };
}
