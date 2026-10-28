import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { expectedRequests, MAX_REQUESTS, type Design, type ScenarioEvent, type Traffic } from '../engine';
import { fmtMs, type SdRun } from '../engine/scenario';
import { runDesign, type SdOutcome } from '../check';
import { DesignEditor, type EditMode } from './DesignEditor';
import { RunPanel } from './RunPanel';
import { yamlToDesign } from '../engine';

const n = (x: number) => x.toLocaleString('en');
const pctOf = (x: number) => `${Math.round(x * 100)}%`;

export function describeTraffic(t: Traffic): string[] {
  const out: string[] = [];
  if (typeof t.rps === 'number') out.push(`**${n(t.rps)} requests/s**`);
  else out.push(`**${t.rps.map(([at, r]) => `${n(r)}/s at ${fmtMs(at)}`).join(' → ')}** (the rate changes over time)`);
  const m = t.mix ?? { read: 0.9, write: 0.1 };
  const total = (m.read ?? 0) + (m.write ?? 0) + (m.static ?? 0) + (m.query ?? 0) || 1;
  const parts = [
    m.read ? `${pctOf(m.read / total)} reads` : '',
    m.write ? `${pctOf(m.write / total)} writes` : '',
    m.static ? `${pctOf(m.static / total)} static files` : '',
    m.query ? `${pctOf(m.query / total)} searches over many items` : '',
  ].filter(Boolean);
  out.push(parts.join(', '));
  if (t.keys !== undefined || t.skew !== undefined) out.push(`${n(t.keys ?? 10000)} items, popularity skew ${t.skew ?? 0.9}${(t.skew ?? 0.9) === 0 ? ' (all equally popular)' : ''}`);
  if (t.hotKey) out.push(`one item gets ${pctOf(t.hotKey.share)} of reads${t.hotKey.fromMs ? ` from ${fmtMs(t.hotKey.fromMs)}` : ''}${t.hotKey.toMs ? ` to ${fmtMs(t.hotKey.toMs)}` : ''}`);
  if (t.readAfterWrite) out.push(`${pctOf(t.readAfterWrite)} of writers reload right away`);
  if (t.sequentialWrites) out.push('writes add new items in order (like timestamps)');
  if (t.abuser) out.push(`one client sends ${pctOf(t.abuser.share)} of all requests${t.abuser.fromMs ? ` from ${fmtMs(t.abuser.fromMs)}` : ''}${t.abuser.toMs ? ` to ${fmtMs(t.abuser.toMs)}` : ''}`);
  if (t.poisonRate) out.push(`${pctOf(t.poisonRate)} of messages always fail`);
  if (t.client && (t.client.retries || t.client.timeoutMs)) out.push(`clients${t.client.timeoutMs ? ` give up after ${fmtMs(t.client.timeoutMs)}` : ''}${t.client.retries ? ` and retry ${t.client.retries}×${t.client.backoffMs ? '' : ' immediately'}` : ''}`);
  return out;
}

export function describeEvent(e: ScenarioEvent): string {
  const who = 'node' in e ? `**${e.node}**${'instance' in e && e.instance !== undefined ? ` (instance ${e.instance})` : ''}` : '';
  switch (e.action) {
    case 'kill':
      return `${who} crashes`;
    case 'hang':
      return `${who} stops responding (but stays connected)`;
    case 'restore':
      return `${who} comes back`;
    case 'slow':
      return `${who} becomes ${e.factor}× slower`;
    case 'flush':
      return `${who} is emptied (restart)`;
    case 'azDown':
      return `zone **${e.az}** goes down`;
    case 'azUp':
      return `zone **${e.az}** comes back`;
    case 'partition':
      return `the network between **${e.a}** and **${e.b}** is cut`;
    case 'heal':
      return 'the network heals';
    case 'failRate':
      return `${who} starts failing ${pctOf(e.rate)} of calls`;
    case 'scale':
      return `${who} is scaled to ${e.instances} instances`;
    case 'addShard':
      return `a shard is added to ${who}`;
  }
}

