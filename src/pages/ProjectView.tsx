import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Project, ProjectTask } from '../content/types';
import { checkProjectTask, type RequirementResult } from '../content/projectCheck';
import { SqlEditor } from '../components/SqlEditor';
import { ResultView } from '../components/ResultView';
import { runSandboxed, type RunResult } from '../db/runQuery';
import { recordProjectCheck, useProgress } from '../progress/store';

/** Open-ended tasks: many valid answers, checked against properties of the result. */
export function ProjectView({ project }: { project: Project }) {
  const p = useProgress();
  return (
    <div className="stack" style={{ maxWidth: 960 }}>
      <div className="card md">
        <h2 style={{ marginTop: 0 }}>🧪 {project.title}</h2>
        <ReactMarkdown>{project.story}</ReactMarkdown>
        <p className="small muted">
          There's no single right answer here. Your query is checked against the <b>requirements</b> of each task, not against an exact result. When you're done, compare your approach with ours.
        </p>
      </div>
      {project.tasks.map((t, i) => (
        <TaskCard key={t.id} task={t} n={i + 1} done={!!p.projects[t.id]} />
      ))}
    </div>
  );
}

function TaskCard({ task, n, done }: { task: ProjectTask; n: number; done: boolean }) {
  const [sql, setSql] = useState('');
  const [run, setRun] = useState<RunResult | null>(null);
  const [reqs, setReqs] = useState<RequirementResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hints, setHints] = useState(0);
  const [showRef, setShowRef] = useState(false);

  const check = async () => {
    setError(null);
    const out = await checkProjectTask(task, sql);
    setRun(out.run);
    if ('error' in out) {
      if (sql.trim()) recordProjectCheck(task.id, sql, false);
      setError(out.error);
      setReqs(null);
      return;
    }
    setReqs(out.requirements);
    recordProjectCheck(task.id, sql, out.requirements.every((r) => r.ok));
  };

  return (
    <div className="card stack">
      <div className="row"><b>Task {n}</b>{done && <span className="tag good">✓ done</span>}</div>
      <div className="md"><ReactMarkdown>{task.prompt}</ReactMarkdown></div>
      <div className="small"><b>Requirements:</b>
        <ul style={{ margin: '4px 0' }}>
          {task.requirements.map((r, i) => (
            <li key={i}>
              {reqs ? (reqs[i].ok ? '✅ ' : '❌ ') : '◻️ '}
              {r.label}
            </li>
          ))}
        </ul>
      </div>
      <SqlEditor value={sql} onChange={setSql} onRun={check} minHeight="140px" />
      <div className="row">
        <button className="btn" onClick={async () => { setReqs(null); setRun(await runSandboxed(sql)); }}>▶ Run</button>
        <button className="btn primary" onClick={check}>✓ Check requirements</button>
        {hints < task.hints.length && <button className="btn small" onClick={() => setHints(hints + 1)}>💡 Hint ({hints}/{task.hints.length})</button>}
        <button className="btn small ghost" onClick={() => setShowRef(!showRef)}>{showRef ? 'Hide' : 'Compare with'} our approach</button>
      </div>
      {task.hints.slice(0, hints).map((h, i) => <div key={i} className="callout info small"><b>Hint {i + 1}:</b> {h}</div>)}
      {error && <div className="callout bad small">{error}</div>}
      <ResultView result={run} sql={sql} />
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
