import { formatValue, KIND_NAMES, type Check, type SimData } from '../engine';
import type { SdRun } from '../engine/scenario';
import { ICONS } from './fields';

const C = { p50: 'var(--accent)', p99: 'var(--bad)', ok: 'var(--good)', err: 'var(--bad)', backlog: 'var(--warn)', inst: 'var(--accent)', hit: 'var(--good)' };

interface Line {
  name: string;
  color: string;
  values: (number | null)[];
}

function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

const fmtT = (ms: number) => (ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000}m` : `${Math.round(ms / 1000)}s`);

/** A small SVG line chart over the run, with failure events and phases marked. */
export function LineChart({ title, t, lines, yFmt, run, maxY }: { title: string; t: number[]; lines: Line[]; yFmt: (v: number) => string; run?: SdRun; maxY?: number }) {
  const W = 300;
  const H = 110;
  const L = 34;
  const B = 14;
  const T = 4;
  const tMax = Math.max(1, t[t.length - 1] ?? 1);
  const yMax = maxY ?? niceMax(Math.max(0, ...lines.flatMap((l) => l.values.filter((v): v is number => v !== null && Number.isFinite(v)))));
  const x = (ms: number) => L + ((W - L - 4) * ms) / tMax;
  const y = (v: number) => T + (H - T - B) * (1 - Math.min(v, yMax * 1.05) / yMax);
  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(t[i]).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const ticks = [0, 0.5, 1].map((f) => f * yMax);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((f * tMax) / 1000) * 1000);
  return (
    <figure className="sd-chart" style={{ margin: 0 }}>
      <figcaption className="sd-chart-title">
        {title}
        {lines.map((l) => (
          <span key={l.name} className="key">
            <i style={{ background: l.color }} /> {l.name}
          </span>
        ))}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} over time`}>
        {run?.phases?.map((p) => (
          <rect key={p.name} className="phase" x={x(p.fromMs)} y={T} width={Math.max(0, x(Math.min(p.toMs, tMax)) - x(p.fromMs))} height={H - T - B}>
            <title>{p.name}</title>
          </rect>
        ))}
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={L} x2={W - 4} y1={y(v)} y2={y(v)} />
            <text x={L - 3} y={y(v) + 3} textAnchor="end">
              {yFmt(v)}
            </text>
          </g>
        ))}
        {xTicks.map((v, i) => (
          <text key={i} x={x(v)} y={H - 2} textAnchor="middle">
            {fmtT(v)}
          </text>
        ))}
        {run?.events?.map((e, i) => (
          <line key={i} className="ev" x1={x(e.atMs)} x2={x(e.atMs)} y1={T} y2={H - B}>
            <title>
              {fmtT(e.atMs)}: {e.action} {'node' in e ? e.node : 'az' in e ? `zone ${e.az}` : ''}
            </title>
          </line>
        ))}
        {lines.map((l) => (
          <path key={l.name} d={path(l.values)} fill="none" stroke={l.color} strokeWidth={1.6} strokeLinejoin="round" />
        ))}
      </svg>
    </figure>
  );
}

const ms = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
const count = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);

export function Charts({ result, run }: { result: SimData; run?: SdRun }) {
  const s = result.series;
  if (s.length < 2) return null;
  const t = s.map((p) => p.t);
  const hasBacklog = s.some((p) => p.backlog > 0);
  const scaled = new Set(s.map((p) => p.instances)).size > 1;
  const hasHits = s.some((p) => p.hitRatio !== null);
  return (
    <div className="sd-charts">
      <LineChart title="Latency" t={t} run={run} yFmt={ms} lines={[{ name: 'p50', color: C.p50, values: s.map((p) => (p.rps ? p.p50 : null)) }, { name: 'p99', color: C.p99, values: s.map((p) => (p.rps ? p.p99 : null)) }]} />
      <LineChart
        title="Requests per second"
        t={t}
        run={run}
        yFmt={count}
        lines={[
          { name: 'succeeded', color: C.ok, values: s.map((p) => p.rps * (1 - p.errRate)) },
          { name: 'failed', color: C.err, values: s.map((p) => p.rps * p.errRate) },
        ]}
      />
      {hasBacklog && <LineChart title="Queue backlog" t={t} run={run} yFmt={count} lines={[{ name: 'messages waiting', color: C.backlog, values: s.map((p) => p.backlog) }]} />}
      {scaled && <LineChart title="Instances" t={t} run={run} yFmt={count} lines={[{ name: 'running', color: C.inst, values: s.map((p) => p.instances) }]} />}
      {hasHits && <LineChart title="Cache hit ratio" t={t} run={run} maxY={1} yFmt={(v) => `${Math.round(v * 100)}%`} lines={[{ name: 'hits', color: C.hit, values: s.map((p) => p.hitRatio) }]} />}
    </div>
  );
}

