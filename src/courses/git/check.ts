/**
 * Checks Git-course answers: the learner's answer and the reference answer run on identically
 * prepared machines, then the results are compared by what matters (branches, HEAD, each
 * commit's files and parents, the staging area, the working folder, the hub) rather than by
 * hashes or exact commands, so any correct way of getting there passes. Feedback says exactly
 * what differs.
 */
import type { Exercise, GitSpec, ProjectTask, SandboxEnv } from '../../content/types';
import { computeStatus, GitMachine, type Line, type Repo } from './engine';
import { sha1, utf8 } from './engine/sha1';
import { worktreeFiles } from './engine/worktree';

export const HOME = '/home/learner';

export interface TranscriptEntry {
  cmd: string;
  lines: Line[];
  code: number;
}

export interface GitOutcome {
  status: 'correct' | 'wrong';
  feedback: string[];
  transcript: TranscriptEntry[];
  /** The learner's machine after the answer (for showing the result). */
  machine?: GitMachine;
}

/** A fresh machine with the files written and the setup commands run (setup isn't in the journal). */
export function sandbox(env?: SandboxEnv): GitMachine {
  return prepare(env).machine;
}

/** Setup steps that failed (a bug in the content; the content tests require none). */
export function setupErrors(env?: SandboxEnv): string[] {
  return prepare(env).errors;
}

function prepare(env?: SandboxEnv): { machine: GitMachine; errors: string[] } {
  const m = new GitMachine();
  const errors: string[] = [];
  for (const [k, v] of Object.entries(env?.files ?? {})) m.learner.fs.write(k.startsWith('/') ? k : `${HOME}/${k}`, v);
  for (const c of env?.setup ?? []) {
    const r = m.exec(c);
    // A setup line ending in "# fails" is expected to fail (e.g. a merge that stops on a conflict).
    if ((r.exitCode !== 0) !== c.trimEnd().endsWith('# fails')) errors.push(`${c} → exit ${r.exitCode}: ${r.lines.map((l) => l.text).join(' / ')}`);
  }
  m.journal = [];
  return { machine: m, errors };
}

/** Answer text → commands. A here-document (`cat > f <<'EOF'` … `EOF`) stays one command. */
export function answerCommands(answer: string): string[] {
  const out: string[] = [];
  const lines = answer.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith('#')) continue;
    const doc = /<<-?\s*['"]?(\w+)['"]?/.exec(l);
    if (doc) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j] !== doc[1]) body.push(lines[j++]);
      out.push([l, ...body, doc[1]].join('\n'));
      i = j;
      continue;
    }
    out.push(l);
  }
  return out;
}

function exec(m: GitMachine, cmd: string, t: TranscriptEntry[]): TranscriptEntry {
  const r = m.exec(cmd);
  const e = { cmd, lines: r.lines, code: r.exitCode };
  t.push(e);
  return e;
}

/** A command that saves `content` to `file` (shown in transcripts like any other command). */
export function saveCommand(file: string, content: string): string {
  let delim = 'EOF';
  while (content.split('\n').includes(delim)) delim += '_';
  const body = content.endsWith('\n') ? content.slice(0, -1) : content;
  return `cat > ${/[\s'"$]/.test(file) ? `'${file}'` : file} <<'${delim}'\n${body}\n${delim}`;
}

/** Applies an answer to a machine. Returns the transcript and the first command that failed. */
export function applyAnswer(m: GitMachine, spec: GitSpec, answer: string): { transcript: TranscriptEntry[]; failed: TranscriptEntry | null } {
  const t: TranscriptEntry[] = [];
  let failed: TranscriptEntry | null = null;
  const cmds = spec.target === 'file' ? [saveCommand(spec.file ?? 'file.txt', answer)] : answerCommands(answer);
  for (const c of cmds) {
    const r = exec(m, c, t);
    if (r.code !== 0 && !failed) failed = r;
  }
  for (const c of spec.after ?? []) exec(m, c, t);
  return { transcript: t, failed };
}