/** The run in words: traffic, how long, what goes wrong, and the requirements. */
export function RunSummary({ run, showRequirements = true }: { run: SdRun; showRequirements?: boolean }) {
  const md = (s: string) => <ReactMarkdown components={{ p: 'span' }}>{s}</ReactMarkdown>;
  return (
    <div className="sd-runsum">
      <div>
        🚦 {md(describeTraffic(run.traffic).join(' · '))} · for {fmtMs(run.durationMs)}
        {run.warmCache ? ' · cache starts warm' : ''}
        {run.backlog ? ` · ${Object.entries(run.backlog).map(([q, b]) => `${n(b)} messages already waiting in ${q}`).join(', ')}` : ''}
      </div>
      {run.events && run.events.length > 0 && (
        <div>
          💥 What happens:
          <ul>
            {[...run.events]
              .sort((a, b) => a.atMs - b.atMs)
              .map((e, i) => (
                <li key={i}>
                  at {fmtMs(e.atMs)}: {md(describeEvent(e))}
                </li>
              ))}
          </ul>
        </div>
      )}
      {showRequirements && run.requirements && run.requirements.length > 0 && (
        <div>
          🎯 Requirements:{' '}
          {run.requirements.map((r, i) => (
            <code key={i} style={{ marginRight: 6 }}>
              {r}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}

/** Runs designs in the background worker; the latest run wins. */
export function useSimRun() {
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<SdOutcome | null>(null);
  const [error, setError] = useState('');
  const latest = useRef(0);
  const run = useCallback(async (design: Design, r: SdRun): Promise<SdOutcome | null> => {
    const id = ++latest.current;
    setRunning(true);
    setError('');
    try {
      const o = await runDesign(design, r);
      if (id !== latest.current) return null;
      setOutcome(o);
      return o;
    } catch (e) {
      if (id === latest.current) setError((e as Error).message);
      return null;
    } finally {
      if (id === latest.current) setRunning(false);
    }
  }, []);
  const clear = useCallback(() => {
    latest.current++;
    setRunning(false);
    setOutcome(null);
    setError('');
  }, []);
  return { running, outcome, error, run, clear };
}

export function RunButton({ running, onClick, label = '▶ Run simulation', primary, disabled }: { running: boolean; onClick: () => void; label?: string; primary?: boolean; disabled?: boolean }) {
  return (
    <button className={`btn ${primary ? 'primary' : ''}`} onClick={onClick} disabled={running || disabled}>
      {running ? (
        <>
          <span className="sd-spinner" /> Simulating…
        </>
      ) : (
        label
      )}
    </button>
  );
}

/** Too many requests for one run? Say so before running. */
export function runTooBig(run: SdRun): string | null {
  const reqs = expectedRequests(run);
  return reqs > MAX_REQUESTS ? `This run would make about ${n(Math.round(reqs))} requests; the simulator handles up to ${n(MAX_REQUESTS)}. Lower the rate or shorten the run.` : null;
}

/**
 * A design you can edit and run: the canvas, the run in words, a Run button and the results.
 * Used by worked examples and predictions.
 */
export function Lab({ initial, run, mode = 'edit', autoRun, height }: { initial: string; run: SdRun; mode?: EditMode; autoRun?: boolean; height?: number }) {
  const [yaml, setYaml] = useState(initial);
  const sim = useSimRun();
  const go = () => {
    const d = yamlToDesign(yaml).design;
    if (d) void sim.run(d, run);
  };
  useEffect(() => {
    if (autoRun) go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changed = yaml !== initial;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <DesignEditor value={yaml} onChange={mode === 'view' ? undefined : setYaml} mode={mode} stats={sim.outcome?.result?.nodes} height={height} />
      <RunSummary run={run} />
      <div className="row">
        <RunButton running={sim.running} onClick={go} label={sim.outcome ? '▶ Run again' : '▶ Run simulation'} disabled={!yamlToDesign(yaml).design} />
        {changed && (
          <button className="btn ghost small" onClick={() => (setYaml(initial), sim.clear())}>
            ↺ Back to the original design
          </button>
        )}
        {mode === 'edit' && <span className="small muted">Change anything and run again: nothing here is graded.</span>}
      </div>
      {sim.error && <div className="callout bad small">{sim.error}</div>}
      {sim.outcome?.result && <RunPanel result={sim.outcome.result} checks={sim.outcome.checks} run={run} diagnosis={sim.outcome.diagnosis} />}
    </div>
  );
}
