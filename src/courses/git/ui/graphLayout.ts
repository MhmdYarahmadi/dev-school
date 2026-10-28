/**
 * The live commit graph's data and layout: which commits to draw, in which row and lane,
 * the edges between them, and the labels (branches, remote-tracking branches, HEAD).
 * Pure functions: tests/git-ui.test.ts checks the layout.
 */
import type { GitMachine } from '../engine';
import type { Repo } from '../engine/repo';
import type { GitEvent } from '../engine/types';
import { t } from '../../../shared/i18n';

export interface GraphCommit {
  sha: string;
  parents: string[];
  subject: string;
  author: string;
  time: number;
}

export interface GraphLabel {
  name: string;
  kind: 'branch' | 'remote' | 'head';
  /** The branch HEAD points at (drawn as "HEAD → main"). */
  current?: boolean;
}

/** Everything the graph needs from one repository, as plain data (a snapshot). */
export interface GraphData {
  id: string;
  title: string;
  commits: GraphCommit[];
  labels: Record<string, GraphLabel[]>;
  head: { branch: string | null; sha: string | null } | null;
  /** The commit being merged in, while a merge stops on conflicts. */
  mergeHead?: string;
  /** Commits hidden because the graph shows only the newest ones. */
  hidden: number;
  /** Draw without hashes (a target shape, whose hashes won't match yours). */
  anonymous?: boolean;
}

export const MAX_COMMITS = 40;