// ---------------------------------------------------------------- comparing machines

const q = (s: string) => `\`${s}\``;
const list = (xs: string[]) => xs.map(q).join(', ');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const where = (root: string) => (root.startsWith(HOME) ? `~${root.slice(HOME.length)}` : root);

/** A commit's identity ignoring hashes, times and (unless asked) messages: its files and its parents'. */
function canonical(r: Repo, messages: boolean): (sha: string) => string {
  const memo = new Map<string, string>();
  const key = (sha: string): string => {
    const hit = memo.get(sha);
    if (hit) return hit;
    const c = r.commit(sha);
    const k = sha1(utf8(`${c.tree}|${c.parents.map(key).join(',')}${messages ? '|' + c.message.split('\n')[0] : ''}`));
    memo.set(sha, k);
    return k;
  };
  return key;
}

/** How two trees differ, in words: "is missing `a.txt`", "has a different `b.txt`". */
function treeDiff(a: Map<string, string>, b: Map<string, string>): string[] {
  const out: string[] = [];
  const missing = [...b.keys()].filter((p) => !a.has(p));
  const extra = [...a.keys()].filter((p) => !b.has(p));
  const changed = [...b.keys()].filter((p) => a.has(p) && a.get(p) !== b.get(p));
  if (missing.length) out.push(`is missing ${list(missing)}`);
  if (extra.length) out.push(`has ${list(extra)}, which shouldn't be there`);
  if (changed.length) out.push(`has a different version of ${list(changed)}`);
  return out;
}

function compareBranch(label: string, mine: Repo, ref: Repo, a: string, b: string, messages: boolean, out: string[]) {
  const na = mine.ancestors([a]).size;
  const nb = ref.ancestors([b]).size;
  const ca = mine.commit(a);
  const cb = ref.commit(b);
  if (na !== nb) {
    out.push(`${label} has ${plural(na, 'commit')}, but it should have ${nb}.`);
    if (na < nb) return;
  }
  if (cb.parents.length > 1 && ca.parents.length < 2) {
    out.push(`The newest commit on ${label} should be a merge commit (one with two parents).`);
    return;
  }
  if (cb.parents.length < 2 && ca.parents.length > 1) {
    out.push(`The newest commit on ${label} is a merge commit, but it shouldn't be.`);
    return;
  }
  const d = treeDiff(mine.files(a), ref.files(b));
  if (d.length) {
    out.push(`The newest commit on ${label} ${d.join(', and ')}.`);
    return;
  }
  if (messages && ca.message.split('\n')[0] !== cb.message.split('\n')[0]) {
    out.push(`The newest commit on ${label} should have the message ${q(cb.message.split('\n')[0])}; yours says ${q(ca.message.split('\n')[0])}.`);
    return;
  }
  if (na === nb) out.push(`The history of ${label} isn't right: an earlier commit differs.`);
}

