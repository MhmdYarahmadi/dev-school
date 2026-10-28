import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Exercise, ParsonsExercise } from '../content/types';
import { evaluateSql, parsonsSql } from '../content/evaluate';
import type { CheckOutcome } from '../db/checker';
import { runSandboxed, type RunResult } from '../db/runQuery';
import { detectMisconceptions } from '../pedagogy/misconceptions';
import type { Confidence } from '../pedagogy/review';
import { getProgress, queueVariant, recordAttempt, saveDraft } from '../progress/store';
import { ConfidencePicker } from './ConfidencePicker';
import { ExecutionStepper } from './ExecutionStepper';
import { HintPanel } from './HintPanel';
import { makeBlocks, ParsonsPuzzle } from './ParsonsPuzzle';
import { ErrorBox, ResultView } from './ResultView';
import { RowDiffView } from './RowDiffView';
import { SqlEditor } from './SqlEditor';

export type ExerciseMode = 'practice' | 'test' | 'review';

const KIND_LABEL: Record<Exercise['kind'], string> = {
  write: '✍️ Write the query',
  fillBlank: '🧩 Fill in the blanks',
  fixBug: '🐛 Fix the bug',
  parsons: '🧱 Build the query',
  readQuery: '👀 Read the query',
};

interface Props {
  exercise: Exercise;
  mode?: ExerciseMode;
  /** Id used for progress (variants use `<id>~<n>`). */
  progressId?: string;
  /** Called once the learner has finished with the item. */
  /** `answer` is the SQL submitted, or the text of the chosen option. */
  onDone?: (correct: boolean, confidence?: Confidence, answer?: string) => void;
  /** Called after every check, right or wrong. */
  onAttempt?: (correct: boolean) => void;
  /** Practice/review records attempts itself; tests leave recording to the TestRunner. */
  record?: boolean;
  variantCount?: number;
}

