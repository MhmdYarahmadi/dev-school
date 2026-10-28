/**
 * The hub: a simulated code-hosting site (like GitHub) at https://hub.zilber.tech/ holding
 * bare repositories, pull requests, reviews and protected branches, plus the `gh` command
 * that works with it (the same commands as GitHub's CLI).
 */
import { mergeTrees } from './merge';
import { Repo, short, subject } from './repo';
import { CliError, type GitEvent, type Out } from './types';
import type { GitMachine, User } from './machine';
import { unifiedHunks, splitLines } from './diff';

export const HUB_URL = 'https://hub.zilber.tech/';
export const HUB_COMMITTER = { name: 'Zilber Hub', email: 'noreply@hub.zilber.tech' };

export interface Review {
  author: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
  body: string;
  at: number;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  /** Branch with the changes. */
  head: string;
  /** Branch they go into. */
  base: string;
  author: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  reviews: Review[];
  comments: { author: string; body: string; at: number }[];
  createdAt: number;
  mergeCommit?: string;
  mergedBy?: string;
}

export interface Protection {
  /** Changes only through pull requests. */
  noDirectPush: boolean;
  /** At least one approval and no outstanding "changes requested". */
  requireApproval: boolean;
}

export class Hub {
  repos = new Map<string, Repo>();
  prs = new Map<string, PullRequest[]>();
  protection = new Map<string, Map<string, Protection>>();

  create(name: string): Repo {
    const r = new Repo(null);
    r.head = { ref: 'refs/heads/main' };
    this.repos.set(name, r);
    this.prs.set(name, []);
    return r;
  }

  /** 'team/shop' from https://hub.zilber.tech/team/shop(.git). */
  parseUrl(url: string): string | null {
    const m = /^https:\/\/hub\.zilber\.tech\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url);
    return m ? m[1] : null;
  }

  byUrl(url: string): Repo | null {
    const n = this.parseUrl(url);
    return n ? (this.repos.get(n) ?? null) : null;
  }

  nameOf(r: Repo): string {
    for (const [n, x] of this.repos) if (x === r) return n;
    return '?';
  }

  id(r: Repo): string {
    return `hub:${this.nameOf(r)}`;
  }

  url(name: string): string {
    return `${HUB_URL}${name}.git`;
  }

  protect(name: string, branch: string, p: Partial<Protection> = {}) {
    if (!this.protection.has(name)) this.protection.set(name, new Map());
    this.protection.get(name)!.set(branch, { noDirectPush: true, requireApproval: false, ...p });
  }

  protectionOf(r: Repo, branch: string): Protection | undefined {
    return this.protection.get(this.nameOf(r))?.get(branch);
  }

  isProtected(r: Repo, branch: string): boolean {
    return !!this.protectionOf(r, branch);
  }

  /** Why the hub refuses a push (protected branch), or null. */
  refusePush(r: Repo, branch: string, forced: boolean): string[] | null {
    const p = this.protectionOf(r, branch);
    if (!p) return null;
    if (p.noDirectPush || forced) return [`error: Protected branch update failed for refs/heads/${branch}.`, 'error: Changes must be made through a pull request.'];
    return null;
  }

  /** A pushed or deleted branch: open pull requests follow their branch. */
  onPush(r: Repo, branch: string, sha: string | null) {
    if (sha) return;
    for (const pr of this.prs.get(this.nameOf(r)) ?? []) if (pr.state === 'OPEN' && pr.head === branch) pr.state = 'CLOSED';
  }

  /** Can this pull request be merged? A reason if not. */
  blocker(name: string, pr: PullRequest): string | null {
    const r = this.repos.get(name)!;
    const head = r.refs.get(`refs/heads/${pr.head}`);
    const base = r.refs.get(`refs/heads/${pr.base}`);
    if (!head || !base) return 'the head branch was deleted';
    const p = this.protectionOf(r, pr.base);
    if (p?.requireApproval) {
      const latest = new Map<string, Review>();
      for (const rv of pr.reviews) if (rv.state !== 'COMMENTED') latest.set(rv.author, rv);
      const states = [...latest.values()].map((x) => x.state);
      if (states.includes('CHANGES_REQUESTED') || !states.includes('APPROVED')) return 'the base branch policy prohibits the merge';
    }
    if (r.isAncestor(head, base)) return null;
    const m = mergeTrees(r, r.mergeBase(base, head), base, head, pr.base, pr.head);
    return m.conflicts.size ? 'the merge commit cannot be cleanly created' : null;
  }

  /** Merges a pull request with a merge commit on the hub. Returns the commit. */
  mergePr(name: string, pr: PullRequest, by: { name: string; email: string }, time: number): string {
    const r = this.repos.get(name)!;
    const head = r.refs.get(`refs/heads/${pr.head}`)!;
    const base = r.refs.get(`refs/heads/${pr.base}`)!;
    const m = mergeTrees(r, r.mergeBase(base, head), base, head, pr.base, pr.head);
    const tree = r.objects.writeTree(m.files);
    const owner = name.split('/')[0];
    const sha = r.objects.put({
      type: 'commit',
      tree,
      parents: [base, head],
      author: { ...by, time },
      committer: { ...HUB_COMMITTER, time },
      message: `Merge pull request #${pr.number} from ${owner}/${pr.head}\n\n${pr.title}\n`,
    });
    r.refs.set(`refs/heads/${pr.base}`, sha);
    pr.state = 'MERGED';
    pr.mergeCommit = sha;
    pr.mergedBy = by.name;
    return sha;
  }
}

