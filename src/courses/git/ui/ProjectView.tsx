import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Project, ProjectTask } from '../../../content/types';
import { recordProjectCheck, useProgress } from '../../../progress/store';
import { checkGitProject, sandbox, type RequirementOutcome } from '../check';
import type { GitMachine } from '../engine';
import { Workspace } from './Workspace';

/** Git projects: work in a terminal on the team's machine; requirements are checked with real Git commands. */
export function GitProjectView({ project }: { project: Project }) {
  const p = useProgress();
  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="card md">
        <h2 style={{ marginTop: 0 }}>🧪 {project.title}</h2>
        <ReactMarkdown>{project.story}</ReactMarkdown>
        <p className="small muted">
          There's no single right answer. Work in the terminal as you would on a real machine; then each <b>requirement</b> is checked by running a Git command on the result. When you're done, compare your approach with ours.
        </p>
      </div>
      {project.tasks.map((t, i) => (
        <TaskCard key={t.id} task={t} n={i + 1} done={!!p.projects[t.id]} />
      ))}
    </div>
  );
}

function TaskCard({ task, n, done }: { task: ProjectTask; n: number; done: boolean }) {
  const [machine, setMachine] = useState<GitMachine>(() => sandbox(task.git));
  const [key, setKey] = useState(0);
  const [typed, setTyped] = useState(0);
  const [reqs, setReqs] = useState<RequirementOutcome[] | null>(null);
  const [hints, setHints] = useState(0);
  const [showRef, setShowRef] = useState(false);
  const [why, setWhy] = useState<number | null>(null);
  const answer = () => machine.journal.join('\n');

  const check = () => {
    // The requirements run on a replay of your commands, so checking never changes your terminal.
    const r = checkGitProject(task, answer()).requirements;
    setReqs(r);
    setWhy(null);
    if (typed) recordProjectCheck(task.id, answer(), r.every((x) => x.ok));
  };
  const restart = () => {
    setMachine(sandbox(task.git));
    setKey((k) => k + 1);
    setTyped(0);
    setReqs(null);
  };
  const allOk = reqs?.every((r) => r.ok);

  return (
    <div className="card stack">
      <div className="row">
        <b>Task {n}</b>
        {done && <span className="tag good">✓ done</span>}
      </div>
      <div className="md">
        <ReactMarkdown>{task.prompt}</ReactMarkdown>
      </div>
      <div className="small">
        <b>Requirements:</b>
        <ul className="goal-list" style={{ margin: '4px 0' }}>
          {task.requirements.map((r, i) => (
            <li key={i} className={reqs?.[i]?.ok ? 'met' : ''}>
              <span>{reqs ? (reqs[i].ok ? '✅' : '❌') : '⬜'}</span> <ReactMarkdown components={{ p: 'span' }}>{r.label}</ReactMarkdown>
              {reqs && !reqs[i].ok && (
                <button className="btn ghost small" style={{ marginLeft: 6 }} onClick={() => setWhy(why === i ? null : i)}>
                  {why === i ? 'hide' : 'why?'}
                </button>
              )}
              {why === i && reqs && (
                <div className="small muted" style={{ width: '100%' }}>
                  Checked with <code>{r.sql.split('\n').pop()}</code>, which printed:
                  <pre className="files-body">{reqs[i].output || '(nothing)'}</pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      <Workspace key={key} machine={machine} views={['graph', 'hub', 'areas', 'files']} onCommand={() => setTyped((t) => t + 1)} placeholder="Your machine for this task. Work as you would for real; then check the requirements." />
      <div className="row">
        <button className="btn primary" onClick={check}>
          ✓ Check requirements
        </button>
        <button className="btn ghost" onClick={restart} disabled={!typed}>
          ↺ Start over
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
      {reqs && (allOk ? <div className="callout good small">All requirements met. Nice work!</div> : <div className="callout bad small">{reqs.filter((r) => !r.ok).length} requirement(s) not met yet. Click “why?” next to one to see what the check found.</div>)}
      {showRef && (
        <div className="callout good small">
          <b>One possible solution</b>
          <pre>{task.referenceSolution}</pre>
          <ReactMarkdown>{task.discussion}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
