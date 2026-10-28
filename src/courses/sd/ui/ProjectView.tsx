import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Project, ProjectTask } from '../../../content/types';
import { recordProjectCheck, useProgress } from '../../../progress/store';
import { checkEstimate, prepareDesign, runDesign, type SdOutcome } from '../check';
import type { SdRun } from '../engine/scenario';
import { detectSdMisconceptions } from '../misconceptions';
import { DesignEditor } from './DesignEditor';
import { RunSummary } from './Lab';
import { RunPanel } from './RunPanel';

/** System Design projects: open-ended tasks, checked by running the design against requirements. */
export function SdProjectView({ project }: { project: Project }) {
  const p = useProgress();
  return (
    <div className="stack">
      <div className="card md" style={{ maxWidth: 900 }}>
        <h2 style={{ marginTop: 0 }}>🧪 {project.title}</h2>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{project.story}</ReactMarkdown>
        <p className="small muted">There's no single right design. Each task runs yours through the simulator and checks the requirements. When you're done, compare it with ours.</p>
      </div>
      {project.tasks.map((t, i) => (
        <TaskCard key={t.id} task={t} n={i + 1} done={!!p.projects[t.id]} />
      ))}
    </div>
  );
}

/** The run of a design task, with the task's requirements. */
export function taskRun(task: ProjectTask): SdRun {
  return { ...task.sd!.run!, requirements: task.requirements.map((r) => r.sql) };
}

function TaskCard({ task, n, done }: { task: ProjectTask; n: number; done: boolean }) {
  const isEstimate = task.sd?.target === 'estimate';
  const [answer, setAnswer] = useState(task.sd?.starter ?? '');
  const [outcome, setOutcome] = useState<SdOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [hints, setHints] = useState(0);
  const [showRef, setShowRef] = useState(false);
  const run = isEstimate ? undefined : taskRun(task);

  const check = async () => {
    setBusy(true);
    try {
      let o: SdOutcome;
      if (isEstimate) o = checkEstimate(task.sd!, task.referenceSolution, answer);
      else {
        const prep = prepareDesign(answer);
        o = prep.outcome ?? (await runDesign(prep.design!, run!));
      }
      setOutcome(o);
      if (answer.trim() && o.status !== 'error') recordProjectCheck(task.id, answer, o.status === 'correct');
    } catch (e) {
      setOutcome({ status: 'error', feedback: [(e as Error).message] });
    } finally {
      setBusy(false);
    }
  };

  const checks = outcome?.checks;
  const misconceptions = outcome?.design && run ? detectSdMisconceptions({ design: outcome.design, run, outcome }) : [];

  return (
    <div className="card stack">
      <div className="row">
        <b>Task {n}</b>
        {done && <span className="tag good">✓ done</span>}
      </div>
      <div className="md">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.prompt}</ReactMarkdown>
      </div>
      {run && <RunSummary run={run} showRequirements={false} />}
      <div className="small">
        <b>Requirements:</b>
        <ul className="goal-list" style={{ margin: '4px 0' }}>
          {task.requirements.map((r, i) => {
            const c = checks?.[i];
            const ok = isEstimate ? outcome?.status === 'correct' : c?.ok;
            return (
              <li key={i} className={ok ? 'met' : ''}>
                <span>{outcome && outcome.status !== 'error' ? (ok ? '✅' : '❌') : '⬜'}</span> <ReactMarkdown components={{ p: 'span' }}>{r.label}</ReactMarkdown>
                {c && !c.ok && <span className="small muted"> · {c.line}</span>}
              </li>
            );
          })}
        </ul>
      </div>
      {isEstimate ? (
        <form
          className="sd-estimate"
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          <input className="input" aria-label="Your estimate" inputMode="decimal" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="e.g. 1200 or 1.2k" />
          {task.sd?.unit && <span>{task.sd.unit}</span>}
        </form>
      ) : (
        <DesignEditor value={answer} onChange={setAnswer} stats={outcome?.result?.nodes} height={420} />
      )}
      <div className="row">
        <button className="btn primary" onClick={() => void check()} disabled={busy}>
          {busy ? (
            <>
              <span className="sd-spinner" /> Simulating…
            </>
          ) : (
            '✓ Check requirements'
          )}
        </button>
        {hints < task.hints.length && (
          <button className="btn small" onClick={() => setHints(hints + 1)}>
            💡 Hint ({hints}/{task.hints.length})
          </button>
        )}
        <button className="btn small ghost" onClick={() => setShowRef(!showRef)}>
          {showRef ? 'Hide' : 'Compare with'} our approach
        </button>
      </div>
      {task.hints.slice(0, hints).map((h, i) => (
        <div key={i} className="callout info small">
          <b>Hint {i + 1}:</b> <ReactMarkdown components={{ p: 'span' }}>{h}</ReactMarkdown>
        </div>
      ))}
      {outcome && (outcome.status === 'correct' ? <div className="callout good small">{isEstimate ? outcome.feedback[0] : 'All requirements met. Nice work!'}</div> : <div className="callout bad small">{(outcome.checks ? outcome.feedback.slice(0, 1) : outcome.feedback).map((f, i) => <div key={i}>{f}</div>)}</div>)}
      {outcome?.result && <RunPanel result={outcome.result} run={run} diagnosis={outcome.status === 'correct' ? undefined : outcome.diagnosis} />}
      {misconceptions.map((m) => (
        <div key={m.id} className="callout warn small">
          <b>🧠 Common mix-up: {m.title}.</b> <ReactMarkdown components={{ p: 'span' }}>{m.explain}</ReactMarkdown>
        </div>
      ))}
      {showRef && (
        <div className="callout good small stack" style={{ gap: 6 }}>
          <b>One possible answer</b>
          {isEstimate ? <pre>{task.referenceSolution}{task.sd?.unit ? ` ${task.sd.unit}` : ''}</pre> : <DesignEditor value={task.referenceSolution} mode="view" height={300} />}
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.discussion}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
