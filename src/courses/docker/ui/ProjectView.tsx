import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Project, ProjectTask } from '../../../content/types';
import { recordProjectCheck, useProgress } from '../../../progress/store';
import { checkDockerProject, tryDocker, type RequirementOutcome, type TranscriptEntry } from '../check';
import type { DockerEngine } from '../engine';
import { CodeEditor } from '../../../components/CodeEditor';
import { EngineView } from './Terminal';
import { FilesView, TranscriptView } from './Transcript';

/** Docker projects: open-ended tasks, checked by running requirement commands on the result. */
export function DockerProjectView({ project }: { project: Project }) {
  const p = useProgress();
  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <div className="card md">
        <h2 style={{ marginTop: 0 }}>🧪 {project.title}</h2>
        <ReactMarkdown>{project.story}</ReactMarkdown>
        <p className="small muted">
          There's no single right answer. Your commands run on a fresh simulated machine, then each <b>requirement</b> is checked with a real Docker command. When you're done, compare your approach with ours.
        </p>
      </div>
      {project.tasks.map((t, i) => (
        <TaskCard key={t.id} task={t} n={i + 1} done={!!p.projects[t.id]} />
      ))}
    </div>
  );
}

function TaskCard({ task, n, done }: { task: ProjectTask; n: number; done: boolean }) {
  const target = task.docker?.target ?? 'commands';
  const [code, setCode] = useState(task.docker?.starter ?? '');
  const [result, setResult] = useState<{ transcript: TranscriptEntry[]; engine: DockerEngine; requirements: RequirementOutcome[] | null } | null>(null);
  const [hints, setHints] = useState(0);
  const [showRef, setShowRef] = useState(false);
  const [why, setWhy] = useState<number | null>(null);
  const setup = task.docker?.setup ?? [];

  const execute = (check: boolean) => {
    // Show the machine as your commands left it; the requirement checks run on a separate copy.
    const shown = tryDocker({ target: 'commands', ...task.docker }, code);
    const r = check ? checkDockerProject(task, code).requirements : null;
    setResult({ ...shown, requirements: r });
    setWhy(null);
    if (r && code.trim()) recordProjectCheck(task.id, code, r.every((x) => x.ok));
  };
  const reqs = result?.requirements;
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
      {setup.length > 0 && (
        <details className="small">
          <summary className="muted">Starting point: what's already on the machine ({setup.length} command{setup.length === 1 ? '' : 's'})</summary>
          <pre className="files-body">{setup.join('\n')}</pre>
        </details>
      )}
      {task.docker?.files && <FilesView files={task.docker.files} />}
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
      {target !== 'commands' && <div className="small muted">{target === 'dockerfile' ? `Your Dockerfile (built with docker build -t ${task.docker?.tag ?? 'app'} .)` : 'Your compose.yaml (started with docker compose up -d)'}</div>}
      <CodeEditor value={code} onChange={setCode} lang={target === 'dockerfile' ? 'dockerfile' : target === 'compose' ? 'yaml' : 'shell'} onRun={() => execute(true)} minHeight={target === 'commands' ? '110px' : '200px'} placeholder={target === 'commands' ? 'docker …   (one command per line)' : undefined} />
      <div className="row">
        <button className="btn" onClick={() => execute(false)}>▶ Run</button>
        <button className="btn primary" onClick={() => execute(true)}>✓ Check requirements</button>
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
      {result && (
        <div className="playground-grid">
          <TranscriptView entries={result.transcript} />
          <EngineView engine={result.engine} version={0} compact />
        </div>
      )}
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
