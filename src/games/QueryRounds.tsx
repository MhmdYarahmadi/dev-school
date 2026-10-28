import { useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { checkAnswer, expectedResult } from '../db/checker';
import { runSandboxed, type ResultSet } from '../db/runQuery';
import { SqlEditor } from '../components/SqlEditor';
import { ErrorBox } from '../components/ResultView';
import { Hud, useCountdown, type FinishFn } from './kit';

export interface QueryLevel {
  prompt: string;
  solution: string;
  setupSql?: string;
  orderMatters?: boolean;
  hint: string;
  starter?: string;
  seconds?: number;
}

interface Props {
  levels: QueryLevel[];
  finish: FinishFn;
  /** Visualise the target and (optionally) the player's current result. */
  visual: (args: { level: QueryLevel; target: ResultSet; mine: ResultSet | null; solved: boolean }) => ReactNode;
  pointsPerLevel?: number;
  hintCost?: number;
  /** Re-run and visualise the player's query on every Run, not just on Submit. */
  liveRun?: boolean;
}

/**
 * The shared loop for "write a query that matches the target" games:
 * Podium Rush, Warehouse Sort, Bridge Builder and Rank Race.
 */
export function QueryRounds({ levels, finish, visual, pointsPerLevel = 100, hintCost = 30, liveRun = true }: Props) {
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [target, setTarget] = useState<ResultSet | null>(null);
  const [mine, setMine] = useState<ResultSet | null>(null);
  const [sql, setSql] = useState(levels[0].starter ?? '');
  const [msg, setMsg] = useState<{ kind: 'good' | 'bad'; text: string; err?: string } | null>(null);
  const [hint, setHint] = useState(false);
  const [solved, setSolved] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const level = levels[round];
  const seconds = level?.seconds ?? 150;
  const timeBonusMax = 50;
  const max = levels.length * (pointsPerLevel + timeBonusMax);

  useEffect(() => {
    if (!level) return;
    setTarget(null);
    setMine(null);
    setSolved(false);
    expectedResult({ solution: level.solution, setupSql: level.setupSql }).then(setTarget);
  }, [level]);

  const next = (gained: number, ok: boolean) => {
    const s = score + gained;
    const r = [...results, ok];
    setScore(s);
    setResults(r);
    setMsg(null);
    setHint(false);
    if (round + 1 >= levels.length) {
      finish(s, max, <div className="small muted">Rounds solved: {r.filter(Boolean).length}/{levels.length}</div>);
    } else {
      setSql(levels[round + 1].starter ?? '');
      setRound(round + 1);
    }
  };

  const left = useCountdown(seconds, !!target && !solved, () => next(0, false), round);

  const run = async () => {
    const r = await runSandboxed(sql, level.setupSql);
    if (!r.ok) {
      setMsg({ kind: 'bad', text: 'Error', err: r.error.message });
      return null;
    }
    setMine(r.last);
    setMsg(null);
    return r.last;
  };

  const submit = async () => {
    if (liveRun) await run();
    const o = await checkAnswer(sql, { solution: level.solution, setupSql: level.setupSql, orderMatters: level.orderMatters });
    if (o.status === 'correct') {
      setSolved(true);
      if (o.actual) setMine(o.actual);
      const gained = pointsPerLevel + Math.round((left / seconds) * timeBonusMax) - (hint ? hintCost : 0);
      setMsg({ kind: 'good', text: `✓ Perfect match! +${gained}` });
      setTimeout(() => next(gained, true), 1400);
    } else if (o.status === 'error') {
      setMsg({ kind: 'bad', text: 'Error', err: o.error?.message });
    } else {
      setMsg({ kind: 'bad', text: o.feedback.join(' ') });
    }
  };

  if (!level) return null;
  return (
    <div className="stack">
      <Hud round={round} rounds={levels.length} score={score} timeLeft={left} timeTotal={seconds} />
      <div className="card md"><ReactMarkdown>{level.prompt}</ReactMarkdown></div>
      {target ? visual({ level, target, mine, solved }) : <div className="muted">Loading…</div>}
      <div className="card stack">
        <SqlEditor value={sql} onChange={setSql} onRun={submit} minHeight="90px" />
        <div className="row">
          {liveRun && <button className="btn" onClick={run}>▶ Run (preview)</button>}
          <button className="btn primary" onClick={submit} disabled={solved}>✓ Submit (Ctrl+Enter)</button>
          {!hint && <button className="btn small" onClick={() => setHint(true)}>💡 Hint (−{hintCost})</button>}
          <button className="btn small ghost" onClick={() => next(0, false)}>Skip round</button>
        </div>
        {hint && <div className="callout info small">{level.hint}</div>}
        {msg && (msg.err ? <ErrorBox message={msg.err} /> : <div className={`callout ${msg.kind} small`}>{msg.text}</div>)}
      </div>
    </div>
  );
}
