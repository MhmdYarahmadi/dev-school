import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { createSeededDb, type DB } from '../db/engine';
import { execRaw, type RunResult } from '../db/runQuery';
import { SqlEditor } from '../components/SqlEditor';
import { ResultView } from '../components/ResultView';
import { GameShell, Hud, type FinishFn } from './kit';
import { COLLATERAL, DOCTOR_SETUP, SYMPTOMS } from './levels/doctor';

const DAMAGE_COST = 30;
const HINT_COST = 25;

export default function Doctor() {
  return (
    <GameShell
      gameId="doctor"
      intro={
        <>
          <p>🩺 The <code>shop</code> table (book_id, title, genre, price, in_stock) is <b>sick</b>: typos, impossible values, a duplicate and a missing row.</p>
          <p>Diagnose and heal it with <b>UPDATE, DELETE and INSERT</b>. Your changes <b>stay</b> during this game (it's your own patient), and you can restart from scratch at any time.</p>
          <ul>
            <li>Each symptom you cure: 100 points. The health meter rises as you go.</li>
            <li>⚠️ <b>Collateral damage</b>: every healthy row you change by accident costs {DAMAGE_COST} points. A missing WHERE hurts!</li>
          </ul>
        </>
      }
    >
      {(finish, key) => <DoctorPlay key={key} finish={finish} />}
    </GameShell>
  );
}

function DoctorPlay({ finish }: { finish: FinishFn }) {
  const [db, setDb] = useState<DB | null>(null);
  const [sql, setSql] = useState("SELECT * FROM shop ORDER BY book_id;");
  const [run, setRun] = useState<RunResult | null>(null);
  const [healthy, setHealthy] = useState<boolean[]>(SYMPTOMS.map(() => false));
  const [damage, setDamage] = useState(0);
  const [hints, setHints] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const fresh = useCallback(async () => {
    setBusy(true);
    const d = await createSeededDb();
    await d.exec(DOCTOR_SETUP);
    setDb(d); // the effect cleanup below closes the previous patient
    setHealthy(SYMPTOMS.map(() => false));
    setDamage(0);
    setRun(null);
    setBusy(false);
  }, []);

  useEffect(() => {
    fresh();
  }, [fresh]);
  useEffect(() => () => void db?.close(), [db]);

  const examine = useCallback(async (d: DB) => {
    const h: boolean[] = [];
    for (const s of SYMPTOMS) {
      const r = await execRaw(d, s.healthy);
      h.push(r.ok && r.last?.rows[0]?.[0] === true);
    }
    setHealthy(h);
    const c = await execRaw(d, COLLATERAL);
    setDamage(c.ok ? Number(c.last?.rows[0]?.[0] ?? 0) : 0);
  }, []);

  const treat = async () => {
    if (!db) return;
    setBusy(true);
    const r = await execRaw(db, sql);
    setRun(r);
    await examine(db);
    setBusy(false);
  };

  const cured = healthy.filter(Boolean).length;
  const health = cured / SYMPTOMS.length;
  const score = cured * 100 - damage * DAMAGE_COST - hints.size * HINT_COST;
  const max = SYMPTOMS.length * 100;

  return (
    <div className="stack">
      <Hud round={cured} rounds={SYMPTOMS.length} score={Math.max(0, score)} extra={<span style={{ color: damage ? 'var(--bad)' : undefined }}>💥 collateral: {damage} row{damage === 1 ? '' : 's'}</span>} />
      <div className="health" title={`${Math.round(health * 100)}% healthy`}><div style={{ width: `${Math.max(4, health * 100)}%` }} /></div>
      <div className="split">
        <div className="card stack">
          <h3 style={{ margin: 0 }}>📋 Symptoms</h3>
          {SYMPTOMS.map((s, i) => (
            <motion.div key={i} className={`callout ${healthy[i] ? 'good' : 'bad'} small`} animate={{ scale: healthy[i] ? [1, 1.04, 1] : 1 }}>
              <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'start' }}>
                <span>{healthy[i] ? '💚' : '🤒'}</span>
                <div className="grow"><ReactMarkdown components={{ p: 'span' }}>{s.label}</ReactMarkdown></div>
                {!healthy[i] && !hints.has(i) && <button className="btn ghost small" onClick={() => setHints(new Set(hints).add(i))}>💡 −{HINT_COST}</button>}
              </div>
              {hints.has(i) && !healthy[i] && <pre style={{ margin: '6px 0 0' }}>{s.hint}</pre>}
            </motion.div>
          ))}
        </div>
        <div className="stack">
          <div className="card stack">
            <SqlEditor value={sql} onChange={setSql} onRun={treat} minHeight="120px" />
            <div className="row">
              <button className="btn primary" onClick={treat} disabled={!db || busy}>💉 Run treatment (Ctrl+Enter)</button>
              <button className="btn small" onClick={fresh} disabled={busy}>↺ New patient</button>
              <div className="grow" />
              <button className="btn good" onClick={() => finish(Math.max(0, score), max, <div className="small">Cured {cured}/{SYMPTOMS.length} · collateral damage: {damage} rows</div>)}>
                ✅ Discharge patient
              </button>
            </div>
            <div className="small muted">💡 Tip: SELECT first to see which rows your WHERE matches, then turn it into an UPDATE or DELETE.</div>
          </div>
          {run && <div className="card"><ResultView result={run} sql={sql} /></div>}
        </div>
      </div>
    </div>
  );
}
