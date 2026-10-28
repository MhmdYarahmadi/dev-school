import { motion } from 'framer-motion';
import { computeStatus, type GitMachine } from '../engine';
import { worktreeFiles } from '../engine/worktree';
import { mark, t } from '../../../shared/i18n';
import { T } from '../../../shared/T';

type Mark = { path: string; mark: string; tone: 'new' | 'mod' | 'del' | 'conflict' | 'clean' | 'ignored' };

/**
 * Git's three areas side by side: the working folder (your files), the staging area
 * (what the next commit will contain) and the repository (the last commit).
 */
export function AreasView({ machine, version }: { machine: GitMachine; version: number }) {
  void version; // re-render trigger
  const r = machine.repoAt(machine.learner);
  if (!r) return <div className="gempty"><T text={t('Not inside a repository. The three areas appear after {init} (or {cd} into a repository).')} vars={{ init: <code>git init</code>, cd: <code>cd</code> }} /></div>;
  const s = computeStatus(machine.learner.fs, r);
  const wt = worktreeFiles(machine.learner.fs, r);
  const head = r.headCommit();
  const headFiles = r.files(head);
  const work: Mark[] = [];
  const unstaged = new Map(s.unstaged.map((x) => [x.path, x.kind]));
  const untracked = s.untracked;
  for (const p of [...wt.keys()].sort()) {
    if (r.unmerged.has(p)) work.push({ path: p, mark: 'conflict', tone: 'conflict' });
    else if (unstaged.get(p) === 'modified') work.push({ path: p, mark: 'modified', tone: 'mod' });
    else if (untracked.some((u) => u === p || (u.endsWith('/') && p.startsWith(u)))) work.push({ path: p, mark: 'untracked', tone: 'new' });
    else if (r.index.has(p)) work.push({ path: p, mark: '', tone: 'clean' });
    else work.push({ path: p, mark: 'ignored', tone: 'ignored' });
  }
  for (const [p, k] of unstaged) if (k === 'deleted') work.push({ path: p, mark: 'deleted', tone: 'del' });
  const staged = new Map(s.staged.map((x) => [x.path, x]));
  const stage: Mark[] = [...new Set([...r.index.keys(), ...r.unmerged.keys(), ...s.staged.filter((x) => x.kind === 'deleted').map((x) => x.path)])].sort().map((p) => {
    if (r.unmerged.has(p)) return { path: p, mark: 'conflict', tone: 'conflict' };
    const x = staged.get(p);
    if (!x) return { path: p, mark: '', tone: 'clean' };
    return { path: x.from ? `${x.from} → ${p}` : p, mark: x.kind === 'new file' ? 'new' : x.kind, tone: x.kind === 'deleted' ? 'del' : x.kind === 'new file' ? 'new' : 'mod' };
  });
  const box = (title: string, hint: string, items: Mark[], empty: string) => (
    <div className="area">
      <div className="area-head">{t(title)}</div>
      <div className="small muted area-hint">{t(hint)}</div>
      <div className="area-list">
        {items.length ? (
          items.map((i) => (
            <motion.div layout key={i.path} className={`area-file ${i.tone}`} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              <span className="mono">{i.path}</span>
              {i.mark && <span className="area-mark">{i.mark}</span>}
            </motion.div>
          ))
        ) : (
          <div className="ev-empty">{t(empty)}</div>
        )}
      </div>
    </div>
  );
  const c = head ? r.commit(head) : null;
  return (
    <div className="areas">
      {box(mark('📁 Working folder'), mark('your files, as they are now'), work, mark('empty folder'))}
      <div className="area-arrow">
        git add
        <br />→
      </div>
      {box(mark('📋 Staging area'), mark('what the next commit will contain'), stage, mark('nothing staged'))}
      <div className="area-arrow">
        git commit
        <br />→
      </div>
      <div className="area">
        <div className="area-head">{t('🗄️ Repository')}</div>
        <div className="small muted area-hint">{t('saved history (the last commit)')}</div>
        {c ? (
          <motion.div key={head} className="area-commit" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
            <div>
              <span className="gsha">{head!.slice(0, 7)}</span> <b>{c.message.split('\n')[0]}</b>
            </div>
            <div className="small muted">
              {headFiles.size === 1 ? t('1 file') : t('{n} files', { n: headFiles.size })} · {r.ancestors([head]).size === 1 ? t('1 commit in history') : t('{n} commits in history', { n: r.ancestors([head]).size })}
            </div>
          </motion.div>
        ) : (
          <div className="ev-empty">{t('no commits yet')}</div>
        )}
      </div>
    </div>
  );
}
