/**
 * A simulated computer for the Git course: a bash-like shell with a few file
 * commands, `git`, `gh`, the learner's files and repositories, a teammate (Sam)
 * with their own machine, and the shared hub. Deterministic: the clock moves
 * 60 seconds per command, as in the golden recordings (scripts/record-git-golden.mjs).
 */
import { FileSystem, basename, dirname, joinPath, normalizePath } from './fs';
import { GitCli } from './git';
import { GhCli, Hub } from './hub';
import type { Repo } from './repo';
import { CliError, Out, type ExecResult, type GitEvent } from './types';

/** Mon Jan 5 2026 09:00:00 UTC, in seconds. */
export const START = 1767603600;

export interface User {
  id: string;
  home: string;
  cwd: string;
  fs: FileSystem;
  /** Repositories by worktree folder. */
  repos: Map<string, Repo>;
  /** ~/.gitconfig */
  global: Map<string, string>;
}

export interface MachineOptions {
  startTime?: number;
  /** Set user.name/user.email for the learner (default true). */
  identity?: boolean;
}

const PEOPLE: Record<string, [string, string]> = {
  learner: ['Alex Learner', 'alex@example.com'],
  sam: ['Sam Rivera', 'sam@example.com'],
};

const EDITORS = ['nano', 'vim', 'vi', 'emacs', 'code', 'pico', 'ed'];
const GIT_DIR_ENTRIES = ['COMMIT_EDITMSG', 'HEAD', 'config', 'description', 'hooks', 'index', 'info', 'logs', 'objects', 'refs'];

interface Word {
  text: string;
  /** Unquoted * or ? present: expand against the files. */
  glob: boolean;
}

interface Cmd {
  words: Word[];
  out?: { file: string; append: boolean };
  errToNull?: boolean;
  heredoc?: { delim: string };
  stdinFile?: string;
}

interface Chain {
  pipeline: Cmd[];
  /** How this pipeline connects to the next one. */
  op: '&&' | '||' | ';' | null;
}

/** Splits a command line into pipelines of commands, with quotes, redirections and here-documents. */
function parseLine(line: string, env: (name: string) => string): Chain[] {
  const chains: Chain[] = [];
  let pipeline: Cmd[] = [];
  let cmd: Cmd = { words: [] };
  let word = '';
  let has = false;
  let glob = false;
  let pending: 'out' | 'append' | 'heredoc' | 'in' | 'err' | null = null;
  const flushWord = () => {
    if (!has) return;
    const w = { text: word, glob };
    if (pending === 'out' || pending === 'append') cmd.out = { file: w.text, append: pending === 'append' };
    else if (pending === 'heredoc') cmd.heredoc = { delim: w.text };
    else if (pending === 'in') cmd.stdinFile = w.text;
    else if (pending === 'err') cmd.errToNull = w.text === '/dev/null';
    else cmd.words.push(w);
    pending = null;
    word = '';
    has = false;
    glob = false;
  };
  const endCmd = () => {
    flushWord();
    pipeline.push(cmd);
    cmd = { words: [] };
  };
  const endChain = (op: Chain['op']) => {
    endCmd();
    chains.push({ pipeline, op });
    pipeline = [];
  };
  let q: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q === "'") {
      if (ch === "'") q = null;
      else word += ch;
      continue;
    }
    if (q === '"') {
      if (ch === '"') q = null;
      else if (ch === '\\' && '$`"\\'.includes(line[i + 1] ?? '')) word += line[++i];
      else if (ch === '$') {
        const m = /^(?:\{(\w+)\}|([A-Za-z_]\w*))/.exec(line.slice(i + 1));
        if (m) {
          word += env(m[1] ?? m[2]);
          i += m[0].length;
        } else word += ch;
      } else word += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      has = true;
      continue;
    }
    if (ch === '\\' && i + 1 < line.length) {
      word += line[++i];
      has = true;
      continue;
    }
    if (ch === '$') {
      const m = /^(?:\{(\w+)\}|([A-Za-z_]\w*))/.exec(line.slice(i + 1));
      if (m) {
        word += env(m[1] ?? m[2]);
        i += m[0].length;
        has = true;
        continue;
      }
    }
    if (ch === '~' && !has && (line[i + 1] === undefined || line[i + 1] === '/' || /\s/.test(line[i + 1]))) {
      word += env('HOME');
      has = true;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      endChain(two);
      i++;
      continue;
    }
    if (line.startsWith('2>&1', i)) {
      flushWord();
      i += 3;
      continue;
    }
    if (two === '2>') {
      flushWord();
      pending = 'err';
      i++;
      continue;
    }
    if (two === '>>') {
      flushWord();
      pending = 'append';
      i++;
      continue;
    }
    if (two === '<<') {
      flushWord();
      pending = 'heredoc';
      i++;
      if (line[i + 1] === '-') i++;
      continue;
    }
    if (ch === '>' || ch === '<') {
      flushWord();
      pending = ch === '>' ? 'out' : 'in';
      continue;
    }
    if (ch === '|') {
      endCmd();
      continue;
    }
    if (ch === ';') {
      endChain(';');
      continue;
    }
    if (ch === '#' && !has) break;
    if (/\s/.test(ch)) {
      flushWord();
      continue;
    }
    if (ch === '*' || ch === '?') glob = true;
    word += ch;
    has = true;
  }
  if (q) throw new CliError(`bash: unexpected EOF while looking for matching \`${q}'`, 2);
  endChain(null);
  return chains.filter((c) => c.pipeline.some((x) => x.words.length || x.out));
}

