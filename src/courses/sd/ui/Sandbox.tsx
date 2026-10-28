import { useMemo, useState } from 'react';
import { parse } from 'yaml';
import { CodeEditor } from '../../../components/CodeEditor';
import { designToYaml, yamlToDesign } from '../engine';
import { readRun, runToYaml, scenarioFromYaml, type SdRun } from '../engine/scenario';
import { DesignEditor } from './DesignEditor';
import { RunButton, RunSummary, runTooBig, useSimRun } from './Lab';
import { RunPanel } from './RunPanel';
import { Simplifies } from './Simplifies';

/** Starting points. Each is a whole scenario (design + run). */
export const PRESETS: { id: string; label: string; yaml: string }[] = [
  {
    id: 'web',
    label: 'Web app + database',
    yaml: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> db
traffic: { rps: 300, mix: { read: 0.9, write: 0.1 } }
run: { duration: 30s, warmup: 2s }
requirements:
  - p99 < 100ms
  - errors < 0.1%
`,
  },
  {
    id: 'cache',
    label: 'With a cache',
    yaml: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, size: medium }
  cache: { type: cache, memoryMb: 512 }
  db: { type: db, replicas: 1 }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
traffic: { rps: 1500, mix: { read: 0.95, write: 0.05 }, keys: 100000, skew: 0.9 }
run: { duration: 30s, warmup: 5s, warmCache: true }
requirements:
  - p99 < 100ms
`,
  },
  {
    id: 'queue',
    label: 'Queue + workers',
    yaml: `components:
  users: { type: client }
  api: { type: app, instances: 2, writeVia: queue }
  jobs: { type: queue, dlq: true }
  workers: { type: worker, instances: 4, concurrency: 4, cpuMs: 40 }
  db: { type: db }
connections:
  - users -> api
  - api -> jobs
  - jobs -> workers
  - workers -> db
traffic: { rps: [[0, 50], [10s, 400], [20s, 50]], mix: { write: 1 } }
run: { duration: 60s }
requirements:
  - messageP99 < 10s
`,
  },
  {
    id: 'outage',
    label: 'Survive a crash',
    yaml: `components:
  users: { type: client }
  lb: { type: lb, azs: [a, b], healthCheck: { intervalMs: 1000 } }
  app: { type: app, instances: 4, azs: [a, b] }
  db: { type: db, replicas: 1, failoverMs: 2000, azs: [a, b] }
connections:
  - users -> lb
  - lb -> app: { retries: 2 }
  - app -> db: { timeoutMs: 500, retries: 3, backoffMs: 200, jitter: true }
traffic: { rps: 300 }
run: { duration: 60s, warmup: 2s }
events:
  - { at: 20s, action: azDown, az: a }
phases:
  - { name: outage, from: 20s, to: 60s }
requirements:
  - "outage: errors < 1%"
`,
  },
  {
    id: 'empty',
    label: 'Empty canvas',
    yaml: `components:
  users: { type: client }
connections: []
traffic: { rps: 100 }
run: { duration: 30s }
`,
  },
];

const KEY = 'zs-sd-sandbox-v1';

function load(): { design: string; run: string } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (typeof v.design === 'string' && typeof v.run === 'string') return v;
    }
  } catch {
    /* private mode or bad data: start fresh */
  }
  return split(PRESETS[0].yaml);
}