export function ExerciseCard({ exercise: ex, mode = 'practice', progressId, onDone, onAttempt, record = mode !== 'test', variantCount = 0 }: Props) {
  const id = progressId ?? ex.id;
  const saved = getProgress().exercises[id];
  const initialSql = ex.kind === 'write' || ex.kind === 'fillBlank' || ex.kind === 'fixBug' ? (mode === 'practice' && saved?.lastSql) || ex.starterSql || '' : '';
  const [sql, setSql] = useState(initialSql);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  const [checking, setChecking] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);
  const [failed, setFailed] = useState(0);
  const [sawSolution, setSawSolution] = useState(false);
  const [solved, setSolved] = useState(false);
  const [finished, setFinished] = useState(false);
  const [stepping, setStepping] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  const initialBlocks = useMemo(() => (ex.kind === 'parsons' ? makeBlocks(ex.id, ex.blocks, ex.distractors) : []), [ex]);
  const [pool, setPool] = useState(initialBlocks);
  const [answer, setAnswer] = useState<typeof initialBlocks>([]);

  // Reset when the exercise changes.
  useEffect(() => {
    setSql(initialSql);
    setRunResult(null);
    setOutcome(null);
    setHintsShown(0);
    setFailed(0);
    setSawSolution(false);
    setSolved(false);
    setFinished(false);
    setStepping(false);
    setChoice(null);
    setPool(initialBlocks);
    setAnswer([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.id, id]);

  const isTest = mode === 'test';
  const currentSql = ex.kind === 'parsons' ? parsonsSql(answer.map((b) => b.text)) : sql;

  const finish = (correct: boolean, confidence?: Confidence, choiceIdx?: number) => {
    if (finished) return;
    setFinished(true);
    if (record) {
      recordAttempt(id, { correct, sql: ex.kind === 'readQuery' ? undefined : currentSql, hintsUsed: hintsShown, sawSolution, confidence });
    }
    const pick = choiceIdx ?? choice;
    const answer = ex.kind === 'readQuery' ? (pick !== null && pick !== undefined ? ex.choices[pick] : undefined) : currentSql;
    onDone?.(correct, confidence, answer);
  };

  const run = async () => {
    setOutcome(null);
    setRunResult(await runSandboxed(currentSql, 'setupSql' in ex ? ex.setupSql : undefined));
  };

  const check = async () => {
    if (ex.kind === 'readQuery') return;
    setChecking(true);
    setRunResult(null);
    try {
      const o = await evaluateSql(ex, currentSql);
      setOutcome(o);
      onAttempt?.(o.status === 'correct');
      if (o.status === 'correct') {
        setSolved(true);
        if (isTest) finish(true);
      } else {
        setFailed((f) => f + 1);
        if (isTest) finish(false);
        else if (record) recordAttempt(id, { correct: false, sql: currentSql, hintsUsed: hintsShown, sawSolution });
      }
    } finally {
      setChecking(false);
    }
  };

  const pickChoice = (i: number) => {
    if (ex.kind !== 'readQuery' || choice !== null) return;
    setChoice(i);
    const correct = i === ex.answer;
    onAttempt?.(correct);
    setSolved(correct);
    if (isTest || !correct) finish(correct, undefined, i);
  };

  const showSolution = () => {
    setSawSolution(true);
    if (variantCount > 0 && record) queueVariant(`${ex.id}~0`);
  };

  const misconceptions = useMemo(() => {
    if (!outcome || outcome.status === 'correct' || isTest) return [];
    return detectMisconceptions({
      sql: currentSql,
      actualRows: outcome.actual?.rows.length,
      expectedRows: outcome.expected?.rows.length,
      errorMessage: outcome.error?.message,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);

  const solutionSql = ex.kind === 'parsons' ? parsonsSql((ex as ParsonsExercise).blocks) : ex.kind === 'readQuery' ? '' : ex.solution;
  const locked = finished || (isTest && (outcome !== null || choice !== null));

  return (
    <div className="card stack">
      <div className="row">
        <span className="tag accent">{KIND_LABEL[ex.kind]}</span>
        {mode === 'review' && <span className="tag">Review</span>}
        {saved?.done && mode === 'practice' && <span className="tag good">✓ solved before</span>}
      </div>
      <div className="md"><ReactMarkdown>{ex.prompt}</ReactMarkdown></div>

      {ex.kind === 'readQuery' && (
        <>
          {ex.sql && <pre>{ex.sql}</pre>}
          <div className="choices">
            {ex.choices.map((c, i) => {
              const cls = choice === null ? '' : isTest ? (i === choice ? 'selected' : '') : i === ex.answer ? 'right' : i === choice ? 'wrong' : '';
              return (
                <button key={i} className={`choice ${cls}`} disabled={choice !== null} onClick={() => pickChoice(i)}>
                  <ReactMarkdown components={{ p: 'span' }}>{c}</ReactMarkdown>
                </button>
              );
            })}
          </div>
          {choice !== null && !isTest && (
            <div className={`callout ${solved ? 'good' : 'bad'}`}>
              <p><b>{solved ? '✓ Correct!' : '✗ Not quite.'}</b> {ex.explanation}</p>
            </div>
          )}
        </>
      )}

      {ex.kind === 'parsons' && (
        <ParsonsPuzzle pool={pool} answer={answer} disabled={locked || solved} onChange={(p, a) => { setPool(p); setAnswer(a); setOutcome(null); }} />
      )}

      {(ex.kind === 'write' || ex.kind === 'fillBlank' || ex.kind === 'fixBug') && (
        <SqlEditor
          value={sql}
          onChange={(v) => {
            setSql(v);
            if (mode === 'practice') saveDraft(id, v);
          }}
          onRun={isTest ? undefined : run}
          readOnly={locked}
        />
      )}

      {ex.kind !== 'readQuery' && !locked && !solved && (
        <div className="row">
          {!isTest && <button className="btn" onClick={run}>▶ Run</button>}
          <button className="btn primary" onClick={check} disabled={checking}>{checking ? 'Checking…' : isTest ? 'Submit answer' : '✓ Check answer'}</button>
          {!isTest && ex.kind !== 'parsons' && <button className="btn ghost" onClick={() => setStepping((s) => !s)}>🔍 Step through</button>}
          {!isTest && <span className="small muted"><span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> runs</span>}
        </div>
      )}

      {stepping && <ExecutionStepper sql={currentSql} setupSql={'setupSql' in ex ? ex.setupSql : undefined} onClose={() => setStepping(false)} />}
      {runResult && !outcome && <ResultView result={runResult} sql={currentSql} />}

      {outcome && !isTest && <Feedback outcome={outcome} sql={currentSql} />}
      {outcome && isTest && (
        <div className="callout info small">Answer submitted. Results are shown at the end of the test.</div>
      )}

      {misconceptions.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {misconceptions.map((m) => (
            <div key={m.id} className="callout warn small">
              <b>🧠 Common mix-up: {m.title}.</b> <ReactMarkdown components={{ p: 'span' }}>{m.explain}</ReactMarkdown>
            </div>
          ))}
        </div>
      )}

      {solved && !isTest && ex.kind !== 'readQuery' && (
        <div className="callout good">
          <p><b>✓ Correct!</b> {ex.explanation}</p>
        </div>
      )}

      {solved && !isTest && !finished && (
        <ConfidencePicker onPick={(c) => finish(true, c, choice ?? undefined)} />
      )}

      {!isTest && !solved && ex.kind !== 'readQuery' && (
        <HintPanel
          hints={ex.hints}
          shown={hintsShown}
          onShowHint={() => setHintsShown((n) => n + 1)}
          solution={solutionSql}
          explanation={ex.explanation}
          failedAttempts={failed}
          sawSolution={sawSolution}
          onShowSolution={showSolution}
        />
      )}
    </div>
  );
}

function Feedback({ outcome, sql }: { outcome: CheckOutcome; sql: string }) {
  if (outcome.status === 'error' && outcome.error) {
    return <ErrorBox message={outcome.error.message} help={outcome.errorHelp} sql={sql} position={outcome.error.position} />;
  }
  if (outcome.status === 'wrong') {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="callout bad">
          {outcome.feedback.map((f, i) => <p key={i}>{i === 0 ? '✗ ' : ''}{f}</p>)}
        </div>
        {outcome.actual && outcome.expected && outcome.actual.columns.length === outcome.expected.columns.length && (
          <RowDiffView actual={outcome.actual} expected={outcome.expected} diff={outcome.diff} />
        )}
        {outcome.actual && outcome.expected && outcome.actual.columns.length !== outcome.expected.columns.length && (
          <div className="small muted">Expected columns: <code>{outcome.expected.columns.join(', ')}</code> · yours: <code>{outcome.actual.columns.join(', ')}</code></div>
        )}
      </div>
    );
  }
  return null;
}
