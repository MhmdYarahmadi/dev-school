import { motion } from 'framer-motion';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { tryAllQuery } from '../content/ddlCheck';
import { runSandboxed } from '../db/runQuery';
import { SqlEditor } from '../components/SqlEditor';
import { ErrorBox } from '../components/ResultView';
import { GameShell, Hud, type FinishFn } from './kit';
import { GATE_WAVES } from './levels/gatekeeper';

const PER_ROW = 10;
const PERFECT_BONUS = 30;
const HINT_COST = 20;

export default function Gatekeeper() {
  return (
    <GameShell
      gameId="gatekeeper"
      intro={
        <>
          <p>🛡️ You guard the database. Each wave, you get a <b>table brief</b>. Write the <code>CREATE TABLE</code> with the right <b>constraints</b>.</p>
          <p>Then a stream of rows charges at your gate. Good rows must get <b>in</b> ✅ and bad rows must <b>bounce off</b> 🛡️.</p>
          <ul>
            <li>{PER_ROW} points per row handled correctly, plus {PERFECT_BONUS} for a perfect wave.</li>
            <li>You can rebuild and resend a wave as often as you like before moving on.</li>
          </ul>
        </>
      }
    >
      {(finish, key) => <GatePlay key={key} finish={finish} />}
    </GameShell>
  );
}

function GatePlay({ finish }: { finish: FinishFn }) {
  const [wave, setWave] = useState(0);
  const [score, setScore] = useState(0);
  const w = GATE_WAVES[wave];
  const [ddl, setDdl] = useState(w.starter);
  const [outcomes, setOutcomes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [shown, setShown] = useState(0);
  const max = GATE_WAVES.reduce((s, x) => s + x.rows.length * PER_ROW + PERFECT_BONUS, 0);

  const send = async () => {
    setError(null);
    setOutcomes(null);
    const r = await runSandboxed(`${w.setupSql ?? ''}\n${ddl}\n${tryAllQuery(w.rows.map((x) => x.sql))}`);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    const out = r.last!.rows.map((x) => String(x[1]));
    setOutcomes(out);
    setShown(0);
    // Reveal the rows one at a time for the "charging at the gate" effect.
    out.forEach((_, i) => setTimeout(() => setShown(i + 1), 350 * (i + 1)));
  };

  const correctness = outcomes?.map((o, i) => o.startsWith('accepted') === w.rows[i].good) ?? [];
  const correct = correctness.filter(Boolean).length;
  const perfect = !!outcomes && correct === w.rows.length;
  const waveScore = correct * PER_ROW + (perfect ? PERFECT_BONUS : 0) - (hint ? HINT_COST : 0);

  const nextWave = () => {
    const total = score + Math.max(0, outcomes ? waveScore : 0);
    setScore(total);
    if (wave + 1 >= GATE_WAVES.length) finish(total, max);
    else {
      setWave(wave + 1);
      setDdl(GATE_WAVES[wave + 1].starter);
      setOutcomes(null);
      setHint(false);
      setError(null);
    }
  };

  return (
    <div className="stack">
      <Hud round={wave} rounds={GATE_WAVES.length} score={score} />
      <div className="split">
        <div className="card stack">
          <h3 style={{ margin: 0 }}>🌊 Wave {wave + 1}</h3>
          <div className="md"><ReactMarkdown>{w.brief}</ReactMarkdown></div>
          <SqlEditor value={ddl} onChange={setDdl} onRun={send} minHeight="140px" />
          <div className="row">
            <button className="btn primary" onClick={send}>🚪 Open the gate (Ctrl+Enter)</button>
            {!hint && <button className="btn small" onClick={() => setHint(true)}>💡 Hint (−{HINT_COST})</button>}
            {outcomes && <button className="btn good" onClick={nextWave}>{wave + 1 >= GATE_WAVES.length ? 'Finish' : 'Next wave'} → (+{Math.max(0, waveScore)})</button>}
          </div>
          {hint && <div className="callout info small">{w.hint}</div>}
          {error && <ErrorBox message={error} help="Your CREATE TABLE failed. Fix it and try again." />}
        </div>
        <div className="card stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>Incoming rows</h3>
          {w.rows.map((row, i) => {
            const o = outcomes && i < shown ? outcomes[i] : null;
            const accepted = o?.startsWith('accepted');
            const ok = o ? accepted === row.good : null;
            return (
              <motion.div key={`${wave}-${i}`} className={`lane ${o ? (accepted ? 'accepted' : 'rejected') : ''}`} initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.05 }}>
                <span>{o ? (accepted ? '✅' : '🛡️') : '⏳'}</span>
                <span className="grow">{row.label}</span>
                <span className="small muted">{row.good ? 'should get in' : 'should bounce'}</span>
                {ok !== null && <span>{ok ? '👍' : '👎'}</span>}
              </motion.div>
            );
          })}
          {outcomes && shown >= w.rows.length && (
            <div className={`callout ${perfect ? 'good' : 'warn'} small`}>
              {perfect ? '🏰 Perfect defence!' : `${correct}/${w.rows.length} handled correctly. Adjust your constraints and open the gate again, or move on.`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
