import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ConfidencePicker } from '../../../components/ConfidencePicker';
import { HintPanel } from '../../../components/HintPanel';
import { makeBlocks, ParsonsPuzzle } from '../../../components/ParsonsPuzzle';
import { CodeEditor } from '../../../components/CodeEditor';
import type { Exercise } from '../../../content/types';
import type { Confidence } from '../../../pedagogy/review';
import { getProgress, queueVariant, recordAttempt, saveDraft } from '../../../progress/store';
import type { ExerciseCardProps } from '../../../shared/course';
import { evaluatePython, tryPython, type PyOutcome } from '../check';
import type { PyResult } from '../engine/run';
import { PyOutput } from './PyOutput';

function kindLabel(ex: Exercise): string {
  switch (ex.kind) {
    case 'write': return '✍️ کد را بنویس';
    case 'fillBlank': return '🧩 جای خالی را پر کن';
    case 'fixBug': return '🐛 اشکال را رفع کن';
    case 'parsons': return '🧱 خط‌ها را مرتب کن';
    case 'readQuery': return '👀 حدس بزن';
  }
}

export function PyExerciseCard({ exercise: ex, mode = 'practice', progressId, onDone, onAttempt, record = mode !== 'test', variantCount = 0 }: ExerciseCardProps) {
  const id = progressId ?? ex.id;
  const saved = getProgress().exercises[id];
  const editable = ex.kind === 'write' || ex.kind === 'fillBlank' || ex.kind === 'fixBug';
  const initialText = editable ? (mode === 'practice' && saved?.lastSql) || ex.starterSql || '' : '';
  const [text, setText] = useState(initialText);
  const [ran, setRan] = useState<PyResult | null>(null);
  const [outcome, setOutcome] = useState<PyOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);
  const [failed, setFailed] = useState(0);
  const [sawSolution, setSawSolution] = useState(false);
  const [solved, setSolved] = useState(false);
  const [finished, setFinished] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  const initialBlocks = useMemo(() => (ex.kind === 'parsons' ? makeBlocks(ex.id, ex.blocks, ex.distractors) : []), [ex]);
  const [pool, setPool] = useState(initialBlocks);
  const [answer, setAnswer] = useState<typeof initialBlocks>([]);

  useEffect(() => {
    setText(initialText);
    setRan(null);
    setOutcome(null);
    setBusy(false);
    setHintsShown(0);
    setFailed(0);
    setSawSolution(false);
    setSolved(false);
    setFinished(false);
    setChoice(null);
    setPool(initialBlocks);
    setAnswer([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.id, id]);

  const isTest = mode === 'test';
  const current = ex.kind === 'parsons' ? answer.map((b) => b.text).join('\n') : text;
  const stdin = ex.python?.stdin ?? '';

  const finish = (correct: boolean, confidence?: Confidence, choiceIdx?: number) => {
    if (finished) return;
    setFinished(true);
    if (record) recordAttempt(id, { correct, sql: ex.kind === 'readQuery' ? undefined : current, hintsUsed: hintsShown, sawSolution, confidence });
    const pick = choiceIdx ?? choice;
    const given = ex.kind === 'readQuery' ? (pick !== null && pick !== undefined ? ex.choices[pick] : undefined) : current;
    onDone?.(correct, confidence, given);
  };

  const run = async () => {
    setOutcome(null);
    setBusy(true);
    setRan(await tryPython(current, stdin));
    setBusy(false);
  };

  const check = async () => {
    if (ex.kind === 'readQuery') return;
    setRan(null);
    setBusy(true);
    const o = await evaluatePython(ex, current);
    setBusy(false);
    setOutcome(o);
    onAttempt?.(o.status === 'correct');
    if (o.status === 'correct') {
      setSolved(true);
      if (isTest) finish(true);
    } else {
      setFailed((f) => f + 1);
      if (isTest) finish(false);
      else if (record) recordAttempt(id, { correct: false, sql: current, hintsUsed: hintsShown, sawSolution });
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

  const solution = ex.kind === 'parsons' ? ex.blocks.join('\n') : ex.kind === 'readQuery' ? '' : ex.solution;
  const locked = finished || (isTest && (outcome !== null || choice !== null));

  return (
    <div className="card stack">
      <div className="row">
        <span className="tag accent">{kindLabel(ex)}</span>
        {mode === 'review' && <span className="tag">مرور</span>}
        {saved?.done && mode === 'practice' && <span className="tag good">✓ قبلاً حل شده</span>}
      </div>
      <div className="md">
        <ReactMarkdown>{ex.prompt}</ReactMarkdown>
      </div>

      {ex.kind === 'readQuery' && (
        <>
          {ex.sql && <pre dir="ltr" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{ex.sql}</pre>}
          <div className="choices">
            {ex.choices.map((c, i) => {
              const cls = choice === null ? '' : isTest ? (i === choice ? 'selected' : '') : i === ex.answer ? 'right' : i === choice ? 'wrong' : '';
              return (
                <button key={i} className={`choice ${cls}`} disabled={choice !== null} onClick={() => pickChoice(i)} dir="ltr">
                  {c}
                </button>
              );
            })}
          </div>
          {choice !== null && !isTest && (
            <div className={`callout ${solved ? 'good' : 'bad'}`}>
              <p>
                <b>{solved ? '✓ درست!' : '✗ نه دقیقاً.'}</b> {ex.explanation}
              </p>
            </div>
          )}
        </>
      )}

      {ex.kind === 'parsons' && (
        <ParsonsPuzzle
          pool={pool}
          answer={answer}
          noun="برنامه"
          disabled={locked || solved}
          onChange={(p, a) => {
            setPool(p);
            setAnswer(a);
            setOutcome(null);
          }}
        />
      )}

      {editable && (
        <CodeEditor
          value={text}
          lang="python"
          minHeight="120px"
          placeholder="کد پایتون را اینجا بنویس…"
          onChange={(v) => {
            setText(v);
            if (mode === 'practice') saveDraft(id, v);
          }}
          onRun={isTest ? undefined : run}
          readOnly={locked || solved}
        />
      )}

      {ex.kind !== 'readQuery' && !locked && !solved && (
        <div className="row">
          {!isTest && (
            <button className="btn" onClick={run} disabled={busy}>
              ▶ اجرا
            </button>
          )}
          <button className="btn primary" onClick={check} disabled={busy}>
            {busy ? '… صبر کن' : isTest ? 'ثبت پاسخ' : '✓ بررسی پاسخ'}
          </button>
          {!isTest && (
            <span className="small muted">
              <span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> اجرا می‌کند
            </span>
          )}
        </div>
      )}

      {ran && !outcome && <PyOutput result={ran} />}

      {outcome && !isTest && outcome.status !== 'correct' && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="callout bad">
            {outcome.feedback.map((f, i) => (
              <p key={i}>
                {i === 0 ? '✗ ' : ''}
                <ReactMarkdown components={{ p: 'span' }}>{f}</ReactMarkdown>
              </p>
            ))}
          </div>
          {outcome.expected !== undefined && (
            <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
              <PyOutput result={{ stdout: outcome.expected, stderr: '', error: '', ms: 0 }} label="خروجی مورد انتظار" />
              <PyOutput result={{ stdout: outcome.stdout, stderr: '', error: '', ms: 0 }} label="خروجی تو" />
            </div>
          )}
        </div>
      )}
      {outcome && isTest && <div className="callout info small">پاسخ ثبت شد. نتیجه در پایان آزمون نشان داده می‌شود.</div>}

      {solved && !isTest && ex.kind !== 'readQuery' && (
        <div className="callout good">
          <p>
            <b>✓ درست!</b> {ex.explanation}
          </p>
        </div>
      )}

      {solved && !isTest && !finished && <ConfidencePicker onPick={(c) => finish(true, c, choice ?? undefined)} />}

      {!isTest && !solved && ex.kind !== 'readQuery' && (
        <HintPanel
          hints={ex.hints}
          shown={hintsShown}
          onShowHint={() => setHintsShown((n) => n + 1)}
          solution={solution}
          explanation={ex.explanation}
          failedAttempts={failed}
          sawSolution={sawSolution}
          onShowSolution={() => {
            setSawSolution(true);
            if (variantCount > 0 && record) queueVariant(`${ex.id}~0`);
          }}
        />
      )}
    </div>
  );
}
