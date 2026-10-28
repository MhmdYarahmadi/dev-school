import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { runSandboxed } from '../db/runQuery';
import { ErrorBox } from '../components/ResultView';
import { GameShell, Hud, type FinishFn } from './kit';
import { LINEUP_CASES, SUSPECTS_SETUP } from './levels/lineup';

interface Suspect {
  id: number;
  name: string;
  face: string;
  age: number;
  height: number;
  hair: string;
  hat: boolean;
  shoe: number;
  vehicle: string | null;
  alibi: string | null;
  seen: string;
}

const CLUE_EVERY = 20; // seconds between automatic clues
const WRONG_ACCUSATION = 40;

export default function Lineup() {
  return (
    <GameShell
      gameId="lineup"
      intro={
        <>
          <p>🕵️ Thirty suspects stand in the lineup. Witness clues arrive one at a time.</p>
          <p>Type a <b>WHERE condition</b>. Suspects who don't match <b>drop out live</b> as you type. When exactly one is left, <b>accuse</b> them!</p>
          <p>Columns: <code>name, age, height_cm, hair, has_hat, shoe_size, vehicle, alibi, last_seen</code>. Some values are NULL…</p>
          <ul>
            <li>Solve each case for 100 points, plus a bonus for speed (fewer clues revealed is faster).</li>
            <li>A wrong accusation costs {WRONG_ACCUSATION} points.</li>
          </ul>
        </>
      }
    >
      {(finish, key) => <LineupPlay key={key} finish={finish} />}
    </GameShell>
  );
}

function LineupPlay({ finish }: { finish: FinishFn }) {
  const [suspects, setSuspects] = useState<Suspect[]>([]);
  const [caseIdx, setCaseIdx] = useState(0);
  const [cluesShown, setCluesShown] = useState(1);
  const [where, setWhere] = useState('');
  const [remaining, setRemaining] = useState<Set<number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [msg, setMsg] = useState<{ kind: 'good' | 'bad'; text: string } | null>(null);
  const [solvedCase, setSolvedCase] = useState(false);
  const c = LINEUP_CASES[caseIdx];
  const reqId = useRef(0);
  const maxScore = LINEUP_CASES.length * 150;

  useEffect(() => {
    runSandboxed('SELECT suspect_id, name, face, age, height_cm, hair, has_hat, shoe_size, vehicle, alibi, last_seen FROM suspects ORDER BY suspect_id', SUSPECTS_SETUP).then((r) => {
      if (!r.ok) return;
      setSuspects(r.last!.rows.map((x) => ({ id: x[0] as number, name: x[1] as string, face: x[2] as string, age: x[3] as number, height: x[4] as number, hair: x[5] as string, hat: x[6] as boolean, shoe: x[7] as number, vehicle: x[8] as string | null, alibi: x[9] as string | null, seen: x[10] as string })));
    });
  }, []);

  // A new clue every CLUE_EVERY seconds.
  useEffect(() => {
    if (solvedCase) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [solvedCase, caseIdx]);
  useEffect(() => {
    if (elapsed > 0 && elapsed % CLUE_EVERY === 0) setCluesShown((n) => Math.min(n + 1, c.clues.length));
  }, [elapsed, c.clues.length]);

  // Live filtering, debounced.
  useEffect(() => {
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      if (!where.trim()) {
        setRemaining(null);
        setError(null);
        return;
      }
      const r = await runSandboxed(`SELECT suspect_id FROM suspects WHERE ${where}`, SUSPECTS_SETUP);
      if (id !== reqId.current) return;
      if (r.ok) {
        setRemaining(new Set(r.last!.rows.map((x) => x[0] as number)));
        setError(null);
      } else setError(r.error.message);
    }, 350);
    return () => clearTimeout(t);
  }, [where]);

  const left = remaining ? suspects.filter((s) => remaining.has(s.id)) : suspects;

  const accuse = () => {
    if (left.length !== 1) return;
    if (left[0].id === c.culpritId) {
      const bonus = Math.max(0, 50 - (cluesShown - 1) * 10 - Math.floor(elapsed / 6));
      const gained = 100 + bonus;
      const total = score + gained;
      setScore(total);
      setSolvedCase(true);
      setMsg({ kind: 'good', text: `🎉 ${left[0].name} confesses! +${gained}` });
      setTimeout(() => {
        if (caseIdx + 1 >= LINEUP_CASES.length) finish(total, maxScore);
        else {
          setCaseIdx(caseIdx + 1);
          setCluesShown(1);
          setElapsed(0);
          setWhere('');
          setMsg(null);
          setSolvedCase(false);
        }
      }, 1800);
    } else {
      setScore((s) => s - WRONG_ACCUSATION);
      setMsg({ kind: 'bad', text: `😬 ${left[0].name} has an airtight alibi. −${WRONG_ACCUSATION}. Re-read the clues!` });
    }
  };

  return (
    <div className="stack">
      <Hud round={caseIdx} rounds={LINEUP_CASES.length} score={score} extra={<span>🔎 {left.length} suspect{left.length === 1 ? '' : 's'} left</span>} />
      <div className="split">
        <div className="card stack">
          <h3 style={{ margin: 0 }}>📁 Case {caseIdx + 1}: {c.title}</h3>
          <div className="muted">{c.story}</div>
          {c.clues.slice(0, cluesShown).map((cl, i) => (
            <motion.div key={i} className="callout info small" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
              <ReactMarkdown components={{ p: 'span' }}>{cl.text}</ReactMarkdown>
            </motion.div>
          ))}
          {cluesShown < c.clues.length && (
            <div className="row small muted">
              Next clue in {CLUE_EVERY - (elapsed % CLUE_EVERY)}s
              <button className="btn small" onClick={() => setCluesShown(cluesShown + 1)}>Reveal now</button>
            </div>
          )}
          <div>
            <div className="mono small" style={{ marginBottom: 4 }}>SELECT * FROM suspects WHERE …</div>
            <textarea
              value={where}
              onChange={(e) => setWhere(e.target.value)}
              rows={3}
              className="mono"
              placeholder="hair = 'red' AND …"
              style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--code-bg)', color: 'var(--text)', font: 'inherit', fontFamily: 'var(--mono)' }}
              disabled={solvedCase}
            />
          </div>
          {error && <ErrorBox message={error} />}
          <div className="row">
            <button className="btn primary" disabled={left.length !== 1 || solvedCase || !where.trim()} onClick={accuse}>
              ☝️ Accuse {left.length === 1 && where.trim() ? left[0].name : '(need exactly 1 suspect)'}
            </button>
          </div>
          {msg && <div className={`callout ${msg.kind}`}>{msg.text}</div>}
        </div>
        <div className="suspects">
          {suspects.map((s) => {
            const out = remaining !== null && !remaining.has(s.id);
            return (
              <motion.div key={s.id} className={`suspect ${out ? 'out' : ''}`} animate={{ scale: out ? 0.92 : 1 }} title={`alibi: ${s.alibi ?? 'NULL'} · vehicle: ${s.vehicle ?? 'NULL'}`}>
                <div className="face">{s.face}{s.hat ? '🎩' : ''}</div>
                <b>{s.name}</b>
                <div className="muted">{s.age}y · {s.height}cm</div>
                <div className="muted">{s.hair} · shoe {s.shoe}</div>
                <div className="muted">{s.vehicle ?? '🚶 —'} · {s.seen}</div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