export class GitMachine {
  t: number;
  users = new Map<string, User>();
  hub = new Hub();
  /** Events of the command being run (then returned with its result). */
  events: GitEvent[] = [];
  /** Every line run, for checking answers. */
  journal: string[] = [];

  constructor(opts: MachineOptions = {}) {
    this.t = opts.startTime ?? START;
    for (const id of Object.keys(PEOPLE)) this.addUser(id, id !== 'learner' || opts.identity !== false);
  }

  addUser(id: string, identity = true): User {
    const home = `/home/${id}`;
    const fs = new FileSystem();
    fs.mkdirp(home);
    const global = new Map<string, string>();
    if (identity) {
      global.set('user.name', PEOPLE[id]?.[0] ?? id);
      global.set('user.email', PEOPLE[id]?.[1] ?? `${id}@example.com`);
    }
    global.set('init.defaultBranch', 'main');
    global.set('pull.rebase', 'false');
    const u: User = { id, home, cwd: home, fs, repos: new Map(), global };
    this.users.set(id, u);
    return u;
  }

  get learner(): User {
    return this.users.get('learner')!;
  }

  identity(u: User, key: string): string | undefined {
    const r = this.repoAt(u);
    for (const m of [r?.config, u.global]) {
      if (!m) continue;
      for (const [k, v] of m) if (k.toLowerCase() === key.toLowerCase()) return v;
    }
    return undefined;
  }

  repoId(u: User, r: Repo): string {
    return `${u.id}:${r.root}`;
  }

  /** The repository the user's current folder is in. */
  repoAt(u: User): Repo | null {
    let best: Repo | null = null;
    for (const [root, r] of u.repos) if ((u.cwd === root || u.cwd.startsWith(root + '/')) && (!best || root.length > best.root!.length)) best = r;
    return best;
  }

  /** Runs git as a user (used by gh). */
  git(u: User, args: string[], out: Out): number {
    try {
      return new GitCli(this, u, out).run(args);
    } catch (e) {
      if (e instanceof CliError) {
        out.err(e.text);
        return e.code;
      }
      throw e;
    }
  }

  /** All refs and HEADs (to report what a command moved). */
  private snapshot(): Map<string, { refs: Map<string, string>; head: string | null; branch: string | null; repo: Repo }> {
    const s = new Map<string, { refs: Map<string, string>; head: string | null; branch: string | null; repo: Repo }>();
    for (const u of this.users.values()) for (const r of u.repos.values()) s.set(this.repoId(u, r), { refs: new Map(r.refs), head: r.headCommit(), branch: r.branch, repo: r });
    for (const r of this.hub.repos.values()) s.set(this.hub.id(r), { refs: new Map(r.refs), head: r.headCommit(), branch: r.branch, repo: r });
    return s;
  }

