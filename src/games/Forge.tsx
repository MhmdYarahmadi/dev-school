import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { expectedResult } from '../db/checker';
import { runSandboxed, type ResultSet } from '../db/runQuery';
import { canonicalValue, displayValue } from '../db/values';
import { SqlEditor } from '../components/SqlEditor';
import { ErrorBox } from '../components/ResultView';
import { GameShell, Hud, type FinishFn } from './kit';
import { FORGE_LEVELS, FORGE_SETUP, forgeQuery } from './levels/forge';

const HINT_COST = 20;

export default function Forge() {
  return (
    <GameShell
      gameId="forge"
      intro={
        <>
          <p>⚒️ Each round shows <b>raw input values</b> and the <b>output</b> the customer wants. Write a single <b>expression</b> (not a whole query) that turns one into the other, for example <code>upper(first_name)</code>.</p>
          <p>It runs as <code>SELECT &lt;your expression&gt; FROM forge</code>. Each row glows green when it matches. Get all rows right to forge the item!</p>
          <p>The forge table has: <code>first_name, last_name, nick, raw, score, price, day</code>.</p>
        </>
      }
    >
      {(finish, key) => <ForgePlay key={key} finish={finish} />}
    </GameShell>
  );
}

function ForgePlay({ finish }: { finish: FinishFn }) {
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [inputs, setInputs] = useState<ResultSet | null>(null);
  const [target, setTarget] = useState<ResultSet | null>(null);
  const [mine, setMine] = useState<ResultSet | null>(null);
  const [expr, setExpr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [done, setDone] = useState(false);
  const level = FORGE_LEVELS[round];
  const max = FORGE_LEVELS.length * 100;

  useEffect(() => {
    if (!level) return;
    setTarget(null);
    setMine(null);
    setDone(false);
    expectedResult({ solution: forgeQuery(level.target), setupSql: FORGE_SETUP }).then(setTarget);
    runSandboxed(`SELECT ${level.inputs.join(', ')} FROM forge ORDER BY id`, FORGE_SETUP).then((r) => r.ok && setInputs(r.last));
  }, [level]);

  const matches = (i: number) =>
    !!mine && !!target && mine.columns.length === 1 && canonicalValue(mine.rows[i]?.[0], mine.typeIds[0]) === canonicalValue(target.rows[i][0], target.typeIds[0]);
  const allMatch = !!target && target.rows.every((_, i) => matches(i));

  const next = (gained: number) => {
    const s = score + gained;
    setScore(s);
    setExpr('');
    setHint(false);
    setError(null);
    if (round + 1 >= FORGE_LEVELS.length) finish(s, max);
    else setRound(round + 1);
  };

  const strike = async () => {
    if (!expr.trim()) return;
    const r = await runSandboxed(forgeQuery(expr), FORGE_SETUP);
    if (!r.ok) {
      setError(r.error.message);
      setMine(null);
      return;
    }
    setError(null);
    setMine(r.last);
  };

  useEffect(() => {
    if (allMatch && !done) {
      setDone(true);
      setTimeout(() => next(100 - (hint ? HINT_COST : 0)), 1300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMatch]);

  if (!level) return null;
  return (
    <div className="stack">
      <Hud round={round} rounds={FORGE_LEVELS.length} score={score} />
      <div className="card">
        <div className="row"><h3 style={{ margin: 0 }}>⚒️ {level.title}</h3>{done && <span className="tag good">Forged! +{100 - (hint ? HINT_COST : 0)}</span>}</div>
        <div className="table-scroll" style={{ marginTop: 10 }}>
          <table className="results">
            <thead>
              <tr>
                {inputs?.columns.map((c) => <th key={c}>{c}</th>)}
                <th>→ wanted</th>
                <th>your output</th>
              </tr>
            </thead>
            <tbody>
              {target?.rows.map((t, i) => (
                <motion.tr key={i} animate={{ backgroundColor: matches(i) ? 'rgba(31,138,76,0.18)' : 'rgba(0,0,0,0)' }}>
                  {inputs?.rows[i]?.map((v, j) => <td key={j} className={v === null ? 'null' : ''}>{displayValue(v, inputs.typeIds[j])}</td>)}
                  <td><b>{displayValue(t[0], target.typeIds[0])}</b></td>
                  <td>{mine ? <>{matches(i) ? '✅ ' : '❌ '}{displayValue(mine.rows[i]?.[0], mine.typeIds[0])}</> : '…'}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card stack">
        <div className="mono small">SELECT <b>your expression</b> FROM forge</div>
        <SqlEditor value={expr} onChange={setExpr} onRun={strike} minHeight="60px" placeholder="e.g. upper(first_name)" />
        <div className="row">
          <button className="btn primary" onClick={strike} disabled={done}>🔨 Strike! (Ctrl+Enter)</button>
          {!hint && <button className="btn small" onClick={() => setHint(true)}>💡 Hint (−{HINT_COST})</button>}
          <button className="btn small ghost" onClick={() => next(0)}>Skip</button>
        </div>
        {hint && <div className="callout info small">{level.hint}</div>}
        {error && <ErrorBox message={error} />}
        {mine && mine.columns.length !== 1 && <div className="callout warn small">Write one expression, not several columns.</div>}
      </div>
    </div>
  );
}