/** "about 3 minutes ago", as gh prints times. */
function ago(now: number, then: number): string {
  const s = Math.max(0, now - then);
  if (s < 60) return 'less than a minute ago';
  const m = Math.round(s / 60);
  if (m < 60) return `about ${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  return `about ${h} hour${h === 1 ? '' : 's'} ago`;
}

function parse(args: string[], withValue: string[]): { flags: Map<string, string>; pos: string[] } {
  const flags = new Map<string, string>();
  const pos: string[] = [];
  const alias: Record<string, string> = { '-t': '--title', '-b': '--body', '-B': '--base', '-H': '--head', '-m': '--merge', '-d': '--delete-branch', '-a': '--approve', '-r': '--request-changes', '-c': '--comment', '-s': '--state', '-f': '--fill' };
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    let v: string | undefined;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0) {
      v = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    a = alias[a] ?? a;
    if (a.startsWith('-')) {
      if (withValue.includes(a)) flags.set(a, v ?? args[++i] ?? '');
      else flags.set(a, 'true');
    } else pos.push(a);
  }
  return { flags, pos };
}

export class GhCli {
  constructor(
    private m: GitMachine,
    private u: User,
    private out: Out,
  ) {}

  private emit(e: GitEvent) {
    this.m.events.push(e);
  }

  /** The hub repository the current folder's `origin` points to. */
  private here(): { local: Repo; name: string; hub: Repo } {
    const local = this.m.repoAt(this.u);
    if (!local) throw new CliError('failed to run git: fatal: not a git repository (or any of the parent directories): .git', 1);
    const url = local.config.get('remote.origin.url');
    const name = url ? this.m.hub.parseUrl(url) : null;
    if (!name || !this.m.hub.repos.has(name)) throw new CliError('none of the git remotes configured for this repository point to a known hub host. To tell gh about a new host, please use `gh auth login`', 1);
    return { local, name, hub: this.m.hub.repos.get(name)! };
  }

  private who() {
    return { name: this.m.identity(this.u, 'user.name') ?? this.u.id, email: this.m.identity(this.u, 'user.email') ?? `${this.u.id}@example.com` };
  }

  private prUrl(name: string, n: number) {
    return `${HUB_URL}${name}/pull/${n}`;
  }

  private find(name: string, local: Repo, arg: string | undefined): PullRequest {
    const prs = this.m.hub.prs.get(name)!;
    if (arg) {
      const n = Number(arg.replace(/^#/, '').replace(/^.*\/pull\//, ''));
      const pr = prs.find((p) => p.number === n) ?? prs.find((p) => p.head === arg);
      if (!pr) throw new CliError(`GraphQL: Could not resolve to a PullRequest with the number of ${arg}. (repository.pullRequest)`, 1);
      return pr;
    }
    const b = local.branch;
    const pr = [...prs].reverse().find((p) => p.head === b && p.state === 'OPEN') ?? [...prs].reverse().find((p) => p.head === b);
    if (!pr) throw new CliError(`no pull requests found for branch "${b}"`, 1);
    return pr;
  }

  run(args: string[]): number {
    const [group, sub, ...rest] = args;
    if (!group || group === 'help' || group === '--help') {
      this.out.add('Work seamlessly with the hub from the command line.\n\nUSAGE\n  gh <command> <subcommand> [flags]\n\nCOMMANDS\n  pr:    Manage pull requests (create, list, view, diff, checkout, comment, review, merge, close)\n  repo:  Manage repositories (clone, view)');
      return 0;
    }
    if (group === 'repo') return this.repo(sub, rest);
    if (group !== 'pr') throw new CliError(`unknown command "${group}" for "gh"`, 1);
    switch (sub) {
      case 'create':
        return this.create(rest);
      case 'list':
        return this.list(rest);
      case 'view':
        return this.view(rest);
      case 'diff':
        return this.diff(rest);
      case 'checkout':
        return this.checkout(rest);
      case 'comment':
        return this.comment(rest);
      case 'review':
        return this.review(rest);
      case 'merge':
        return this.merge(rest);
      case 'close':
        return this.close(rest);
      default:
        throw new CliError(`unknown command "${sub ?? ''}" for "gh pr"\n\nUsage:  gh pr <command> [flags]\n\nAvailable commands:\n  checkout\n  close\n  comment\n  create\n  diff\n  list\n  merge\n  review\n  view`, 1);
    }
  }

  private repo(sub: string | undefined, rest: string[]): number {
    if (sub === 'clone') {
      const name = rest[0];
      if (!name) throw new CliError('cannot clone: repository argument required', 1);
      return this.m.git(this.u, ['clone', `${HUB_URL}${name.replace(/\.git$/, '')}.git`, ...rest.slice(1)], this.out);
    }
    if (sub === 'view') {
      const { name, hub } = this.here();
      const branches = hub.branches();
      const open = this.m.hub.prs.get(name)!.filter((p) => p.state === 'OPEN').length;
      this.out.add(`${name}\nBranches: ${branches.join(', ') || '(none)'}\nOpen pull requests: ${open}\n\nView this repository on the hub: ${HUB_URL}${name}`);
      return 0;
    }
    throw new CliError(`unknown command "${sub ?? ''}" for "gh repo"`, 1);
  }

  private create(args: string[]): number {
    const { local, name, hub } = this.here();
    const { flags } = parse(args, ['--title', '--body', '--base', '--head']);
    const head = flags.get('--head') ?? local.branch;
    const base = flags.get('--base') ?? ('ref' in hub.head ? hub.head.ref.slice(11) : 'main');
    if (!head) throw new CliError('could not determine the current branch: not on any branch', 1);
    const headSha = hub.refs.get(`refs/heads/${head}`);
    if (!headSha) throw new CliError('aborted: you must first push the current branch to a remote, or use the --head flag', 1);
    const baseSha = hub.refs.get(`refs/heads/${base}`);
    if (!baseSha) throw new CliError(`pull request create failed: base branch "${base}" not found`, 1);
    const prs = this.m.hub.prs.get(name)!;
    const existing = prs.find((p) => p.head === head && p.base === base && p.state === 'OPEN');
    if (existing) throw new CliError(`a pull request for branch "${head}" into branch "${base}" already exists:\n${this.prUrl(name, existing.number)}`, 1);
    if (hub.isAncestor(headSha, baseSha)) throw new CliError(`pull request create failed: GraphQL: No commits between ${base} and ${head} (createPullRequest)`, 1);
    let title = flags.get('--title');
    let body = flags.get('--body') ?? '';
    if (flags.has('--fill')) {
      const c = hub.commit(headSha);
      title ??= subject(c);
      body ||= c.message.split('\n').slice(2).join('\n').trim();
    }
    if (!title) throw new CliError('must provide `--title` and `--body` (or `--fill`) when not running interactively', 1);
    const pr: PullRequest = { number: prs.length + 1, title, body, head, base, author: this.who().name, state: 'OPEN', reviews: [], comments: [], createdAt: this.m.t };
    prs.push(pr);
    this.emit({ type: 'pr', repo: `hub:${name}`, number: pr.number, action: 'opened' });
    this.out.err(`\nCreating pull request for ${head} into ${base} in ${name}\n`);
    this.out.add(this.prUrl(name, pr.number));
    return 0;
  }

  private list(args: string[]): number {
    const { name } = this.here();
    const { flags } = parse(args, ['--state']);
    const state = (flags.get('--state') ?? 'open').toUpperCase();
    const prs = this.m.hub.prs.get(name)!.filter((p) => state === 'ALL' || p.state === state).reverse();
    if (!prs.length) {
      this.out.add(`no ${state === 'ALL' ? '' : state.toLowerCase() + ' '}pull requests in ${name}`);
      return 0;
    }
    const rows = prs.map((p) => [`#${p.number}`, p.title, p.head, ago(this.m.t, p.createdAt)]);
    const head = ['ID', 'TITLE', 'BRANCH', 'CREATED AT'];
    const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const fmt = (r: string[]) => r.map((c, i) => (i < r.length - 1 ? c.padEnd(w[i]) : c)).join('  ');
    this.out.add(`\nShowing ${prs.length} of ${prs.length} ${state === 'ALL' ? '' : state.toLowerCase() + ' '}pull request${prs.length === 1 ? '' : 's'} in ${name}\n\n${fmt(head)}\n${rows.map(fmt).join('\n')}`);
    return 0;
  }

  private commitsOf(hub: Repo, pr: PullRequest): string[] {
    const head = hub.refs.get(`refs/heads/${pr.head}`);
    const base = hub.refs.get(`refs/heads/${pr.base}`);
    if (pr.state === 'MERGED' && pr.mergeCommit) {
      const c = hub.commit(pr.mergeCommit);
      const a = hub.ancestors([c.parents[1]]);
      const b = hub.ancestors([c.parents[0]]);
      return [...a].filter((x) => !b.has(x));
    }
    if (!head) return [];
    const b = hub.ancestors([base ?? null]);
    return [...hub.ancestors([head])].filter((x) => !b.has(x));
  }

  private view(args: string[]): number {
    const { local, name, hub } = this.here();
    const { pos } = parse(args, []);
    const pr = this.find(name, local, pos[0]);
    const n = this.commitsOf(hub, pr).length;
    const state = { OPEN: 'Open', MERGED: 'Merged', CLOSED: 'Closed' }[pr.state];
    const verb = pr.state === 'MERGED' ? `${pr.mergedBy} merged ${n} commit${n === 1 ? '' : 's'} into ${pr.base} from ${pr.head}` : `${pr.author} wants to merge ${n} commit${n === 1 ? '' : 's'} into ${pr.base} from ${pr.head}`;
    const L = [`${pr.title} #${pr.number}`, `${state} • ${verb} • ${ago(this.m.t, pr.createdAt)}`];
    const latest = new Map<string, Review>();
    for (const rv of pr.reviews) latest.set(rv.author, rv);
    if (latest.size) L.push(`Reviewers: ${[...latest.values()].map((r) => `${r.author} (${{ APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', COMMENTED: 'Commented' }[r.state]})`).join(', ')}`);
    if (pr.state === 'OPEN') {
      const why = this.m.hub.blocker(name, pr);
      L.push(why ? `Merge: blocked (${why})` : 'Merge: ready to merge');
    }
    L.push('', pr.body ? pr.body.split('\n').map((l) => '  ' + l).join('\n') : '  No description provided', '');
    const events = [
      ...pr.reviews.map((r) => ({ at: r.at, text: `${r.author} ${r.state === 'APPROVED' ? 'approved' : r.state === 'CHANGES_REQUESTED' ? 'requested changes' : 'reviewed'} • ${ago(this.m.t, r.at)}`, body: r.body })),
      ...pr.comments.map((c) => ({ at: c.at, text: `${c.author} commented • ${ago(this.m.t, c.at)}`, body: c.body })),
    ].sort((a, b) => a.at - b.at);
    for (const e of events) L.push(e.text, ...(e.body ? e.body.split('\n').map((l) => '  ' + l) : []), '');
    L.push(`View this pull request on the hub: ${this.prUrl(name, pr.number)}`);
    this.out.add(L.join('\n'));
    return 0;
  }

  private diff(args: string[]): number {
    const { local, name, hub } = this.here();
    const { pos } = parse(args, []);
    const pr = this.find(name, local, pos[0]);
    const head = pr.state === 'MERGED' ? hub.commit(pr.mergeCommit!).parents[1] : hub.refs.get(`refs/heads/${pr.head}`);
    const baseTip = pr.state === 'MERGED' ? hub.commit(pr.mergeCommit!).parents[0] : hub.refs.get(`refs/heads/${pr.base}`);
    if (!head || !baseTip) return 0;
    const base = hub.mergeBase(baseTip, head);
    const a = hub.files(base);
    const b = hub.files(head);
    const out: string[] = [];
    for (const p of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const x = a.get(p);
      const y = b.get(p);
      if (x === y) continue;
      out.push(`diff --git a/${p} b/${p}`);
      if (!x) out.push('new file mode 100644', `index 0000000..${short(y!)}`, '--- /dev/null', `+++ b/${p}`);
      else if (!y) out.push('deleted file mode 100644', `index ${short(x)}..0000000`, `--- a/${p}`, '+++ /dev/null');
      else out.push(`index ${short(x)}..${short(y)} 100644`, `--- a/${p}`, `+++ b/${p}`);
      out.push(...unifiedHunks(splitLines(x ? hub.objects.blob(x) : ''), splitLines(y ? hub.objects.blob(y) : '')));
    }
    if (out.length) this.out.add(out.join('\n'));
    return 0;
  }

  private checkout(args: string[]): number {
    const { local, name } = this.here();
    const { pos } = parse(args, []);
    const pr = this.find(name, local, pos[0]);
    if (this.m.git(this.u, ['fetch', '-q', 'origin'], this.out)) return 1;
    if (local.refs.has(`refs/heads/${pr.head}`)) {
      if (this.m.git(this.u, ['switch', pr.head], this.out)) return 1;
      return this.m.git(this.u, ['merge', '--ff-only', `origin/${pr.head}`], this.out);
    }
    return this.m.git(this.u, ['switch', '-c', pr.head, `origin/${pr.head}`], this.out);
  }

  private comment(args: string[]): number {
    const { local, name } = this.here();
    const { flags, pos } = parse(args, ['--body']);
    const pr = this.find(name, local, pos[0]);
    const body = flags.get('--body');
    if (!body) throw new CliError('`--body` or `--body-file` required when not running interactively', 1);
    pr.comments.push({ author: this.who().name, body, at: this.m.t });
    this.emit({ type: 'pr', repo: `hub:${name}`, number: pr.number, action: 'commented' });
    this.out.add(`${this.prUrl(name, pr.number)}#issuecomment-${pr.number}${pr.comments.length}`);
    return 0;
  }

  private review(args: string[]): number {
    const { local, name } = this.here();
    const { flags, pos } = parse(args, ['--body']);
    const pr = this.find(name, local, pos[0]);
    const body = flags.get('--body') ?? '';
    const state = flags.has('--approve') ? 'APPROVED' : flags.has('--request-changes') ? 'CHANGES_REQUESTED' : flags.has('--comment') ? 'COMMENTED' : null;
    if (!state) throw new CliError('did not understand desired review action: --approve, --request-changes, or --comment required when not running interactively', 1);
    if (state !== 'APPROVED' && !body) throw new CliError('body cannot be blank for comment and request-changes reviews', 1);
    const me = this.who().name;
    if (me === pr.author && state !== 'COMMENTED') throw new CliError(`failed to create review: GraphQL: ${state === 'APPROVED' ? 'Can not approve your own pull request' : 'Can not request changes on your own pull request'} (addPullRequestReview)`, 1);
    pr.reviews.push({ author: me, state, body, at: this.m.t });
    this.emit({ type: 'pr', repo: `hub:${name}`, number: pr.number, action: 'reviewed' });
    this.out.err(state === 'APPROVED' ? `✓ Approved pull request #${pr.number}` : state === 'CHANGES_REQUESTED' ? `+ Requested changes to pull request #${pr.number}` : `- Reviewed pull request #${pr.number}`);
    return 0;
  }

  private merge(args: string[]): number {
    const { local, name, hub } = this.here();
    const { flags, pos } = parse(args, []);
    const pr = this.find(name, local, pos[0]);
    if (pr.state === 'MERGED') throw new CliError(`! Pull request #${pr.number} was already merged`, 1);
    if (pr.state === 'CLOSED') throw new CliError(`! Pull request #${pr.number} is closed`, 1);
    if (!flags.has('--merge')) throw new CliError('--merge required when not running interactively (this hub merges with a merge commit)', 1);
    const why = this.m.hub.blocker(name, pr);
    if (why) throw new CliError(`X Pull request #${pr.number} is not mergeable: ${why}.\nTo have the pull request merged after all the requirements have been met, add the \`--auto\` flag.\nTo use administrator privileges to immediately merge the pull request, add the \`--admin\` flag.`, 1);
    const sha = this.m.hub.mergePr(name, pr, this.who(), this.m.t);
    this.emit({ type: 'commit', repo: `hub:${name}`, sha, parents: hub.commit(sha).parents, kind: 'merge' });
    this.emit({ type: 'pr', repo: `hub:${name}`, number: pr.number, action: 'merged' });
    this.out.err(`✓ Merged pull request #${pr.number} (${pr.title})`);
    if (flags.has('--delete-branch')) {
      hub.refs.delete(`refs/heads/${pr.head}`);
      if (local.refs.has(`refs/heads/${pr.head}`)) {
        const quiet = { lines: [] as unknown[], add() {}, err() {} } as unknown as Out;
        if (local.branch === pr.head) this.m.git(this.u, ['switch', pr.base], quiet);
        this.m.git(this.u, ['pull', '-q', '--ff-only'], quiet);
        local.refs.delete(`refs/heads/${pr.head}`);
        for (const k of [...local.config.keys()]) if (k.startsWith(`branch.${pr.head}.`)) local.config.delete(k);
        local.refs.delete(`refs/remotes/origin/${pr.head}`);
        this.out.err(`✓ Deleted local branch ${pr.head} and switched to branch ${local.branch}`);
      }
      this.out.err(`✓ Deleted remote branch ${pr.head}`);
    }
    return 0;
  }

  private close(args: string[]): number {
    const { local, name } = this.here();
    const { pos } = parse(args, []);
    const pr = this.find(name, local, pos[0]);
    if (pr.state !== 'OPEN') throw new CliError(`! Pull request #${pr.number} (${pr.title}) is already ${pr.state.toLowerCase()}`, 1);
    pr.state = 'CLOSED';
    this.emit({ type: 'pr', repo: `hub:${name}`, number: pr.number, action: 'closed' });
    this.out.err(`✓ Closed pull request #${pr.number} (${pr.title})`);
    return 0;
  }
}