  private refEvents(before: ReturnType<GitMachine['snapshot']>, after: ReturnType<GitMachine['snapshot']>): GitEvent[] {
    const out: GitEvent[] = [];
    for (const [id, a] of after) {
      const b = before.get(id);
      const old = b?.refs ?? new Map<string, string>();
      for (const ref of [...new Set([...old.keys(), ...a.refs.keys()])].sort()) {
        const from = old.get(ref) ?? null;
        const to = a.refs.get(ref) ?? null;
        if (from === to) continue;
        out.push({ type: 'ref', repo: id, ref, from, to, fastForward: !!(from && to && a.repo.objects.has(from) && a.repo.isAncestor(from, to)) });
      }
      // HEAD moving with its branch is already the ref event; report switches and detached moves.
      if (b && (b.branch !== a.branch || (!a.branch && b.head !== a.head))) out.push({ type: 'head', repo: id, from: b.head, to: a.head, branch: a.branch });
    }
    return out;
  }

  /** Runs one line typed in the terminal. Lines starting with "@sam " run as the teammate; "@hub …" sets up the hub. */
  exec(input: string, as = 'learner'): ExecResult {
    this.t += 60;
    let line = input;
    let user = this.users.get(as)!;
    const out = new Out();
    const prefix = /^@(\w+) ([\s\S]*)$/.exec(line);
    if (prefix) {
      if (prefix[1] === 'hub') return this.hubAdmin(prefix[2]);
      user = this.users.get(prefix[1]) ?? this.addUser(prefix[1]);
      line = prefix[2];
    }
    const trimmed = line.trim();
    if (!trimmed) return { lines: [], exitCode: 0, events: [] };
    this.journal.push(prefix ? input.trim() : trimmed);
    this.events = [];
    const before = this.snapshot();
    let code: number;
    try {
      code = this.runShell(user, trimmed, out);
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      out.err(e.text);
      code = e.code;
    }
    const events = [...this.events.filter((e) => e.type !== 'ref' && e.type !== 'head'), ...this.refEvents(before, this.snapshot())];
    this.events = [];
    return { lines: out.lines, exitCode: code, events };
  }

  /** Setup commands for the hub: `init team/shop`, `protect team/shop main [--require-approval]`. */
  private hubAdmin(cmd: string): ExecResult {
    const [verb, name, branch, ...flags] = cmd.trim().split(/\s+/);
    const out = new Out();
    if (verb === 'init' && name) {
      this.hub.create(name);
      return { lines: [], exitCode: 0, events: [{ type: 'repo', repo: `hub:${name}`, action: 'init' }] };
    }
    if (verb === 'protect' && name && branch) {
      this.hub.protect(name, branch, { requireApproval: flags.includes('--require-approval') });
      return { lines: [], exitCode: 0, events: [] };
    }
    out.err(`hub: unknown setup command: ${cmd}`);
    return { lines: out.lines, exitCode: 1, events: [] };
  }

  // ---------------------------------------------------------------- the shell

  private env(u: User): (name: string) => string {
    return (name) => ({ HOME: u.home, USER: u.id, PWD: u.cwd, SHELL: '/bin/bash' })[name] ?? '';
  }

  private runShell(u: User, text: string, out: Out): number {
    const [first, ...rest] = text.split('\n');
    const chains = parseLine(first, this.env(u));
    // Here-documents: the body is on the lines after the command.
    let bodyLines = rest;
    for (const c of chains) {
      for (const cmd of c.pipeline) {
        if (!cmd.heredoc) continue;
        const end = bodyLines.findIndex((l) => l === cmd.heredoc!.delim);
        const body = end < 0 ? bodyLines : bodyLines.slice(0, end);
        (cmd as Cmd & { stdin?: string }).stdin = body.length ? body.join('\n') + '\n' : '';
        bodyLines = end < 0 ? [] : bodyLines.slice(end + 1);
      }
    }
    let code = 0;
    let skip = false;
    for (const c of chains) {
      if (!skip) code = this.runPipeline(u, c.pipeline, out);
      if (c.op === '&&') skip = skip || code !== 0;
      else if (c.op === '||') skip = !skip && code === 0;
      else skip = false;
    }
    return code;
  }

