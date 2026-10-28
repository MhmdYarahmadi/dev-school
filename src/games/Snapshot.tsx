import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { checkAnswer, expectedResult } from '../db/checker';
import type { ResultSet } from '../db/runQuery';
import { ResultsTable } from '../components/ResultsTable';
import { SqlEditor } from '../components/SqlEditor';
import { ErrorBox } from '../components/ResultView';
import { GameShell, Hud, useCountdown, type FinishFn } from './kit';

export interface SnapshotLevel {
  target: string;
  hint: string;
}

/** Module 1: reproduce a target result grid. Every round gets a bit faster. */
export const SNAPSHOT_LEVELS: SnapshotLevel[] = [
  { target: 'SELECT * FROM authors', hint: 'All columns of one table. Which table has a name, a country and a birth_year?' },
  { target: 'SELECT title, price FROM books', hint: 'Two columns from books.' },
  { target: 'SELECT name, country FROM authors', hint: 'Two columns from authors.' },
  { target: 'SELECT DISTINCT genre FROM books', hint: 'Each genre once. Use DISTINCT.' },
  { target: 'SELECT first_name, last_name, city FROM customers', hint: 'Three columns from customers.' },
  { target: 'SELECT title, price * 2 AS double_price FROM books', hint: 'A computed column: price times 2.' },
  { target: 'SELECT DISTINCT department FROM employees', hint: 'Each department once.' },
  { target: 'SELECT name, salary / 12 AS monthly FROM employees', hint: 'salary divided by 12. Watch out: it\'s integer division!' },
];

const ROUND_TIME = (i: number) => Math.max(45, 100 - i * 8);
const HINT_COST = 30;

export default function Snapshot() {
  return (
    <GameShell
      gameId="snapshot"
      intro={
        <>
          <p>📸 A <b>snapshot</b> of a query result appears. Your job: write a SELECT that produces <b>exactly</b> the same grid.</p>
          <ul>
            <li>8 rounds, and each one has less time.</li>
            <li>Points: 100 per snapshot + 1 point per second left.</li>
            <li>The column headers are a clue! (Column names don't have to match, though.)</li>
            <li>Stuck? A hint costs {HINT_COST} points. You can also skip a round.</li>
          </ul>
        </>
      }
    >
      {(finish, key) => <SnapshotPlay key={key} finish={finish} />}
    </GameShell>
  );
}

function SnapshotPlay({ finish }: { finish: FinishFn }) {
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [target, setTarget] = useState<ResultSet | null>(null);
  const [sql, setSql] = useState('');
  const [msg, setMsg] = useState<{ kind: 'bad' | 'good'; text: string; err?: string } | null>(null);
  const [hint, setHint] = useState(false);
  const [solved, setSolved] = useState<boolean[]>([]);
  const level = SNAPSHOT_LEVELS[round];
  const total = ROUND_TIME(round);
  const max = SNAPSHOT_LEVELS.reduce((s, _, i) => s + 100 + Math.round(ROUND_TIME(i) * 0.6), 0);

  useEffect(() => {
    if (!level) return;
    setTarget(null);
    expectedResult({ solution: level.target }).then(setTarget);
  }, [level]);

  const advance = (gained: number, ok: boolean) => {
    const nextScore = score + gained;
    const nextSolved = [...solved, ok];
    setScore(nextScore);
    setSolved(nextSolved);
    setSql('');
    setMsg(null);
    setHint(false);
    if (round + 1 >= SNAPSHOT_LEVELS.length) {
      finish(nextScore, max, <div className="small muted">Snapshots matched: {nextSolved.filter(Boolean).length}/{SNAPSHOT_LEVELS.length}</div>);
    } else setRound(round + 1);
  };

  const left = useCountdown(total, !!target, () => advance(0, false), round);

  const submit = async () => {
    const o = await checkAnswer(sql, { solution: level.target });
    if (o.status === 'correct') {
      const gained = 100 + Math.round(left) - (hint ? HINT_COST : 0);
      setMsg({ kind: 'good', text: `📸 Match! +${gained}` });
      setTimeout(() => advance(gained, true), 700);
    } else if (o.status === 'error') {
      setMsg({ kind: 'bad', text: 'Error', err: o.error?.message });
    } else {
      setMsg({ kind: 'bad', text: o.feedback.join(' ') });
    }
  };

  if (!level) return null;
  return (
    <div className="stack">
      <Hud round={round} rounds={SNAPSHOT_LEVELS.length} score={score} timeLeft={left} timeTotal={total} />
      <div className="split">
        <motion.div key={round} className="card" initial={{ rotate: -2, scale: 0.92, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }}>
            <div className="row"><b>Target snapshot</b>{target && <span className="small muted">{target.rows.length} rows</span>}</div>
            {target ? <ResultsTable set={target} maxRows={60} showTypes={false} /> : <div className="muted">Developing…</div>}
        </motion.div>
        <div className="card stack">
          <b>Your query</b>
          <SqlEditor value={sql} onChange={setSql} onRun={submit} />
          <div className="row">
            <button className="btn primary" onClick={submit}>📸 Snap! (Ctrl+Enter)</button>
            {!hint && <button className="btn small" onClick={() => setHint(true)}>💡 Hint (−{HINT_COST})</button>}
            <button className="btn small ghost" onClick={() => advance(0, false)}>Skip round</button>
          </div>
          {hint && <div className="callout info small">{level.hint}</div>}
          {msg && (msg.err ? <ErrorBox message={msg.err} /> : <div className={`callout ${msg.kind} small`}>{msg.text}</div>)}
        </div>
      </div>
    </div>
  );
}
