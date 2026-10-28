import { motion } from 'framer-motion';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { checkAnswer } from '../db/checker';
import { runSandboxed, type RunResult } from '../db/runQuery';
import { SqlEditor } from '../components/SqlEditor';
import { ErrorBox, ResultView } from '../components/ResultView';
import { GameShell, Hud, type FinishFn } from './kit';
import { CASEFILES, FINALE, type MysteryCase } from './levels/cases';

const STEP_POINTS = 100;
const HINT_COST = 40;
const ACCUSE_POINTS = 200;

export function MysteryGame({ mystery }: { mystery: MysteryCase }) {
  return (
    <GameShell
      gameId={mystery.id}
      intro={
        <>
          <h3 style={{ marginTop: 0 }}>{mystery.title}</h3>
          <ReactMarkdown>{mystery.intro}</ReactMarkdown>
          <p className="small muted">Each solved step: {STEP_POINTS} points (a hint costs {HINT_COST}). The right accusation at the end: {ACCUSE_POINTS} points.</p>
        </>
      }
    >
      {(finish, key) => <MysteryPlay key={key} mystery={mystery} finish={finish} />}
    </GameShell>
  );
}

function MysteryPlay({ mystery, finish }: { mystery: MysteryCase; finish: FinishFn }) {
  const [step, setStep] = useState(0);
  const [score, setScore] = useState(0);
  const [sql, setSql] = useState('');
  const [run, setRun] = useState<RunResult | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'good' | 'bad'; text: string; err?: string } | null>(null);
  const [hint, setHint] = useState(false);
  const [notebook, setNotebook] = useState<{ prompt: string; reveal: string; sql: string }[]>([]);
  const [accused, setAccused] = useState<string | null>(null);
  const max = mystery.steps.length * STEP_POINTS + ACCUSE_POINTS;
  const cur = mystery.steps[step];
  const accusing = step >= mystery.steps.length;

  const tryRun = async () => setRun(await runSandboxed(sql, mystery.setupSql));

  const submit = async () => {
    const o = await checkAnswer(sql, { solution: cur.solution, setupSql: mystery.setupSql });
    setRun(o.userResult ?? null);
    if (o.status === 'correct') {
      const gained = STEP_POINTS - (hint ? HINT_COST : 0);
      setScore((s) => s + gained);
      setNotebook((n) => [...n, { prompt: cur.prompt, reveal: cur.reveal, sql }]);
      setFeedback({ kind: 'good', text: `🔓 Clue unlocked! +${gained}` });
      setTimeout(() => {
        setStep(step + 1);
        setSql('');
        setRun(null);
        setFeedback(null);
        setHint(false);
      }, 1200);
    } else if (o.status === 'error') setFeedback({ kind: 'bad', text: 'Error', err: o.error?.message });
    else setFeedback({ kind: 'bad', text: o.feedback.join(' ') });
  };

  const accuse = (name: string) => {
    setAccused(name);
    const right = name === mystery.culprit;
    const total = score + (right ? ACCUSE_POINTS : 0);
    setScore(total);
    setTimeout(
      () =>
        finish(
          total,
          max,
          <div className={`callout ${right ? 'good' : 'warn'}`}>
            <p>{right ? mystery.epilogue : `${name} was innocent… The real culprit was ${mystery.culprit}. Look back at the clues in your notebook.`}</p>
          </div>,
        ),
      1500,
    );
  };

  return (
    <div className="stack">
      <Hud round={Math.min(step, mystery.steps.length)} rounds={mystery.steps.length + 1} score={score} />
      <div className="split">
        <div className="stack">
          {!accusing ? (
            <div className="card stack">
              <div className="md"><ReactMarkdown>{cur.prompt}</ReactMarkdown></div>
              <SqlEditor value={sql} onChange={setSql} onRun={tryRun} minHeight="120px" />
              <div className="row">
                <button className="btn" onClick={tryRun}>▶ Run</button>
                <button className="btn primary" onClick={submit}>🔎 Submit evidence</button>
                {!hint && <button className="btn small" onClick={() => setHint(true)}>💡 Hint (−{HINT_COST})</button>}
              </div>
              {hint && <div className="callout info small mono">{cur.hint}</div>}
              {feedback && (feedback.err ? <ErrorBox message={feedback.err} /> : <div className={`callout ${feedback.kind} small`}>{feedback.text}</div>)}
              <ResultView result={run} sql={sql} />
            </div>
          ) : (
            <motion.div className="card stack" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              <h3 style={{ margin: 0 }}>☝️ Time to accuse. Who did it?</h3>
              <div className="choices">
                {mystery.suspects.map((s) => (
                  <button key={s} className={`choice ${accused === s ? (s === mystery.culprit ? 'right' : 'wrong') : ''}`} disabled={!!accused} onClick={() => accuse(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </div>
        <div className="card stack">
          <h3 style={{ margin: 0 }}>📓 Detective's notebook</h3>
          {notebook.length === 0 && <div className="muted small">Solved steps and what they revealed will appear here.</div>}
          {notebook.map((n, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="callout info small">
              <b>Step {i + 1}:</b> {n.reveal}
              <details><summary className="muted">your query</summary><pre>{n.sql}</pre></details>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CaseFilesGame() {
  return <MysteryGame mystery={CASEFILES} />;
}

export function FinaleGame() {
  return <MysteryGame mystery={FINALE} />;
}

export default CaseFilesGame;
