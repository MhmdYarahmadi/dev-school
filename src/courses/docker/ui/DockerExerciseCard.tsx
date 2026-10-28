import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ConfidencePicker } from '../../../components/ConfidencePicker';
import { HintPanel } from '../../../components/HintPanel';
import { makeBlocks, ParsonsPuzzle } from '../../../components/ParsonsPuzzle';
import type { Exercise } from '../../../content/types';
import type { Confidence } from '../../../pedagogy/review';
import { getProgress, queueVariant, recordAttempt, saveDraft } from '../../../progress/store';
import type { ExerciseCardProps } from '../../../shared/course';
import { evaluateDocker, sandbox, tryDocker, type DockerOutcome, type TranscriptEntry } from '../check';
import { lintDockerfile, type DockerEngine } from '../engine';
import { detectDockerMisconceptions } from '../misconceptions';
import { CodeEditor } from '../../../components/CodeEditor';
import { Terminal, EngineView } from './Terminal';
import { FilesView, TranscriptView } from './Transcript';

const NOUN = { commands: 'commands', dockerfile: 'Dockerfile', compose: 'compose.yaml' } as const;

function kindLabel(ex: Exercise): string {
  const noun = ex.docker ? NOUN[ex.docker.target] : 'commands';
  switch (ex.kind) {
    case 'write':
      return ex.docker?.target === 'commands' ? '⌨️ Write the commands' : `✍️ Write the ${noun}`;
    case 'fillBlank':
      return '🧩 Fill in the blanks';
    case 'fixBug':
      return `🐛 Fix the ${noun}`;
    case 'parsons':
      return `🧱 Build the ${noun}`;
    case 'readQuery':
      return '👀 Read and decide';
  }
}

