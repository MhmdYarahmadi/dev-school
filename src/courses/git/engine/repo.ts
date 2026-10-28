/** One Git repository: its objects, refs, HEAD, staging area (index) and merge state. */
import { ObjectStore, type Commit } from './objects';

/** The three versions of a file with a conflict (blob shas; missing = the file didn't exist there). */
export interface Unmerged {
  base?: string;
  ours?: string;
  theirs?: string;
}

/** What's in progress: a merge or revert that stopped on conflicts. */
export interface Operation {
  kind: 'merge' | 'revert';
  /** MERGE_HEAD or REVERT_HEAD. */
  head: string;
  /** The prepared commit message (MERGE_MSG). */
  msg: string;
  /** HEAD before the operation, for --abort. */
  orig: string;
}

export class Repo {
  objects = new ObjectStore();
  /** Full ref name → commit: refs/heads/main, refs/remotes/origin/main, refs/tags/v1. */
  refs = new Map<string, string>();
  /** Symbolic refs other than HEAD, e.g. refs/remotes/origin/HEAD → refs/remotes/origin/main. */
  symrefs = new Map<string, string>();
  /** HEAD: a branch ref ('refs/heads/main', possibly unborn), or a commit when detached. */
  head: { ref: string } | { sha: string } = { ref: 'refs/heads/main' };
  /** Where a detached HEAD started, as typed (for "HEAD detached at/from …"). */
  detachedAt?: { name: string; sha: string };
  /** The branch or commit before the last switch (`git switch -`). */
  previous?: string;
  /** The staging area: repository path → blob sha. */
  index = new Map<string, string>();
  unmerged = new Map<string, Unmerged>();
  op?: Operation;
  /** .git/config: remote.origin.url, branch.main.remote, … */
  config = new Map<string, string>();

  constructor(
    /** Worktree folder, or null for a bare repository (the hub's). */
    public root: string | null,
  ) {}

  get branch(): string | null {
    return 'ref' in this.head ? this.head.ref.replace(/^refs\/heads\//, '') : null;
  }

  headCommit(): string | null {
    return 'ref' in this.head ? (this.refs.get(this.head.ref) ?? null) : this.head.sha;
  }

  commit(sha: string): Commit {
    return this.objects.commit(sha);
  }

  /** Files of a commit: path → blob sha. */
  files(sha: string | null): Map<string, string> {
    return sha ? this.objects.flatten(this.commit(sha).tree) : new Map();
  }

  /** Branch names (without refs/heads/), sorted. */
  branches(): string[] {
    return [...this.refs.keys()]
      .filter((r) => r.startsWith('refs/heads/'))
      .map((r) => r.slice(11))
      .sort();
  }

  remotes(): string[] {
    const out: string[] = [];
    for (const k of this.config.keys()) {
      const m = /^remote\.(.+)\.url$/.exec(k);
      if (m) out.push(m[1]);
    }
    return out;
  }

  /** The upstream of a branch as a remote-tracking ref, e.g. 'origin/main'. */
  upstream(branch: string): { remote: string; branch: string; tracking: string } | null {
    const remote = this.config.get(`branch.${branch}.remote`);
    const merge = this.config.get(`branch.${branch}.merge`);
    if (!remote || !merge) return null;
    const b = merge.replace(/^refs\/heads\//, '');
    return { remote, branch: b, tracking: `${remote}/${b}` };
  }

  setUpstream(branch: string, remote: string, remoteBranch: string) {
    this.config.set(`branch.${branch}.remote`, remote);
    this.config.set(`branch.${branch}.merge`, `refs/heads/${remoteBranch}`);
  }

  /** The commit a ref name stands for, trying refs/heads, refs/tags and refs/remotes as Git does. */
  lookupRef(name: string): string | null {
    if (name === 'HEAD' || name === '@') return this.headCommit();
    if (name === 'MERGE_HEAD') return this.op?.kind === 'merge' ? this.op.head : null;
    if (name === 'REVERT_HEAD') return this.op?.kind === 'revert' ? this.op.head : null;
    for (const full of [name, `refs/${name}`, `refs/tags/${name}`, `refs/heads/${name}`, `refs/remotes/${name}`, `refs/remotes/${name}/HEAD`]) {
      const sym = this.symrefs.get(full);
      const v = this.refs.get(sym ?? full);
      if (v) return v;
    }
    return null;
  }

  /** A revision: HEAD, main, origin/main, a1b2c3d, HEAD~2, main^, HEAD^2. Null if unknown. */
  resolve(rev: string): string | null {
    const m = /^(.*?)((?:[~^]\d*)*)$/.exec(rev);
    if (!m || !m[1]) return null;
    let sha = this.lookupRef(m[1]);
    if (!sha && /^[0-9a-f]{4,40}$/.test(m[1])) {
      const hits = [...this.objects.objects.keys()].filter((s) => s.startsWith(m[1]) && this.objects.get(s)?.type === 'commit');
      if (hits.length === 1) sha = hits[0];
    }
    if (!sha) return null;
    const steps = m[2].match(/[~^]\d*/g) ?? [];
    for (const s of steps) {
      const n = s.length > 1 ? Number(s.slice(1)) : 1;
      const c = this.objects.get(sha);
      if (c?.type !== 'commit') return null;
      if (s[0] === '^') {
        if (n === 0) continue;
        sha = this.commit(sha).parents[n - 1];
        if (!sha) return null;
      } else {
        for (let k = 0; k < n; k++) {
          sha = this.commit(sha).parents[0];
          if (!sha) return null;
        }
      }
    }
    return this.objects.get(sha)?.type === 'commit' ? sha : null;
  }

  /** All commits reachable from these (including them). */
  ancestors(tips: (string | null)[]): Set<string> {
    const seen = new Set<string>();
    const stack = tips.filter((t): t is string => !!t);
    while (stack.length) {
      const c = stack.pop()!;
      if (seen.has(c) || !this.objects.has(c)) continue;
      seen.add(c);
      stack.push(...this.commit(c).parents);
    }
    return seen;
  }

  isAncestor(a: string, b: string): boolean {
    return this.ancestors([b]).has(a);
  }

  /** The best common ancestor of two commits (the newest one if there are several). */
  mergeBase(a: string, b: string): string | null {
    const common = [...this.ancestors([a])].filter((c) => this.ancestors([b]).has(c));
    const best = common.filter((c) => !common.some((d) => d !== c && this.isAncestor(c, d)));
    best.sort((x, y) => this.commit(y).committer.time - this.commit(x).committer.time);
    return best[0] ?? null;
  }

  /** Commits on `a` not on `b`, and on `b` not on `a`. */
  aheadBehind(a: string, b: string): [number, number] {
    const A = this.ancestors([a]);
    const B = this.ancestors([b]);
    return [[...A].filter((c) => !B.has(c)).length, [...B].filter((c) => !A.has(c)).length];
  }

  /** Points HEAD's branch (or a detached HEAD) at a commit. */
  moveHead(sha: string) {
    if ('ref' in this.head) this.refs.set(this.head.ref, sha);
    else this.head = { sha };
  }

  /** Every ref pointing at each commit, for decorations: [name, full ref]. */
  refsByCommit(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const all = [...this.refs.keys(), ...this.symrefs.keys()].sort();
    for (const r of all) {
      const sha = this.refs.get(this.symrefs.get(r) ?? r);
      if (!sha) continue;
      if (!out.has(sha)) out.set(sha, []);
      out.get(sha)!.push(r);
    }
    return out;
  }
}

export function short(sha: string): string {
  return sha.slice(0, 7);
}

export function subject(c: Commit): string {
  return c.message.split('\n')[0];
}
