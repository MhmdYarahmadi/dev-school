import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Project, ProjectTask } from '../../../content/types';
import { recordProjectCheck, useProgress } from '../../../progress/store';
import { checkGitProject, sandbox, type RequirementOutcome } from '../check';
import type { GitMachine } from '../engine';
import { Workspace } from './Workspace';
import { t } from '../../../shared/i18n';
import { T } from '../../../shared/T';

/** Git projects: work in a terminal on the team's machine; requirements are checked with real Git commands. */
export function GitProjectView({ project }: { project: Project }) {
  const p = useProgress();
  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="card md">
        <h2 style={{ marginTop: 0 }}>🧪 {project.title}</h2>
        <ReactMarkdown>{project.story}</ReactMarkdown>
        <p className="small muted">
          {t("There's no single right answer. Work in the terminal as you would on a real machine; then each requirement is checked by running a Git command on the result. When you're done, compare your approach with ours.")}
        </p>
      </div>
      {project.tasks.map((task, i) => (
        <TaskCard key={task.id} task={task} n={i + 1} done={!!p.projects[task.id]} />
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
        <b>{t('Task {n}', { n })}</b>
        {done && <span className="tag good">{t('✓ done')}</span>}
      </div>
      <div className="md">
        <ReactMarkdown>{task.prompt}</ReactMarkdown>
      </div>
      <div className="small">
        <b>{t('Requirements:')}</b>
        <ul className="goal-list" style={{ margin: '4px 0' }}>
          {task.requirements.map((r, i) => (
            <li key={i} className={reqs?.[i]?.ok ? 'met' : ''}>
              <span>{reqs ? (reqs[i].ok ? '✅' : '❌') : '⬜'}</span> <ReactMarkdown components={{ p: 'span' }}>{r.label}</ReactMarkdown>
              {reqs && !reqs[i].ok && (
                <button className="btn ghost small" style={{ marginInlineStart: 6 }} onClick={() => setWhy(why === i ? null : i)}>
                  {why === i ? t('hide') : t('why?')}
                </button>
              )}
              {why === i && reqs && (
                <div className="small muted" style={{ width: '100%' }}>
                  <T text={t('Checked with {cmd}, which printed:')} vars={{ cmd: <code>{r.sql.split('\n').pop()}</code> }} />
                  <pre className="files-body">{reqs[i].output || t('(nothing)')}</pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      <Workspace key={key} machine={machine} views={['graph', 'hub', 'areas', 'files']} onCommand={() => setTyped((x) => x + 1)} placeholder={t('Your machine for this task. Work as you would for real; then check the requirements.')} />
      <div className="row">
        <button className="btn primary" onClick={check}>
          {t('✓ Check requirements')}
        </button>
        <button className="btn ghost" onClick={restart} disabled={!typed}>
          {t('↺ Start over')}
        </button>
        {hints < task.hints.length && (
          <button className="btn small" onClick={() => setHints(hints + 1)}>
            {t('💡 Hint ({n}/{total})', { n: hints, total: task.hints.length })}
          </button>
        )}
        <button className="btn small ghost" onClick={() => setShowRef(!showRef)}>
          {showRef ? t('Hide our approach') : t('Compare with our approach')}
        </button>
      </div>
      {task.hints.slice(0, hints).map((h, i) => (
        <div key={i} className="callout info small">
          <b>{t('Hint {n}:', { n: i + 1 })}</b> <ReactMarkdown components={{ p: 'span' }}>{h}</ReactMarkdown>
        </div>
      ))}
      {reqs && (allOk ? <div className="callout good small">{t('All requirements met. Nice work!')}</div> : <div className="callout bad small">{t('{n} requirement(s) not met yet. Click “why?” next to one to see what the check found.', { n: reqs.filter((r) => !r.ok).length })}</div>)}
      {showRef && (
        <div className="callout good small">
          <b>{t('One possible solution')}</b>
          <pre>{task.referenceSolution}</pre>
          <ReactMarkdown>{task.discussion}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