export function DockerExerciseCard({ exercise: ex, mode = 'practice', progressId, onDone, onAttempt, record = mode !== 'test', variantCount = 0 }: ExerciseCardProps) {
  const id = progressId ?? ex.id;
  const saved = getProgress().exercises[id];
  const spec = ex.docker;
  const target = spec?.target ?? 'commands';
  const lang = target === 'commands' ? 'shell' : target === 'dockerfile' ? 'dockerfile' : 'yaml';
  const initialText = ex.kind === 'write' || ex.kind === 'fillBlank' || ex.kind === 'fixBug' ? (mode === 'practice' && saved?.lastSql) || ex.starterSql || '' : '';
  const [text, setText] = useState(initialText);
  const [ran, setRan] = useState<{ transcript: TranscriptEntry[]; engine: DockerEngine } | null>(null);
  const [outcome, setOutcome] = useState<DockerOutcome | null>(null);
  const [hintsShown, setHintsShown] = useState(0);
  const [failed, setFailed] = useState(0);
  const [sawSolution, setSawSolution] = useState(false);
  const [solved, setSolved] = useState(false);
  const [finished, setFinished] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  const [scratch, setScratch] = useState<{ engine: DockerEngine; key: number } | null>(null);
  const [scratchVersion, setScratchVersion] = useState(0);
  const initialBlocks = useMemo(() => (ex.kind === 'parsons' ? makeBlocks(ex.id, ex.blocks, ex.distractors) : []), [ex]);
  const [pool, setPool] = useState(initialBlocks);
  const [answer, setAnswer] = useState<typeof initialBlocks>([]);

  useEffect(() => {
    setText(initialText);
    setRan(null);
    setOutcome(null);
    setHintsShown(0);
    setFailed(0);
    setSawSolution(false);
    setSolved(false);
    setFinished(false);
    setChoice(null);
    setScratch(null);
    setPool(initialBlocks);
    setAnswer([]);
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

  const run = () => {
    if (!spec) return;
    setOutcome(null);
    setRan(tryDocker(spec, current));
  };

  const check = () => {
    if (ex.kind === 'readQuery' || !spec) return;
    setRan(null);
    const o = evaluateDocker(ex, current);
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

  const misconceptions = useMemo(() => {
    if (!outcome || !spec || isTest) return [];
    return detectDockerMisconceptions({ answer: current, spec, outcome });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);

  const lint = useMemo(() => (target === 'dockerfile' && current.trim() && !isTest ? lintDockerfile(current) : []), [target, current, isTest]);

  const solution = ex.kind === 'parsons' ? ex.blocks.join('\n') : ex.kind === 'readQuery' ? '' : ex.solution;
  const locked = finished || (isTest && (outcome !== null || choice !== null));
  const files = spec?.files ?? {};

  return (
    <div className="card stack">
      <div className="row">
        <span className="tag accent">{kindLabel(ex)}</span>
        {mode === 'review' && <span className="tag">Review</span>}
        {saved?.done && mode === 'practice' && <span className="tag good">✓ solved before</span>}
      </div>
      <div className="md">
        <ReactMarkdown>{ex.prompt}</ReactMarkdown>
      </div>

      {Object.keys(files).length > 0 && <FilesView files={files} />}

      {ex.kind === 'readQuery' && (
        <>
          {ex.sql && <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{ex.sql}</pre>}
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
                <b>{solved ? '✓ Correct!' : '✗ Not quite.'}</b> {ex.explanation}
              </p>
            </div>
          )}
        </>
      )}

      {ex.kind === 'parsons' && (
        <ParsonsPuzzle
          pool={pool}
          answer={answer}
          noun={NOUN[target]}
          disabled={locked || solved}
          onChange={(p, a) => {
            setPool(p);
            setAnswer(a);
            setOutcome(null);
          }}
        />
      )}

      {(ex.kind === 'write' || ex.kind === 'fillBlank' || ex.kind === 'fixBug') && (
        <CodeEditor
          value={text}
          lang={lang}
          minHeight={target === 'commands' ? '80px' : '160px'}
          placeholder={target === 'commands' ? 'docker …   (one command per line)' : undefined}
          onChange={(v) => {
            setText(v);
            if (mode === 'practice') saveDraft(id, v);
          }}
          onRun={isTest ? undefined : run}
          readOnly={locked || solved}
        />
      )}

      {lint.length > 0 && !solved && (
        <div className="stack" style={{ gap: 4 }}>
          {lint.slice(0, 4).map((l, i) => (
            <div key={i} className={`small ${l.kind === 'error' ? 'bad-text' : 'muted'}`}>
              {l.kind === 'error' ? '⛔' : '💡'} <ReactMarkdown components={{ p: 'span' }}>{l.message}</ReactMarkdown>
            </div>
          ))}
        </div>
      )}

      {ex.kind !== 'readQuery' && !locked && !solved && (
        <div className="row">
          {!isTest && (
            <button className="btn" onClick={run}>
              ▶ {target === 'commands' ? 'Run' : target === 'dockerfile' ? 'Build' : 'Compose up'}
            </button>
          )}
          <button className="btn primary" onClick={check}>
            {isTest ? 'Submit answer' : '✓ Check answer'}
          </button>
          {!isTest && spec && (
            <button
              className="btn ghost"
              onClick={() => setScratch((s) => (s ? null : { engine: sandbox(spec), key: Date.now() }))}
              title="A separate terminal for trying things out. It starts from the same state as the exercise."
            >
              🖥 {scratch ? 'Close' : 'Scratch'} terminal
            </button>
          )}
          {!isTest && (
            <span className="small muted">
              Each Run starts from a fresh machine · <span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> runs
            </span>
          )}
        </div>
      )}

      {scratch && !isTest && (
        <div className="stack" style={{ gap: 8 }}>
          <Terminal key={scratch.key} engine={scratch.engine} height={240} onCommand={() => setScratchVersion((v) => v + 1)} placeholder="Scratch terminal: experiment freely. Nothing here is checked. Try docker ps -a or docker images." />
          <EngineView engine={scratch.engine} version={scratchVersion} compact />
        </div>
      )}

      {ran && !outcome && (
        <div className="stack" style={{ gap: 8 }}>
          <TranscriptView entries={ran.transcript} />
          <EngineView engine={ran.engine} version={0} compact />
        </div>
      )}

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
          <details open={outcome.status === 'error'}>
            <summary className="small muted">What happened when your answer ran</summary>
            <TranscriptView entries={outcome.transcript} />
          </details>
          {outcome.engine && <EngineView engine={outcome.engine} version={0} compact />}
        </div>
      )}
      {outcome && isTest && <div className="callout info small">Answer submitted. Results are shown at the end of the test.</div>}

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
        <>
          <div className="callout good">
            <p>
              <b>✓ Correct!</b> {ex.explanation}
            </p>
          </div>
          {outcome?.transcript && outcome.transcript.length > 0 && (
            <details>
              <summary className="small muted">See the output</summary>
              <TranscriptView entries={outcome.transcript} />
            </details>
          )}
        </>
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