/** Differences between two repositories' branches, HEAD and state. */
function compareRepo(mine: Repo, ref: Repo, messages: boolean, local: boolean): string[] {
  const out: string[] = [];
  const ka = canonical(mine, messages);
  const kb = canonical(ref, messages);
  const prefix = local ? '' : 'On the hub, ';
  const ba = mine.branches();
  const bb = ref.branches();
  const sentence = (s: string) => (prefix ? prefix + s[0].toLowerCase() + s.slice(1) : s);
  for (const b of bb) if (!ba.includes(b)) out.push(sentence(`There's no branch ${q(b)}.`));
  for (const b of ba) if (!bb.includes(b)) out.push(sentence(`There's a branch ${q(b)} that shouldn't be there.`));
  for (const b of bb) {
    if (!ba.includes(b)) continue;
    const a = mine.refs.get(`refs/heads/${b}`)!;
    const c = ref.refs.get(`refs/heads/${b}`)!;
    if (ka(a) === kb(c)) continue;
    const sub: string[] = [];
    compareBranch(q(b), mine, ref, a, c, messages, sub);
    out.push(...sub.map(sentence));
  }
  if (local) {
    if (ref.branch && mine.branch !== ref.branch) out.push(mine.branch ? `You're on ${q(mine.branch)}, but you should end on ${q(ref.branch)}.` : `HEAD is detached (not on a branch); you should end on ${q(ref.branch)}.`);
    else if (!ref.branch && mine.branch) out.push(`You should end with a detached HEAD (on a commit, not a branch), but you're on ${q(mine.branch)}.`);
    else if (!ref.branch && !mine.branch && ka(mine.headCommit()!) !== kb(ref.headCommit()!)) out.push(`HEAD is on a different commit than it should be.`);
    if (mine.op && !ref.op) out.push(mine.op.kind === 'merge' ? 'A merge is still in progress. Resolve the conflicts, `git add` the files, then `git commit` (or cancel with `git merge --abort`).' : 'A revert is still in progress. Resolve the conflicts, `git add` the files, then `git revert --continue` (or cancel with `git revert --abort`).');
    if (!mine.op && ref.op) out.push(`A ${ref.op.kind} should still be in progress here (with its conflicts to resolve).`);
    // Remote-tracking branches: what the last fetch saw.
    for (const [r, s] of ref.refs) {
      if (!r.startsWith('refs/remotes/')) continue;
      const m = mine.refs.get(r);
      if (!m) out.push(`There's no ${q(r.slice(13))} (remote-tracking branch). It appears after a \`git fetch\` (or \`git push\` of that branch).`);
      else if (mine.objects.has(m) && ka(m) !== kb(s)) out.push(`${q(r.slice(13))} isn't where it should be: it shows what the hub had at your last \`git fetch\`, \`git pull\` or \`git push\`.`);
    }
    // Upstreams.
    for (const b of bb) {
      if (!ba.includes(b)) continue;
      const ua = mine.upstream(b)?.tracking;
      const ub = ref.upstream(b)?.tracking;
      if (ub && ua !== ub) out.push(`${q(b)} should track ${q(ub)} (for example with \`git push -u\`)${ua ? `, not ${q(ua)}` : ''}.`);
    }
  }
  return out;
}

function compareStaging(mine: Repo, minefs: GitMachine, ref: Repo, reffs: GitMachine): string[] {
  const out: string[] = [];
  const sa = computeStatus(minefs.learner.fs, mine);
  const sb = computeStatus(reffs.learner.fs, ref);
  const staged = (s: typeof sa) => new Map(s.staged.map((x) => [x.path, x.kind]));
  const a = staged(sa);
  const b = staged(sb);
  for (const [p, k] of b) if (!a.has(p)) out.push(`${q(p)} should be staged (${k}) but isn't. Stage it with \`git ${k === 'deleted' ? 'rm' : 'add'} ${p}\`.`);
  for (const [p] of a) if (!b.has(p)) out.push(`${q(p)} is staged, but it shouldn't be.`);
  for (const [p] of b) if (a.has(p) && mine.index.get(p) !== ref.index.get(p)) out.push(`The staged version of ${q(p)} isn't the right one. Stage it again after your last change (\`git add ${p}\`).`);
  const ua = sa.unmerged.map((x) => x.path);
  for (const p of ua) if (!sb.unmerged.some((x) => x.path === p)) out.push(`${q(p)} still has an unresolved conflict. Fix the file, then \`git add ${p}\`.`);
  return out;
}