  private expand(u: User, words: Word[]): string[] {
    const out: string[] = [];
    for (const w of words) {
      if (!w.glob) {
        out.push(w.text);
        continue;
      }
      const dirPart = w.text.includes('/') ? w.text.slice(0, w.text.lastIndexOf('/') + 1) : '';
      const pat = w.text.slice(dirPart.length);
      const dir = joinPath(u.cwd, dirPart || '.');
      const re = new RegExp('^' + pat.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      const hits = this.listDir(u, dir, pat.startsWith('.')).filter((n) => re.test(n) && n !== '.' && n !== '..');
      if (hits.length) out.push(...hits.map((h) => dirPart + h));
      else out.push(w.text);
    }
    return out;
  }

  private runPipeline(u: User, cmds: Cmd[], out: Out): number {
    let input: string | undefined;
    let code = 0;
    cmds.forEach((cmd, k) => {
      const last = k === cmds.length - 1;
      const buf = new Out();
      const args = this.expand(u, cmd.words);
      let stdin = (cmd as Cmd & { stdin?: string }).stdin ?? input;
      if (cmd.stdinFile) {
        const p = joinPath(u.cwd, cmd.stdinFile);
        stdin = u.fs.read(p);
        if (stdin === undefined) {
          buf.err(`bash: ${cmd.stdinFile}: No such file or directory`);
          code = 1;
        }
      }
      if (code === 0 || !cmd.stdinFile) {
        try {
          code = args.length ? this.runCommand(u, args, stdin, buf) : 0;
        } catch (e) {
          if (!(e instanceof CliError)) throw e;
          buf.err(e.text);
          code = e.code;
        }
      }
      const stdout = buf.lines.filter((l) => l.kind !== 'err');
      const stderr = buf.lines.filter((l) => l.kind === 'err');
      if (!cmd.errToNull) for (const l of stderr) out.lines.push(l);
      const text = stdout.map((l) => l.text + (l.noNewline ? '' : '\n')).join('');
      if (cmd.out) {
        const p = joinPath(u.cwd, cmd.out.file);
        if (cmd.out.file === '/dev/null') return;
        if (this.inGitDir(u, p) !== null || u.fs.isDir(p)) {
          out.err(`bash: ${cmd.out.file}: ${u.fs.isDir(p) ? 'Is a directory' : 'Permission denied'}`);
          code = 1;
          return;
        }
        if (!u.fs.isDir(dirname(p))) {
          out.err(`bash: ${cmd.out.file}: No such file or directory`);
          code = 1;
          return;
        }
        u.fs.write(p, (cmd.out.append ? (u.fs.read(p) ?? '') : '') + text);
        input = '';
      } else if (last) for (const l of stdout) out.lines.push(l);
      else input = text;
    });
    return code;
  }

  /** If a path is inside a repository's .git folder: the repo and the path inside it. */
  private inGitDir(u: User, p: string): { repo: Repo; rest: string } | null {
    for (const [root, r] of u.repos) {
      const g = root === '/' ? '/.git' : `${root}/.git`;
      if (p === g) return { repo: r, rest: '' };
      if (p.startsWith(g + '/')) return { repo: r, rest: p.slice(g.length + 1) };
    }
    return null;
  }

  private listDir(u: User, dir: string, all: boolean): string[] {
    const g = this.inGitDir(u, dir);
    if (g) {
      if (g.rest === '') return GIT_DIR_ENTRIES;
      if (g.rest === 'refs') return ['heads', 'remotes', 'tags'].filter((x) => x !== 'remotes' || g.repo.remotes().length);
      if (g.rest === 'refs/heads') return g.repo.branches();
      return [];
    }
    const names = u.fs.list(dir);
    if (u.repos.has(dir)) names.push('.git');
    return names.filter((n) => all || !n.startsWith('.')).sort((a, b) => a.replace(/^\./, '').localeCompare(b.replace(/^\./, ''), 'en'));
  }

  private gitFile(g: { repo: Repo; rest: string }): string | undefined {
    const r = g.repo;
    if (g.rest === 'HEAD') return 'ref' in r.head ? `ref: ${r.head.ref}\n` : `${r.head.sha}\n`;
    if (g.rest.startsWith('refs/')) {
      const sha = r.refs.get(g.rest);
      return sha ? sha + '\n' : undefined;
    }
    if (g.rest === 'config') {
      const sections = new Map<string, string[]>();
      for (const [k, v] of r.config) {
        const m = /^(\w+)\.(?:(.+)\.)?([^.]+)$/.exec(k);
        if (!m) continue;
        const sec = m[2] ? `[${m[1]} "${m[2]}"]` : `[${m[1]}]`;
        if (!sections.has(sec)) sections.set(sec, []);
        sections.get(sec)!.push(`\t${m[3]} = ${v}`);
      }
      return [...sections].map(([s, l]) => [s, ...l].join('\n')).join('\n') + '\n';
    }
    if (g.rest === 'description') return "Unnamed repository; edit this file 'description' to name the repository.\n";
    return undefined;
  }

  private exists(u: User, p: string): 'file' | 'dir' | null {
    const g = this.inGitDir(u, p);
    if (g) return g.rest === '' || ['refs', 'refs/heads', 'refs/tags', 'refs/remotes', 'objects', 'hooks', 'info', 'logs'].includes(g.rest) ? 'dir' : this.gitFile(g) !== undefined ? 'file' : null;
    if (u.fs.isFile(p)) return 'file';
    if (u.fs.isDir(p)) return 'dir';
    return null;
  }

  private read(u: User, p: string): string | undefined {
    const g = this.inGitDir(u, p);
    if (g) return this.gitFile(g);
    return u.fs.read(p);
  }

  /** `ls` output: names in columns that fit 80 characters, like a terminal. */
  private columns(names: string[]): string[] {
    if (!names.length) return [];
    for (let cols = names.length; cols >= 1; cols--) {
      const rows = Math.ceil(names.length / cols);
      const widths: number[] = [];
      for (let c = 0; c < cols; c++) widths.push(Math.max(0, ...names.slice(c * rows, (c + 1) * rows).map((n) => n.length)));
      const total = widths.reduce((a, b) => a + b, 0) + 2 * (cols - 1);
      if (total <= 80 || cols === 1) {
        const lines: string[] = [];
        for (let r = 0; r < rows; r++) {
          const cells: string[] = [];
          for (let c = 0; c < cols; c++) {
            const n = names[c * rows + r];
            if (n !== undefined) cells.push(c === cols - 1 || names[(c + 1) * rows + r] === undefined ? n : n.padEnd(widths[c] + 2));
          }
          lines.push(cells.join(''));
        }
        return lines;
      }
    }
    return names;
  }

  private runCommand(u: User, args: string[], stdin: string | undefined, out: Out): number {
    const [cmd, ...rest] = args;
    const path = (p: string) => joinPath(u.cwd, p);
    const write = (text: string) => {
      if (!text) return;
      out.add(text.endsWith('\n') ? text.slice(0, -1) : text);
    };
    switch (cmd) {
      case 'git':
        return new GitCli(this, u, out).run(rest);
      case 'gh':
        return new GhCli(this, u, out).run(rest);
      case 'echo': {
        let nl = true;
        let esc = false;
        let words = rest;
        while (words[0] && /^-[neE]+$/.test(words[0])) {
          if (words[0].includes('n')) nl = false;
          if (words[0].includes('e')) esc = true;
          words = words.slice(1);
        }
        let s = words.join(' ');
        if (esc) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
        if (nl) out.add(s);
        else if (s) out.add(s);
        if (!nl) out.lines[out.lines.length - 1].noNewline = true;
        return 0;
      }
      case 'printf': {
        const [fmt = '', ...vals] = rest;
        const unescape = (s: string) => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
        let res = '';
        let i = 0;
        do {
          res += unescape(fmt).replace(/%[sd%]/g, (m) => (m === '%%' ? '%' : (vals[i++] ?? '')));
        } while (i < vals.length && /%[sd]/.test(fmt));
        if (res) {
          out.add(res.endsWith('\n') ? res.slice(0, -1) : res);
          if (!res.endsWith('\n')) out.lines[out.lines.length - 1].noNewline = true;
        }
        return 0;
      }
      case 'cat': {
        if (!rest.length) {
          write(stdin ?? '');
          return 0;
        }
        let code = 0;
        let text = '';
        for (const f of rest) {
          const p = path(f);
          const kind = this.exists(u, p);
          if (kind === 'dir') {
            out.err(`cat: ${f}: Is a directory`);
            code = 1;
          } else if (!kind) {
            out.err(`cat: ${f}: No such file or directory`);
            code = 1;
          } else text += this.read(u, p) ?? '';
        }
        if (text) {
          out.add(text.endsWith('\n') ? text.slice(0, -1) : text);
          if (!text.endsWith('\n')) out.lines[out.lines.length - 1].noNewline = true;
        }
        return code;
      }
      case 'ls': {
        const flags = rest.filter((a) => a.startsWith('-')).join('');
        const all = flags.includes('a');
        const almost = flags.includes('A');
        const one = flags.includes('1') || flags.includes('l');
        const targets = rest.filter((a) => !a.startsWith('-'));
        let code = 0;
        const blocks: string[][] = [];
        const files: string[] = [];
        for (const t of targets.length ? targets : ['.']) {
          const p = path(t);
          const kind = this.exists(u, p);
          if (!kind) {
            out.err(`ls: cannot access '${t}': No such file or directory`);
            code = 2;
          } else if (kind === 'file') files.push(t);
          else {
            let names = this.listDir(u, p, all || almost);
            if (all) names = ['.', '..', ...names];
            blocks.push([t, ...names]);
          }
        }
        const lines: string[] = [];
        const fmt = (names: string[]) => (one ? names : this.columns(names));
        if (files.length) lines.push(...fmt(files));
        for (const [t, ...names] of blocks) {
          if (targets.length > 1) {
            if (lines.length) lines.push('');
            lines.push(`${t}:`);
          }
          lines.push(...fmt(names));
        }
        if (lines.length) out.add(lines.join('\n'));
        return code;
      }
      case 'pwd':
        out.add(u.cwd);
        return 0;
      case 'cd': {
        const target = rest[0] === undefined ? u.home : rest[0] === '-' ? u.cwd : path(rest[0]);
        const kind = this.exists(u, target);
        if (!kind) throw new CliError(`bash: cd: ${rest[0]}: No such file or directory`, 1);
        if (kind === 'file') throw new CliError(`bash: cd: ${rest[0]}: Not a directory`, 1);
        if (this.inGitDir(u, target)) throw new CliError(`bash: cd: ${rest[0]}: this simulator doesn't let you go inside .git (use ls and cat to look)`, 1);
        u.cwd = target;
        return 0;
      }
      case 'mkdir': {
        const parents = rest.includes('-p');
        let code = 0;
        for (const d of rest.filter((a) => !a.startsWith('-'))) {
          const p = path(d);
          if (this.exists(u, p)) {
            if (!parents) {
              out.err(`mkdir: cannot create directory '${d}': File exists`);
              code = 1;
            }
            continue;
          }
          if (!parents && !u.fs.isDir(dirname(p))) {
            out.err(`mkdir: cannot create directory '${d}': No such file or directory`);
            code = 1;
            continue;
          }
          u.fs.mkdirp(p);
        }
        if (!rest.filter((a) => !a.startsWith('-')).length) throw new CliError("mkdir: missing operand\nTry 'mkdir --help' for more information.", 1);
        return code;
      }
      case 'touch': {
        let code = 0;
        for (const f of rest) {
          const p = path(f);
          if (u.fs.isDir(p)) continue;
          if (!u.fs.isDir(dirname(p))) {
            out.err(`touch: cannot touch '${f}': No such file or directory`);
            code = 1;
            continue;
          }
          if (!u.fs.isFile(p)) u.fs.write(p, '');
        }
        return code;
      }
      case 'rm': {
        const flags = rest.filter((a) => a.startsWith('-')).join('');
        const recursive = /[rR]/.test(flags);
        const force = flags.includes('f');
        let code = 0;
        for (const f of rest.filter((a) => !a.startsWith('-'))) {
          const p = path(f);
          const g = this.inGitDir(u, p);
          if (g && g.rest === '') {
            if (!recursive) {
              out.err(`rm: cannot remove '${f}': Is a directory`);
              code = 1;
              continue;
            }
            u.repos.delete(g.repo.root!);
            this.events.push({ type: 'repo', repo: this.repoId(u, g.repo), action: 'delete' });
            continue;
          }
          const kind = this.exists(u, p);
          if (!kind) {
            if (!force) {
              out.err(`rm: cannot remove '${f}': No such file or directory`);
              code = 1;
            }
            continue;
          }
          if (kind === 'dir' && !recursive) {
            out.err(`rm: cannot remove '${f}': Is a directory`);
            code = 1;
            continue;
          }
          for (const [root, r] of [...u.repos]) if (root === p || root.startsWith(p + '/')) {
            u.repos.delete(root);
            this.events.push({ type: 'repo', repo: this.repoId(u, r), action: 'delete' });
          }
          u.fs.remove(p);
          if (u.cwd === p || u.cwd.startsWith(p + '/')) u.cwd = dirname(p);
        }
        return code;
      }
      case 'mv':
      case 'cp': {
        const ops = rest.filter((a) => !a.startsWith('-'));
        if (ops.length < 2) throw new CliError(`${cmd}: missing file operand\nTry '${cmd} --help' for more information.`, 1);
        const dst = path(ops[ops.length - 1]);
        let code = 0;
        for (const s of ops.slice(0, -1)) {
          const src = path(s);
          const kind = this.exists(u, src);
          if (!kind) {
            out.err(`${cmd}: cannot stat '${s}': No such file or directory`);
            code = 1;
            continue;
          }
          const target = u.fs.isDir(dst) ? `${dst}/${basename(src)}` : dst;
          if (kind === 'dir') {
            if (cmd === 'cp' && !/r|R|a/.test(rest.join(''))) {
              out.err(`cp: -r not specified; omitting directory '${s}'`);
              code = 1;
              continue;
            }
            for (const rel of u.fs.walk(src)) u.fs.write(`${target}/${rel}`, u.fs.read(`${src}/${rel}`)!);
            u.fs.mkdirp(target);
            if (cmd === 'mv') u.fs.remove(src);
          } else {
            u.fs.write(target, u.fs.read(src)!);
            if (cmd === 'mv' && target !== src) u.fs.remove(src);
          }
        }
        return code;
      }
      case 'head':
      case 'tail': {
        let n = 10;
        const files: string[] = [];
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === '-n') n = Number(rest[++i]);
          else if (/^-\d+$/.test(rest[i])) n = Number(rest[i].slice(1));
          else files.push(rest[i]);
        }
        const text = files.length ? (this.read(u, path(files[0])) ?? '') : (stdin ?? '');
        if (files.length && this.exists(u, path(files[0])) !== 'file') throw new CliError(`${cmd}: cannot open '${files[0]}' for reading: No such file or directory`, 1);
        const lines = text.replace(/\n$/, '').split('\n');
        const picked = cmd === 'head' ? lines.slice(0, n) : lines.slice(Math.max(0, lines.length - n));
        if (text) out.add(picked.join('\n'));
        return 0;
      }
      case 'wc': {
        const text = rest.filter((a) => !a.startsWith('-')).length ? (this.read(u, path(rest.filter((a) => !a.startsWith('-'))[0])) ?? '') : (stdin ?? '');
        const n = (text.match(/\n/g) ?? []).length;
        out.add(rest.includes('-l') ? String(n) + (rest.filter((a) => !a.startsWith('-')).length ? ` ${rest.filter((a) => !a.startsWith('-'))[0]}` : '') : `${n} ${text.split(/\s+/).filter(Boolean).length} ${text.length}`);
        return 0;
      }
      case 'grep': {
        const flags = rest.filter((a) => a.startsWith('-')).join('');
        const [pat, file] = rest.filter((a) => !a.startsWith('-'));
        if (pat === undefined) throw new CliError('Usage: grep [OPTION]... PATTERNS [FILE]...', 2);
        const text = file ? this.read(u, path(file)) : stdin;
        if (text === undefined) throw new CliError(`grep: ${file}: No such file or directory`, 2);
        let re: RegExp;
        try {
          re = new RegExp(pat, flags.includes('i') ? 'i' : '');
        } catch {
          re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
        const lines = text.replace(/\n$/, '').split('\n');
        const hits = lines.map((l, i) => [l, i + 1] as const).filter(([l]) => re.test(l) !== flags.includes('v'));
        if (hits.length) out.add(hits.map(([l, i]) => (flags.includes('n') ? `${i}:${l}` : l)).join('\n'));
        return hits.length ? 0 : 1;
      }
      case 'sort': {
        const text = rest.length ? (this.read(u, path(rest[0])) ?? '') : (stdin ?? '');
        if (text) out.add(text.replace(/\n$/, '').split('\n').sort().join('\n'));
        return 0;
      }
      case 'clear':
      case 'true':
        return 0;
      case 'false':
        return 1;
      case 'whoami':
        out.add(u.id);
        return 0;
      default:
        if (EDITORS.includes(cmd)) {
          throw new CliError(`${cmd}: this terminal has no full-screen editors. Open the file with ✏️ Edit next to the terminal, or write it with: echo "text" > ${rest[0] ?? 'file.txt'}`, 1);
        }
        throw new CliError(`${cmd}: command not found`, 127);
    }
  }
}

export { normalizePath };
