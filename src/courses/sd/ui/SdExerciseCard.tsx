import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeEditor } from '../../../components/CodeEditor';
import { ConfidencePicker } from '../../../components/ConfidencePicker';
import { HintPanel } from '../../../components/HintPanel';
import { makeBlocks, ParsonsPuzzle } from '../../../components/ParsonsPuzzle';
import type { Confidence } from '../../../pedagogy/review';
import { getProgress, queueVariant, recordAttempt, saveDraft } from '../../../progress/store';
import type { ExerciseCardProps } from '../../../shared/course';
import { checkParsons, evaluateSd, prepareDesign, type SdOutcome } from '../check';
import { detectSdMisconceptions } from '../misconceptions';
import { DesignEditor } from './DesignEditor';
import { RunButton, RunSummary, useSimRun } from './Lab';
import { RunPanel } from './RunPanel';
import { sdKindLabel } from './labels';
import { ScenarioView } from './ScenarioView';

export function SdExerciseCard({ exercise: ex, mode = 'practice', progressId, onDone, onAttempt, record = mode !== 'test', variantCount = 0 }: ExerciseCardProps) {
  const id = progressId ?? ex.id;
  const saved = getProgress().exercises[id];
  const spec = ex.sd;
  const isEstimate = spec?.target === 'estimate';
  const isDesign = !isEstimate && (ex.kind === 'write' || ex.kind === 'fillBlank' || ex.kind === 'fixBug');
  const initialText = ex.kind === 'write' || ex.kind === 'fillBlank' || ex.kind === 'fixBug' ? (mode === 'practice' && saved?.lastSql) || ex.starterSql || '' : '';
  const [text, setText] = useState(initialText);
  const [outcome, setOutcome] = useState<SdOutcome | null>(null);
  const [checking, setChecking] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);
  const [failed, setFailed] = useState(0);
  const [sawSolution, setSawSolution] = useState(false);
  const [solved, setSolved] = useState(false);
  const [finished, setFinished] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  const initialBlocks = useMemo(() => (ex.kind === 'parsons' ? makeBlocks(ex.id, ex.blocks, ex.distractors) : []), [ex]);
  const [pool, setPool] = useState(initialBlocks);
  const [answer, setAnswer] = useState<typeof initialBlocks>([]);
  const trial = useSimRun();

  useEffect(() => {
    setText(initialText);
    setOutcome(null);
    setChecking(false);
    setHintsShown(0);
    setFailed(0);
    setSawSolution(false);
    setSolved(false);
    setFinished(false);
    setChoice(null);
    setPool(initialBlocks);
    setAnswer([]);
    trial.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.id, id]);

  const isTest = mode === 'test';
  const current = ex.kind === 'parsons' ? answer.map((b) => b.text).join('\n') : text;

  const finish = (correct: boolean, confidence?: Confidence, choiceIdx?: number) => {
    if (finished) return;
    setFinished(true);
    if (record) recordAttempt(id, { correct, sql: ex.kind === 'readQuery' ? undefined : current, hintsUsed: hintsShown, sawSolution, confidence });
    const pick = choiceIdx ?? choice;
    const given = ex.kind === 'readQuery' ? (pick !== null && pick !== undefined ? ex.choices[pick] : undefined) : current;
    onDone?.(correct, confidence, given);
  };

  const settle = (o: SdOutcome) => {
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

  const check = async () => {
    if (ex.kind === 'readQuery' || checking) return;
    trial.clear();
    if (ex.kind === 'parsons') {
      const ok = checkParsons(ex.blocks, answer.map((b) => b.text));
      settle({ status: ok ? 'correct' : 'wrong', feedback: ok ? ['That order works.'] : ['Not in the right order yet.'] });
      return;
    }
    setChecking(true);
    try {
      settle(await evaluateSd(ex, current));
    } catch (e) {
      setOutcome({ status: 'error', feedback: [(e as Error).message] });
    } finally {
      setChecking(false);
    }
  };

  /** Practice only: run the design and show the results without checking. */
  const tryRun = () => {
    if (!spec?.run) return;
    setOutcome(null);
    const p = prepareDesign(current);
    if (p.outcome) {
      setOutcome(p.outcome);
      return;
    }
    void trial.run(p.design!, spec.run);
  };

  const pickChoice = (i: number) => {
    if (ex.kind !== 'readQuery' || choice !== null) return;
    setChoice(i);
    const correct = i === ex.answer;
    onAttempt?.(correct);
    setSolved(correct);
    if (isTest || !correct) finish(correct, undefined, i);
  };

  const misconceptions = useMemo(() => {
    if (!outcome?.design || !spec?.run || isTest) return [];
    return detectSdMisconceptions({ design: outcome.design, run: spec.run, outcome });
  }, [outcome, spec, isTest]);

  const solution = ex.kind === 'parsons' ? ex.blocks.join('\n') : ex.kind === 'readQuery' ? '' : ex.solution;
  const locked = finished || (isTest && (outcome !== null || choice !== null));
  const shown = outcome?.result ? outcome : trial.outcome;
  const editMode = locked || solved ? 'view' : spec?.tuneOnly ? 'tune' : 'edit';

  return (
    <div className="card stack">
      <div className="row">
        <span className="tag accent">{sdKindLabel(ex)}</span>
        {mode === 'review' && <span className="tag">Review</span>}
        {saved?.done && mode === 'practice' && <span className="tag good">✓ solved before</span>}
      </div>
      <div className="md">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{ex.prompt}</ReactMarkdown>
      </div>

      {ex.kind === 'readQuery' && (
        <>
          {ex.sql && <ScenarioView code={ex.sql} autoRun />}
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
              <p>
                <b>{solved ? '✓ Correct!' : '✗ Not quite.'}</b> <ReactMarkdown components={{ p: 'span' }}>{ex.explanation}</ReactMarkdown>
              </p>
            </div>
          )}
        </>
      )}

      {ex.kind === 'parsons' && (
        <ParsonsPuzzle
          pool={pool}
          answer={answer}
          noun="steps"
          disabled={locked || solved}
          onChange={(p, a) => {
            setPool(p);
            setAnswer(a);
            setOutcome(null);
          }}
        />
      )}

      {isEstimate && (
        <form
          className="sd-estimate"
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          <input
            className="input"
            aria-label="Your estimate"
            inputMode="decimal"
            placeholder="e.g. 1200 or 1.2k"
            value={text}
            disabled={locked || solved}
            onChange={(e) => {
              setText(e.target.value);
              setOutcome(null);
              if (mode === 'practice') saveDraft(id, e.target.value);
            }}
          />
          {spec?.unit && <span>{spec.unit}</span>}
          <span className="small muted">Within {Math.round((spec?.tolerance ?? 0.25) * 100)}% counts: it's an estimate.</span>
        </form>
      )}

      {isDesign && (
        <>
          {spec?.run && <RunSummary run={spec.run} />}
          {ex.kind === 'fillBlank' ? (
            <CodeEditor
              value={text}
              lang="yaml"
              minHeight="200px"
              readOnly={locked || solved}
              onRun={isTest ? undefined : tryRun}
              onChange={(v) => {
                setText(v);
                if (mode === 'practice') saveDraft(id, v);
              }}
            />
          ) : (
            <DesignEditor
              value={text}
              mode={editMode}
              stats={shown?.result?.nodes}
              onChange={(v) => {
                setText(v);
                if (mode === 'practice') saveDraft(id, v);
              }}
            />
          )}
        </>
      )}

      {ex.kind !== 'readQuery' && !locked && !solved && (
        <div className="row">
          {isDesign && !isTest && <RunButton running={trial.running} onClick={tryRun} label="▶ Run" disabled={checking} />}
          <button className="btn primary" onClick={() => void check()} disabled={checking || trial.running}>
            {checking ? (
              <>
                <span className="sd-spinner" /> Checking…
              </>
            ) : isTest ? (
              'Submit answer'
            ) : (
              '✓ Check answer'
            )}
          </button>
          {isDesign && !isTest && <span className="small muted">Run shows what happens; Check runs it against the requirements.</span>}
        </div>
      )}

      {trial.error && <div className="callout bad small">{trial.error}</div>}

      {outcome && !isTest && outcome.status !== 'correct' && (
        <div className="callout bad">
          {/* with a run, the requirement list below shows each failure: only the summary here */}
          {(outcome.checks ? outcome.feedback.slice(0, 1) : outcome.feedback).map((f, i) => (
            <p key={i}>
              {i === 0 ? '✗ ' : ''}
              <ReactMarkdown components={{ p: 'span' }}>{f}</ReactMarkdown>
            </p>
          ))}
        </div>
      )}
      {outcome && isTest && <div className="callout info small">Answer submitted. Results are shown at the end of the test.</div>}

      {shown?.result && !isTest && <RunPanel result={shown.result} checks={shown.checks} run={spec?.run} diagnosis={shown.status === 'correct' ? undefined : shown.diagnosis} />}

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
          <p>
            <b>✓ Correct!</b> {isEstimate && outcome?.feedback[0]} <ReactMarkdown components={{ p: 'span' }}>{ex.explanation}</ReactMarkdown>
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