function Kpi({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className={`sd-kpi ${bad ? 'bad' : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export function Kpis({ r }: { r: SimData }) {
  const hit = r.cache.hitRatio ?? r.cdn.hitRatio;
  return (
    <div className="sd-kpis">
      <Kpi label="requests measured" value={r.requests.toLocaleString('en')} />
      <Kpi label="succeeded per second" value={formatValue('throughput', r.throughput)} />
      <Kpi label="median (p50)" value={formatValue('p50', r.p50)} />
      <Kpi label="p99 latency" value={formatValue('p99', r.p99)} />
      <Kpi label="errors" value={formatValue('errors', r.errorRate)} bad={r.errorRate > 0.001} />
      <Kpi label="per month" value={formatValue('cost', r.cost.monthly).replace('/month', '')} />
      {hit !== null && <Kpi label={r.cache.hitRatio !== null ? 'cache hits' : 'CDN hits'} value={formatValue('hitRatio', hit)} />}
      {r.staleReads > 0 && <Kpi label="stale reads" value={r.staleReads.toLocaleString('en')} bad />}
      {r.rywViolations > 0 && <Kpi label="didn't see own write" value={r.rywViolations.toLocaleString('en')} bad />}
      {r.lostWrites > 0 && <Kpi label="lost writes" value={r.lostWrites.toLocaleString('en')} bad />}
      {r.duplicates > 0 && <Kpi label="processed twice" value={r.duplicates.toLocaleString('en')} bad />}
      {r.messages.done > 0 && <Kpi label="p99 message delay" value={formatValue('messageP99', r.messages.p99)} />}
      {r.messages.maxBacklog > 0 && <Kpi label="largest backlog" value={r.messages.maxBacklog.toLocaleString('en')} />}
      {r.dlq > 0 && <Kpi label="dead-lettered" value={r.dlq.toLocaleString('en')} bad />}
      {r.keysMoved > 0 && <Kpi label="keys moved between shards" value={r.keysMoved.toLocaleString('en')} />}
    </div>
  );
}

export function Requirements({ checks }: { checks: Check[] }) {
  return (
    <ul className="sd-reqs" aria-label="Requirements">
      {checks.map((c, i) => (
        <li key={i} className={c.ok ? 'ok' : 'no'}>
          <span aria-hidden>{c.ok ? '✅' : '❌'}</span>
          <span>
            <span className="sr-only">{c.ok ? 'Met: ' : 'Not met: '}</span>
            {c.line}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function NodesTable({ r }: { r: SimData }) {
  const rows = Object.entries(r.nodes).filter(([, n]) => n.kind !== 'client');
  return (
    <div className="sd-scroll">
      <table className="sd-nodes-table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Instances</th>
            <th title="Average over instances / busiest instance">Busy (avg / max)</th>
            <th>Avg waiting</th>
            <th>Errors started here</th>
            <th>Cost / month</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, n]) => {
            const errs = Object.entries(n.errors);
            return (
              <tr key={id}>
                <td>
                  {ICONS[n.kind]} <code>{id}</code> <span className="muted small">{KIND_NAMES[n.kind]}</span>
                </td>
                <td className="num">{n.instances === n.maxInstances ? n.instances : `${n.instances} (max ${n.maxInstances})`}</td>
                <td className="num">{n.kind === 'queue' ? '—' : `${Math.round(n.utilisation * 100)}% / ${Math.round(n.maxInstanceUtilisation * 100)}%`}</td>
                <td className="num">{n.kind === 'queue' ? `${(n.maxBacklog ?? 0).toLocaleString('en')} max` : n.avgQueue < 0.05 ? '0' : n.avgQueue.toFixed(1)}</td>
                <td>{errs.length ? errs.map(([k, v]) => `${k.replace(/_/g, ' ')} ${v.toLocaleString('en')}`).join(', ') : '—'}</td>
                <td className="num">${Math.round(r.cost.byNode[id] ?? 0).toLocaleString('en')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Everything about one run: requirements, headline numbers, charts, diagnosis and per-component detail. */
export function RunPanel({ result, checks, run, diagnosis }: { result: SimData; checks?: Check[]; run?: SdRun; diagnosis?: string[] }) {
  if (result.invalid?.length) {
    return (
      <div className="callout bad">
        <b>The design can't run yet:</b>
        <ul style={{ margin: '4px 0 0' }}>
          {result.invalid.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="sd-run">
      {checks && checks.length > 0 && <Requirements checks={checks} />}
      <Kpis r={result} />
      <Charts result={result} run={run} />
      {diagnosis && diagnosis.length > 0 && (
        <div className="callout info small">
          <b>🔎 What the simulator saw</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {diagnosis.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {result.warnings.length > 0 && (
        <div className="small muted">
          {result.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}
      <details>
        <summary className="small muted">Per component</summary>
        <NodesTable r={result} />
      </details>
    </div>
  );
}