export function graphData(r: Repo, id: string, title: string, bare = false): GraphData {
  const tips = [...r.refs.values(), r.headCommit(), r.op?.head ?? null].filter((x): x is string => !!x);
  const all = [...r.ancestors(tips)];
  const commits = all
    .map((sha) => {
      const c = r.commit(sha);
      return { sha, parents: c.parents, subject: c.message.split('\n')[0], author: c.author.name, time: c.committer.time };
    })
    // Newest first; a child is always newer than its parents in this simulator (the clock only moves forward).
    .sort((a, b) => b.time - a.time || (a.sha < b.sha ? -1 : 1));
  const shown = commits.slice(0, MAX_COMMITS);
  const labels: Record<string, GraphLabel[]> = {};
  const add = (sha: string, l: GraphLabel) => (labels[sha] ??= []).push(l);
  const cur = 'ref' in r.head ? r.head.ref : null;
  for (const [ref, sha] of [...r.refs.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (ref.startsWith('refs/heads/')) add(sha, { name: ref.slice(11), kind: 'branch', current: !bare && ref === cur });
    else if (ref.startsWith('refs/remotes/')) add(sha, { name: ref.slice(13), kind: 'remote' });
  }
  const head = bare ? null : { branch: r.branch, sha: r.headCommit() };
  if (head && !head.branch && head.sha) add(head.sha, { name: 'HEAD', kind: 'head' });
  return { id, title, commits: shown, labels, head, mergeHead: r.op?.kind === 'merge' ? r.op.head : undefined, hidden: commits.length - shown.length };
}

/** The local repository at the learner's current folder, plus every hub repository it talks to. */
export function machineGraphs(m: GitMachine): GraphData[] {
  const out: GraphData[] = [];
  const local = m.repoAt(m.learner);
  if (local) {
    const home = m.learner.home;
    const where = local.root!.startsWith(home) ? '~' + local.root!.slice(home.length) : local.root!;
    out.push(graphData(local, m.repoId(m.learner, local), t('Your repository · {where}', { where })));
    const url = local.config.get('remote.origin.url');
    const name = url ? m.hub.parseUrl(url) : null;
    const hub = name ? m.hub.repos.get(name) : undefined;
    if (hub && name) out.push(graphData(hub, `hub:${name}`, t('On the hub · {name}', { name }), true));
  }
  return out;
}

export interface Node {
  sha: string;
  row: number;
  lane: number;
}

export interface Edge {
  from: string;
  to: string;
  /** The lane the edge runs down in (the child's for a first parent, the parent's for a merge's other parents). */
  path: { x1: number; y1: number; x2: number; y2: number; bendAt: 'end' | 'start' };
  /** Leads to a commit that isn't drawn (beyond the newest ones shown). */
  open?: boolean;
}

/** Rows (newest at the top) and lanes, the classic way: a branch line keeps its lane until its commit. */
export function layout(g: GraphData): { nodes: Node[]; edges: Edge[]; lanes: number } {
  const lanes: (string | null)[] = [];
  const nodes: Node[] = [];
  const pos = new Map<string, Node>();
  g.commits.forEach((c, row) => {
    let lane = lanes.indexOf(c.sha);
    if (lane < 0) {
      lane = lanes.indexOf(null);
      if (lane < 0) lane = lanes.push(null) - 1;
    }
    // Other lanes waiting for this commit end here.
    for (let i = 0; i < lanes.length; i++) if (i !== lane && lanes[i] === c.sha) lanes[i] = null;
    lanes[lane] = c.parents[0] ?? null;
    for (const p of c.parents.slice(1)) {
      if (lanes.includes(p)) continue;
      let free = lanes.indexOf(null);
      if (free < 0) free = lanes.push(null) - 1;
      lanes[free] = p;
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    const n = { sha: c.sha, row, lane };
    nodes.push(n);
    pos.set(c.sha, n);
  });
  const edges: Edge[] = [];
  const rows = g.commits.length;
  for (const c of g.commits) {
    const a = pos.get(c.sha)!;
    c.parents.forEach((p, i) => {
      const b = pos.get(p);
      if (!b) {
        edges.push({ from: c.sha, to: p, path: { x1: a.lane, y1: a.row, x2: a.lane, y2: rows - 0.4, bendAt: 'end' }, open: true });
        return;
      }
      edges.push({ from: c.sha, to: p, path: { x1: a.lane, y1: a.row, x2: b.lane, y2: b.row, bendAt: i === 0 ? 'end' : 'start' } });
    });
  }
  return { nodes, edges, lanes: Math.max(1, ...nodes.map((n) => n.lane + 1)) };
}

/** One sentence per thing the last command did, for the caption under the graph. */
export function describeEvents(events: GitEvent[]): string[] {
  const out: string[] = [];
  const short = (s: string | null) => (s ? s.slice(0, 7) : '');
  const onHub = (repo: string) => repo.startsWith('hub:');
  const commits = (n: number) => (n === 0 ? t('no new commits') : n === 1 ? t('1 commit') : t('{n} commits', { n }));
  const repoName = (id: string) => (onHub(id) ? t('the hub ({name})', { name: id.slice(4) }) : t('your repository'));
  for (const e of events) {
    if (e.type === 'commit') {
      const sha = short(e.sha);
      if (e.kind === 'merge') out.push(onHub(e.repo) ? t('🔀 New merge commit {sha} with two parents on the hub.', { sha }) : t('🔀 New merge commit {sha} with two parents.', { sha }));
      else if (e.kind === 'revert') out.push(t('↩️ New commit {sha} that undoes an earlier one.', { sha }));
      else out.push(e.parents.length ? t('🟢 New commit {sha}.', { sha }) : t('🟢 New commit {sha} (the first one: no parent).', { sha }));
    } else if (e.type === 'ref') {
      const name = e.ref.replace(/^refs\/(heads|remotes)\//, '');
      const remote = e.ref.startsWith('refs/remotes/');
      const hub = onHub(e.repo);
      const v = { name, from: short(e.from), to: short(e.to) };
      if (!e.from) out.push(remote ? t('📡 {name} appeared (what the hub has).', v) : hub ? t('🏷️ Branch {name} created on the hub at {to}.', v) : t('🏷️ Branch {name} created at {to}.', v));
      else if (!e.to) out.push(hub ? t('✂️ Branch {name} deleted on the hub.', v) : t('✂️ Branch {name} deleted.', v));
      else if (remote) out.push(t("📡 {name} moved to {to} (the hub's {branch}).", { ...v, branch: name.split('/').slice(1).join('/') }));
      else if (!e.fastForward) out.push(hub ? t('➡️ {name} on the hub moved {from} → {to}.', v) : t('➡️ {name} moved {from} → {to}.', v));
      else if (events.some((x) => x.type === 'commit' && x.repo === e.repo)) out.push(hub ? t('➡️ {name} on the hub moved forward {from} → {to}.', v) : t('➡️ {name} moved forward {from} → {to}.', v));
      else out.push(hub ? t('➡️ {name} on the hub moved forward {from} → {to} (fast-forward: no new commit needed).', v) : t('➡️ {name} moved forward {from} → {to} (fast-forward: no new commit needed).', v));
    } else if (e.type === 'head') out.push(e.branch ? t('👉 HEAD is now on {branch}.', { branch: e.branch }) : t('👉 HEAD is detached at {sha} (not on a branch).', { sha: short(e.to) }));
    else if (e.type === 'transfer') {
      const what = commits(e.commits.length);
      out.push(e.kind === 'push' ? t('⬆️ Pushed {what} to {repo}.', { what, repo: repoName(e.to) }) : e.kind === 'fetch' ? t('⬇️ Downloaded {what} from {repo}.', { what, repo: repoName(e.from) }) : t('📥 Cloned: copied {what} from {repo}.', { what, repo: repoName(e.from) }));
    } else if (e.type === 'conflict') out.push(e.paths.length === 1 ? t('⚠️ Conflict in {files}: fix the file, git add, then git commit.', { files: e.paths.join(', ') }) : t('⚠️ Conflict in {files}: fix the files, git add, then git commit.', { files: e.paths.join(', ') }));
    else if (e.type === 'repo') out.push(e.action === 'init' ? (onHub(e.repo) ? t('🌐 New repository on the hub.') : t('📁 New repository (a hidden .git folder).')) : t('🗑️ Repository deleted (.git removed).'));
    else if (e.type === 'pr') {
      const n = e.number;
      const said = { opened: t('📬 Pull request #{n} opened.', { n }), updated: t('📬 Pull request #{n} updated.', { n }), reviewed: t('📬 Pull request #{n} reviewed.', { n }), commented: t('📬 Pull request #{n} commented.', { n }), merged: t('📬 Pull request #{n} merged.', { n }), closed: t('📬 Pull request #{n} closed.', { n }) };
      out.push(said[e.action]);
    }
  }
  return [...new Set(out)];
}
