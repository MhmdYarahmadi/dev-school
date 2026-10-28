import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { createSeededDb, type DB } from '../db/engine';
import { canonicalRow } from '../db/values';
import { execRaw, toPgError, type RunResult } from '../db/runQuery';
import { SqlEditor } from '../components/SqlEditor';
import { ErrorBox, ResultView } from '../components/ResultView';
import { GameShell, Hud, type FinishFn } from './kit';
import { costFromExplain, EVENTS_SETUP, explainSql, RACE_LEVELS } from './levels/indexracer';

const HINT_COST = 30;

export default function IndexRacer() {
  return (
    <GameShell
      gameId="indexracer"
      intro={
        <>
          <p>⚡ A table <code>events(event_id, user_id, kind, created_at, email, amount)</code> with <b>100,000 rows</b> is built just for you.</p>
          <p>Each level shows a slow query and its <b>estimated cost</b> from <code>EXPLAIN</code>. Add <b>indexes</b> (or rewrite the query when allowed) until the cost drops <b>below the target</b>.</p>
          <p>Your indexes stay for the rest of the race. Cost is the planner's estimate, so it doesn't depend on how fast your computer is.</p>
        </>
      }
    >
      {(finish, key) => <RacePlay key={key} finish={finish} />}
    </GameShell>
  );
}

async function costOf(db: DB, query: string): Promise<number> {
  const r = await db.query(explainSql(query));
  return costFromExplain(Object.values(r.rows[0] as object)[0]);
}

function CostMeter({ cost, start, target }: { cost: number; start: number; target: number }) {
  const scale = (v: number) => Math.max(2, Math.min(100, (Math.log10(v + 1) / Math.log10(start + 1)) * 100));
  return (
    <div style={{ position: 'relative', height: 30, background: 'var(--surface-2)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <motion.div animate={{ width: `${scale(cost)}%` }} transition={{ type: 'spring', stiffness: 80, damping: 15 }} style={{ height: '100%', background: cost <= target ? 'var(--good)' : 'var(--warn)' }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${scale(target)}%`, borderLeft: '3px dashed var(--text)' }} title="target" />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, fontWeight: 700 }}>cost {cost.toFixed(1)} · target ≤ {target}</div>
    </div>
  );
}

function RacePlay({ finish }: { finish: FinishFn }) {
  const [db, setDb] = useState<DB | null>(null);
  const [level, setLevel] = useState(0);
  const [score, setScore] = useState(0);
  const [cost, setCost] = useState<number | null>(null);
  const [startCost, setStartCost] = useState(1);
  const [sql, setSql] = useState('');
  const [run, setRun] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [won, setWon] = useState(false);
  const [rewriteQuery, setRewriteQuery] = useState<string | null>(null);
  const L = RACE_LEVELS[level];
  const max = RACE_LEVELS.length * 100;

  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await createSeededDb();
      await d.exec(EVENTS_SETUP);
      if (alive) setDb(d);
      else d.close();
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => () => void db?.close(), [db]);

  const measure = useCallback(async () => {
    if (!db) return;
    const c = await costOf(db, rewriteQuery ?? L.query);
    setCost(c);
    return c;
  }, [db, L, rewriteQuery]);

  useEffect(() => {
    if (!db) return;
    setWon(false);
    setRewriteQuery(null);
    setSql(L.rewrite ? L.query : '');
    costOf(db, L.query).then((c) => {
      setCost(c);
      setStartCost(c);
    });
  }, [db, L]);

  const apply = async () => {
    if (!db || won) return;
    setError(null);
    if (L.rewrite && /^\s*(SELECT|WITH)\b/i.test(sql)) {
      // A rewrite must return exactly the same rows as the original query.
      try {
        const [a, b] = await Promise.all([db.query(L.query, [], { rowMode: 'array' }), db.query(sql, [], { rowMode: 'array' })]);
        const key = (rows: unknown[][]) => rows.map((r) => canonicalRow(r, [])).sort().join('|');
        if (key(a.rows as unknown[][]) !== key(b.rows as unknown[][])) {
          setError('Your rewritten query returns different rows from the original. It must give the same answer, just faster.');
          return;
        }
        setRewriteQuery(sql);
        const c = await costOf(db, sql);
        setCost(c);
        check(c);
      } catch (e) {
        setError(toPgError(e).message);
      }
      return;
    }
    const r = await execRaw(db, sql);
    setRun(r);
    if (!r.ok) return;
    await db.exec('ANALYZE events');
    const c = await measure();
    if (c !== undefined) check(c);
  };

  const check = (c: number) => {
    if (c <= L.targetCost) {
      setWon(true);
      const gained = 100 - (hint ? HINT_COST : 0);
      setTimeout(() => {
        const total = score + gained;
        setScore(total);
        if (level + 1 >= RACE_LEVELS.length) finish(total, max);
        else {
          setLevel(level + 1);
          setHint(false);
          setRun(null);
        }
      }, 1500);
    }
  };

  if (!db) return <div className="card loading">⚙️ Building a 100,000-row table…</div>;
  return (
    <div className="stack">
      <Hud round={level} rounds={RACE_LEVELS.length} score={score} />
      <div className="card stack">
        <div className="row"><h3 style={{ margin: 0 }}>⚡ {L.title}</h3>{L.rewrite && <span className="tag accent">rewrite allowed</span>}{won && <span className="tag good">Target beaten!</span>}</div>
        <div className="md"><ReactMarkdown>{L.brief}</ReactMarkdown></div>
        <pre style={{ margin: 0 }}>{L.query}</pre>
        {cost !== null && <CostMeter cost={cost} start={startCost} target={L.targetCost} />}
      </div>
      <div className="card stack">
        <div className="small muted">{L.rewrite ? 'Write a faster SELECT that returns the same rows, or run CREATE INDEX first.' : 'Run DDL here, for example CREATE INDEX … ON events (…); You can also run EXPLAIN to peek at the plan.'}</div>
        <SqlEditor value={sql} onChange={setSql} onRun={apply} minHeight="80px" placeholder="CREATE INDEX events_user_idx ON events (user_id);" />
        <div className="row">
          <button className="btn primary" onClick={apply} disabled={won}>🏎 Apply (Ctrl+Enter)</button>
          {!hint && <button className="btn small" onClick={() => setHint(true)}>💡 Hint (−{HINT_COST})</button>}
          <button className="btn small ghost" onClick={() => { setLevel(level + 1 >= RACE_LEVELS.length ? level : level + 1); if (level + 1 >= RACE_LEVELS.length) finish(score, max); }}>Skip</button>
        </div>
        {hint && <div className="callout info small">{L.hint}</div>}
        {error && <ErrorBox message={error} />}
        <ResultView result={run} sql={sql} />
      </div>
    </div>
  );
}
