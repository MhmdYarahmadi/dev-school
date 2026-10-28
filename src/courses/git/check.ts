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
import { inEnglish, lang, t } from '../../shared/i18n';

export const HOME = '/home/learner';

export interface TranscriptEntry {
  cmd: string;
  lines: Line[];
  code: number;
}

export interface GitOutcome {
  status: 'correct' | 'wrong';
  feedback: string[];
  /** The same feedback in English: misconception rules match against it. */
  feedbackEn: string[];
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

/** How a branch's newest commit differs from the expected one, one sentence per kind of difference. */
function treeDiff(label: string, a: Map<string, string>, b: Map<string, string>): string[] {
  const out: string[] = [];
  const missing = [...b.keys()].filter((p) => !a.has(p));
  const extra = [...a.keys()].filter((p) => !b.has(p));
  const changed = [...b.keys()].filter((p) => a.has(p) && a.get(p) !== b.get(p));
  if (missing.length) out.push(t('The newest commit on {label} is missing {files}.', { label, files: list(missing) }));
  if (extra.length) out.push(t("The newest commit on {label} has {files}, which shouldn't be there.", { label, files: list(extra) }));
  if (changed.length) out.push(t('The newest commit on {label} has a different version of {files}.', { label, files: list(changed) }));
  return out;
}

function compareBranch(label: string, mine: Repo, ref: Repo, a: string, b: string, messages: boolean, out: string[]) {
  const na = mine.ancestors([a]).size;
  const nb = ref.ancestors([b]).size;
  const ca = mine.commit(a);
  const cb = ref.commit(b);
  if (na !== nb) {
    out.push(na === 1 ? t('{label} has 1 commit, but it should have {nb}.', { label, nb }) : t('{label} has {na} commits, but it should have {nb}.', { label, na, nb }));
    if (na < nb) return;
  }
  if (cb.parents.length > 1 && ca.parents.length < 2) {
    out.push(t('The newest commit on {label} should be a merge commit (one with two parents).', { label }));
    return;
  }
  if (cb.parents.length < 2 && ca.parents.length > 1) {
    out.push(t("The newest commit on {label} is a merge commit, but it shouldn't be.", { label }));
    return;
  }
  const d = treeDiff(label, mine.files(a), ref.files(b));
  if (d.length) {
    out.push(...d);
    return;
  }
  if (messages && ca.message.split('\n')[0] !== cb.message.split('\n')[0]) {
    out.push(t('The newest commit on {label} should have the message {want}; yours says {got}.', { label, want: q(cb.message.split('\n')[0]), got: q(ca.message.split('\n')[0]) }));
    return;
  }
  if (na === nb) out.push(t("The history of {label} isn't right: an earlier commit differs.", { label }));
}

/** Differences between two repositories' branches, HEAD and state. */
function compareRepo(mine: Repo, ref: Repo, messages: boolean, local: boolean): string[] {
  const out: string[] = [];
  const ka = canonical(mine, messages);
  const kb = canonical(ref, messages);
  const ba = mine.branches();
  const bb = ref.branches();
  const sentence = (s: string) => (local ? s : t('On the hub, {s}', { s: s[0].toLowerCase() + s.slice(1) }));
  for (const b of bb) if (!ba.includes(b)) out.push(sentence(t("There's no branch {b}.", { b: q(b) })));
  for (const b of ba) if (!bb.includes(b)) out.push(sentence(t("There's a branch {b} that shouldn't be there.", { b: q(b) })));
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
    if (ref.branch && mine.branch !== ref.branch) out.push(mine.branch ? t("You're on {got}, but you should end on {want}.", { got: q(mine.branch), want: q(ref.branch) }) : t('HEAD is detached (not on a branch); you should end on {want}.', { want: q(ref.branch) }));
    else if (!ref.branch && mine.branch) out.push(t("You should end with a detached HEAD (on a commit, not a branch), but you're on {got}.", { got: q(mine.branch) }));
    else if (!ref.branch && !mine.branch && ka(mine.headCommit()!) !== kb(ref.headCommit()!)) out.push(t('HEAD is on a different commit than it should be.'));
    if (mine.op && !ref.op) out.push(mine.op.kind === 'merge' ? t('A merge is still in progress. Resolve the conflicts, `git add` the files, then `git commit` (or cancel with `git merge --abort`).') : t('A revert is still in progress. Resolve the conflicts, `git add` the files, then `git revert --continue` (or cancel with `git revert --abort`).'));
    if (!mine.op && ref.op) out.push(ref.op.kind === 'merge' ? t('A merge should still be in progress here (with its conflicts to resolve).') : t('A revert should still be in progress here (with its conflicts to resolve).'));
    // Remote-tracking branches: what the last fetch saw.
    for (const [r, s] of ref.refs) {
      if (!r.startsWith('refs/remotes/')) continue;
      const m = mine.refs.get(r);
      if (!m) out.push(t("There's no {b} (remote-tracking branch). It appears after a `git fetch` (or `git push` of that branch).", { b: q(r.slice(13)) }));
      else if (mine.objects.has(m) && ka(m) !== kb(s)) out.push(t("{b} isn't where it should be: it shows what the hub had at your last `git fetch`, `git pull` or `git push`.", { b: q(r.slice(13)) }));
    }
    // Upstreams.
    for (const b of bb) {
      if (!ba.includes(b)) continue;
      const ua = mine.upstream(b)?.tracking;
      const ub = ref.upstream(b)?.tracking;
      if (ub && ua !== ub) out.push(ua ? t('{b} should track {want} (for example with `git push -u`), not {got}.', { b: q(b), want: q(ub), got: q(ua) }) : t('{b} should track {want} (for example with `git push -u`).', { b: q(b), want: q(ub) }));
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
  for (const [p, k] of b) if (!a.has(p)) out.push(t("{file} should be staged ({kind}) but isn't. Stage it with {cmd}.", { file: q(p), kind: k, cmd: q(`git ${k === 'deleted' ? 'rm' : 'add'} ${p}`) }));
  for (const [p] of a) if (!b.has(p)) out.push(t("{file} is staged, but it shouldn't be.", { file: q(p) }));
  for (const [p] of b) if (a.has(p) && mine.index.get(p) !== ref.index.get(p)) out.push(t("The staged version of {file} isn't the right one. Stage it again after your last change ({cmd}).", { file: q(p), cmd: q(`git add ${p}`) }));
  const ua = sa.unmerged.map((x) => x.path);
  for (const p of ua) if (!sb.unmerged.some((x) => x.path === p)) out.push(t('{file} still has an unresolved conflict. Fix the file, then {cmd}.', { file: q(p), cmd: q(`git add ${p}`) }));
  return out;
}

function compareFiles(mine: Repo | null, minem: GitMachine, ref: Repo | null, refm: GitMachine): string[] {
  const out: string[] = [];
  const read = (m: GitMachine, r: Repo | null) => (r ? worktreeFiles(m.learner.fs, r) : new Map<string, string>());
  const a = read(minem, mine);
  const b = read(refm, ref);
  for (const [p, c] of a) if (/^<<<<<<< |^=======$|^>>>>>>> /m.test(c) && !/^<<<<<<< /m.test(b.get(p) ?? '')) out.push(t('{file} still contains conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`). Edit the file so only the final text is left.', { file: q(p) }));
  if (out.length) return out;
  const missing = [...b.keys()].filter((p) => !a.has(p));
  const extra = [...a.keys()].filter((p) => !b.has(p));
  const changed = [...b.keys()].filter((p) => a.has(p) && a.get(p) !== b.get(p));
  if (missing.length) out.push(t('Your folder is missing {files}.', { files: list(missing) }));
  if (extra.length) out.push(t("Your folder has {files}, which shouldn't be there.", { files: list(extra) }));
  for (const p of changed) {
    const want = b.get(p)!.split('\n');
    const got = a.get(p)!.split('\n');
    let i = 0;
    while (i < want.length && i < got.length && want[i] === got[i]) i++;
    const gone = got[i] === undefined || (got[i] === '' && i === got.length - 1);
    const ends = want[i] === undefined || (want[i] === '' && i === want.length - 1);
    const v = { file: q(p), n: i + 1, got: gone ? '' : q(got[i]), want: ends ? '' : q(want[i]) };
    if (gone) out.push(ends ? t("{file} isn't right: line {n} is missing, but the file should end before it.", v) : t("{file} isn't right: line {n} is missing, but it should be {want}.", v));
    else out.push(ends ? t("{file} isn't right: line {n} is {got}, but the file should end before it.", v) : t("{file} isn't right: line {n} is {got}, but it should be {want}.", v));
  }
  return out;
}

function compareHub(mine: GitMachine, ref: GitMachine, messages: boolean): string[] {
  const out: string[] = [];
  const state = (s: string) => (s === 'OPEN' ? t('open') : s === 'MERGED' ? t('merged') : t('closed'));
  for (const [name, rr] of ref.hub.repos) {
    const mr = mine.hub.repos.get(name);
    if (!mr) {
      out.push(t("There's no {repo} repository on the hub.", { repo: q(name) }));
      continue;
    }
    out.push(...compareRepo(mr, rr, messages, false));
    const pa = mine.hub.prs.get(name) ?? [];
    const pb = ref.hub.prs.get(name) ?? [];
    for (const p of pb) {
      const m = pa.find((x) => x.head === p.head && x.base === p.base && x.state === p.state) ?? pa.find((x) => x.head === p.head && x.base === p.base);
      const v = { head: q(p.head), base: q(p.base), want: state(p.state) };
      if (!m) out.push(p.state === 'OPEN' ? t('On the hub, there should be a pull request from {head} into {base}. Create one with `gh pr create`.', v) : t('On the hub, there should be a pull request from {head} into {base} ({want}). Create one with `gh pr create`.', v));
      else if (m.state !== p.state) out.push(t('Pull request #{n} (a pull request from {head} into {base}) is {got}, but it should be {want}.', { ...v, n: m.number, got: state(m.state) }));
    }
    const extra = pa.length - pb.length;
    if (extra > 0) out.push(extra === 1 ? t('On the hub, there is an extra pull request.') : t('On the hub, there are {n} extra pull requests.', { n: extra }));
  }
  return out;
}

/** Lines the answer printed, with hashes and dates made comparable. */
function printed(tr: TranscriptEntry[]): string[] {
  return tr.flatMap((x) => x.lines.map((l) => l.text.replace(/\b[0-9a-f]{7,40}\b/g, '<hash>').replace(/\w{3} \w{3} \d+ \d\d:\d\d:\d\d \d{4} \+0000/g, '<date>')));
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
      if (!mr) out.push(root === ref.learner.cwd ? t("There's no Git repository in {dir}. Create one with `git init`.", { dir: q(where(root)) }) : t("There's no Git repository in {dir}.", { dir: q(where(root)) }));
      else out.push(...compareRepo(mr, rr, messages, true));
    }
    for (const root of mine.learner.repos.keys()) if (!roots.has(root)) out.push(root === mine.learner.home ? t("There's an extra Git repository in {dir} (your home folder: a `git init` in the wrong place?).", { dir: q(where(root)) }) : t("There's an extra Git repository in {dir}.", { dir: q(where(root)) }));
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

/** What's wrong with an answer, in the current language. */
function feedbackFor(spec: GitSpec, mine: GitMachine, ref: GitMachine, r: ReturnType<typeof applyAnswer>, m: ReturnType<typeof applyAnswer>): string[] {
  const compare = spec.compare ?? ['repo', 'staging', 'files', 'hub'];
  const feedback = diffMachines(mine, ref, compare);
  if (compare.includes('stdout')) {
    const want = printed(r.transcript.slice(0, r.transcript.length - (spec.after?.length ?? 0)));
    const got = printed(m.transcript.slice(0, m.transcript.length - (spec.after?.length ?? 0)));
    const found = spec.exactOutput ? got.join('\n') === want.join('\n') : want.length === 0 || got.some((_, i) => want.every((w, k) => got[i + k] === w));
    if (!found && spec.exactOutput && want.every((w) => got.includes(w))) feedback.push(want.length === 1 ? t('Your commands show more than was asked: the answer should print 1 line, yours printed {got}.', { got: got.length }) : t('Your commands show more than was asked: the answer should print {want} lines, yours printed {got}.', { want: want.length, got: got.length }));
    else if (!found) {
      const first = q(want.find((w) => !got.includes(w)) ?? want[0]);
      const more = want.length > 1;
      if (got.length) feedback.push(more ? t("Your commands don't show what was asked: the answer should print {first} (and more).", { first }) : t("Your commands don't show what was asked: the answer should print {first}.", { first }));
      else feedback.push(more ? t("Your commands don't print anything. The answer should show {first} (and more).", { first }) : t("Your commands don't print anything. The answer should show {first}.", { first }));
    }
  }
  if (feedback.length && m.failed) {
    const err = m.failed.lines.find((l) => l.kind === 'err' && l.text.trim())?.text ?? m.failed.lines.find((l) => l.text.trim())?.text ?? '';
    const cmd = q(m.failed.cmd.split('\n')[0]);
    feedback.unshift(err ? t('{cmd} failed: {err}', { cmd, err: err.slice(0, 180) }) : t('{cmd} failed.', { cmd }));
  }
  return feedback;
}

export function evaluateGit(item: Exercise, answer: string): GitOutcome {
  const spec = item.git;
  if (!spec) throw new Error(`${item.id} has no git spec`);
  if (/___/.test(answer)) return { status: 'wrong', feedback: [t('Fill in every ___ blank first.')], feedbackEn: [], transcript: [] };
  if (!answer.trim()) return { status: 'wrong', feedback: [t('Write your answer first!')], feedbackEn: [], transcript: [] };
  const mine = sandbox(spec);
  const ref = sandbox(spec);
  const r = applyAnswer(ref, spec, referenceOf(item));
  const m = applyAnswer(mine, spec, answer);
  const feedbackEn = inEnglish(() => feedbackFor(spec, mine, ref, r, m));
  const feedback = lang() === 'en' ? feedbackEn : feedbackFor(spec, mine, ref, r, m);
  return { status: feedback.length ? 'wrong' : 'correct', feedback, feedbackEn, transcript: m.transcript, machine: mine };
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
