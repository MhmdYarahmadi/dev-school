/**
 * The live commit graph's data and layout: which commits to draw, in which row and lane,
 * the edges between them, and the labels (branches, remote-tracking branches, HEAD).
 * Pure functions: tests/git-ui.test.ts checks the layout.
 */
import type { GitMachine } from '../engine';
import type { Repo } from '../engine/repo';
import type { GitEvent } from '../engine/types';

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
    out.push(graphData(local, m.repoId(m.learner, local), `Your repository · ${where}`));
    const url = local.config.get('remote.origin.url');
    const name = url ? m.hub.parseUrl(url) : null;
    const hub = name ? m.hub.repos.get(name) : undefined;
    if (hub && name) out.push(graphData(hub, `hub:${name}`, `On the hub · ${name}`, true));
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
  const repoName = (id: string) => (id.startsWith('hub:') ? `the hub (${id.slice(4)})` : 'your repository');
  for (const e of events) {
    if (e.type === 'commit') out.push(e.kind === 'merge' ? `🔀 New merge commit ${short(e.sha)} with two parents${e.repo.startsWith('hub:') ? ' on the hub' : ''}.` : e.kind === 'revert' ? `↩️ New commit ${short(e.sha)} that undoes an earlier one.` : `🟢 New commit ${short(e.sha)}${e.parents.length ? '' : ' (the first one: no parent)'}.`);
    else if (e.type === 'ref') {
      const name = e.ref.replace(/^refs\/(heads|remotes)\//, '');
      const remote = e.ref.startsWith('refs/remotes/');
      const where = e.repo.startsWith('hub:') ? ' on the hub' : '';
      if (!e.from) out.push(remote ? `📡 ${name} appeared (what the hub has).` : `🏷️ Branch ${name} created${where} at ${short(e.to)}.`);
      else if (!e.to) out.push(`✂️ Branch ${name} deleted${where}.`);
      else if (remote) out.push(`📡 ${name} moved to ${short(e.to)} (the hub's ${name.split('/').slice(1).join('/')}).`);
      else out.push(`➡️ ${name}${where} moved ${e.fastForward ? 'forward' : ''} ${short(e.from)} → ${short(e.to)}${e.fastForward && !events.some((x) => x.type === 'commit' && x.repo === e.repo) ? ' (fast-forward: no new commit needed)' : ''}.`.replace('  ', ' '));
    } else if (e.type === 'head') out.push(e.branch ? `👉 HEAD is now on ${e.branch}.` : `👉 HEAD is detached at ${short(e.to)} (not on a branch).`);
    else if (e.type === 'transfer') {
      const n = e.commits.length;
      const what = n ? `${n} commit${n === 1 ? '' : 's'}` : 'no new commits';
      out.push(e.kind === 'push' ? `⬆️ Pushed ${what} to ${repoName(e.to)}.` : e.kind === 'fetch' ? `⬇️ Downloaded ${what} from ${repoName(e.from)}.` : `📥 Cloned: copied ${what} from ${repoName(e.from)}.`);
    } else if (e.type === 'conflict') out.push(`⚠️ Conflict in ${e.paths.join(', ')}: fix the file${e.paths.length === 1 ? '' : 's'}, git add, then git commit.`);
    else if (e.type === 'repo') out.push(e.action === 'init' ? (e.repo.startsWith('hub:') ? `🌐 New repository on the hub.` : `📁 New repository (a hidden .git folder).`) : `🗑️ Repository deleted (.git removed).`);
    else if (e.type === 'pr') out.push(`📬 Pull request #${e.number} ${e.action}.`);
  }
  return [...new Set(out)];
}
