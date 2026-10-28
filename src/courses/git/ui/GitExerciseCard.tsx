import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { CodeEditor } from '../../../components/CodeEditor';
import { ConfidencePicker } from '../../../components/ConfidencePicker';
import { HintPanel } from '../../../components/HintPanel';
import { makeBlocks, ParsonsPuzzle } from '../../../components/ParsonsPuzzle';
import type { Exercise } from '../../../content/types';
import type { Confidence } from '../../../pedagogy/review';
import { getProgress, queueVariant, recordAttempt, saveDraft } from '../../../progress/store';
import type { ExerciseCardProps } from '../../../shared/course';
import { evaluateGit, sandbox, tryGit, type GitOutcome } from '../check';
import type { GitMachine } from '../engine';
import { detectGitMisconceptions } from '../misconceptions';
import { machineGraphs } from './graphLayout';
import { GraphView } from './GraphView';
import { TranscriptView, type TermEntry } from './Terminal';
import { Workspace, type View } from './Workspace';
import { t } from '../../../shared/i18n';

function kindLabel(ex: Exercise): string {
  const file = ex.git?.target === 'file';
  switch (ex.kind) {
    case 'write':
      return file ? t('✍️ Write {file}', { file: ex.git?.file ?? 'file.txt' }) : t('⌨️ Do it in the terminal');
    case 'fillBlank':
      return t('🧩 Fill in the blanks');
    case 'fixBug':
      return t('🐛 Fix the commands');
    case 'parsons':
      return t('🧱 Put the steps in order');
    case 'readQuery':
      return t('👀 Read and decide');
  }
}

/** Which panels an exercise shows: the hub once there's a remote, the areas for staging work. */
function viewsFor(ex: Exercise): View[] {
  const setup = (ex.git?.setup ?? []).join('\n') + ('solution' in ex ? (ex as { solution: string }).solution : '');
  const hub = /@hub|clone|push|pull|fetch|gh /.test(setup);
  const staging = (ex.git?.compare ?? []).includes('staging') || /\bgit (add|restore --staged|rm --cached)\b/.test(setup);
  const v: View[] = staging ? ['areas', 'graph'] : ['graph', 'areas'];
  if (hub) v.splice(1, 0, 'hub');
  v.push('files');
  return v;
}

/** The commands the learner typed in the exercise terminal: their answer. */
function journalAnswer(m: GitMachine): string {
  return m.journal.join('\n');
}

