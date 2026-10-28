/**
 * The `git` command line: porcelain commands with output and errors copied from
 * real Git 2.53 (tests/git-golden.test.ts replays sessions recorded on it).
 */
import { countChanges, splitLines, unifiedHunks, diffLines } from './diff';
import { mergeTrees, type TreeMerge } from './merge';
import { basename, dirname, joinPath, normalizePath, relativePath } from './fs';
import type { Commit } from './objects';
import { Repo, short, subject, type Unmerged } from './repo';
import { TextGraph } from './graphText';
import { CliError, type GitEvent, type Out } from './types';
import { blobSha, computeStatus, ignoreRules, isIgnored, removeEmptyDirs, switchTrees, unmergedHow, worktreeFiles, pairRenames, type Status } from './worktree';
import type { GitMachine, User } from './machine';

const NOT_REPO = 'fatal: not a git repository (or any of the parent directories): .git';
const ZERO = '0000000';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function gitDate(t: number): string {
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${d.getUTCFullYear()} +0000`;
}

/** `git commit`'s message cleanup: strip comments and trailing spaces, collapse blank lines. */
export function cleanupMessage(msg: string, stripComments = true): string {
  const lines = msg.split('\n').filter((l) => !(stripComments && l.startsWith('#'))).map((l) => l.replace(/\s+$/, ''));
  const out: string[] = [];
  for (const l of lines) {
    if (!l && (!out.length || !out[out.length - 1])) continue;
    out.push(l);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.length ? out.join('\n') + '\n' : '';
}

/** A side of a diff: path → blob sha, with a way to read contents. */
interface Side {
  files: Map<string, string>;
  read: (path: string) => string;
}

interface FileChange {
  path: string;
  kind: 'new' | 'deleted' | 'modified' | 'renamed';
  from?: string;
  a?: string;
  b?: string;
}

function parseArgs(args: string[], withValue: string[] = []): { flags: Map<string, string>; pos: string[]; paths: string[] | null } {
  const flags = new Map<string, string>();
  const pos: string[] = [];
  let paths: string[] | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (paths) {
      paths.push(a);
      continue;
    }
    if (a === '--') {
      paths = [];
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(0, eq) : a;
      if (eq > 0) flags.set(name, a.slice(eq + 1));
      else if (withValue.includes(name)) flags.set(name, args[++i] ?? '');
      else flags.set(name, 'true');
    } else if (/^-\d+$/.test(a)) flags.set(a, 'true');
    else if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const f = '-' + a[j];
        if (withValue.includes(f)) {
          flags.set(f, a.slice(j + 1) || (args[++i] ?? ''));
          break;
        }
        flags.set(f, 'true');
      }
    } else pos.push(a);
  }
  return { flags, pos, paths };
}

export class GitCli {
  constructor(
    private m: GitMachine,
    private u: User,
    private out: Out,
  ) {}

  private get fs() {
    return this.u.fs;
  }

  private emit(e: GitEvent) {
    this.m.events.push(e);
  }

  // ---------------------------------------------------------------- repository helpers

  private findRepo(): Repo | null {
    let best: Repo | null = null;
    for (const [root, r] of this.u.repos) {
      if (this.u.cwd === root || this.u.cwd.startsWith(root + '/')) if (!best || root.length > best.root!.length) best = r;
    }
    return best;
  }

  private repo(): Repo {
    const r = this.findRepo();
    if (!r) throw new CliError(NOT_REPO, 128);
    return r;
  }

  private id(r: Repo): string {
    return this.m.repoId(this.u, r);
  }

  /** The cwd inside the repository ('' at the top, 'src' in a subfolder). */
  private prefix(r: Repo): string {
    return this.u.cwd === r.root ? '' : this.u.cwd.slice(r.root!.length + 1);
  }

  /** A repository path as Git shows it from the cwd ('../a.txt'). */
  private rel(r: Repo, p: string): string {
    const pre = this.prefix(r);
    if (!pre) return p;
    const dir = p.endsWith('/');
    const res = relativePath(`/${pre}`, `/${p.replace(/\/$/, '')}`);
    return dir ? res + '/' : res;
  }

  /** A path typed by the learner → a repository path ('' = the top folder). Null if outside. */
  private toRepoPath(r: Repo, arg: string): string | null {
    const abs = joinPath(this.u.cwd, arg);
    if (abs === r.root) return '';
    if (!abs.startsWith(r.root + '/')) return null;
    return abs.slice(r.root!.length + 1);
  }

  private matches(spec: string, path: string): boolean {
    if (spec === '') return true;
    if (path === spec || path.startsWith(spec + '/')) return true;
    if (/[*?[]/.test(spec)) {
      const re = new RegExp('^' + spec.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      return re.test(path);
    }
    return false;
  }

  private config(r: Repo | null, key: string): string | undefined {
    const k = key.toLowerCase();
    const find = (m: Map<string, string>) => {
      for (const [kk, v] of m) if (kk.toLowerCase() === k) return v;
      return undefined;
    };
    return (r && find(r.config)) ?? find(this.u.global);
  }

  private identity(r: Repo) {
    const name = this.config(r, 'user.name');
    const email = this.config(r, 'user.email');
    if (!name || !email) {
      throw new CliError(
        `Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config --global user.email "you@example.com"\n  git config --global user.name "Your Name"\n\nto set your account's default identity.\nOmit --global to set the identity only in this repository.\n\nfatal: ${name ? 'unable to auto-detect email address' : 'empty ident name (for <>) not allowed'}`,
        128,
      );
    }
    return { name, email, time: this.m.t };
  }

  private makeCommit(r: Repo, tree: string, parents: string[], message: string, kind: 'commit' | 'merge' | 'revert'): string {
    const who = this.identity(r);
    const sha = r.objects.put({ type: 'commit', tree, parents, author: who, committer: who, message });
    this.emit({ type: 'commit', repo: this.id(r), sha, parents, kind });
    return sha;
  }

  private indexTree(r: Repo): string {
    return r.objects.writeTree(r.index);
  }

  /** The working tree as a diff side (content hashed on demand). */
  private worktreeSide(r: Repo): Side {
    const wt = worktreeFiles(this.fs, r);
    const files = new Map<string, string>();
    for (const [p, c] of wt) files.set(p, blobSha(c));
    return { files, read: (p) => wt.get(p) ?? '' };
  }

  private objSide(r: Repo, files: Map<string, string>): Side {
    return { files, read: (p) => r.objects.blob(files.get(p)!) };
  }

  /** A revision or a fatal "unknown revision" error. */
  private rev(r: Repo, rev: string): string {
    const sha = r.resolve(rev);
    if (!sha) throw new CliError(`fatal: ambiguous argument '${rev}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`, 128);
    return sha;
  }

  private writeFile(r: Repo, p: string, content: string) {
    this.fs.write(`${r.root}/${p}`, content);
  }

  // ---------------------------------------------------------------- entry point

  run(args: string[]): number {
    const [cmd, ...rest] = args;
    switch (cmd) {
      case undefined:
      case 'help':
      case '--help':
        return this.help();
      case '--version':
      case 'version':
        this.out.add('git version 2.53.0');
        return 0;
      case 'init':
        return this.init(rest);
      case 'status':
        return this.status(rest);
      case 'add':
        return this.add(rest);
      case 'rm':
        return this.rm(rest);
      case 'mv':
        return this.mv(rest);
      case 'commit':
        return this.commit(rest);
      case 'log':
        return this.log(rest);
      case 'show':
        return this.show(rest);
      case 'diff':
        return this.diff(rest);
      case 'restore':
        return this.restore(rest);
      case 'switch':
        return this.switch(rest);
      case 'checkout':
        return this.checkout(rest);
      case 'branch':
        return this.branch(rest);
      case 'merge':
        return this.merge(rest);
      case 'revert':
        return this.revert(rest);
      case 'config':
        return this.configCmd(rest);
      case 'remote':
        return this.remote(rest);
      case 'clone':
        return this.clone(rest);
      case 'fetch':
        return this.fetch(rest);
      case 'pull':
        return this.pull(rest);
      case 'push':
        return this.push(rest);
      case 'ls-files':
        return this.lsFiles();
      default:
        throw new CliError(`git: '${cmd}' is not a git command. See 'git --help'.`, 1);
    }
  }

  private help(): number {
    this.out.add(`usage: git [-v | --version] [-h | --help] <command> [<args>]

These are common Git commands used in various situations:

start a working area
   clone      Clone a repository into a new directory
   init       Create an empty Git repository or reinitialize an existing one

work on the current change
   add        Add file contents to the index
   mv         Move or rename a file, a directory, or a symlink
   restore    Restore working tree files
   rm         Remove files from the working tree and from the index

examine the history and state
   diff       Show changes between commits, commit and working tree, etc
   log        Show commit logs
   show       Show various types of objects
   status     Show the working tree status

grow, mark and tweak your common history
   branch     List, create, or delete branches
   commit     Record changes to the repository
   merge      Join two or more development histories together
   revert     Revert some existing commits
   switch     Switch branches

collaborate
   fetch      Download objects and refs from another repository
   pull       Fetch from and integrate with another repository or a local branch
   push       Update remote refs along with associated objects`);
    return 0;
  }

  // ---------------------------------------------------------------- init / config

  private init(args: string[]): number {
    const { flags, pos } = parseArgs(args, ['-b', '--initial-branch']);
    const dir = pos[0] ? joinPath(this.u.cwd, pos[0]) : this.u.cwd;
    const existing = this.u.repos.get(dir);
    const quiet = flags.has('-q') || flags.has('--quiet');
    if (existing) {
      if (quiet) return 0;
      this.out.add(`Reinitialized existing Git repository in ${dir === '/' ? '' : dir}/.git/`);
      return 0;
    }
    this.fs.mkdirp(dir);
    const r = new Repo(dir);
    const branch = flags.get('-b') ?? flags.get('--initial-branch') ?? this.config(null, 'init.defaultBranch') ?? 'master';
    r.head = { ref: `refs/heads/${branch}` };
    for (const [k, v] of [['core.repositoryformatversion', '0'], ['core.filemode', 'true'], ['core.bare', 'false'], ['core.logallrefupdates', 'true']]) r.config.set(k, v);
    this.u.repos.set(dir, r);
    this.emit({ type: 'repo', repo: this.id(r), action: 'init' });
    if (!quiet) this.out.add(`Initialized empty Git repository in ${dir === '/' ? '' : dir}/.git/`);
    return 0;
  }

  private configCmd(args: string[]): number {
    const { flags, pos } = parseArgs(args);
    const global = flags.has('--global');
    const r = global ? null : this.findRepo();
    if (!global && !r && pos.length > 1) throw new CliError('fatal: not in a git directory', 128);
    if (flags.has('--list') || flags.has('-l')) {
      const lines: string[] = [];
      for (const [k, v] of this.u.global) lines.push(`${k.toLowerCase()}=${v}`);
      if (!global && r) for (const [k, v] of r.config) lines.push(`${k.toLowerCase()}=${v}`);
      if (lines.length) this.out.add(lines.join('\n'));
      return 0;
    }
    const unset = flags.has('--unset');
    const key = pos[0];
    if (!key) throw new CliError('usage: git config [<options>]', 129);
    if (!/^[a-zA-Z][\w-]*\.[^\s]+$/.test(key)) throw new CliError(`error: key does not contain a section: ${key}`, 1);
    const store = global ? this.u.global : r ? r.config : this.u.global;
    if (unset) {
      for (const k of [...store.keys()]) if (k.toLowerCase() === key.toLowerCase()) store.delete(k);
      return 0;
    }
    if (pos.length === 1) {
      const v = global ? [...this.u.global].find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] : this.config(r, key);
      if (v === undefined) return 1;
      this.out.add(v);
      return 0;
    }
    for (const k of [...store.keys()]) if (k.toLowerCase() === key.toLowerCase()) store.delete(k);
    store.set(key, pos.slice(1).join(' '));
    return 0;
  }

  // ---------------------------------------------------------------- status

  private upstreamInfo(r: Repo): string[] {
    const b = r.branch;
    if (!b || !r.headCommit()) return [];
    const up = r.upstream(b);
    if (!up) return [];
    const theirs = r.refs.get(`refs/remotes/${up.tracking}`);
    if (!theirs) return [`Your branch is based on '${up.tracking}', but the upstream is gone.`, '  (use "git branch --unset-upstream" to fixup)'];
    const [ahead, behind] = r.aheadBehind(r.headCommit()!, theirs);
    const c = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;
    if (!ahead && !behind) return [`Your branch is up to date with '${up.tracking}'.`];
    if (ahead && !behind) return [`Your branch is ahead of '${up.tracking}' by ${c(ahead)}.`, '  (use "git push" to publish your local commits)'];
    if (!ahead) return [`Your branch is behind '${up.tracking}' by ${c(behind)}, and can be fast-forwarded.`, '  (use "git pull" to update your local branch)'];
    return [`Your branch and '${up.tracking}' have diverged,`, `and have ${ahead} and ${behind} different commits each, respectively.`, '  (use "git pull" if you want to integrate the remote branch with yours)'];
  }

  private detachedName(r: Repo): string {
    const at = r.detachedAt;
    const head = r.headCommit()!;
    if (!at) return `HEAD detached at ${short(head)}`;
    return `HEAD detached ${at.sha === head ? 'at' : 'from'} ${at.name}`;
  }

  /** The long `git status` text. `forCommit`: the version `git commit` prints when there's nothing to commit. */
  private statusLines(r: Repo, forCommit = false): { lines: string[]; committable: boolean } {
    const s = computeStatus(this.fs, r);
    const L: string[] = [];
    L.push(r.branch ? `On branch ${r.branch}` : this.detachedName(r));
    const up = this.upstreamInfo(r);
    if (up.length) L.push(...up, '');
    const initial = !r.headCommit();
    if (initial) L.push('', forCommit ? 'Initial commit' : 'No commits yet', '');
    const op = r.op;
    if (op?.kind === 'merge') {
      if (s.unmerged.length) L.push('You have unmerged paths.', '  (fix conflicts and run "git commit")', '  (use "git merge --abort" to abort the merge)', '');
      else L.push('All conflicts fixed but you are still merging.', '  (use "git commit" to conclude merge)', '');
    } else if (op?.kind === 'revert') {
      L.push(`You are currently reverting commit ${short(op.head)}.`);
      if (s.unmerged.length) L.push('  (fix conflicts and run "git revert --continue")');
      else L.push('  (all conflicts fixed: run "git revert --continue")');
      L.push('  (use "git revert --skip" to skip this patch)', '  (use "git revert --abort" to cancel the revert operation)', '');
    }
    const fromCommit = op?.kind !== 'merge';
    const pad = (label: string, w: number) => label + ' '.repeat(Math.max(1, w - label.length));
    if (s.staged.length) {
      L.push('Changes to be committed:');
      if (fromCommit) L.push(initial ? '  (use "git rm --cached <file>..." to unstage)' : '  (use "git restore --staged <file>..." to unstage)');
      for (const x of s.staged) L.push(`\t${pad(x.kind + ':', 12)}${x.from ? `${this.rel(r, x.from)} -> ` : ''}${this.rel(r, x.path)}`);
      L.push('');
    }
    if (s.unmerged.length) {
      L.push('Unmerged paths:');
      if (fromCommit && !initial) L.push('  (use "git restore --staged <file>..." to unstage)');
      const delMod = s.unmerged.some((x) => x.how !== 'both modified' && x.how !== 'both added');
      L.push(delMod ? '  (use "git add/rm <file>..." as appropriate to mark resolution)' : '  (use "git add <file>..." to mark resolution)');
      for (const x of s.unmerged) L.push(`\t${pad(x.how + ':', 17)}${this.rel(r, x.path)}`);
      L.push('');
    }
    if (s.unstaged.length) {
      L.push('Changes not staged for commit:');
      L.push(s.unstaged.some((x) => x.kind === 'deleted') ? '  (use "git add/rm <file>..." to update what will be committed)' : '  (use "git add <file>..." to update what will be committed)');
      L.push('  (use "git restore <file>..." to discard changes in working directory)');
      for (const x of s.unstaged) L.push(`\t${pad(x.kind + ':', 12)}${this.rel(r, x.path)}`);
      L.push('');
    }
    if (s.untracked.length) {
      L.push('Untracked files:', '  (use "git add <file>..." to include in what will be committed)');
      for (const p of s.untracked) L.push(`\t${this.rel(r, p)}`);
      L.push('');
    }
    const committable = s.staged.length > 0 || (op?.kind === 'merge' && !s.unmerged.length);
    if (!committable) {
      if (s.unstaged.length || s.unmerged.length) L.push('no changes added to commit (use "git add" and/or "git commit -a")');
      else if (s.untracked.length) L.push('nothing added to commit but untracked files present (use "git add" to track)');
      else if (initial) L.push('nothing to commit (create/copy files and use "git add" to track)');
      else L.push('nothing to commit, working tree clean');
    }
    return { lines: L, committable };
  }

  private status(args: string[]): number {
    const r = this.repo();
    const { flags } = parseArgs(args);
    if (flags.has('-s') || flags.has('--short')) {
      const s = computeStatus(this.fs, r);
      const rows = new Map<string, [string, string, string]>();
      const set = (p: string, x: string | null, y: string | null, show = p) => {
        const cur = rows.get(p) ?? [' ', ' ', show];
        if (x) cur[0] = x;
        if (y) cur[1] = y;
        cur[2] = show;
        rows.set(p, cur);
      };
      for (const x of s.staged) set(x.path, { 'new file': 'A', modified: 'M', deleted: 'D', renamed: 'R' }[x.kind], null, x.from ? `${this.rel(r, x.from)} -> ${this.rel(r, x.path)}` : this.rel(r, x.path));
      for (const x of s.unstaged) set(x.path, null, x.kind === 'deleted' ? 'D' : 'M', rows.get(x.path)?.[2] ?? this.rel(r, x.path));
      const codes: Record<string, string> = { 'both modified': 'UU', 'both added': 'AA', 'deleted by us': 'DU', 'deleted by them': 'UD', 'added by us': 'AU', 'added by them': 'UA', 'both deleted': 'DD' };
      for (const x of s.unmerged) rows.set(x.path, [codes[x.how][0], codes[x.how][1], this.rel(r, x.path)]);
      const lines = [...rows.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => `${v[0]}${v[1]} ${v[2]}`);
      for (const p of s.untracked) lines.push(`?? ${this.rel(r, p)}`);
      if (lines.length) this.out.add(lines.join('\n'));
      return 0;
    }
    this.out.add(this.statusLines(r).lines.join('\n'));
    return 0;
  }

  // ---------------------------------------------------------------- add / rm / mv / restore

  private add(args: string[]): number {
    const r = this.repo();
    const { flags, pos, paths } = parseArgs(args);
    const specs = [...pos, ...(paths ?? [])];
    const all = flags.has('-A') || flags.has('--all');
    const update = flags.has('-u') || flags.has('--update');
    const force = flags.has('-f') || flags.has('--force');
    if (!specs.length && !all && !update) {
      this.out.add('Nothing specified, nothing added.\nhint: Maybe you wanted to say \'git add .\'?\nhint: Disable this message with "git config set advice.addEmptyPathspec false"', 'err');
      return 0;
    }
    const rp = specs.map((s) => this.toRepoPath(r, s));
    for (let i = 0; i < specs.length; i++) if (rp[i] === null) throw new CliError(`fatal: ${joinPath(this.u.cwd, specs[i])}: '${specs[i]}' is outside repository at '${r.root}'`, 128);
    const scope = rp.length ? (rp as string[]) : [''];
    const wt = worktreeFiles(this.fs, r);
    const rules = ignoreRules(wt);
    const ignored: string[] = [];
    const hit = new Set<number>();
    const touched = new Set<string>();
    for (const [p, c] of wt) {
      const k = scope.findIndex((s) => this.matches(s, p));
      if (k < 0) continue;
      const tracked = r.index.has(p) || r.unmerged.has(p);
      if (!tracked) {
        if (update) continue;
        if (isIgnored(rules, p) && !force) {
          if (scope[k] === p) ignored.push(this.rel(r, p));
          continue;
        }
      }
      hit.add(k);
      touched.add(p);
      r.index.set(p, r.objects.put({ type: 'blob', content: c }));
      r.unmerged.delete(p);
    }
    // Tracked files that are gone: `git add` stages the deletion.
    for (const p of [...r.index.keys(), ...r.unmerged.keys()]) {
      if (wt.has(p)) continue;
      const k = scope.findIndex((s) => this.matches(s, p));
      if (k < 0) continue;
      hit.add(k);
      r.index.delete(p);
      r.unmerged.delete(p);
    }
    if (ignored.length) {
      this.out.err(`The following paths are ignored by one of your .gitignore files:\n${ignored.join('\n')}\nhint: Use -f if you really want to add them.\nhint: Disable this message with "git config set advice.addIgnoredFile false"`);
      return 1;
    }
    for (let i = 0; i < specs.length; i++) {
      if (!hit.has(i) && !(rp[i] === '' || this.fs.isDir(joinPath(this.u.cwd, specs[i])))) throw new CliError(`fatal: pathspec '${specs[i]}' did not match any files`, 128);
    }
    return 0;
  }

  private rm(args: string[]): number {
    const r = this.repo();
    const { flags, pos, paths } = parseArgs(args);
    const specs = [...pos, ...(paths ?? [])];
    const cached = flags.has('--cached');
    const force = flags.has('-f') || flags.has('--force');
    const recursive = flags.has('-r');
    if (!specs.length) throw new CliError('usage: git rm [-f | --force] [-n] [-r] [--cached] [--ignore-unmatch]\n              [--quiet] [--pathspec-from-file=<file> [--pathspec-file-nul]]\n              [--] [<pathspec>...]', 129);
    const head = r.files(r.headCommit());
    const targets: string[] = [];
    for (const s of specs) {
      const rp = this.toRepoPath(r, s);
      const hits = rp === null ? [] : [...new Set([...r.index.keys(), ...r.unmerged.keys()])].filter((p) => this.matches(rp, p)).sort();
      if (!hits.length) throw new CliError(`fatal: pathspec '${s}' did not match any files`, 128);
      if (rp !== null && hits.some((h) => h !== rp) && !recursive && !/[*?]/.test(rp)) throw new CliError(`fatal: not removing '${s}' recursively without -r`, 128);
      targets.push(...hits);
    }
    if (!force) {
      const modified: string[] = [];
      const staged: string[] = [];
      for (const p of targets) {
        const c = this.fs.read(`${r.root}/${p}`);
        const idx = r.index.get(p);
        const localMod = c !== undefined && idx !== undefined && blobSha(c) !== idx;
        const stagedMod = idx !== undefined && head.get(p) !== idx;
        if (localMod && stagedMod) staged.push(p);
        else if (localMod && !cached) modified.push(p);
        else if (stagedMod && !cached && head.has(p)) staged.push(p);
      }
      if (staged.length) {
        this.out.err(`error: the following file${staged.length > 1 ? 's have' : ' has'} staged content different from both the\nfile and the HEAD:\n${staged.map((p) => '    ' + p).join('\n')}\n(use -f to force removal)`);
        return 1;
      }
      if (modified.length) {
        this.out.err(`error: the following file${modified.length > 1 ? 's have' : ' has'} local modifications:\n${modified.map((p) => '    ' + p).join('\n')}\n(use --cached to keep the file, or -f to force removal)`);
        return 1;
      }
    }
    for (const p of targets) {
      r.index.delete(p);
      r.unmerged.delete(p);
      if (!flags.has('-q') && !flags.has('--quiet')) this.out.add(`rm '${p}'`);
      if (!cached) {
        this.fs.remove(`${r.root}/${p}`);
        removeEmptyDirs(this.fs, r.root!, p);
      }
    }
    return 0;
  }

  private mv(args: string[]): number {
    const r = this.repo();
    const { pos } = parseArgs(args);
    if (pos.length < 2) throw new CliError('usage: git mv [-v] [-f] [-n] [-k] <source> <destination>\n   or: git mv [-v] [-f] [-n] [-k] <source>... <destination-directory>', 129);
    let [src, dst] = pos;
    const s = this.toRepoPath(r, src);
    let d = this.toRepoPath(r, dst);
    if (s === null || d === null) throw new CliError(`fatal: '${dst}' is outside repository at '${r.root}'`, 128);
    if (this.fs.isDir(`${r.root}/${d}`) && d !== '') d = `${d}/${basename(s)}`;
    else if (d === '') d = basename(s);
    const moved = [...r.index.keys()].filter((p) => p === s || p.startsWith(s + '/'));
    if (!moved.length) throw new CliError(`fatal: not under version control, source=${s}, destination=${d}`, 128);
    if (this.fs.exists(`${r.root}/${d}`)) throw new CliError(`fatal: destination exists, source=${s}, destination=${d}`, 128);
    for (const p of moved) {
      const np = d + p.slice(s.length);
      r.index.set(np, r.index.get(p)!);
      r.index.delete(p);
      const c = this.fs.read(`${r.root}/${p}`);
      if (c !== undefined) {
        this.fs.remove(`${r.root}/${p}`);
        this.fs.write(`${r.root}/${np}`, c);
      }
    }
    removeEmptyDirs(this.fs, r.root!, s + '/x');
    src = dst;
    return 0;
  }

  private restore(args: string[]): number {
    const r = this.repo();
    const { flags, pos, paths } = parseArgs(args, ['--source', '-s']);
    const specs = [...pos, ...(paths ?? [])];
    const staged = flags.has('--staged') || flags.has('-S');
    const worktree = flags.has('--worktree') || flags.has('-W') || !staged;
    const source = flags.get('--source') ?? flags.get('-s');
    if (!specs.length) throw new CliError('fatal: you must specify path(s) to restore', 128);
    let from: Map<string, string> | null = null;
    if (source !== undefined) {
      const sha = r.resolve(source);
      if (!sha) throw new CliError(`fatal: could not resolve '${source}'`, 128);
      from = r.files(sha);
    } else if (staged) {
      const head = r.headCommit();
      if (!head) throw new CliError("fatal: could not resolve 'HEAD'", 128);
      from = r.files(head);
    }
    const rps = specs.map((s) => this.toRepoPath(r, s) ?? '\u0000');
    const known = new Set([...r.index.keys(), ...r.unmerged.keys(), ...(from?.keys() ?? []), ...(staged ? r.files(r.headCommit()).keys() : [])]);
    for (let i = 0; i < specs.length; i++) {
      if (![...known].some((p) => this.matches(rps[i], p))) {
        this.out.err(`error: pathspec '${specs[i]}' did not match any file(s) known to git`);
        return 1;
      }
    }
    const targets = [...known].filter((p) => rps.some((s) => this.matches(s, p))).sort();
    if (worktree && !staged && !from) {
      const conflicted = targets.filter((p) => r.unmerged.has(p));
      if (conflicted.length) {
        this.out.err(conflicted.map((p) => `error: path '${p}' is unmerged`).join('\n'));
        return 1;
      }
    }
    for (const p of targets) {
      const src = from ?? r.index;
      const sha = src.get(p);
      if (staged) {
        if (sha === undefined) r.index.delete(p);
        else r.index.set(p, sha);
        r.unmerged.delete(p);
      }
      if (worktree) {
        if (sha === undefined) {
          if (from) {
            this.fs.remove(`${r.root}/${p}`);
            removeEmptyDirs(this.fs, r.root!, p);
          }
        } else this.writeFile(r, p, r.objects.blob(sha));
      }
    }
    return 0;
  }

  private lsFiles(): number {
    const r = this.repo();
    const pre = this.prefix(r);
    const all = [...new Set([...r.index.keys(), ...r.unmerged.keys()])].filter((p) => !pre || p.startsWith(pre + '/')).sort();
    if (all.length) this.out.add(all.map((p) => this.rel(r, p)).join('\n'));
    return 0;
  }

  // ---------------------------------------------------------------- commit

  /** Paths changed between two trees (exact renames paired up). */
  private changes(a: Map<string, string>, b: Map<string, string>): FileChange[] {
    const out: FileChange[] = [];
    for (const [p, s] of b) {
      if (!a.has(p)) out.push({ path: p, kind: 'new', b: s });
      else if (a.get(p) !== s) out.push({ path: p, kind: 'modified', a: a.get(p), b: s });
    }
    for (const [p, s] of a) if (!b.has(p)) out.push({ path: p, kind: 'deleted', a: s });
    const paired = pairRenames(
      out.map((c) => ({ ...c, kind: c.kind === 'new' ? 'new file' : c.kind })),
      (p) => a.get(p),
      (p) => b.get(p),
    );
    return paired.map((c) => ({ ...c, kind: c.kind === 'new file' ? 'new' : c.kind, a: c.from ? a.get(c.from) : a.get(c.path), b: b.get(c.path) }) as FileChange);
  }

  /** "N files changed, X insertions(+), Y deletions(-)" plus the per-file stat rows. */
  private stat(ch: FileChange[], side: { a: Side; b: Side }, withRows: boolean, summary = true): string[] {
    let ins = 0;
    let del = 0;
    const rows: { name: string; add: number; del: number }[] = [];
    for (const c of ch) {
      const before = c.kind === 'new' ? [] : splitLines(side.a.read(c.from ?? c.path));
      const after = c.kind === 'deleted' ? [] : splitLines(side.b.read(c.path));
      const n = countChanges(before, after);
      ins += n.add;
      del += n.del;
      rows.push({ name: c.from ? `${c.from} => ${c.path}` : c.path, ...n });
    }
    const out: string[] = [];
    if (withRows && rows.length) {
      const nameW = Math.max(...rows.map((x) => x.name.length));
      const maxChange = Math.max(...rows.map((x) => x.add + x.del));
      const numW = String(maxChange).length;
      // Git fits the graph into 80 columns.
      const graphW = Math.max(6, 80 - 1 - nameW - 3 - numW - 1);
      const scale = (n: number) => (maxChange > graphW && n ? Math.max(1, Math.round((n * graphW) / maxChange)) : n);
      for (const x of rows) {
        const total = x.add + x.del;
        let a = scale(x.add);
        let d = scale(x.del);
        if (maxChange > graphW && a + d > scale(total)) (a > d ? (a -= 1) : (d -= 1));
        const graph = '+'.repeat(a) + '-'.repeat(d);
        out.push(` ${x.name.padEnd(nameW)} | ${String(total).padStart(numW)}${graph ? ' ' + graph : ''}`);
      }
    }
    const files = ch.length;
    let s = ` ${files} file${files === 1 ? '' : 's'} changed`;
    if (ins || !del) s += `, ${ins} insertion${ins === 1 ? '' : 's'}(+)`;
    if (del || !ins) s += `, ${del} deletion${del === 1 ? '' : 's'}(-)`;
    if (!files) s = ' 0 files changed';
    out.push(s);
    if (summary) for (const c of ch) {
      if (c.kind === 'new') out.push(` create mode 100644 ${c.path}`);
      else if (c.kind === 'deleted') out.push(` delete mode 100644 ${c.path}`);
      else if (c.kind === 'renamed') out.push(` rename ${this.renameLabel(c.from!, c.path)} (100%)`);
    }
    return out;
  }

  /** Git's compact rename label: "src/{a.js => b.js}". */
  private renameLabel(from: string, to: string): string {
    const a = from.split('/');
    const b = to.split('/');
    let pre = 0;
    while (pre < a.length - 1 && pre < b.length - 1 && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - 1 - pre && suf < b.length - 1 - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    if (!pre && !suf) return `${from} => ${to}`;
    const P = a.slice(0, pre).join('/');
    const S = a.slice(a.length - suf).join('/');
    const mid = `{${a.slice(pre, a.length - suf).join('/')} => ${b.slice(pre, b.length - suf).join('/')}}`;
    return [P, mid, S].filter(Boolean).join('/');
  }

  private commit(args: string[]): number {
    const r = this.repo();
    const { flags, pos } = parseArgs(args, ['-m', '--message']);
    const messages: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-m' || a === '--message') messages.push(args[++i] ?? '');
      else if (a.startsWith('--message=')) messages.push(a.slice(10));
      else if (/^-[a-zA-Z]*m$/.test(a) && !a.startsWith('--')) messages.push(args[++i] ?? '');
      else if (/^-[a-zA-Z]*m./.test(a) && !a.startsWith('--')) messages.push(a.slice(a.indexOf('m') + 1));
    }
    const quiet = flags.has('-q') || flags.has('--quiet');
    if (r.unmerged.size) {
      this.out.add([...r.unmerged.keys()].sort().map((p) => `U\t${p}`).join('\n'));
      throw new CliError("error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.", 128);
    }
    if (flags.has('-a') || flags.has('--all')) {
      const wt = worktreeFiles(this.fs, r);
      for (const p of [...r.index.keys()]) {
        const c = wt.get(p);
        if (c === undefined) r.index.delete(p);
        else r.index.set(p, r.objects.put({ type: 'blob', content: c }));
      }
    }
    if (pos.length) {
      // `git commit file`: commit just those files (staging them first).
      for (const s of pos) {
        const rp = this.toRepoPath(r, s);
        if (rp === null || ![...r.index.keys()].some((p) => this.matches(rp, p))) throw new CliError(`error: pathspec '${s}' did not match any file(s) known to git`, 1);
        for (const p of [...r.index.keys()].filter((p) => this.matches(rp, p))) {
          const c = this.fs.read(`${r.root}/${p}`);
          if (c === undefined) r.index.delete(p);
          else r.index.set(p, r.objects.put({ type: 'blob', content: c }));
        }
      }
    }
    const head = r.headCommit();
    const tree = this.indexTree(r);
    const isMerge = r.op?.kind === 'merge';
    if (!isMerge && head && r.commit(head).tree === tree && !flags.has('--allow-empty')) {
      const st = this.statusLines(r, true);
      this.out.add(st.lines.join('\n'));
      return 1;
    }
    if (!head && r.index.size === 0 && !flags.has('--allow-empty')) {
      this.out.add(this.statusLines(r, true).lines.join('\n'));
      return 1;
    }
    let message: string;
    if (messages.length) message = cleanupMessage(messages.join('\n\n'), false);
    else {
      // No -m: Git opens the editor; this terminal's editor saves the prepared message unchanged.
      message = cleanupMessage(r.op?.msg ?? '');
    }
    if (!message) {
      this.out.err('Aborting commit due to empty commit message.');
      return 1;
    }
    const parents = head ? [head] : [];
    let kind: 'commit' | 'merge' | 'revert' = 'commit';
    if (isMerge) {
      parents.push(r.op!.head);
      kind = 'merge';
    } else if (r.op?.kind === 'revert') kind = 'revert';
    const sha = this.makeCommit(r, tree, parents, message, kind);
    r.moveHead(sha);
    r.op = undefined;
    if (quiet) return 0;
    this.commitSummary(r, sha, head, isMerge);
    return 0;
  }

  /** "[main (root-commit) abc1234] message" and the change summary. */
  private commitSummary(r: Repo, sha: string, parent: string | null, isMerge: boolean, showDate = false) {
    const c = r.commit(sha);
    const where = r.branch ?? 'detached HEAD';
    this.out.add(`[${where}${parent ? '' : ' (root-commit)'} ${short(sha)}] ${subject(c)}`);
    if (showDate) this.out.add(` Date: ${gitDate(c.author.time)}`);
    if (isMerge) return;
    const a = r.files(parent);
    const b = r.files(sha);
    this.out.add(this.stat(this.changes(a, b), { a: this.objSide(r, a), b: this.objSide(r, b) }, false).join('\n'));
  }

  // ---------------------------------------------------------------- log / show

  /** "(HEAD -> main, origin/main, feature)" for a commit, as `log.decorate=short` prints it. */
  private decoration(r: Repo, sha: string, byCommit: Map<string, string[]>): string {
    const refs = [...(byCommit.get(sha) ?? [])].reverse();
    const parts: string[] = [];
    const headHere = r.headCommit() === sha;
    const cur = 'ref' in r.head ? r.head.ref : null;
    const shortRef = (ref: string) => {
      if (ref.startsWith('refs/heads/')) return ref.slice(11);
      if (ref.startsWith('refs/remotes/')) return ref.slice(13);
      if (ref.startsWith('refs/tags/')) return `tag: ${ref.slice(10)}`;
      return ref;
    };
    if (headHere) parts.push(cur && r.refs.get(cur) === sha ? `HEAD -> ${shortRef(cur)}` : 'HEAD');
    for (const ref of refs) if (!(headHere && ref === cur)) parts.push(shortRef(ref));
    return parts.length ? ` (${parts.join(', ')})` : '';
  }

  /** The commits a log shows, in Git's order (date order, or topological with --graph). */
  private walk(r: Repo, tips: string[], exclude: string[], topo: boolean): string[] {
    const hidden = r.ancestors(exclude);
    const shown = [...r.ancestors(tips)].filter((c) => !hidden.has(c));
    const set = new Set(shown);
    const time = (c: string) => r.commit(c).committer.time;
    // The tips, newest first (ties keep the order given).
    const starts = [...new Set(tips)].filter((t) => set.has(t));
    const order = starts.map((t, i) => [t, i] as const).sort((a, b) => time(b[0]) - time(a[0]) || a[1] - b[1]).map(([t]) => t);
    if (!topo) {
      // A priority queue by commit date; equal dates come out in the order they went in.
      const out: string[] = [];
      const seen = new Set<string>();
      let queue: { c: string; n: number }[] = [];
      let n = 0;
      for (const t of order) {
        if (!seen.has(t)) {
          seen.add(t);
          queue.push({ c: t, n: n++ });
        }
      }
      while (queue.length) {
        queue.sort((a, b) => time(b.c) - time(a.c) || a.n - b.n);
        const { c } = queue.shift()!;
        out.push(c);
        for (const p of r.commit(c).parents) {
          if (!seen.has(p) && set.has(p)) {
            seen.add(p);
            queue.push({ c: p, n: n++ });
          }
        }
        queue = queue.filter((q) => set.has(q.c));
      }
      return out;
    }
    // --topo-order with Git's LIFO work queue: a commit only after all its children.
    const indegree = new Map<string, number>();
    for (const c of shown) indegree.set(c, 1);
    for (const c of shown) for (const p of r.commit(c).parents) if (indegree.has(p)) indegree.set(p, indegree.get(p)! + 1);
    const tipsAll = shown.filter((c) => indegree.get(c) === 1);
    // The walk starts from the tips sorted by date (newest first), then everything reachable in date order.
    const dateOrder = this.walk(r, tips, exclude, false);
    const stack = dateOrder.filter((c) => tipsAll.includes(c)).reverse();
    const out: string[] = [];
    while (stack.length) {
      const c = stack.pop()!;
      for (const p of r.commit(c).parents) {
        const d = indegree.get(p);
        if (!d) continue;
        indegree.set(p, d - 1);
        if (d - 1 === 1) stack.push(p);
      }
      indegree.set(c, 0);
      out.push(c);
    }
    return out;
  }

  private commitHeader(r: Repo, sha: string, byCommit: Map<string, string[]>, oneline: boolean): string[] {
    const c = r.commit(sha);
    if (oneline) return [`${short(sha)}${this.decoration(r, sha, byCommit)} ${subject(c)}`];
    const L = [`commit ${sha}${this.decoration(r, sha, byCommit)}`];
    if (c.parents.length > 1) L.push(`Merge: ${c.parents.map(short).join(' ')}`);
    L.push(`Author: ${c.author.name} <${c.author.email}>`, `Date:   ${gitDate(c.author.time)}`, '');
    for (const l of c.message.replace(/\n$/, '').split('\n')) L.push(l ? `    ${l}` : '    ');
    return L;
  }

  /** The diff (or stat) a commit introduced, against its first parent. */
  private commitPatch(r: Repo, sha: string, stat: boolean, patch: boolean): string[] {
    const c = r.commit(sha);
    if (c.parents.length > 1) return [];
    const a = r.files(c.parents[0] ?? null);
    const b = r.files(sha);
    const ch = this.changes(a, b);
    const sides = { a: this.objSide(r, a), b: this.objSide(r, b) };
    const out: string[] = [];
    if (stat) out.push(...this.stat(ch, sides, true, false));
    if (patch) out.push(...this.patch(ch, sides));
    return out;
  }

  private log(args: string[]): number {
    const r = this.repo();
    const { flags, pos, paths } = parseArgs(args, ['-n', '--max-count', '--format', '--pretty']);
    const oneline = flags.has('--oneline') || flags.get('--pretty') === 'oneline' || flags.get('--format') === 'oneline';
    const graph = flags.has('--graph');
    let max = Number(flags.get('-n') ?? flags.get('--max-count') ?? Infinity);
    for (const a of args) if (/^-\d+$/.test(a)) max = Number(a.slice(1));
    const stat = flags.has('--stat');
    const patch = flags.has('-p') || flags.has('--patch');
    const tips: string[] = [];
    const exclude: string[] = [];
    for (const p of pos) {
      const range = /^(.*)\.\.(.*)$/.exec(p);
      if (range) {
        exclude.push(this.rev(r, range[1] || 'HEAD'));
        tips.push(this.rev(r, range[2] || 'HEAD'));
      } else if (p.startsWith('^')) exclude.push(this.rev(r, p.slice(1)));
      else tips.push(this.rev(r, p));
    }
    if (flags.has('--all')) {
      for (const [ref, sha] of r.refs) if (!ref.startsWith('refs/remotes/') || true) tips.push(sha);
      if (r.headCommit()) tips.push(r.headCommit()!);
    }
    if (!tips.length) {
      const head = r.headCommit();
      if (!head) throw new CliError(`fatal: your current branch '${r.branch}' does not have any commits yet`, 128);
      tips.push(head);
    }
    let commits = this.walk(r, tips, exclude, graph);
    if (paths?.length) {
      const specs = paths.map((s) => this.toRepoPath(r, s) ?? '\u0000');
      commits = commits.filter((c) => {
        const co = r.commit(c);
        const a = r.files(co.parents[0] ?? null);
        const b = r.files(c);
        return this.changes(a, b).some((ch) => specs.some((s) => this.matches(s, ch.path) || (ch.from !== undefined && this.matches(s, ch.from))));
      });
    }
    const shownSet = new Set(commits);
    if (max < commits.length) commits = commits.slice(0, max);
    const byCommit = r.refsByCommit();
    const lines: string[] = [];
    const g = graph ? new TextGraph((s) => shownSet.has(s)) : null;
    commits.forEach((sha, i) => {
      const entry = this.commitHeader(r, sha, byCommit, oneline);
      const extra = this.commitPatch(r, sha, stat, patch);
      if (extra.length) entry.push(...(oneline ? [] : ['']), ...extra);
      if (!g) {
        if (i > 0 && !oneline) lines.push('');
        lines.push(...entry);
        return;
      }
      g.update(sha, r.commit(sha).parents);
      // The blank line between commits carries the graph too.
      if (i > 0 && !oneline) lines.push(g.paddingLine());
      for (;;) {
        const row = g.nextLine();
        if (row.commit) {
          lines.push(row.text + entry[0]);
          break;
        }
        lines.push(row.text);
      }
      for (const l of entry.slice(1)) lines.push(g.nextLine().text + l);
      // Rows still needed for this commit (merge edges, branches collapsing).
      while (!g.isCommitFinished()) lines.push(g.nextLine().text);
    });
    if (lines.length) this.out.add(lines.join('\n'));
    return 0;
  }

  private show(args: string[]): number {
    const r = this.repo();
    const { flags, pos } = parseArgs(args, ['--format', '--pretty']);
    const targets = pos.length ? pos : ['HEAD'];
    const out: string[] = [];
    const byCommit = r.refsByCommit();
    for (const t of targets) {
      const colon = /^([^:]*):(.+)$/.exec(t);
      if (colon) {
        const sha = this.rev(r, colon[1] || 'HEAD');
        const files = r.files(sha);
        let p = colon[2];
        if (p.startsWith('./')) p = this.toRepoPath(r, p) ?? p;
        const blob = files.get(p);
        if (!blob) {
          const inTree = [...files.keys()].some((f) => f.startsWith(p + '/'));
          if (inTree) {
            out.push(`tree ${t}`, '', ...[...new Set([...files.keys()].filter((f) => f.startsWith(p + '/')).map((f) => f.slice(p.length + 1).split('/')[0] + (f.slice(p.length + 1).includes('/') ? '/' : '')))].sort());
            continue;
          }
          throw new CliError(`fatal: path '${p}' does not exist in '${colon[1] || 'HEAD'}'`, 128);
        }
        out.push(...splitLines(r.objects.blob(blob)).map((l) => l.replace(/\n$/, '')));
        continue;
      }
      const sha = this.rev(r, t);
      const oneline = flags.has('--oneline');
      const stat = flags.has('--stat');
      if (out.length && !oneline) out.push('');
      out.push(...this.commitHeader(r, sha, byCommit, oneline));
      const patch = !stat && !flags.has('--no-patch') && !flags.has('-s');
      const extra = this.commitPatch(r, sha, stat, patch);
      if (extra.length) out.push(...(oneline ? [] : ['']), ...extra);
      // A merge's combined diff is empty when it had no conflicts to resolve: just its blank separator.
      else if (patch && r.commit(sha).parents.length > 1 && !oneline) out.push('');
    }
    if (out.length) this.out.add(out.join('\n'));
    return 0;
  }

  // ---------------------------------------------------------------- diff

  private patch(ch: FileChange[], sides: { a: Side; b: Side }): string[] {
    const out: string[] = [];
    for (const c of ch.sort((x, y) => (x.path < y.path ? -1 : 1))) {
      const from = c.from ?? c.path;
      const before = c.kind === 'new' ? '' : sides.a.read(from);
      const after = c.kind === 'deleted' ? '' : sides.b.read(c.path);
      out.push(`diff --git a/${from} b/${c.path}`);
      if (c.kind === 'new') out.push('new file mode 100644', `index ${ZERO}..${short(c.b!)}`);
      else if (c.kind === 'deleted') out.push('deleted file mode 100644', `index ${short(c.a!)}..${ZERO}`);
      else if (c.kind === 'renamed') {
        out.push('similarity index 100%', `rename from ${from}`, `rename to ${c.path}`);
        continue;
      } else out.push(`index ${short(c.a!)}..${short(c.b!)} 100644`);
      if (before === after) continue;
      out.push(c.kind === 'new' ? '--- /dev/null' : `--- a/${from}`, c.kind === 'deleted' ? '+++ /dev/null' : `+++ b/${c.path}`);
      out.push(...unifiedHunks(splitLines(before), splitLines(after)));
    }
    return out;
  }

  /** `git diff` of a file with conflicts: the "combined" diff against both sides. */
  private combinedDiff(r: Repo, p: string, u: Unmerged): string[] {
    const result = this.fs.read(`${r.root}/${p}`);
    if (result === undefined || !u.ours || !u.theirs) return [`* Unmerged path ${p}`];
    const R = splitLines(result);
    const parents = [u.ours, u.theirs].map((s) => splitLines(r.objects.blob(s)));
    const n = R.length;
    const added = parents.map(() => new Array<boolean>(n).fill(false));
    const lost: { text: string; mask: number }[][] = Array.from({ length: n + 1 }, () => []);
    parents.forEach((P, k) => {
      const mine: string[][] = Array.from({ length: n + 1 }, () => []);
      for (const c of diffLines(P, R)) {
        for (let j = 0; j < c.chg2; j++) added[k][c.i2 + j] = true;
        for (let j = 0; j < c.chg1; j++) mine[c.i2].push(P[c.i1 + j]);
      }
      // Merge this parent's lost lines into the shared list (lines lost from both are shown once).
      for (let at = 0; at <= n; at++) {
        if (!mine[at].length) continue;
        const cur = lost[at];
        const merged: { text: string; mask: number }[] = [];
        let x = 0;
        for (const line of mine[at]) {
          let y = x;
          while (y < cur.length && cur[y].text !== line) y++;
          if (y < cur.length) {
            merged.push(...cur.slice(x, y), { text: line, mask: cur[y].mask | (1 << k) });
            x = y + 1;
          } else merged.push({ text: line, mask: 1 << k });
        }
        merged.push(...cur.slice(x));
        lost[at] = merged;
      }
    });
    const interesting = (j: number) => (j < n && added.some((a) => a[j])) || lost[j].length > 0;
    const ranges: [number, number][] = [];
    for (let j = 0; j <= n; j++) {
      if (!interesting(j)) continue;
      const s = Math.max(0, j - 3);
      const e = Math.min(n, j + 4);
      const last = ranges[ranges.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else ranges.push([s, e]);
    }
    const out = [`diff --cc ${p}`, `index ${short(u.ours)},${short(u.theirs)}..${ZERO}`, `--- a/${p}`, `+++ b/${p}`];
    for (const [s, e] of ranges) {
      const counts = parents.map((_, k) => {
        let before = 0;
        let inside = 0;
        for (let j = 0; j <= n; j++) {
          const lostK = lost[j].filter((l) => l.mask & (1 << k)).length;
          const common = j < n && !added[k][j] ? 1 : 0;
          if (j < s) before += lostK + common;
          else if (j < e || (j === e && e === n)) inside += lostK + (j < e ? common : 0);
        }
        return `-${before + 1},${inside}`;
      });
      out.push(`@@@ ${counts.join(' ')} +${s + 1},${e - s} @@@`);
      const col = (mask: number, ch: string) => parents.map((_, k) => (mask & (1 << k) ? ch : ' ')).join('');
      for (let j = s; j <= e && j <= n; j++) {
        for (const l of lost[j]) out.push(col(l.mask, '-') + l.text.replace(/\n$/, ''));
        if (j < e && j < n) out.push(parents.map((_, k) => (added[k][j] ? '+' : ' ')).join('') + R[j].replace(/\n$/, ''));
      }
    }
    return out;
  }

  private diff(args: string[]): number {
    const r = this.repo();
    const { flags, pos, paths } = parseArgs(args);
    const staged = flags.has('--staged') || flags.has('--cached');
    const statOnly = flags.has('--stat');
    const nameOnly = flags.has('--name-only');
    const revs: string[] = [];
    const specs: string[] = [...(paths ?? [])];
    for (const p of pos) {
      const range = /^(.+?)\.\.(.+)$/.exec(p);
      if (range) revs.push(this.rev(r, range[1]), this.rev(r, range[2]));
      else if (r.resolve(p)) revs.push(r.resolve(p)!);
      else if (this.fs.exists(joinPath(this.u.cwd, p)) || r.index.has(this.toRepoPath(r, p) ?? '')) specs.push(p);
      else this.rev(r, p);
    }
    let a: Side;
    let b: Side;
    if (revs.length >= 2) {
      a = this.objSide(r, r.files(revs[0]));
      b = this.objSide(r, r.files(revs[1]));
    } else if (revs.length === 1) {
      a = this.objSide(r, r.files(revs[0]));
      b = staged ? this.objSide(r, r.index) : this.worktreeSide(r);
    } else if (staged) {
      a = this.objSide(r, r.files(r.headCommit()));
      b = this.objSide(r, r.index);
    } else {
      a = this.objSide(r, r.index);
      b = this.worktreeSide(r);
      // Only tracked files: untracked ones aren't part of the diff.
      for (const p of [...b.files.keys()]) if (!r.index.has(p) && !r.unmerged.has(p)) b.files.delete(p);
    }
    const rps = specs.map((s) => this.toRepoPath(r, s) ?? '\u0000');
    const keep = (p: string) => !rps.length || rps.some((s) => this.matches(s, p));
    let ch = this.changes(a.files, b.files).filter((c) => keep(c.path) || (c.from !== undefined && keep(c.from)));
    const out: string[] = [];
    const combined = !revs.length && !staged ? [...r.unmerged.entries()].filter(([p]) => keep(p)) : [];
    ch = ch.filter((c) => !r.unmerged.has(c.path));
    if (nameOnly) out.push(...[...ch.map((c) => c.path), ...combined.map(([p]) => p)].sort());
    else if (statOnly) {
      if (ch.length) out.push(...this.stat(ch, { a, b }, true, false));
    } else {
      const all: { path: string; lines: string[] }[] = [];
      for (const c of ch) all.push({ path: c.path, lines: this.patch([c], { a, b }) });
      for (const [p, u] of combined) all.push({ path: p, lines: this.combinedDiff(r, p, u) });
      all.sort((x, y) => (x.path < y.path ? -1 : 1));
      for (const x of all) out.push(...x.lines);
    }
    if (out.length) this.out.add(out.join('\n'));
    return flags.has('--exit-code') && out.length ? 1 : 0;
  }

  // ---------------------------------------------------------------- branches, switch, checkout

  private validBranchName(name: string): boolean {
    return !(!name || /[\s~^:?*[\\]|\.\.|@\{|^[-/.]|[/.]$|\.lock$|\/\//.test(name) || name === 'HEAD');
  }

  private branch(args: string[]): number {
    const r = this.repo();
    const { flags, pos } = parseArgs(args, ['--set-upstream-to', '-u']);
    const del = flags.has('-d') || flags.has('--delete');
    const force = flags.has('-D') || flags.has('-f') || flags.has('--force');
    const move = flags.has('-m') || flags.has('-M') || flags.has('--move');
    const up = flags.get('--set-upstream-to') ?? flags.get('-u');
    if (flags.has('--show-current')) {
      if (r.branch) this.out.add(r.branch);
      return 0;
    }
    if (up !== undefined) {
      const b = pos[0] ?? r.branch!;
      const m = /^([^/]+)\/(.+)$/.exec(up);
      if (!m || !r.refs.has(`refs/remotes/${up}`)) throw new CliError(`error: the requested upstream branch '${up}' does not exist\nhint: \nhint: If you are planning on basing your work on an upstream\nhint: branch that already exists at the remote, you may need to\nhint: run "git fetch" to retrieve it.\nhint: \nhint: If you are planning to push out a new local branch that\nhint: will track its remote counterpart, you may want to use\nhint: "git push -u" to set the upstream config as you push.\nhint: Disable this message with "git config set advice.setUpstreamFailure false"`, 1);
      r.setUpstream(b, m[1], m[2]);
      this.out.add(`branch '${b}' set up to track '${up}'.`);
      return 0;
    }
    if (flags.has('--unset-upstream')) {
      const b = pos[0] ?? r.branch!;
      r.config.delete(`branch.${b}.remote`);
      r.config.delete(`branch.${b}.merge`);
      return 0;
    }
    if (del || flags.has('-D')) {
      if (!pos.length) throw new CliError('fatal: branch name required', 128);
      let code = 0;
      for (const b of pos) {
        const ref = `refs/heads/${b}`;
        const sha = r.refs.get(ref);
        if (!sha) {
          this.out.err(`error: branch '${b}' not found`);
          code = 1;
          continue;
        }
        if (r.branch === b) {
          this.out.err(`error: cannot delete branch '${b}' used by worktree at '${r.root}'`);
          code = 1;
          continue;
        }
        if (!force) {
          const upstream = r.upstream(b);
          const target = (upstream && r.refs.get(`refs/remotes/${upstream.tracking}`)) || r.headCommit();
          if (!target || !r.isAncestor(sha, target)) {
            this.out.err(`error: the branch '${b}' is not fully merged\nhint: If you are sure you want to delete it, run 'git branch -D ${b}'\nhint: Disable this message with "git config set advice.forceDeleteBranch false"`);
            code = 1;
            continue;
          }
        }
        r.refs.delete(ref);
        for (const k of [...r.config.keys()]) if (k.startsWith(`branch.${b}.`)) r.config.delete(k);
        this.out.add(`Deleted branch ${b} (was ${short(sha)}).`);
      }
      return code;
    }
    if (move) {
      const [a, b] = pos.length === 1 ? [r.branch!, pos[0]] : pos;
      if (!this.validBranchName(b)) throw new CliError(`fatal: '${b}' is not a valid branch name`, 128);
      const sha = r.refs.get(`refs/heads/${a}`);
      if (!sha && r.branch !== a) throw new CliError(`error: refname refs/heads/${a} not found\nfatal: branch rename failed`, 128);
      if (r.refs.has(`refs/heads/${b}`) && !flags.has('-M') && a !== b) throw new CliError(`fatal: a branch named '${b}' already exists`, 128);
      if (sha) {
        r.refs.delete(`refs/heads/${a}`);
        r.refs.set(`refs/heads/${b}`, sha);
      }
      for (const k of [...r.config.keys()]) {
        if (k.startsWith(`branch.${a}.`)) {
          r.config.set(`branch.${b}.` + k.slice(`branch.${a}.`.length), r.config.get(k)!);
          r.config.delete(k);
        }
      }
      if (r.branch === a) r.head = { ref: `refs/heads/${b}` };
      return 0;
    }
    if (pos.length) {
      const [name, start] = pos;
      if (!this.validBranchName(name)) throw new CliError(`fatal: '${name}' is not a valid branch name\nhint: See 'git help check-ref-format'\nhint: Disable this message with "git config set advice.refSyntax false"`, 128);
      if (r.refs.has(`refs/heads/${name}`)) throw new CliError(`fatal: a branch named '${name}' already exists`, 128);
      const sha = start ? r.resolve(start) : r.headCommit();
      if (!sha) {
        if (start) throw new CliError(`fatal: not a valid object name: '${start}'`, 128);
        throw new CliError(`fatal: not a valid object name: '${r.branch}'`, 128);
      }
      r.refs.set(`refs/heads/${name}`, sha);
      if (start && r.refs.has(`refs/remotes/${start}`)) {
        const m = /^([^/]+)\/(.+)$/.exec(start)!;
        r.setUpstream(name, m[1], m[2]);
        this.out.add(`branch '${name}' set up to track '${start}'.`);
      }
      return 0;
    }
    const verbose = flags.has('-v') || flags.has('-vv') || flags.has('--verbose');
    const vv = args.includes('-vv');
    const showRemotes = flags.has('-r') || flags.has('--remotes');
    const showAll = flags.has('-a') || flags.has('--all');
    const rows: { mark: string; name: string; sha?: string; info?: string }[] = [];
    if (!showRemotes) {
      if (!r.branch && r.headCommit()) rows.push({ mark: '*', name: `(${this.detachedName(r)})`, sha: r.headCommit()! });
      for (const b of r.branches()) {
        const sha = r.refs.get(`refs/heads/${b}`)!;
        let info: string | undefined;
        if (vv) {
          const u = r.upstream(b);
          if (u) {
            const t = r.refs.get(`refs/remotes/${u.tracking}`);
            if (!t) info = `[${u.tracking}: gone]`;
            else {
              const [ah, be] = r.aheadBehind(sha, t);
              const parts = [ah ? `ahead ${ah}` : '', be ? `behind ${be}` : ''].filter(Boolean).join(', ');
              info = `[${u.tracking}${parts ? ': ' + parts : ''}]`;
            }
          }
        } else if (verbose) {
          const u = r.upstream(b);
          const t = u && r.refs.get(`refs/remotes/${u.tracking}`);
          if (u && t) {
            const [ah, be] = r.aheadBehind(sha, t);
            const parts = [ah ? `ahead ${ah}` : '', be ? `behind ${be}` : ''].filter(Boolean).join(', ');
            if (parts) info = `[${parts}]`;
          }
        }
        rows.push({ mark: r.branch === b ? '*' : ' ', name: b, sha, info });
      }
    }
    if (showRemotes || showAll) {
      const pre = showAll ? 'remotes/' : '';
      const remoteRefs = [...r.refs.keys(), ...r.symrefs.keys()].filter((k) => k.startsWith('refs/remotes/')).sort();
      for (const ref of remoteRefs) {
        const name = ref.slice(13);
        const sym = r.symrefs.get(ref);
        rows.push({ mark: ' ', name: `${pre}${name}${sym && !verbose ? ` -> ${sym.slice(13)}` : ''}`, sha: r.refs.get(sym ?? ref) });
      }
    }
    if (!rows.length) return 0;
    const w = Math.max(...rows.map((x) => x.name.length));
    const lines = rows.map((x) => {
      if (!verbose || !x.sha) return `${x.mark} ${x.name}`;
      const c = r.commit(x.sha);
      return `${x.mark} ${x.name.padEnd(w)} ${short(x.sha)} ${x.info ? x.info + ' ' : ''}${subject(c)}`;
    });
    this.out.add(lines.join('\n'));
    return 0;
  }

  /** Commits only reachable from a detached HEAD that a switch would leave behind. */
  private orphanWarning(r: Repo, target: string | null) {
    if (r.branch) return;
    const head = r.headCommit()!;
    const reachable = r.ancestors([...r.refs.values(), target]);
    const lost = [...r.ancestors([head])].filter((c) => !reachable.has(c));
    if (!lost.length) {
      this.out.err(`Previous HEAD position was ${short(head)} ${subject(r.commit(head))}`);
      return;
    }
    const ordered = this.walk(r, [head], [...r.refs.values(), ...(target ? [target] : [])], false);
    const n = ordered.length;
    const list = ordered.slice(0, n > 5 ? 4 : 5).map((c) => `  ${short(c)} ${subject(r.commit(c))}`);
    if (n > 5) list.push(` ... and ${n - 4} more.`);
    this.out.err(
      `Warning: you are leaving ${n} commit${n === 1 ? '' : 's'} behind, not connected to\nany of your branches:\n\n${list.join('\n')}\n\nIf you want to keep ${n === 1 ? 'it' : 'them'} by creating a new branch, this may be a good time\nto do so with:\n\n git branch <new-branch-name> ${short(head)}\n`,
    );
  }

  /** Moves the files to a branch or commit (HEAD is moved by the caller). Throws if local changes would be lost. */
  private moveTo(r: Repo, target: string | null): void {
    const from = r.files(r.headCommit());
    const to = r.files(target);
    const res = switchTrees(this.fs, r, from, to);
    if (res.dirty.length) {
      throw new CliError(`error: Your local changes to the following files would be overwritten by checkout:\n${res.dirty.map((p) => '\t' + p).join('\n')}\nPlease commit your changes or stash them before you switch branches.\nAborting`, 1);
    }
    if (res.untracked.length) {
      throw new CliError(`error: The following untracked working tree files would be overwritten by checkout:\n${res.untracked.map((p) => '\t' + p).join('\n')}\nPlease move or remove them before you switch branches.\nAborting`, 1);
    }
    if (res.removed.length) {
      throw new CliError(`error: The following untracked working tree files would be removed by checkout:\n${res.removed.map((p) => '\t' + p).join('\n')}\nPlease move or remove them before you switch branches.\nAborting`, 1);
    }
  }

  /** Local changes carried over by a switch ("M\tfile"), against the new HEAD. */
  private carried(r: Repo): string[] {
    const s = computeStatus(this.fs, r);
    const carried = new Map<string, string>();
    for (const x of s.staged) carried.set(x.path, x.kind === 'new file' ? 'A' : x.kind === 'deleted' ? 'D' : 'M');
    for (const x of s.unstaged) carried.set(x.path, x.kind === 'deleted' ? 'D' : 'M');
    return [...carried.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, k]) => `${k}\t${p}`);
  }

  private switchToBranch(r: Repo, b: string): number {
    if (r.branch === b) {
      r.previous = b;
      const carried = this.carried(r);
      if (carried.length) this.out.add(carried.join('\n'));
      this.out.err(`Already on '${b}'`);
      const up = this.upstreamInfo(r);
      if (up.length) this.out.add(up.join('\n'));
      return 0;
    }
    const target = r.refs.get(`refs/heads/${b}`) ?? null;
    this.moveTo(r, target);
    this.orphanWarning(r, target);
    r.previous = r.branch ?? r.headCommit() ?? undefined;
    r.head = { ref: `refs/heads/${b}` };
    r.detachedAt = undefined;
    const carried = this.carried(r);
    if (carried.length) this.out.add(carried.join('\n'));
    this.out.err(`Switched to branch '${b}'`);
    const up = this.upstreamInfo(r);
    if (up.length) this.out.add(up.join('\n'));
    return 0;
  }

  private createAndSwitch(r: Repo, name: string, start: string | undefined, verb: 'checkout' | 'switch', force = false): number {
    if (!this.validBranchName(name)) throw new CliError(`fatal: '${name}' is not a valid branch name\nhint: See 'git help check-ref-format'\nhint: Disable this message with "git config set advice.refSyntax false"`, 128);
    if (r.refs.has(`refs/heads/${name}`) && !force) throw new CliError(`fatal: a branch named '${name}' already exists`, 128);
    const sha = start ? r.resolve(start) : r.headCommit();
    if (start && !sha) throw new CliError(verb === 'switch' ? `fatal: invalid reference: ${start}` : `fatal: '${start}' is not a commit and a branch '${name}' cannot be created from it`, 128);
    if (sha) this.moveTo(r, sha);
    if (sha) this.orphanWarning(r, sha);
    if (sha) r.refs.set(`refs/heads/${name}`, sha);
    r.previous = r.branch ?? r.headCommit() ?? undefined;
    r.head = { ref: `refs/heads/${name}` };
    r.detachedAt = undefined;
    let tracking = '';
    if (start && r.refs.has(`refs/remotes/${start}`)) {
      const m = /^([^/]+)\/(.+)$/.exec(start)!;
      r.setUpstream(name, m[1], m[2]);
      tracking = `branch '${name}' set up to track '${start}'.`;
    }
    const carried = this.carried(r);
    if (carried.length) this.out.add(carried.join('\n'));
    if (tracking) this.out.add(tracking);
    this.out.err(`Switched to a new branch '${name}'`);
    return 0;
  }

  /** `git switch feature` when only origin/feature exists: create a tracking branch. */
  private remoteBranchFor(r: Repo, name: string): string | null {
    const hits = r.remotes().filter((rem) => r.refs.has(`refs/remotes/${rem}/${name}`));
    return hits.length === 1 ? `${hits[0]}/${name}` : null;
  }

  private detach(r: Repo, rev: string, sha: string): number {
    const prevSha = r.headCommit();
    this.moveTo(r, sha);
    this.orphanWarning(r, sha);
    const wasBranch = r.branch;
    r.previous = r.branch ?? r.headCommit() ?? undefined;
    r.head = { sha };
    const isRef = !!(r.refs.has(`refs/heads/${rev}`) || r.refs.has(`refs/remotes/${rev}`) || r.refs.has(`refs/tags/${rev}`) || r.symrefs.has(`refs/remotes/${rev}`));
    r.detachedAt = { name: isRef ? rev : short(sha), sha };
    const carried = this.carried(r);
    if (carried.length) this.out.add(carried.join('\n'));
    if (wasBranch || prevSha !== sha) {
      if (wasBranch && this.config(r, 'advice.detachedHead') !== 'false') {
        this.out.err(
          `Note: switching to '${rev}'.\n\nYou are in 'detached HEAD' state. You can look around, make experimental\nchanges and commit them, and you can discard any commits you make in this\nstate without impacting any branches by switching back to a branch.\n\nIf you want to create a new branch to retain commits you create, you may\ndo so (now or later) by using -c with the switch command. Example:\n\n  git switch -c <new-branch-name>\n\nOr undo this operation with:\n\n  git switch -\n\nTurn off this advice by setting config variable advice.detachedHead to false\n`,
        );
      }
      this.out.err(`HEAD is now at ${short(sha)} ${subject(r.commit(sha))}`);
    }
    return 0;
  }

  private switch(args: string[]): number {
    const r = this.repo();
    const { flags, pos } = parseArgs(args, ['-c', '-C', '--create']);
    if (r.op) throw new CliError(`fatal: cannot switch branch while ${r.op.kind === 'merge' ? 'merging' : 'reverting'}\nConsider "git ${r.op.kind} --quit" or "git worktree add".`, 128);
    const create = flags.get('-c') ?? flags.get('--create') ?? flags.get('-C');
    if (create !== undefined) return this.createAndSwitch(r, create, pos[0], 'switch', flags.has('-C'));
    let name = pos[0];
    if (!name) throw new CliError('fatal: missing branch or commit argument', 128);
    if (name === '-') {
      if (!r.previous) throw new CliError('fatal: invalid reference: @{-1}', 128);
      name = r.previous;
    }
    if (flags.has('--detach') || flags.has('-d')) {
      const sha = r.resolve(name);
      if (!sha) throw new CliError(`fatal: invalid reference: ${name}`, 128);
      return this.detach(r, name, sha);
    }
    if (r.refs.has(`refs/heads/${name}`) || (r.branch === name && !r.headCommit())) return this.switchToBranch(r, name);
    const remote = this.remoteBranchFor(r, name);
    if (remote) return this.createAndSwitch(r, name, remote, 'switch');
    const sha = r.resolve(name);
    if (sha) throw new CliError(`fatal: a branch is expected, got ${r.refs.has(`refs/remotes/${name}`) ? `remote branch '${name}'` : `commit '${name}'`}\nhint: If you want to detach HEAD at the commit, try again with the --detach option.\nhint: Disable this message with "git config set advice.suggestDetachingHead false"`, 128);
    throw new CliError(`fatal: invalid reference: ${name}`, 128);
  }

  private checkout(args: string[]): number {
    const r = this.repo();
    const { flags, pos, paths } = parseArgs(args, ['-b', '-B']);
    const create = flags.get('-b') ?? flags.get('-B');
    const switching = create !== undefined || (!paths && pos.length && (r.resolve(pos[0]) || this.remoteBranchFor(r, pos[0]) || pos[0] === '-'));
    if (switching && r.unmerged.size) throw new CliError(`error: you need to resolve your current index first\n${[...r.unmerged.keys()].sort().map((p) => `${p}: needs merge`).join('\n')}`, 1);
    if (create !== undefined) return this.createAndSwitch(r, create, pos[0], 'checkout', flags.has('-B'));
    // `git checkout -- file` / `git checkout file`: discard changes like `git restore`.
    const restorePaths = paths ?? (pos.length && !r.resolve(pos[0]) && !this.remoteBranchFor(r, pos[0]) && pos[0] !== '-' ? pos : null);
    if (restorePaths) {
      const source = paths && pos.length ? pos[0] : null;
      const rps = restorePaths.map((s) => this.toRepoPath(r, s) ?? '\u0000');
      const from = source ? r.files(this.rev(r, source)) : r.index;
      const hits = [...from.keys()].filter((p) => rps.some((s) => this.matches(s, p)));
      for (let i = 0; i < restorePaths.length; i++) {
        if (!hits.some((p) => this.matches(rps[i], p))) {
          this.out.err(`error: pathspec '${restorePaths[i]}' did not match any file(s) known to git`);
          return 1;
        }
      }
      for (const p of hits) {
        if (source) r.index.set(p, from.get(p)!);
        this.writeFile(r, p, r.objects.blob(from.get(p)!));
      }
      this.out.err(`Updated ${hits.length} path${hits.length === 1 ? '' : 's'} from ${source ? `${short(r.resolve(source)!)}` : 'the index'}`);
      return 0;
    }
    let name = pos[0];
    if (!name) return 0;
    if (name === '-') {
      if (!r.previous) throw new CliError("error: pathspec '-' did not match any file(s) known to git", 1);
      name = r.previous;
    }
    if (r.refs.has(`refs/heads/${name}`)) return this.switchToBranch(r, name);
    const remote = this.remoteBranchFor(r, name);
    if (remote) return this.createAndSwitch(r, name, remote, 'checkout');
    const sha = r.resolve(name);
    if (!sha) throw new CliError(`error: pathspec '${name}' did not match any file(s) known to git`, 1);
    return this.detach(r, name, sha);
  }

  // ---------------------------------------------------------------- merging

  /**
   * Applies a tree merge to the index and working tree. Returns false (and prints Git's error)
   * when local changes would be overwritten.
   */
  private applyMerge(r: Repo, m: TreeMerge, verb: 'merge' | 'revert'): boolean {
    const head = r.files(r.headCommit());
    // Target tree for the clean part: ours where conflicted.
    const target = new Map(m.files);
    for (const [p, c] of m.conflicts) if (c.ours) target.set(p, c.ours);
    const touched = new Set([...m.conflicts.keys(), ...[...new Set([...head.keys(), ...target.keys()])].filter((p) => head.get(p) !== target.get(p))]);
    const wt = worktreeFiles(this.fs, r);
    const dirty: string[] = [];
    const untracked: string[] = [];
    for (const p of touched) {
      const idx = r.index.get(p);
      const c = wt.get(p);
      if (idx !== head.get(p) || (c !== undefined && blobSha(c) !== idx && idx !== undefined)) dirty.push(p);
      else if (idx === undefined && c !== undefined && !head.has(p)) untracked.push(p);
    }
    if (dirty.length) {
      if (verb === 'revert') this.out.err('error: your local changes would be overwritten by revert.\nhint: commit your changes or stash them to proceed.\nfatal: revert failed');
      else this.out.err(`error: Your local changes to the following files would be overwritten by merge:\n${dirty.sort().map((p) => '\t' + p).join('\n')}\nPlease commit your changes or stash them before you merge.\nAborting`);
      return false;
    }
    if (untracked.length) {
      this.out.err(`error: The following untracked working tree files would be overwritten by ${verb}:\n${untracked.sort().map((p) => '\t' + p).join('\n')}\nPlease move or remove them before you ${verb}.\nAborting`);
      return false;
    }
    switchTrees(this.fs, r, head, target);
    for (const [p, c] of m.conflicts) {
      r.index.delete(p);
      r.unmerged.set(p, { base: c.base, ours: c.ours, theirs: c.theirs });
      if (c.text !== undefined) this.writeFile(r, p, c.text);
      else if (c.keep) this.writeFile(r, p, r.objects.blob(c.keep));
    }
    if (m.conflicts.size) this.emit({ type: 'conflict', repo: this.id(r), paths: [...m.conflicts.keys()] });
    return true;
  }

  /** "Merge branch 'x'", "Merge remote-tracking branch 'origin/x'", "… into dev". */
  private mergeMessage(r: Repo, name: string, url?: string): string {
    let msg: string;
    if (url) msg = `Merge branch '${name}' of ${url.replace(/\.git$/, '')}`;
    else if (r.refs.has(`refs/heads/${name}`)) msg = `Merge branch '${name}'`;
    else if (r.refs.has(`refs/remotes/${name}`)) msg = `Merge remote-tracking branch '${name}'`;
    else msg = `Merge commit '${name}'`;
    const dflt = this.config(r, 'init.defaultBranch') ?? 'master';
    if (r.branch && r.branch !== dflt) msg += ` into ${r.branch}`;
    return msg;
  }

  /** Merges commit `theirs` into HEAD. Shared by `git merge` and `git pull`. */
  doMerge(r: Repo, theirs: string, label: string, message: string, opts: { noFf?: boolean; ffOnly?: boolean; userMessage?: string } = {}): number {
    const head = r.headCommit();
    if (!head) {
      // Merging into an empty branch: just take theirs.
      switchTrees(this.fs, r, new Map(), r.files(theirs));
      r.moveHead(theirs);
      return 0;
    }
    if (r.isAncestor(theirs, head)) {
      this.out.add('Already up to date.');
      return 0;
    }
    if (r.isAncestor(head, theirs) && !opts.noFf) {
      this.out.add(`Updating ${short(head)}..${short(theirs)}`);
      const res = switchTrees(this.fs, r, r.files(head), r.files(theirs), true);
      if (res.dirty.length) {
        this.out.err(`error: Your local changes to the following files would be overwritten by merge:\n${res.dirty.map((p) => '\t' + p).join('\n')}\nPlease commit your changes or stash them before you merge.\nAborting`);
        return 1;
      }
      if (res.untracked.length) {
        this.out.err(`error: The following untracked working tree files would be overwritten by merge:\n${res.untracked.map((p) => '\t' + p).join('\n')}\nPlease move or remove them before you merge.\nAborting`);
        return 1;
      }
      switchTrees(this.fs, r, r.files(head), r.files(theirs));
      r.moveHead(theirs);
      this.out.add('Fast-forward');
      const a = r.files(head);
      const b = r.files(theirs);
      const ch = this.changes(a, b);
      if (ch.length) this.out.add(this.stat(ch, { a: this.objSide(r, a), b: this.objSide(r, b) }, true).join('\n'));
      return 0;
    }
    if (opts.ffOnly) throw new CliError('fatal: Not possible to fast-forward, aborting.', 128);
    const base = r.mergeBase(head, theirs);
    const m = mergeTrees(r, base, head, theirs, 'HEAD', label);
    const unmergedBefore = new Map(r.unmerged);
    if (!this.applyMerge(r, m, 'merge')) return 1;
    void unmergedBefore;
    if (m.messages.length) this.out.add(m.messages.join('\n'));
    if (m.conflicts.size) {
      r.op = { kind: 'merge', head: theirs, msg: `${opts.userMessage ?? message}\n\n# Conflicts:\n${[...m.conflicts.keys()].map((p) => `#\t${p}`).join('\n')}\n`, orig: head };
      this.out.add('Automatic merge failed; fix conflicts and then commit the result.');
      return 1;
    }
    const tree = r.objects.writeTree(m.files);
    const sha = this.makeCommit(r, tree, [head, theirs], cleanupMessage(opts.userMessage ?? message, false), 'merge');
    r.moveHead(sha);
    this.out.add("Merge made by the 'ort' strategy.");
    const a = r.files(head);
    const b = r.files(sha);
    const ch = this.changes(a, b);
    if (ch.length) this.out.add(this.stat(ch, { a: this.objSide(r, a), b: this.objSide(r, b) }, true).join('\n'));
    return 0;
  }

  private merge(args: string[]): number {
    const r = this.repo();
    const { flags, pos } = parseArgs(args, ['-m']);
    if (flags.has('--abort')) {
      if (r.op?.kind !== 'merge') throw new CliError('fatal: There is no merge to abort (MERGE_HEAD missing).', 128);
      this.abortOp(r);
      return 0;
    }
    if (flags.has('--continue')) {
      if (r.op?.kind !== 'merge') throw new CliError('fatal: There is no merge in progress (MERGE_HEAD missing).', 128);
      return this.commit([]);
    }
    if (r.op?.kind === 'merge') {
      if (r.unmerged.size) throw new CliError("error: Merging is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.", 128);
      throw new CliError('fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.', 128);
    }
    if (!pos.length) {
      const up = r.branch && r.upstream(r.branch);
      if (!up) throw new CliError('fatal: No remote for the current branch.', 128);
      pos.push(up.tracking);
    }
    const name = pos[0];
    const theirs = r.resolve(name);
    if (!theirs) throw new CliError(`merge: ${name} - not something we can merge`, 1);
    return this.doMerge(r, theirs, name, this.mergeMessage(r, name), { noFf: flags.has('--no-ff'), ffOnly: flags.has('--ff-only'), userMessage: flags.get('-m') });
  }

  private abortOp(r: Repo) {
    const orig = r.op!.orig;
    // Back to HEAD: the index and every file the operation touched (like `git reset --merge`).
    const head = r.files(orig);
    const touched = new Set([...r.unmerged.keys(), ...[...r.index.keys()].filter((p) => r.index.get(p) !== head.get(p)), ...[...head.keys()].filter((p) => !r.index.has(p))]);
    for (const p of touched) {
      const sha = head.get(p);
      r.unmerged.delete(p);
      if (sha) {
        r.index.set(p, sha);
        this.writeFile(r, p, r.objects.blob(sha));
      } else {
        r.index.delete(p);
        this.fs.remove(`${r.root}/${p}`);
        removeEmptyDirs(this.fs, r.root!, p);
      }
    }
    r.op = undefined;
  }

  private revert(args: string[]): number {
    const r = this.repo();
    const { flags, pos } = parseArgs(args, ['-m', '--mainline']);
    if (flags.has('--abort')) {
      if (r.op?.kind !== 'revert') throw new CliError('error: no cherry-pick or revert in progress\nfatal: revert failed', 128);
      this.abortOp(r);
      return 0;
    }
    if (flags.has('--skip')) {
      if (r.op?.kind !== 'revert') throw new CliError('error: no cherry-pick or revert in progress\nfatal: revert failed', 128);
      this.abortOp(r);
      return 0;
    }
    if (flags.has('--continue')) {
      if (r.op?.kind !== 'revert') throw new CliError('error: no cherry-pick or revert in progress\nfatal: revert failed', 128);
      if (r.unmerged.size) throw new CliError("error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.\nU\t" + [...r.unmerged.keys()][0] + '\nerror: commit is not possible because you have unmerged files.\nfatal: revert failed', 128);
      const head = r.headCommit()!;
      const msg = cleanupMessage(r.op.msg);
      const sha = this.makeCommit(r, this.indexTree(r), [head], msg, 'revert');
      r.moveHead(sha);
      r.op = undefined;
      this.commitSummary(r, sha, head, false);
      return 0;
    }
    if (r.op) throw new CliError(r.op.kind === 'revert' ? 'error: revert is already in progress\nhint: try "git revert (--continue | --abort | --quit)"\nfatal: revert failed' : 'error: Merging is not possible because you have unmerged files.', 128);
    if (!pos.length) throw new CliError('usage: git revert [--[no-]edit] [-n] [-m <parent-number>] [-s] [-S[<keyid>]] <commit>...\n   or: git revert (--continue | --skip | --abort | --quit)', 129);
    const target = r.resolve(pos[0]);
    if (!target) throw new CliError(`fatal: bad revision '${pos[0]}'`, 128);
    const c = r.commit(target);
    const mainline = Number(flags.get('-m') ?? flags.get('--mainline') ?? 0);
    if (c.parents.length > 1 && !mainline) throw new CliError(`error: commit ${target} is a merge but no -m option was given.\nfatal: revert failed`, 128);
    const parent = c.parents[mainline ? mainline - 1 : 0] ?? null;
    const head = r.headCommit()!;
    const label = `parent of ${short(target)} (${subject(c)})`;
    const m = mergeTrees(r, target, head, parent ?? target, 'HEAD', label);
    if (!parent) for (const p of r.files(target).keys()) m.files.delete(p);
    // Reverting a revert says "Reapply" (Git 2.43+).
    const sub = subject(c);
    const again = /^Revert "(.*)"$/.exec(sub);
    const msg = `${again ? `Reapply "${again[1]}"` : `Revert "${sub}"`}\n\nThis reverts commit ${target}${mainline ? `, reversing\nchanges made to ${c.parents[mainline - 1]}` : ''}.\n`;
    if (!this.applyMerge(r, m, 'revert')) return 128;
    if (m.conflicts.size) {
      if (m.messages.length) this.out.add(m.messages.join('\n'));
      r.op = { kind: 'revert', head: target, msg: msg + `\n# Conflicts:\n${[...m.conflicts.keys()].map((p) => `#\t${p}`).join('\n')}\n`, orig: head };
      this.out.err(`error: could not revert ${short(target)}... ${subject(c)}\nhint: After resolving the conflicts, mark them with\nhint: "git add/rm <pathspec>", then run\nhint: "git revert --continue".\nhint: You can instead skip this commit with "git revert --skip".\nhint: To abort and get back to the state before "git revert",\nhint: run "git revert --abort".\nhint: Disable this message with "git config set advice.mergeConflict false"`);
      return 1;
    }
    const tree = r.objects.writeTree(m.files);
    if (tree === r.commit(head).tree) {
      throw new CliError(`On branch ${r.branch}\nnothing to commit, working tree clean`, 1);
    }
    const sha = this.makeCommit(r, tree, [head], msg, 'revert');
    r.moveHead(sha);
    this.commitSummary(r, sha, head, false, true);
    return 0;
  }

  // ---------------------------------------------------------------- remotes

  private remote(args: string[]): number {
    const r = this.repo();
    const { flags, pos } = parseArgs(args);
    const [sub, ...rest] = pos;
    if (!sub) {
      const names = r.remotes();
      if (!names.length) return 0;
      if (flags.has('-v') || flags.has('--verbose')) {
        this.out.add(names.flatMap((n) => [`${n}\t${r.config.get(`remote.${n}.url`)} (fetch)`, `${n}\t${r.config.get(`remote.${n}.url`)} (push)`]).join('\n'));
      } else this.out.add(names.join('\n'));
      return 0;
    }
    if (sub === 'add') {
      const [name, url] = rest;
      if (!name || !url) throw new CliError('usage: git remote add [<options>] <name> <url>', 129);
      if (r.config.has(`remote.${name}.url`)) throw new CliError(`error: remote ${name} already exists.`, 3);
      r.config.set(`remote.${name}.url`, url);
      r.config.set(`remote.${name}.fetch`, `+refs/heads/*:refs/remotes/${name}/*`);
      return 0;
    }
    if (sub === 'remove' || sub === 'rm') {
      const [name] = rest;
      if (!r.config.has(`remote.${name}.url`)) throw new CliError(`error: No such remote: '${name}'`, 2);
      for (const k of [...r.config.keys()]) if (k.startsWith(`remote.${name}.`)) r.config.delete(k);
      for (const k of [...r.config.keys()]) if (/^branch\..*\.remote$/.test(k) && r.config.get(k) === name) {
        r.config.delete(k);
        r.config.delete(k.replace(/remote$/, 'merge'));
      }
      for (const ref of [...r.refs.keys()]) if (ref.startsWith(`refs/remotes/${name}/`)) r.refs.delete(ref);
      for (const ref of [...r.symrefs.keys()]) if (ref.startsWith(`refs/remotes/${name}/`)) r.symrefs.delete(ref);
      return 0;
    }
    if (sub === 'get-url') {
      const url = r.config.get(`remote.${rest[0]}.url`);
      if (!url) throw new CliError(`error: No such remote '${rest[0]}'`, 2);
      this.out.add(url);
      return 0;
    }
    if (sub === 'set-url') {
      const [name, url] = rest;
      if (!r.config.has(`remote.${name}.url`)) throw new CliError(`error: No such remote '${name}'`, 2);
      r.config.set(`remote.${name}.url`, url);
      return 0;
    }
    throw new CliError(`error: unknown subcommand: \`${sub}'`, 129);
  }

  private hubRepo(url: string): Repo | null {
    return this.m.hub.byUrl(url);
  }

  private clone(args: string[]): number {
    const { flags, pos } = parseArgs(args);
    const quiet = flags.has('-q') || flags.has('--quiet');
    const [url, dirArg] = pos;
    if (!url) throw new CliError('fatal: You must specify a repository to clone.\n\nusage: git clone [<options>] [--] <repo> [<dir>]', 129);
    const name = dirArg ?? basename(url.replace(/\/$/, '')).replace(/\.git$/, '');
    const dir = joinPath(this.u.cwd, name);
    if (this.fs.isFile(dir) || this.fs.list(dir).length) throw new CliError(`fatal: destination path '${name}' already exists and is not an empty directory.`, 128);
    const src = this.hubRepo(url);
    if (!quiet) this.out.err(`Cloning into '${name}'...`);
    if (!src) throw new CliError(`remote: Repository not found.\nfatal: repository '${url.replace(/\.git$/, '')}/' not found`, 128);
    this.fs.mkdirp(dir);
    const r = new Repo(dir);
    for (const [k, v] of [['core.repositoryformatversion', '0'], ['core.filemode', 'true'], ['core.bare', 'false'], ['core.logallrefupdates', 'true']]) r.config.set(k, v);
    r.config.set('remote.origin.url', url);
    r.config.set('remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    this.u.repos.set(dir, r);
    const tips = [...src.refs.entries()].filter(([k]) => k.startsWith('refs/heads/'));
    const objs = src.objects.reachable(tips.map(([, s]) => s));
    r.objects.copyFrom(src.objects, objs);
    for (const [k, s] of tips) r.refs.set(`refs/remotes/origin/${k.slice(11)}`, s);
    const headRef = 'ref' in src.head ? src.head.ref : 'refs/heads/main';
    const branch = headRef.slice(11);
    this.emit({ type: 'repo', repo: this.id(r), action: 'init' });
    this.emit({ type: 'transfer', kind: 'clone', from: this.m.hub.id(src), to: this.id(r), commits: [...objs].filter((s) => r.objects.get(s)?.type === 'commit') });
    if (!tips.length) {
      this.out.err('warning: You appear to have cloned an empty repository.');
      r.head = { ref: headRef };
      r.setUpstream(branch, 'origin', branch);
      return 0;
    }
    r.symrefs.set('refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`);
    const sha = src.refs.get(headRef)!;
    r.refs.set(headRef, sha);
    r.head = { ref: headRef };
    r.setUpstream(branch, 'origin', branch);
    switchTrees(this.fs, r, new Map(), r.files(sha));
    return 0;
  }

  /** Downloads a remote's branches; returns the "From …" report lines. */
  fetchRemote(r: Repo, remote: string): { lines: string[]; ok: boolean } {
    const url = r.config.get(`remote.${remote}.url`);
    if (!url) {
      return { lines: [`fatal: '${remote}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`], ok: false };
    }
    const src = this.hubRepo(url);
    if (!src) return { lines: [`remote: Repository not found.\nfatal: repository '${url.replace(/\.git$/, '')}/' not found`], ok: false };
    // The branch this one merges from comes first (Git marks it for FETCH_HEAD), then the rest by name.
    const up = r.branch ? r.upstream(r.branch) : null;
    const first = up?.remote === remote ? `refs/heads/${up.branch}` : '';
    const tips = [...src.refs.entries()].filter(([k]) => k.startsWith('refs/heads/')).sort(([a], [b]) => (a === first ? -1 : b === first ? 1 : a < b ? -1 : 1));
    const have = new Set(r.objects.objects.keys());
    const objs = src.objects.reachable(tips.map(([, s]) => s));
    const newCommits = [...objs].filter((s) => !have.has(s) && src.objects.get(s)?.type === 'commit');
    r.objects.copyFrom(src.objects, objs);
    const rows: [string, string, string][] = [];
    for (const [k, s] of tips) {
      const b = k.slice(11);
      const local = `refs/remotes/${remote}/${b}`;
      const old = r.refs.get(local);
      if (old === s) continue;
      r.refs.set(local, s);
      if (!old) rows.push([' * ', '[new branch]', b]);
      else if (r.isAncestor(old, s)) rows.push(['   ', `${short(old)}..${short(s)}`, b]);
      else rows.push([' + ', `${short(old)}...${short(s)}`, b]);
    }
    // Since Git 2.48 a fetch also creates origin/HEAD when it's missing.
    const headRef = 'ref' in src.head ? src.head.ref : null;
    if (headRef && src.refs.has(headRef) && !r.symrefs.has(`refs/remotes/${remote}/HEAD`)) r.symrefs.set(`refs/remotes/${remote}/HEAD`, `refs/remotes/${remote}/${headRef.slice(11)}`);
    if (newCommits.length) this.emit({ type: 'transfer', kind: 'fetch', from: this.m.hub.id(src), to: this.id(r), commits: newCommits });
    if (!rows.length) return { lines: [], ok: true };
    const w = Math.max(10, ...rows.map((x) => x[2].length));
    const lines = [`From ${url.replace(/\.git$/, '')}`];
    for (const [flag, summary, b] of rows) lines.push(`${flag}${summary.padEnd(17)} ${b.padEnd(w)} -> ${remote}/${b}${flag === ' + ' ? '  (forced update)' : ''}`);
    return { lines, ok: true };
  }

  private fetch(args: string[]): number {
    const r = this.repo();
    const { flags, pos } = parseArgs(args);
    const remotes = flags.has('--all') ? r.remotes() : [pos[0] ?? (r.branch && r.upstream(r.branch)?.remote) ?? 'origin'];
    if (!r.remotes().length && !pos.length) throw new CliError("fatal: No remote repository specified.  Please, specify either a URL or a\nremote name from which new revisions should be fetched.", 128);
    for (const rem of remotes) {
      const res = this.fetchRemote(r, rem);
      if (!res.ok) throw new CliError(res.lines.join('\n'), 128);
      if (res.lines.length && !flags.has('-q') && !flags.has('--quiet')) this.out.err(res.lines.join('\n'));
    }
    return 0;
  }

  private pull(args: string[]): number {
    const r = this.repo();
    const { flags, pos } = parseArgs(args);
    if (r.op?.kind === 'merge') {
      if (r.unmerged.size) throw new CliError("error: Pulling is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.", 128);
      throw new CliError('fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before merging.', 128);
    }
    const b = r.branch;
    let remote = pos[0];
    let remoteBranch = pos[1];
    if (!remote) {
      const up = b ? r.upstream(b) : null;
      if (!up) {
        if (!b) throw new CliError('You are not currently on a branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n', 1);
        throw new CliError(`There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=${r.remotes()[0] ?? 'origin'}/<branch> ${b}\n`, 1);
      }
      remote = up.remote;
      remoteBranch = up.branch;
    }
    const res = this.fetchRemote(r, remote);
    if (!res.ok) throw new CliError(res.lines.join('\n'), 1);
    const quiet = flags.has('-q') || flags.has('--quiet');
    if (res.lines.length && !quiet) this.out.err(res.lines.join('\n'));
    if (!remoteBranch) {
      const up = b ? r.upstream(b) : null;
      remoteBranch = up?.branch ?? '';
    }
    const theirs = r.refs.get(`refs/remotes/${remote}/${remoteBranch}`);
    if (!theirs) {
      if (!r.headCommit()) return 0;
      throw new CliError(`Your configuration specifies to merge with the ref 'refs/heads/${remoteBranch}'\nfrom the remote, but no such ref was fetched.`, 1);
    }
    const url = r.config.get(`remote.${remote}.url`)!;
    const mark = this.out.lines.length;
    const code = this.doMerge(r, theirs, theirs, this.mergeMessage(r, remoteBranch, url), { ffOnly: flags.has('--ff-only'), noFf: flags.has('--no-ff') });
    // -q: only problems are shown.
    if (quiet) this.out.lines = [...this.out.lines.slice(0, mark), ...this.out.lines.slice(mark).filter((l) => l.kind === 'err' || /^(CONFLICT|Automatic merge failed)/.test(l.text))];
    return code;
  }

  private push(args: string[]): number {
    const r = this.repo();
    const { flags, pos } = parseArgs(args);
    const setUp = flags.has('-u') || flags.has('--set-upstream');
    const force = flags.has('-f') || flags.has('--force');
    const del = flags.has('-d') || flags.has('--delete');
    const quiet = flags.has('-q') || flags.has('--quiet');
    const b = r.branch;
    let remote = pos[0];
    let specs = pos.slice(1);
    if (!remote) {
      if (!b) throw new CliError('fatal: You are not currently on a branch.\nTo push the history leading to the current (detached HEAD)\nstate now, use\n\n    git push origin HEAD:<name-of-remote-branch>\n', 128);
      const up = r.upstream(b);
      if (!up) {
        const names = r.remotes();
        if (!names.length) throw new CliError('fatal: No configured push destination.\nEither specify the URL from the command-line or configure a remote repository using\n\n    git remote add <name> <url>\n\nand then push using the remote name\n\n    git push <name>\n', 128);
        if (!setUp) throw new CliError(`fatal: The current branch ${b} has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream ${names[0]} ${b}\n\nTo have this happen automatically for branches without a tracking\nupstream, see 'push.autoSetupRemote' in 'git help config'.\n`, 128);
        remote = names[0];
      } else {
        remote = up.remote;
        if (up.branch !== b) throw new CliError(`fatal: The upstream branch of your current branch does not match\nthe name of your current branch.  To push to the upstream branch\non the remote, use\n\n    git push ${up.remote} HEAD:${up.branch}\n\nTo push to the branch of the same name on the remote, use\n\n    git push ${up.remote} HEAD\n\nTo choose either option permanently, see push.default in 'git help config'.\n\nTo avoid automatically configuring an upstream branch when its name\nwon't match the local branch, see option 'track' of branch.autoSetupMerge\nin 'git help config'.\n`, 128);
      }
    }
    const url = r.config.get(`remote.${remote}.url`);
    if (!url) throw new CliError(`fatal: '${remote}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`, 128);
    const dst = this.hubRepo(url);
    if (!dst) throw new CliError(`remote: Repository not found.\nfatal: repository '${url.replace(/\.git$/, '')}/' not found`, 128);
    if (!specs.length) {
      if (!b) throw new CliError('fatal: You are not currently on a branch.', 128);
      specs = [b];
    }
    interface Up {
      src: string;
      dst: string;
      sha: string | null;
    }
    const ups: Up[] = [];
    const rejected: ('fetch first' | 'non-fast-forward')[] = [];
    for (const s of specs) {
      const [from, to] = s.includes(':') ? s.split(':') : [s, s];
      if (del) {
        ups.push({ src: '(delete)', dst: from, sha: null });
        continue;
      }
      const srcName = from === 'HEAD' ? (b ?? 'HEAD') : from;
      const sha = r.resolve(from);
      if (!sha || (!r.refs.has(`refs/heads/${from}`) && from !== 'HEAD' && !/^[0-9a-f]{4,40}$/.test(from))) throw new CliError(`error: src refspec ${from} does not match any\nerror: failed to push some refs to '${url}'`, 1);
      ups.push({ src: srcName, dst: to === 'HEAD' ? (b ?? 'HEAD') : to, sha });
    }
    const rows: string[] = [];
    let failed = false;
    const remoteMsgs: string[] = [];
    const pushed: string[] = [];
    for (const u of ups) {
      const ref = `refs/heads/${u.dst}`;
      const old = dst.refs.get(ref) ?? null;
      if (u.sha === null) {
        if (!old) {
          rows.push(` ! [remote rejected] ${u.dst} (remote ref does not exist)`);
          failed = true;
          continue;
        }
        if (this.m.hub.isProtected(dst, u.dst) || ('ref' in dst.head && dst.head.ref === ref)) {
          rows.push(` ! [remote rejected] ${u.dst} (${this.m.hub.isProtected(dst, u.dst) ? 'protected branch hook declined' : 'refusing to delete the current branch: refs/heads/' + u.dst})`);
          failed = true;
          continue;
        }
        dst.refs.delete(ref);
        r.refs.delete(`refs/remotes/${remote}/${u.dst}`);
        rows.push(` - ${'[deleted]'.padEnd(17)} ${u.dst}`);
        this.m.hub.onPush(dst, u.dst, null);
        continue;
      }
      if (old === u.sha) continue;
      let forced = false;
      if (old && !(r.objects.has(old) && r.isAncestor(old, u.sha))) {
        if (!force) {
          const why = r.objects.has(old) ? 'non-fast-forward' : 'fetch first';
          rows.push(` ! ${'[rejected]'.padEnd(17)} ${u.src} -> ${u.dst} (${why})`);
          rejected.push(why);
          failed = true;
          continue;
        }
        forced = true;
      }
      const refusal = this.m.hub.refusePush(dst, u.dst, forced);
      if (refusal) {
        remoteMsgs.push(...refusal.map((l) => `remote: ${l}`));
        rows.push(` ! [remote rejected] ${u.src} -> ${u.dst} (protected branch hook declined)`);
        failed = true;
        continue;
      }
      const objs = r.objects.reachable([u.sha], new Set(dst.objects.objects.keys()));
      const commits = [...objs].filter((s) => r.objects.get(s)?.type === 'commit');
      dst.objects.copyFrom(r.objects, objs);
      dst.refs.set(ref, u.sha);
      r.refs.set(`refs/remotes/${remote}/${u.dst}`, u.sha);
      if (commits.length || !old) pushed.push(...commits);
      if (!old) rows.push(` * ${'[new branch]'.padEnd(17)} ${u.src} -> ${u.dst}`);
      else if (forced) rows.push(` + ${`${short(old)}...${short(u.sha)}`.padEnd(17)} ${u.src} -> ${u.dst} (forced update)`);
      else rows.push(`   ${`${short(old)}..${short(u.sha)}`.padEnd(17)} ${u.src} -> ${u.dst}`);
      this.m.hub.onPush(dst, u.dst, u.sha);
    }
    if (pushed.length) this.emit({ type: 'transfer', kind: 'push', from: this.id(r), to: this.m.hub.id(dst), commits: pushed });
    if (!rows.length) {
      this.out.err('Everything up-to-date');
    } else if (!quiet || failed) {
      if (remoteMsgs.length) this.out.err(remoteMsgs.join('\n'));
      this.out.err(`To ${url}\n${rows.join('\n')}`);
    }
    if (failed) {
      this.out.err(`error: failed to push some refs to '${url}'`);
      if (rejected.includes('fetch first'))
        this.out.err("hint: Updates were rejected because the remote contains work that you do not\nhint: have locally. This is usually caused by another repository pushing to\nhint: the same ref. If you want to integrate the remote changes, use\nhint: 'git pull' before pushing again.\nhint: See the 'Note about fast-forwards' in 'git push --help' for details.");
      else if (rejected.includes('non-fast-forward'))
        this.out.err(`hint: Updates were rejected because the tip of your current branch is behind\nhint: its remote counterpart. If you want to integrate the remote changes,\nhint: use 'git pull' before pushing again.\nhint: See the 'Note about fast-forwards' in 'git push --help' for details.`);
      return 1;
    }
    if (setUp) {
      for (const u of ups) {
        if (!u.sha || !r.refs.has(`refs/heads/${u.src}`)) continue;
        r.setUpstream(u.src, remote, u.dst);
        this.out.add(`branch '${u.src}' set up to track '${remote}/${u.dst}'.`);
      }
    }
    return 0;
  }
}

export { dirname, normalizePath, unmergedHow };
export type { Status, Commit };