function save(v: { design: string; run: string }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

function split(yaml: string): { design: string; run: string } {
  const s = scenarioFromYaml(yaml).scenario!;
  const { design, ...run } = s;
  return { design: designToYaml(design), run: runToYaml(run) };
}

function parseRun(text: string): { run?: SdRun; errors: string[] } {
  let doc: unknown;
  try {
    doc = parse(text) ?? {};
  } catch (e) {
    return { errors: [`The YAML can't be read: ${(e as Error).message.split('\n')[0]}`] };
  }
  if (typeof doc !== 'object' || Array.isArray(doc)) return { errors: ['Expected traffic:, run:, events:, phases: and requirements:.'] };
  const errors: string[] = [];
  const extra = Object.keys(doc as object).filter((k) => !['traffic', 'run', 'events', 'phases', 'requirements'].includes(k));
  for (const k of extra) errors.push(`Unknown section "${k}" here: use traffic, run, events, phases, requirements.`);
  const run = readRun(doc as Record<string, unknown>, errors);
  return errors.length ? { errors } : { run, errors };
}

/** Free play: build any design, choose the traffic and failures, and run it. Nothing is graded. */
export default function Sandbox() {
  const [state, setState] = useState(load);
  const sim = useSimRun();
  const update = (v: Partial<typeof state>) => {
    const next = { ...state, ...v };
    setState(next);
    save(next);
  };
  const design = useMemo(() => yamlToDesign(state.design), [state.design]);
  const run = useMemo(() => parseRun(state.run), [state.run]);
  const tooBig = run.run ? runTooBig(run.run) : null;

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0 }}>🧪 Sandbox</h1>
        <div className="grow" />
        <label className="small row" style={{ gap: 6 }}>
          Start from
          <select
            className="input"
            style={{ width: 'auto' }}
            value=""
            onChange={(e) => {
              const p = PRESETS.find((x) => x.id === e.target.value);
              if (p) {
                update(split(p.yaml));
                sim.clear();
              }
            }}
          >
            <option value="">choose…</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Build any design, set the traffic and what goes wrong, and run it. Nothing here is graded, and your work is kept in this browser.
      </p>
      <DesignEditor value={state.design} onChange={(v) => update({ design: v })} stats={sim.outcome?.result?.nodes} height={440} />
      <div className="card stack" style={{ gap: 8 }}>
        <b>Traffic, failures and requirements</b>
        <CodeEditor value={state.run} onChange={(v) => update({ run: v })} lang="yaml" minHeight="140px" />
        <details className="small muted">
          <summary>What can go here?</summary>
          <ul>
            <li>
              <code>traffic</code>: <code>rps</code> (or a curve <code>[[0, 100], [30s, 500]]</code>), <code>mix</code> (read, write, static, query), <code>keys</code>, <code>skew</code>, <code>hotKey</code>, <code>abuser</code>, <code>readAfterWrite</code>, <code>users</code>, <code>client</code> (timeoutMs, retries…), <code>poisonRate</code>.
            </li>
            <li>
              <code>run</code>: <code>duration</code>, <code>warmup</code>, <code>seed</code>, <code>warmCache</code>, <code>backlog</code>.
            </li>
            <li>
              <code>events</code>: kill, hang, restore, slow (factor), flush, azDown/azUp (az), partition (a, b), heal, failRate (rate), scale (instances), addShard. Each needs <code>at</code>.
            </li>
            <li>
              <code>requirements</code>: like <code>p99 &lt; 200ms</code>, <code>errors &lt; 0.1%</code>, <code>cost &lt; $500</code>, <code>util(db) &lt; 70%</code>, <code>staleReads = 0</code>, <code>outage: errors &lt; 1%</code> (with a phase).
            </li>
          </ul>
        </details>
        {run.errors.length > 0 && (
          <div className="callout bad small">
            {run.errors.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        )}
        {run.run && <RunSummary run={run.run} />}
      </div>
      <div className="row">
        <RunButton primary running={sim.running} disabled={!design.design || !run.run || !!tooBig} onClick={() => void sim.run(design.design!, run.run!)} />
        {!design.design && <span className="small bad-text">Fix the design first (see the YAML tab).</span>}
        {tooBig && <span className="small bad-text">{tooBig}</span>}
      </div>
      {sim.error && <div className="callout bad small">{sim.error}</div>}
      {sim.outcome?.result && <RunPanel result={sim.outcome.result} checks={sim.outcome.checks} run={run.run} diagnosis={sim.outcome.diagnosis} />}
      <Simplifies />
    </div>
  );
}