export function GitExerciseCard({ exercise: ex, mode = 'practice', progressId, onDone, onAttempt, record = mode !== 'test', variantCount = 0 }: ExerciseCardProps) {
  const id = progressId ?? ex.id;
  const saved = getProgress().exercises[id];
  const spec = ex.git;
  const terminalMode = ex.kind === 'write' && spec?.target !== 'file';
  const initialText = ex.kind === 'fillBlank' || ex.kind === 'fixBug' || (ex.kind === 'write' && !terminalMode) ? (mode === 'practice' && saved?.lastSql) || ex.starterSql || '' : '';
  const [text, setText] = useState(initialText);
  const [machine, setMachine] = useState<GitMachine>(() => sandbox(spec));
  const [wsKey, setWsKey] = useState(0);
  const [typed, setTyped] = useState(0);
  const [ran, setRan] = useState<{ transcript: TermEntry[]; machine: GitMachine } | null>(null);
  const [outcome, setOutcome] = useState<GitOutcome | null>(null);
  const [hintsShown, setHintsShown] = useState(0);
  const [failed, setFailed] = useState(0);
  const [sawSolution, setSawSolution] = useState(false);
  const [solved, setSolved] = useState(false);
  const [finished, setFinished] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  const initialBlocks = useMemo(() => (ex.kind === 'parsons' ? makeBlocks(ex.id, ex.blocks, ex.distractors) : []), [ex]);
  const [pool, setPool] = useState(initialBlocks);
  const [answer, setAnswer] = useState<typeof initialBlocks>([]);
  const views = useMemo(() => viewsFor(ex), [ex]);

  useEffect(() => {
    setText(initialText);
    setMachine(sandbox(spec));
    setWsKey((k) => k + 1);
    setTyped(0);
    setRan(null);
    setOutcome(null);
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
  const current = ex.kind === 'parsons' ? answer.map((b) => b.text).join('\n') : terminalMode ? journalAnswer(machine) : text;

  const finish = (correct: boolean, confidence?: Confidence, choiceIdx?: number) => {
    if (finished) return;
    setFinished(true);
    if (record) recordAttempt(id, { correct, sql: ex.kind === 'readQuery' ? undefined : current, hintsUsed: hintsShown, sawSolution, confidence });
    const pick = choiceIdx ?? choice;
    const given = ex.kind === 'readQuery' ? (pick !== null && pick !== undefined ? ex.choices[pick] : undefined) : current;
    onDone?.(correct, confidence, given);
  };

  const run = () => {
    if (!spec) return;
    setOutcome(null);
    setRan(tryGit(spec, current));
  };

  const check = () => {
    if (ex.kind === 'readQuery' || !spec) return;
    setRan(null);
    const o = evaluateGit(ex, current);
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

  const restart = () => {
    setMachine(sandbox(spec));
    setWsKey((k) => k + 1);
    setTyped(0);
    setOutcome(null);
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
    if (!outcome || !spec || isTest) return [];
    return detectGitMisconceptions({ answer: current, spec, outcome });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);

  // "Read and decide": what the shown commands print, on the exercise's machine.
  const shown = useMemo(() => (ex.kind === 'readQuery' && ex.sql && spec ? tryGit(spec, ex.sql) : null), [ex, spec]);
  const solution = ex.kind === 'parsons' ? ex.blocks.join('\n') : ex.kind === 'readQuery' ? '' : ex.solution;
  const locked = finished || (isTest && (outcome !== null || choice !== null));
  const startGraphs = useMemo(() => (spec && !terminalMode && ex.kind !== 'readQuery' ? machineGraphs(sandbox(spec)) : []), [spec, terminalMode, ex.kind]);

  return (
    <div className="card stack">
      <div className="row">
        <span className="tag accent">{kindLabel(ex)}</span>
        {mode === 'review' && <span className="tag">{t('Review')}</span>}
        {saved?.done && mode === 'practice' && <span className="tag good">{t('✓ solved before')}</span>}
      </div>
      <div className="md">
        <ReactMarkdown>{ex.prompt}</ReactMarkdown>
      </div>

      {ex.kind === 'readQuery' && (
        <>
          {shown && (
            <div className="playground-grid">
              <TranscriptView entries={shown.transcript} />
              <GraphView graphs={machineGraphs(shown.machine)} />
            </div>
          )}
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
                <b>{solved ? t('✓ Correct!') : t('✗ Not quite.')}</b> {ex.explanation}
              </p>
            </div>
          )}
        </>
      )}

      {startGraphs.length > 0 && !ran && !outcome && (
        <details open={ex.kind !== 'parsons'}>
          <summary className="small muted">{t('The repository before your answer')}</summary>
          <GraphView graphs={startGraphs} />
        </details>
      )}

      {ex.kind === 'parsons' && (
        <ParsonsPuzzle
          pool={pool}
          answer={answer}
          noun={t('commands')}
          disabled={locked || solved}
          onChange={(p, a) => {
            setPool(p);
            setAnswer(a);
            setOutcome(null);
          }}
        />
      )}

      {terminalMode && spec && (
        <>
          <Workspace key={wsKey} machine={machine} views={views} disabled={locked || solved} onCommand={() => setTyped((n) => n + 1)} placeholder={t('Your terminal for this exercise. Type the commands; the graph and panels follow along. Then press Check.')} />
          {!locked && !solved && (
            <div className="row">
              <button className="btn primary" onClick={check} disabled={!typed}>
                {isTest ? t('Submit answer') : t('✓ Check answer')}
              </button>
              <button className="btn ghost" onClick={restart} disabled={!typed}>
                {t('↺ Start over')}
              </button>
              <span className="small muted">{typed === 0 ? t('Nothing typed yet.') : typed === 1 ? t('1 command so far. Checking compares where you ended up with the goal.') : t('{n} commands so far. Checking compares where you ended up with the goal.', { n: typed })}</span>
            </div>
          )}
        </>
      )}

      {!terminalMode && (ex.kind === 'write' || ex.kind === 'fillBlank' || ex.kind === 'fixBug') && (
        <>
          {spec?.target === 'file' && <div className="small muted">{t('Your {file}:', { file: spec.file ?? 'file.txt' })}</div>}
          <CodeEditor
            value={text}
            lang={spec?.target === 'file' ? 'text' : 'shell'}
            minHeight="90px"
            placeholder={spec?.target === 'file' ? undefined : t('git …   (one command per line)')}
            onChange={(v) => {
              setText(v);
              if (mode === 'practice') saveDraft(id, v);
            }}
            onRun={isTest ? undefined : run}
            readOnly={locked || solved}
          />
        </>
      )}

      {!terminalMode && ex.kind !== 'readQuery' && !locked && !solved && (
        <div className="row">
          {!isTest && (
            <button className="btn" onClick={run}>
              {t('▶ Run')}
            </button>
          )}
          <button className="btn primary" onClick={check}>
            {isTest ? t('Submit answer') : t('✓ Check answer')}
          </button>
          {!isTest && <span className="small muted">{t('Each Run starts from the same starting point')} · <span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> {t('runs')}</span>}
        </div>
      )}

      {ran && !outcome && (
        <div className="playground-grid">
          <TranscriptView entries={ran.transcript} />
          <GraphView graphs={machineGraphs(ran.machine)} />
        </div>
      )}

      {outcome && !isTest && outcome.status !== 'correct' && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="callout bad">
            {outcome.feedback.slice(0, 4).map((f, i) => (
              <p key={i}>
                {i === 0 ? '✗ ' : ''}
                <ReactMarkdown components={{ p: 'span' }}>{f}</ReactMarkdown>
              </p>
            ))}
          </div>
          {!terminalMode && (
            <details open>
              <summary className="small muted">{t('What happened when your answer ran')}</summary>
              <div className="playground-grid">
                <TranscriptView entries={outcome.transcript} />
                {outcome.machine && <GraphView graphs={machineGraphs(outcome.machine)} />}
              </div>
            </details>
          )}
          {terminalMode && <div className="small muted">{t('Keep going in the terminal above, or ↺ start over.')}</div>}
        </div>
      )}
      {outcome && isTest && <div className="callout info small">{t('Answer submitted. Results are shown at the end of the test.')}</div>}

      {misconceptions.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {misconceptions.map((m) => (
            <div key={m.id} className="callout warn small">
              <b>{t('🧠 Common mix-up: {title}.', { title: m.title })}</b> <ReactMarkdown components={{ p: 'span' }}>{m.explain}</ReactMarkdown>
            </div>
          ))}
        </div>
      )}

      {solved && !isTest && ex.kind !== 'readQuery' && (
        <div className="callout good">
          <p>
            <b>{t('✓ Correct!')}</b> {ex.explanation}
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
