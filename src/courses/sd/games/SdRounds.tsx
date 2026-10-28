import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Hud, type FinishFn } from '../../../games/kit';
import { prepareDesign, type SdOutcome } from '../check';
import { detectSdMisconceptions } from '../misconceptions';
import { DesignEditor } from '../ui/DesignEditor';
import { RunButton, RunSummary, useSimRun } from '../ui/Lab';
import { RunPanel } from '../ui/RunPanel';
import { LEVEL_MAX, levelScore, prepareLevel, type SdLevel } from './rounds';

interface Result {
  title: string;
  points: number;
  cost: number | null;
  par: number;
}

const usd = (x: number) => `$${Math.round(x).toLocaleString('en')}`;

/** Plays scenario levels: edit the design, run it against the level's traffic and failures, meet the requirements cheaply. */
export function SdRounds({ levels, finish, playKey }: { levels: SdLevel[]; finish: FinishFn; playKey: number }) {
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const level = levels[Math.min(round, levels.length - 1)];
  const prepared = useMemo(() => prepareLevel(level), [level]);
  const [yaml, setYaml] = useState(prepared.starter);
  const [hinted, setHinted] = useState(false);
  const [runs, setRuns] = useState(0);
  const [prepError, setPrepError] = useState('');
  const [best, setBest] = useState<{ cost: number; points: number } | null>(null);
  const sim = useSimRun();
  const score = results.reduce((s, r) => s + r.points, 0);

  useEffect(() => {
    setRound(0);
    setResults([]);
  }, [playKey]);
  useEffect(() => {
    setYaml(prepared.starter);
    setHinted(false);
    setRuns(0);
    setPrepError('');
    setBest(null);
    sim.clear();
    if (round > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, playKey]);

  const run = async () => {
    const prep = prepareDesign(yaml, { tuneOnly: level.tuneOnly, starter: prepared.starter });
    if (prep.outcome) {
      setPrepError(prep.outcome.feedback.join(' '));
      return;
    }
    setPrepError('');
    const o = await sim.run(prep.design!, prepared.run);
    if (!o) return;
    setRuns((n) => n + 1);
    if (o.status === 'correct' && o.result) {
      const cost = o.result.cost.monthly;
      const points = levelScore(true, cost, level.parCost, hinted);
      if (!best || points > best.points) setBest({ cost, points });
    }
  };

  const next = (r: Result) => {
    const all = [...results, r];
    setResults(all);
    if (round + 1 < levels.length) {
      setRound(round + 1);
      return;
    }
    finish(
      all.reduce((s, x) => s + x.points, 0),
      levels.length * LEVEL_MAX,
      <table className="small" style={{ width: '100%' }}>
        <tbody>
          {all.map((x, i) => (
            <tr key={i}>
              <td>{x.points > 0 ? '✅' : '⏭'} {x.title}</td>
              <td className="muted">{x.cost === null ? 'skipped' : `${usd(x.cost)}/month (par ${usd(x.par)})`}</td>
              <td style={{ textAlign: 'right' }}>{x.points} pts</td>
            </tr>
          ))}
        </tbody>
      </table>,
    );
  };

  const o: SdOutcome | null = sim.outcome;
  const passed = o?.status === 'correct';
  const misconceptions = o?.design && !passed ? detectSdMisconceptions({ design: o.design, run: prepared.run, outcome: o }) : [];

  return (
    <div className="stack">
      <Hud round={round} rounds={levels.length} score={score} extra={<span>🎯 par {usd(level.parCost)}/month</span>} />
      <div className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>{level.title}</h3>
        <div className="md">
          <ReactMarkdown>{level.story}</ReactMarkdown>
        </div>
        <RunSummary run={prepared.run} />
        {level.tuneOnly && <div className="small muted">Settings only this round: you can’t add or remove components or connections.</div>}
        <div className="row">
          {!hinted && !best && (
            <button className="btn ghost small" onClick={() => setHinted(true)}>
              💡 Hint (−20 pts)
            </button>
          )}
          {hinted && (
            <div className="callout info small">
              <ReactMarkdown components={{ p: 'span' }}>{level.hint}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
      <DesignEditor value={yaml} onChange={setYaml} mode={level.tuneOnly ? 'tune' : 'edit'} stats={o?.result?.nodes} height={400} />
      <div className="row">
        <RunButton primary running={sim.running} onClick={() => void run()} label={runs ? '▶ Run again' : '▶ Run the scenario'} />
        <span className="small muted">{runs ? `${runs} run${runs === 1 ? '' : 's'}: run as often as you like.` : 'Runs are free: try, look at the charts, adjust.'}</span>
        <div className="grow" />
        {!best && (
          <button className="btn ghost small" onClick={() => next({ title: level.title, points: 0, cost: null, par: level.parCost })}>
            Skip level
          </button>
        )}
      </div>
      {prepError && <div className="callout bad small">{prepError}</div>}
      {sim.error && <div className="callout bad small">{sim.error}</div>}
      {best && (
        <motion.div className="callout good row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <b>Level passed!</b>
          <span>
            Best: {usd(best.cost)}/month (par {usd(level.parCost)}) → <b>{best.points} pts</b>
            {best.cost > level.parCost && <span className="muted"> · cheaper still is possible: keep tuning, or move on</span>}
          </span>
          <div className="grow" />
          <button className="btn primary" onClick={() => next({ title: level.title, points: best.points, cost: best.cost, par: level.parCost })}>
            {round + 1 < levels.length ? 'Next level →' : 'Finish'}
          </button>
        </motion.div>
      )}
      {o && !passed && o.status === 'wrong' && <div className="callout bad small">{o.feedback[0]}</div>}
      {o?.result && <RunPanel result={o.result} checks={o.checks} run={prepared.run} diagnosis={passed ? undefined : o.diagnosis} />}
      {misconceptions.map((m) => (
        <div key={m.id} className="callout warn small">
          <b>🧠 {m.title}.</b> <ReactMarkdown components={{ p: 'span' }}>{m.explain}</ReactMarkdown>
        </div>
      ))}
    </div>
  );
}
