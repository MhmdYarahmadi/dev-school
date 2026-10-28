/** Common Git mistakes, detected from the answer text and its outcome. */
import type { GitSpec } from '../../content/types';
import type { GitOutcome } from './check';

export interface GitMisconception {
  id: string;
  title: string;
  explain: string;
}

interface Ctx {
  answer: string;
  spec: GitSpec;
  outcome: GitOutcome;
}

type Rule = GitMisconception & { test: (c: Ctx) => boolean };

const has = (c: Ctx, re: RegExp) => re.test(c.answer);
const said = (c: Ctx, re: RegExp) => c.outcome.feedback.some((f) => re.test(f)) || c.outcome.transcript.some((t) => t.lines.some((l) => re.test(l.text)));
const cmds = (c: Ctx) => c.answer.split('\n').map((l) => l.trim());

const RULES: Rule[] = [
  {
    id: 'commit-without-add',
    title: 'A commit only takes what is staged',
    explain: '`git commit` saves the **staging area**, not your folder. New or changed files go in only after `git add`. (`git commit -a` stages changes to files Git already tracks, but never new files.)',
    test: (c) => has(c, /git commit/) && (said(c, /no changes added to commit|nothing added to commit but untracked files present/) || said(c, /should be staged .* but isn't|is missing/)) && !has(c, /git add/),
  },
  {
    id: 'add-is-not-save',
    title: '`git add` doesn\'t save history',
    explain: '`git add` only puts changes in the staging area (the "next commit" draft). Nothing is in the history until you run `git commit`.',
    test: (c) => has(c, /git add/) && !has(c, /git commit/) && said(c, /has \d+ commits?, but it should have|There's no branch/),
  },
  {
    id: 'branch-not-switch',
    title: 'Creating a branch doesn\'t switch to it',
    explain: '`git branch name` only creates the label; you stay where you are, so the next commit still goes to your current branch. Use `git switch name` afterwards, or create and switch in one go with `git switch -c name`.',
    test: (c) => has(c, /git branch [\w-]+\s*$/m) && !has(c, /git (switch|checkout)/) && said(c, /You're on .* but you should end on|has \d+ commits?, but it should have/),
  },
  {
    id: 'wrong-branch',
    title: 'Check which branch you\'re on before committing',
    explain: 'Commits go to the branch HEAD points at. Run `git status` (first line: "On branch …") or `git branch` (the `*` marks the current one) before you commit, and `git switch` first if needed.',
    test: (c) => has(c, /git commit/) && said(c, /has \d+ commits?, but it should have/) && said(c, /`main` has/) && has(c, /git (switch|checkout|branch)/),
  },
  {
    id: 'markers-left',
    title: 'Remove the conflict markers',
    explain: 'Git writes both versions into the file between `<<<<<<<`, `=======` and `>>>>>>>`. Resolving means editing the file into its final form, **deleting those three marker lines**, then `git add` to mark it resolved.',
    test: (c) => said(c, /conflict markers/),
  },
  {
    id: 'commit-during-conflict',
    title: 'Resolve, add, then commit',
    explain: 'While a merge has conflicts, Git refuses to commit until every conflicted file is fixed **and** staged with `git add`. Then `git commit` finishes the merge.',
    test: (c) => said(c, /Committing is not possible because you have unmerged files/),
  },
  {
    id: 'push-before-pull',
    title: 'Pull before you push',
    explain: 'The hub rejects a push when it has commits you don\'t (a teammate pushed first). That protects their work. Run `git pull` to bring their commits in (and resolve any conflict), then push again.',
    test: (c) => said(c, /\[rejected\].*\((fetch first|non-fast-forward)\)/),
  },
  {
    id: 'protected-main',
    title: 'Protected `main` only changes through pull requests',
    explain: 'The hub refuses direct pushes to a protected branch, with or without `--force`. Put the work on a branch (`git switch -c name`), push the branch (`git push -u origin name`) and open a pull request (`gh pr create`).',
    test: (c) => said(c, /protected branch hook declined|Protected branch update failed/),
  },
  {
    id: 'fetch-not-merge',
    title: '`git fetch` doesn\'t change your files',
    explain: '`git fetch` downloads new commits and moves `origin/main`, but your own `main` and your files stay as they are. To bring the changes into your branch, merge them (`git merge origin/main`) or use `git pull` (fetch + merge in one step).',
    test: (c) => has(c, /git fetch/) && !has(c, /git (pull|merge)/) && said(c, /has \d+ commits?, but it should have|is missing|has a different version/),
  },
  {
    id: 'no-upstream',
    title: 'The first push of a branch needs -u',
    explain: 'A new branch doesn\'t exist on the hub yet, so Git doesn\'t know where to push it. `git push -u origin name` creates it there and remembers the link ("upstream"), so later a plain `git push` / `git pull` works.',
    test: (c) => said(c, /has no upstream branch/),
  },
  {
    id: 'restore-vs-revert',
    title: '`restore` undoes uncommitted changes; `revert` undoes a commit',
    explain: '`git restore file` throws away edits you haven\'t committed (it brings back the staged or committed version). Once a change is committed (and maybe pushed), undo it with `git revert <commit>`: a new commit that does the opposite, so history stays honest.',
    test: (c) => (has(c, /git restore/) && said(c, /has \d+ commits?, but it should have/)) || (has(c, /git revert/) && said(c, /should be staged|isn't right: line/)),
  },
  {
    id: 'unstage-needs-staged',
    title: 'Unstaging needs `--staged`',
    explain: 'Plain `git restore file` works on your **folder** (it throws away unstaged edits). To take a file out of the staging area and keep your changes, use `git restore --staged file`.',
    test: (c) => has(c, /git restore (?!.*--staged)/) && !has(c, /--staged/) && said(c, /is staged, but it shouldn't be/),
  },
  {
    id: 'merge-direction',
    title: 'Merge into the branch you\'re on',
    explain: '`git merge X` brings X\'s commits into the **current** branch. To get a feature into main: `git switch main`, then `git merge feature`. Merging main into the feature branch updates the feature branch instead.',
    test: (c) => has(c, /git merge main\b/) && said(c, /has \d+ commits?, but it should have|should be a merge commit|You're on .* but you should end on/),
  },
  {
    id: 'delete-unmerged',
    title: '`-d` protects unmerged work',
    explain: '`git branch -d` refuses to delete a branch whose commits aren\'t merged anywhere, so you can\'t lose work by accident. Merge it first, or use `git branch -D` if you really want to throw it away.',
    test: (c) => said(c, /is not fully merged/),
  },
  {
    id: 'shell-rm',
    title: '`rm` deletes the file; `git rm` also stages the deletion',
    explain: 'After a plain `rm file`, Git sees the file as "deleted" but not yet staged. `git rm file` does both (or run `git add file` after `rm`).',
    test: (c) => cmds(c).some((l) => /^rm /.test(l)) && said(c, /should be staged \(deleted\)/),
  },
  {
    id: 'init-twice',
    title: 'One `git init` per project folder',
    explain: '`git init` turns the current folder into a repository. Run it once, inside the project folder. Running it in your home folder (or a parent) makes a repository that swallows everything under it.',
    test: (c) => said(c, /extra Git repository/),
  },
];

export function detectGitMisconceptions(c: Ctx): GitMisconception[] {
  if (c.outcome.status === 'correct') return [];
  return RULES.filter((r) => r.test(c)).slice(0, 2).map(({ id, title, explain }) => ({ id, title, explain }));
}
