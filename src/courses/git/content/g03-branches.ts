import type { Module } from '../../../content/types';

/** A repository with two commits on main. */
const site = [
  'git init -q shop',
  'cd shop',
  'echo "<h1>Shop</h1>" > index.html',
  'echo "body { color: navy; }" > style.css',
  'git add .',
  'git commit -qm "Add home page"',
  'echo "<p>Welcome!</p>" >> index.html',
  'git commit -qam "Welcome text"',
];
/** `fix` is one commit ahead of main; you're on main. */
const withFix = [...site, 'git switch -qc fix', 'echo "body { color: black; }" > style.css', 'git commit -qam "Darker text"', 'git switch -q main'];
/** `about` and main both moved on since they split; you're on main. */
const withAbout = [...site, 'git switch -qc about', 'echo "<h1>About us</h1>" > about.html', 'git add about.html', 'git commit -qm "Add about page"', 'git switch -q main', 'echo "body { color: teal; }" > style.css', 'git commit -qam "Teal text"'];

export const g03: Module = {
  id: 'g03',
  number: 3,
  title: 'Branches and merging',
  tagline: 'Work on several things at once without them getting in each other\'s way, then bring the work together.',
  games: ['branchrunner'],
  concepts: [
    {
      id: 'g03-branch',
      title: 'A branch is a movable label',
      env: { setup: site },
      card: `A **branch** is just a **label pointing at a commit**. \`main\` is a branch too: it points at your newest commit, and moves forward each time you commit.

**HEAD** says which branch you're on: \`HEAD -> main\` in the log, a \`*\` in \`git branch\`.

- \`git branch\`: list the branches.
- \`git branch NAME\`: create a new label at the current commit. It does **not** move you onto it.

A branch costs nothing: no files are copied. That's why Git users make one for every feature or fix, and keep \`main\` working.`,
      predict: {
        sql: 'git branch menu\ngit branch',
        question: 'After `git branch menu`, which branch are you on?',
        choices: ['menu: creating a branch moves you onto it', 'main: `git branch` only creates the label', 'Neither: HEAD is detached', 'Both at once'],
        answer: 1,
        why: '`git branch menu` creates the label (at the same commit as main) and stays where you are. `git branch` marks the current one with `*`.',
        verify: ['\\* main', '  menu'],
      },
      example: { sql: 'git branch menu\ngit branch\ngit log --oneline', note: 'Both labels point at the same commit: the log shows `(HEAD -> main, menu)`.' },
      cheat: { syntax: 'git branch\ngit branch NAME', note: 'List branches; create one (without switching to it).' },
    },
    {
      id: 'g03-switch',
      title: 'Switching branches',
      env: { setup: [...site, 'git branch menu'] },
      card: `\`git switch NAME\` moves HEAD to another branch, and updates your files to match that branch's newest commit.

- \`git switch -c NAME\`: **c**reate a branch and switch to it, in one go (the usual way to start new work).
- New commits go on the branch you're on: that label moves forward, the others stay put.
- \`git switch -\` goes back to the previous branch.

Older tutorials use \`git checkout NAME\` and \`git checkout -b NAME\`: the same thing (\`checkout\` does other jobs too, which is why \`switch\` was added).`,
      predict: {
        sql: 'git switch menu\necho "<nav>Menu</nav>" >> index.html\ngit commit -qam "Add menu"\ngit log --oneline --all',
        question: 'You switched to `menu` and committed. Where is `main` now?',
        choices: ['On the new commit too', 'Still on "Welcome text": only menu moved', 'Deleted', 'On the first commit'],
        answer: 1,
        why: 'Only the branch HEAD is on moves when you commit. `main` keeps pointing at "Welcome text" until you merge.',
        verify: ['\\(HEAD -> menu\\) Add menu\\n[0-9a-f]{7} \\(main\\) Welcome text'],
      },
      example: { sql: 'git switch -c contact\necho "<p>Call us</p>" > contact.html\ngit add contact.html\ngit commit -m "Add contact page"\nls\ngit switch main\nls', note: 'Back on main, `contact.html` disappears from the folder: it only exists on the contact branch. Switch back and it returns.' },
      cheat: { syntax: 'git switch NAME\ngit switch -c NAME\ngit switch -', note: 'Go to a branch; create one and go to it; back to the previous branch.' },
    },
    {
      id: 'g03-ff',
      title: 'Merging, the easy case: fast-forward',
      env: { setup: withFix },
      card: `**Merging** brings another branch's commits into the branch you're on: \`git merge OTHER\`.

Always: **switch to the branch that should receive the work** (usually \`main\`), then merge the other one in.

If your branch hasn't moved since the other one split off, there's nothing to combine: Git just slides your label forward to the other branch's commit. That's a **fast-forward**: no new commit is made.`,
      predict: {
        sql: 'git merge fix\ngit log --oneline',
        question: '`fix` is one commit ahead, and `main` didn\'t change since. What does `git merge fix` do?',
        choices: ['Makes a merge commit with two parents', 'Fast-forward: main moves up to fix\'s commit', 'Copies fix\'s files without a commit', 'Fails: fix must be deleted first'],
        answer: 1,
        why: 'main\'s commit is an ancestor of fix\'s, so Git just moves the main label forward ("Fast-forward"). The history stays a straight line.',
        verify: ['Fast-forward', '\\(HEAD -> main, fix\\) Darker text'],
      },
      example: { sql: 'git log --oneline --all\ngit merge fix\ngit log --oneline', note: 'Watch the 🌳 Graph: the main label slides up to join fix.' },
      cheat: { syntax: 'git switch main\ngit merge fix', note: 'Bring fix\'s commits into main.' },
    },
    {
      id: 'g03-merge',
      title: 'Merging diverged branches: a merge commit',
      env: { setup: withAbout },
      card: `When **both** branches have new commits since they split, Git can't just slide a label. It makes a **merge commit**: a commit with **two parents**, combining both sides.

- Git finds the commit where they split (the *merge base*) and combines both sets of changes.
- Different files, or different parts of a file: Git combines them by itself.
- The same lines changed on both sides: a **conflict**, which you resolve by hand (module 4).

The message defaults to \`Merge branch 'about'\`. \`git log --oneline --graph\` draws the two lines joining.`,
      predict: {
        sql: 'git merge about\ngit log --oneline --graph',
        question: 'Both main and `about` have a new commit. What does `git merge about` do?',
        choices: ['Fast-forward', 'A merge commit with two parents', 'A conflict', 'Nothing: they share no files'],
        answer: 1,
        why: 'The branches diverged, so a new commit joins them. They changed different files, so there\'s no conflict.',
        verify: ["Merge made by the 'ort' strategy", "\\*   [0-9a-f]{7} \\(HEAD -> main\\) Merge branch 'about'"],
      },
      example: { sql: 'git log --oneline --graph --all\ngit merge about\ngit log --oneline --graph', note: 'The merge commit (a hollow dot in the 🌳 Graph) has two parents: "Teal text" and "Add about page".' },
      cheat: { syntax: 'git merge about', note: 'A merge commit when both sides changed; a fast-forward otherwise.' },
    },
    {
      id: 'g03-delete',
      title: 'Cleaning up: deleting branches',
      env: { setup: [...withFix, 'git merge -q fix', 'git branch old', 'git switch -q old', 'echo "<p>old idea</p>" >> index.html', 'git commit -qam "Old idea"', 'git switch -q main'] },
      card: `Once a branch is merged, its label isn't needed: the commits are safely part of \`main\`.

- \`git branch -d NAME\`: delete a **merged** branch. Git refuses if it has commits that aren't merged anywhere, so you can't lose work by accident.
- \`git branch -D NAME\`: delete it **anyway** (for work you really want to throw away).
- You can't delete the branch you're on: switch away first.

Deleting a branch only removes the label. Commits that were merged stay in history.`,
      predict: {
        sql: 'git branch -d old # fails',
        question: '`old` has a commit that was never merged. What does `git branch -d old` do?',
        choices: ['Deletes it', 'Refuses: "not fully merged"', 'Merges it first, then deletes it', 'Deletes the commit but keeps the label'],
        answer: 1,
        why: 'With `-d`, Git protects unmerged work and tells you to use `-D` if you\'re sure.',
        expectError: true,
        verify: ["error: the branch 'old' is not fully merged"],
      },
      example: { sql: 'git branch -d fix\ngit branch -D old\ngit branch', note: '`fix` was merged, so `-d` works. `old` needs `-D`.' },
      cheat: { syntax: 'git branch -d NAME\ngit branch -D NAME', note: 'Delete a merged branch; delete one even if unmerged.' },
    },
    {
      id: 'g03-dirty',
      title: 'Switching with uncommitted changes',
      env: { setup: withAbout },
      card: `What happens to changes you haven't committed when you switch?

- If the other branch has the **same version** of those files, Git **carries your changes along**: they stay in your folder, uncommitted, and \`switch\` lists them (\`M index.html\`).
- If switching would **overwrite** them (the other branch has a different version of that file), Git **refuses**: *"Your local changes … would be overwritten by checkout"*.

Either way, nothing is lost. The fix is to commit first (or throw the changes away with \`git restore\`). A good habit: \`git status\` before you switch.`,
      predict: {
        sql: 'echo "body { color: red; }" > style.css\ngit switch about # fails',
        question: 'You changed `style.css` (not committed). On `about`, `style.css` is different from main\'s. What does `git switch about` do?',
        choices: ['Switches and keeps your change', 'Refuses, to protect your change', 'Switches and throws your change away', 'Commits your change first'],
        answer: 1,
        why: 'Switching would replace `style.css` with about\'s version and lose your edit, so Git stops and tells you to commit (or stash) first.',
        expectError: true,
        verify: ['would be overwritten by checkout:\\n\\tstyle\\.css'],
      },
      example: { sql: 'echo "<p>Hi</p>" >> index.html\ngit switch about\ngit status\ngit switch main', note: '`about` has the same `index.html` as main, so the edit just comes along.' },
      cheat: { syntax: 'git status\ngit switch NAME', note: 'Check for uncommitted changes before switching.' },
    },
  ],
  practice: [
    {
      id: 'g03-p1',
      kind: 'write',
      conceptIds: ['g03-branch'],
      prompt: 'Create a branch called **`menu`**, but **stay on `main`**.',
      solution: 'git branch menu',
      wrongExample: 'git switch -c menu',
      hints: ['`git branch NAME` creates a label without moving you.'],
      explanation: '`git branch menu` creates the label; HEAD stays on main.',
      git: { setup: site, compare: ['repo'] },
    },
    {
      id: 'g03-p2',
      kind: 'write',
      conceptIds: ['g03-switch'],
      prompt: 'Create a branch **`contact`** and switch to it, **in one command**.',
      solution: 'git switch -c contact',
      wrongExample: 'git branch contact',
      hints: ['`git switch` has an option to create the branch.', '`-c`'],
      explanation: '`git switch -c contact` (or the older `git checkout -b contact`).',
      git: { setup: site, compare: ['repo'] },
    },
    {
      id: 'g03-p3',
      kind: 'write',
      conceptIds: ['g03-switch'],
      prompt: 'Start a branch **`sale`**, and on it commit one change: add the line **`<p>Sale!</p>`** to the end of `index.html` (any message). `main` must not change.',
      solution: 'git switch -c sale\necho "<p>Sale!</p>" >> index.html\ngit commit -am "Add sale banner"',
      wrongExample: 'echo "<p>Sale!</p>" >> index.html\ngit commit -am "Add sale banner"\ngit switch -c sale',
      hints: ['Switch first: commits go on the branch you\'re on.', '`>>` adds a line to the end of a file.'],
      explanation: 'Switching first puts the commit on `sale`. Committing first would move `main` too.',
      git: { setup: site, compare: ['repo'] },
    },
    {
      id: 'g03-p4',
      kind: 'readQuery',
      conceptIds: ['g03-branch'],
      prompt: 'Read the output. Which branch are you on?',
      sql: 'git branch',
      choices: ['about', 'fix', 'main', 'none of them'],
      answer: 1,
      explanation: 'The `*` marks the current branch (also shown in the prompt).',
      hints: [],
      git: { setup: [...withAbout, 'git branch fix', 'git switch -q fix'] },
    },
    {
      id: 'g03-p5',
      kind: 'write',
      conceptIds: ['g03-ff'],
      prompt: 'You\'re on `main`. Bring the commits of **`fix`** into it.',
      solution: 'git merge fix',
      wrongExample: 'git switch fix',
      hints: ['Merge into the branch you\'re on.'],
      explanation: '`git merge fix` fast-forwards main to fix\'s commit.',
      git: { setup: withFix, compare: ['repo', 'files'] },
    },
    {
      id: 'g03-p6',
      kind: 'fixBug',
      conceptIds: ['g03-merge'],
      prompt: 'The goal: `main` gets the about page with a merge commit. These commands merged the **wrong way round**: `about` got main\'s changes and main didn\'t change. **Fix them.**',
      starterSql: 'git switch about\ngit merge main',
      solution: 'git merge about',
      wrongExample: 'git switch about\ngit merge main',
      hints: ['`git merge X` brings X into the branch you\'re **on**.', 'You\'re already on main.'],
      explanation: 'Stay on the receiving branch (main) and merge the other one in: `git merge about`.',
      git: { setup: withAbout, compare: ['repo'] },
    },
    {
      id: 'g03-p7',
      kind: 'write',
      conceptIds: ['g03-delete'],
      prompt: '`fix` was merged into `main`. **Delete** the `fix` branch (safely).',
      solution: 'git branch -d fix',
      wrongExample: 'git switch fix',
      hints: ['`git branch` with an option to delete.', '`-d` (safe) or `-D` (forced).'],
      explanation: '`git branch -d fix` works because its commits are in main.',
      git: { setup: [...withFix, 'git merge -q fix'], compare: ['repo'] },
    },
    {
      id: 'g03-p8',
      kind: 'parsons',
      conceptIds: ['g03-switch', 'g03-ff', 'g03-delete'],
      prompt: 'Put the steps of a feature branch in order: start `footer`, commit a change on it, bring it into `main`, and delete the branch.',
      blocks: ['git switch -c footer', 'echo "<footer>Shop</footer>" >> index.html', 'git commit -am "Add footer"', 'git switch main', 'git merge footer', 'git branch -d footer'],
      distractors: ['git merge main'],
      wrongOrder: ['git switch -c footer', 'echo "<footer>Shop</footer>" >> index.html', 'git commit -am "Add footer"', 'git merge footer', 'git switch main', 'git branch -d footer'],
      explanation: 'Create and switch, commit, switch back to main, merge, delete. Merging while still on footer does nothing ("Already up to date"), and then `-d` refuses.',
      hints: ['Merge from the branch that receives the work.'],
      git: { setup: site, compare: ['repo'] },
    },
    {
      id: 'g03-p9',
      kind: 'readQuery',
      conceptIds: ['g03-dirty'],
      prompt: 'You edited `index.html` (not committed) and switched to `about`, which has the same `index.html` as main. What happened to your edit?',
      sql: 'echo "<p>Hi</p>" >> index.html\ngit switch about\ngit status --short',
      choices: ['It was lost', 'It came along: still uncommitted, now on about', 'It was committed on main', 'The switch was refused'],
      answer: 1,
      explanation: 'Nothing would be overwritten, so Git carries the change along. It belongs to no branch until you commit it.',
      hints: [],
      git: { setup: withAbout },
    },
    {
      id: 'g03-p10',
      kind: 'write',
      conceptIds: ['g03-merge'],
      prompt: 'Show the history of **every** branch at once, one line per commit, **with the graph lines**.',
      solution: 'git log --oneline --graph --all',
      wrongExample: 'git log --oneline',
      hints: ['Three options to `git log`.', '`--oneline`, `--graph` and `--all`.'],
      explanation: '`--all` includes every branch, `--graph` draws how they split and join.',
      git: { setup: withAbout, compare: ['stdout'] },
    },
  ],
  test: [
    {
      id: 'g03-t1',
      kind: 'write',
      conceptIds: ['g03-switch'],
      prompt: 'Create a branch **`blog`** and switch to it.',
      solution: 'git switch -c blog',
      wrongExample: 'git branch blog',
      hints: [],
      explanation: '`git switch -c blog` (or `git branch blog` then `git switch blog`).',
      git: { setup: site, compare: ['repo'] },
    },
    {
      id: 'g03-t2',
      kind: 'write',
      conceptIds: ['g03-merge'],
      prompt: 'Merge **`about`** into **`main`**.',
      solution: 'git merge about',
      wrongExample: 'git switch about\ngit merge main',
      hints: [],
      explanation: 'On main, `git merge about` makes a merge commit (both branches had moved on).',
      git: { setup: withAbout, compare: ['repo'] },
    },
    {
      id: 'g03-t3',
      kind: 'readQuery',
      conceptIds: ['g03-ff'],
      prompt: 'Why does this merge say **Fast-forward**?',
      sql: 'git merge fix',
      choices: ['main had no new commits since fix split off, so main\'s label just moved forward', 'The files were small', 'fix had no commits', 'Git made a merge commit quickly'],
      answer: 0,
      explanation: 'Nothing to combine: main\'s commit is an ancestor of fix\'s, so Git moves the label and makes no new commit.',
      hints: [],
      git: { setup: withFix },
    },
    {
      id: 'g03-t4',
      kind: 'write',
      conceptIds: ['g03-delete'],
      prompt: 'The branch **`old`** holds an abandoned idea that was never merged. Delete it **anyway**.',
      solution: 'git branch -D old',
      wrongExample: 'git branch -d old',
      hints: [],
      explanation: '`-d` refuses unmerged work; `-D` forces it.',
      git: { setup: [...site, 'git branch old', 'git switch -q old', 'echo "<p>old idea</p>" >> index.html', 'git commit -qam "Old idea"', 'git switch -q main'], compare: ['repo'] },
    },
    {
      id: 'g03-t5',
      kind: 'readQuery',
      conceptIds: ['g03-branch'],
      prompt: 'What **is** a branch in Git?',
      choices: ['A copy of all the project\'s files', 'A label pointing at a commit, which moves forward as you commit', 'A separate repository', 'A list of changes waiting to be committed'],
      answer: 1,
      explanation: 'Branches are cheap labels; the commits hold the snapshots.',
      hints: [],
    },
    {
      id: 'g03-t6',
      kind: 'fillBlank',
      conceptIds: ['g03-switch', 'g03-ff'],
      prompt: 'You\'re on `fix`, which is one commit ahead of `main`. Fill in the blank so `main` gets fix\'s commit.',
      starterSql: 'git ___ main\ngit merge fix',
      solution: 'git switch main\ngit merge fix',
      wrongExample: 'git branch main\ngit merge fix',
      hints: [],
      explanation: 'Go to the receiving branch, then merge.',
      git: { setup: [...withFix, 'git switch -q fix'], compare: ['repo'] },
    },
  ],
};