function compareFiles(mine: Repo | null, minem: GitMachine, ref: Repo | null, refm: GitMachine): string[] {
  const out: string[] = [];
  const read = (m: GitMachine, r: Repo | null) => (r ? worktreeFiles(m.learner.fs, r) : new Map<string, string>());
  const a = read(minem, mine);
  const b = read(refm, ref);
  for (const [p, c] of a) if (/^<<<<<<< |^=======$|^>>>>>>> /m.test(c) && !/^<<<<<<< /m.test(b.get(p) ?? '')) out.push(`${q(p)} still contains conflict markers (\`<<<<<<<\`, \`=======\`, \`>>>>>>>\`). Edit the file so only the final text is left.`);
  if (out.length) return out;
  const missing = [...b.keys()].filter((p) => !a.has(p));
  const extra = [...a.keys()].filter((p) => !b.has(p));
  const changed = [...b.keys()].filter((p) => a.has(p) && a.get(p) !== b.get(p));
  if (missing.length) out.push(`Your folder is missing ${list(missing)}.`);
  if (extra.length) out.push(`Your folder has ${list(extra)}, which shouldn't be there.`);
  for (const p of changed) {
    const want = b.get(p)!.split('\n');
    const got = a.get(p)!.split('\n');
    let i = 0;
    while (i < want.length && i < got.length && want[i] === got[i]) i++;
    out.push(`${q(p)} isn't right: line ${i + 1} is ${got[i] === undefined || got[i] === '' && i === got.length - 1 ? 'missing' : q(got[i])}${want[i] !== undefined && !(want[i] === '' && i === want.length - 1) ? `, but it should be ${q(want[i])}` : ', but the file should end before it'}.`);
  }
  return out;
}

function compareHub(mine: GitMachine, ref: GitMachine, messages: boolean): string[] {
  const out: string[] = [];
  for (const [name, rr] of ref.hub.repos) {
    const mr = mine.hub.repos.get(name);
    if (!mr) {
      out.push(`There's no ${q(name)} repository on the hub.`);
      continue;
    }
    out.push(...compareRepo(mr, rr, messages, false));
    const pa = mine.hub.prs.get(name) ?? [];
    const pb = ref.hub.prs.get(name) ?? [];
    for (const p of pb) {
      const m = pa.find((x) => x.head === p.head && x.base === p.base && x.state === p.state) ?? pa.find((x) => x.head === p.head && x.base === p.base);
      const what = `a pull request from ${q(p.head)} into ${q(p.base)}`;
      if (!m) out.push(`On the hub, there should be ${what}${p.state === 'OPEN' ? '' : ` (${p.state.toLowerCase()})`}. Create one with \`gh pr create\`.`);
      else if (m.state !== p.state) out.push(`Pull request #${m.number} (${what}) is ${m.state.toLowerCase()}, but it should be ${p.state.toLowerCase()}.`);
    }
    if (pa.length > pb.length) out.push(`On the hub, there ${pa.length - pb.length === 1 ? 'is an extra pull request' : `are ${pa.length - pb.length} extra pull requests`}.`);
  }
  return out;
}

/** Lines the answer printed, with hashes and dates made comparable. */
function printed(t: TranscriptEntry[]): string[] {
  return t.flatMap((x) => x.lines.map((l) => l.text.replace(/\b[0-9a-f]{7,40}\b/g, '<hash>').replace(/\w{3} \w{3} \d+ \d\d:\d\d:\d\d \d{4} \+0000/g, '<date>')));
}

/** Every difference between the learner's machine and the reference one, most important first. */
export function diffMachines(mine: GitMachine, ref: GitMachine, compare: NonNullable<GitSpec['compare']>): string[] {
  const out: string[] = [];
  const messages = compare.includes('messages');
  const roots = new Set([...ref.learner.repos.keys()]);
  const repoOf = (m: GitMachine) => m.repoAt(m.learner);
  if (compare.includes('repo') || messages) {
    for (const root of roots) {
      const rr = ref.learner.repos.get(root)!;
      const mr = mine.learner.repos.get(root);
      if (!mr) out.push(`There's no Git repository in ${q(where(root))}.${root === ref.learner.cwd ? ' Create one with `git init`.' : ''}`);
      else out.push(...compareRepo(mr, rr, messages, true));
    }
    for (const root of mine.learner.repos.keys()) if (!roots.has(root)) out.push(`There's an extra Git repository in ${q(where(root))}${root === mine.learner.home ? ' (your home folder: a `git init` in the wrong place?)' : ''}.`);
  }
  const rr = repoOf(ref);
  const mr = mine.learner.repos.get(rr?.root ?? '') ?? null;
  if (compare.includes('staging') && rr && mr) out.push(...compareStaging(mr, mine, rr, ref));
  if (compare.includes('files') && rr) out.push(...compareFiles(mr, mine, rr, ref));
  if (compare.includes('hub')) out.push(...compareHub(mine, ref, messages));
  return [...new Set(out)];
}

