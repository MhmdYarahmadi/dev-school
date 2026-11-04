import { useState } from 'react';
import type { GitMachine } from '../engine';
import type { PullRequest } from '../engine/hub';
import { mark, t } from '../../../shared/i18n';
import { T } from '../../../shared/T';

const STATE = { OPEN: [mark('🟢 Open'), 'good'], MERGED: [mark('🟣 Merged'), 'accent'], CLOSED: [mark('⚪ Closed'), ''] } as const;

/**
 * The hub's web page for the repository you're in (or every hub repository): branches, pull
 * requests with their reviews, and buttons that run the matching `gh` command in your terminal,
 * so every click is a command you could have typed.
 */
export function HubView({ machine, version, run }: { machine: GitMachine; version: number; run: (cmd: string) => void }) {
  void version;
  const local = machine.repoAt(machine.learner);
  const url = local?.config.get('remote.origin.url');
  const mine = url ? machine.hub.parseUrl(url) : null;
  const names = [...machine.hub.repos.keys()];
  const [picked, setPicked] = useState<string | null>(null);
  const name = picked && names.includes(picked) ? picked : (mine ?? names[0]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  if (!name) return <div className="gempty"><T text={t('Nothing on the hub yet. Repositories you clone from {url} show up here.')} vars={{ url: <code>https://hub.zilber.tech/…</code> }} /></div>;
  const hub = machine.hub.repos.get(name)!;
  const prs = [...(machine.hub.prs.get(name) ?? [])].reverse();
  const branches = hub.branches();
  const defaultBranch = 'ref' in hub.head ? hub.head.ref.slice(11) : 'main';
  const inClone = mine === name;
  const current = local?.branch;
  const canOpen = inClone && current && current !== defaultBranch && branches.includes(current) && !prs.some((p) => p.state === 'OPEN' && p.head === current);
  const q = (s: string) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
  const pr = (p: PullRequest) => {
    const [label, cls] = STATE[p.state];
    const blocker = p.state === 'OPEN' ? machine.hub.blocker(name, p) : null;
    const latest = new Map<string, PullRequest['reviews'][number]>();
    for (const r of p.reviews) latest.set(r.author, r);
    return (
      <div key={p.number} className="hub-pr">
        <div className="row" style={{ gap: 8 }}>
          <span className={`tag ${cls}`}>{t(label)}</span>
          <b>
            {p.title} <span className="muted">#{p.number}</span>
          </b>
        </div>
        <div className="small muted">
          <span className="mono">{p.head}</span> → <span className="mono">{p.base}</span> · {t('opened by {who}', { who: p.author })}
        </div>
        {p.body && <div className="small hub-body">{p.body}</div>}
        {[...p.reviews.map((r) => ({ at: r.at, who: r.author, what: r.state === 'APPROVED' ? t('✅ approved') : r.state === 'CHANGES_REQUESTED' ? t('🔴 requested changes') : t('💬 reviewed'), body: r.body })), ...p.comments.map((c) => ({ at: c.at, who: c.author, what: t('💬 commented'), body: c.body }))]
          .sort((a, b) => a.at - b.at)
          .map((x, i) => (
            <div key={i} className="hub-review small">
              <b>{x.who}</b> {x.what}
              {x.body && <div className="muted">“{x.body}”</div>}
            </div>
          ))}
        {p.state === 'OPEN' && inClone && (
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button className="btn small" disabled={!!blocker} title={blocker ?? t('Runs: {cmd}', { cmd: `gh pr merge ${p.number} --merge` })} onClick={() => run(`gh pr merge ${p.number} --merge`)}>
              {t('🔀 Merge pull request')}
            </button>
            <button className="btn small ghost" onClick={() => run(`gh pr view ${p.number}`)}>
              {t('View')}
            </button>
            <button className="btn small ghost" onClick={() => run(`gh pr diff ${p.number}`)}>
              {t('Files changed')}
            </button>
            {blocker && <span className="small bad-text">{t("Can't merge yet: {why}.", { why: blocker })}</span>}
            {!blocker && latest.size === 0 && <span className="small muted">{t('No reviews yet.')}</span>}
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="hub">
      <div className="hub-top">
        <span className="hub-logo">🌐 hub.zilber.tech</span>
        {names.length > 1 ? (
          <select className="input small" value={name} onChange={(e) => setPicked(e.target.value)}>
            {names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        ) : (
          <b className="mono">{name}</b>
        )}
      </div>
      <div className="small">
        <b>{t('Branches:')}</b>{' '}
        {branches.length ? (
          branches.map((b) => (
            <span key={b} className="tag mono" style={{ marginInlineEnd: 4 }}>
              {b}
              {b === defaultBranch ? ` ${t('(default)')}` : ''}
              {machine.hub.isProtected(hub, b) ? ' 🔒' : ''}
            </span>
          ))
        ) : (
          <span className="muted">{t('none yet (an empty repository)')}</span>
        )}
      </div>
      <div className="small muted mono">{t('Clone:')} git clone {machine.hub.url(name)}</div>
      {canOpen && (
        <form
          className="hub-new stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            run(`gh pr create --title ${q(title.trim())}${body.trim() ? ` --body ${q(body.trim())}` : ''}`);
            setTitle('');
            setBody('');
          }}
        >
          <b className="small">
            {t('Open a pull request:')} <span className="mono">{current}</span> → <span className="mono">{defaultBranch}</span>
          </b>
          <input className="input" placeholder={t('Title (what does this change do?)')} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input" rows={2} placeholder={t('Description (optional)')} value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="btn small primary" disabled={!title.trim()}>
            {t('Create pull request')}
          </button>
        </form>
      )}
      <div className="stack" style={{ gap: 8 }}>
        <b className="small">{t('Pull requests')}</b>
        {prs.length ? prs.map(pr) : <div className="ev-empty">{t('No pull requests yet.')}</div>}
      </div>
    </div>
  );
}