function referenceOf(item: Exercise): string {
  if ('solution' in item) return (item as { solution: string }).solution;
  if (item.kind === 'parsons') return item.blocks.join('\n');
  return '';
}

export function evaluateGit(item: Exercise, answer: string): GitOutcome {
  const spec = item.git;
  if (!spec) throw new Error(`${item.id} has no git spec`);
  if (/___/.test(answer)) return { status: 'wrong', feedback: ['Fill in every ___ blank first.'], transcript: [] };
  if (!answer.trim()) return { status: 'wrong', feedback: ['Write your answer first!'], transcript: [] };
  const mine = sandbox(spec);
  const ref = sandbox(spec);
  const r = applyAnswer(ref, spec, referenceOf(item));
  const m = applyAnswer(mine, spec, answer);
  const compare = spec.compare ?? ['repo', 'staging', 'files', 'hub'];
  const feedback = diffMachines(mine, ref, compare);
  if (compare.includes('stdout')) {
    const want = printed(r.transcript.slice(0, r.transcript.length - (spec.after?.length ?? 0)));
    const got = printed(m.transcript.slice(0, m.transcript.length - (spec.after?.length ?? 0)));
    const found = spec.exactOutput ? got.join('\n') === want.join('\n') : want.length === 0 || got.some((_, i) => want.every((w, k) => got[i + k] === w));
    if (!found && spec.exactOutput && want.every((w) => got.includes(w))) feedback.push(`Your commands show more than was asked: the answer should print ${plural(want.length, 'line')}, yours printed ${got.length}.`);
    else if (!found) {
      const first = want.find((w) => !got.includes(w)) ?? want[0];
      feedback.push(got.length ? `Your commands don't show what was asked: the answer should print ${q(first)}${want.length > 1 ? ' (and more)' : ''}.` : `Your commands don't print anything. The answer should show ${q(first)}${want.length > 1 ? ' (and more)' : ''}.`);
    }
  }
  if (feedback.length && m.failed) {
    const err = m.failed.lines.find((l) => l.kind === 'err' && l.text.trim())?.text ?? m.failed.lines.find((l) => l.text.trim())?.text ?? '';
    feedback.unshift(`${q(m.failed.cmd.split('\n')[0])} failed${err ? `: ${err.slice(0, 180)}` : '.'}`);
  }
  return { status: feedback.length ? 'wrong' : 'correct', feedback, transcript: m.transcript, machine: mine };
}

/** Runs an answer without checking it (the Run button). */
export function tryGit(spec: GitSpec, answer: string): { transcript: TranscriptEntry[]; machine: GitMachine } {
  const m = sandbox(spec);
  const { transcript } = applyAnswer(m, spec, answer);
  return { transcript, machine: m };
}

export interface RequirementOutcome {
  ok: boolean;
  output: string;
}

/** Project tasks: run the learner's commands, then each requirement's command on the same machine. */
export function checkGitProject(task: ProjectTask, answer: string): { transcript: TranscriptEntry[]; machine: GitMachine; requirements: RequirementOutcome[] } {
  const m = sandbox(task.git);
  const { transcript } = applyAnswer(m, { target: 'commands' }, answer);
  const requirements = task.requirements.map((req) => {
    // Checks run on a copy of the state, as written: several lines run in turn and the last decides.
    let res = m.exec('true');
    for (const line of answerCommands(req.sql)) res = m.exec(line);
    const output = res.lines.map((l) => l.text).join('\n');
    const ok = res.exitCode === (req.code ?? 0) && (!req.expect || new RegExp(req.expect, 'm').test(output));
    return { ok, output };
  });
  return { transcript, machine: m, requirements };
}
