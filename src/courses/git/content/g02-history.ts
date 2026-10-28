import type { Module } from '../../../content/types';

/** A repository with three commits: the home page, the styles, and a welcome line. */
const history = [
  'git init -q shop',
  'cd shop',
  'echo "<h1>Shop</h1>" > index.html',
  'git add index.html',
  'git commit -qm "Add home page"',
  'echo "body { color: navy; }" > style.css',
  'git add style.css',
  'git commit -qm "Add styles"',
  'echo "<p>Welcome!</p>" >> index.html',
  'git commit -qam "Welcome text"',
];
/** The same, with a staged change to style.css and an unstaged one to index.html. */
const twoKinds = [...history, 'echo "body { color: teal; }" > style.css', 'git add style.css', 'echo "<p>Open daily</p>" >> index.html'];
/** The last commit broke the page. */
const broken = [...history, 'echo "<h1>Shpo</h1>" > index.html', 'git commit -qam "Shorter title"'];

export const g02: Module = {
  id: 'g02',
  number: 2,
  title: 'History and simple undo',
  tagline: 'Read the history, see exactly what changed, keep junk out, and undo mistakes safely.',
  games: [],
  concepts: [
    {
      id: 'g02-log',
      title: 'Reading the history: git log',
      env: { setup: history },
      card: `\`git log\` lists the commits of your current branch, **newest first**: each with its hash, author, date and message.

Useful options:

- \`--oneline\`: one line per commit (short hash and message). The everyday view.
- \`-3\` (or \`-n 3\`): only the newest 3 commits.
- \`--stat\`: also list the files each commit changed.
- \`--graph\`: draw the lines between commits (it matters once there are branches, in module 3).

Labels in brackets show where things point: \`(HEAD -> main)\` means "you are here, on the branch main".`,
      predict: {
        sql: 'git log --oneline',
        question: 'This repository has three commits. Which one is on the **first** line?',
        choices: ['Add home page (the first commit)', 'Welcome text (the newest commit)', 'Add styles (the middle one)', 'The order is random'],
        answer: 1,
        why: '`git log` starts at the newest commit (where HEAD is) and follows each parent back, so the first commit ever made comes last.',
        verify: ['^[0-9a-f]{7} \\(HEAD -> main\\) Welcome text\\n[0-9a-f]{7} Add styles\\n[0-9a-f]{7} Add home page$'],
      },
      example: { sql: 'git log --oneline\ngit log --stat -1', note: '`--stat -1` shows only the newest commit, with the files it changed.' },
      cheat: { syntax: 'git log --oneline\ngit log -3\ngit log --stat', note: 'Compact history; the newest 3 commits; with the files each commit changed.' },
    },
    {
      id: 'g02-names',
      title: 'Naming commits: hashes, HEAD and HEAD~1',
      env: { setup: history },
      card: `To look at (or undo) a commit, you name it. Three ways:

- its **hash**: the full 40 characters, or just the first 7 (\`git log --oneline\` prints those);
- **\`HEAD\`**: the commit you're on now (the newest one on your branch);
- **\`HEAD~1\`**: HEAD's parent, one step back; \`HEAD~2\` is two steps back, and so on.

\`git show\` displays one commit: its details, then exactly which lines it added (\`+\`) and removed (\`-\`). Without a name it shows HEAD. \`git show --stat\` lists just the files.`,
      predict: {
        sql: 'git show --stat HEAD~1',
        question: 'The history is "Add home page" → "Add styles" → "Welcome text" (newest). Which commit does `git show HEAD~1` show?',
        choices: ['Welcome text', 'Add styles', 'Add home page', 'An error: HEAD~1 is not a commit'],
        answer: 1,
        why: '`HEAD` is "Welcome text"; `~1` goes one parent back, to "Add styles". That commit added `style.css`.',
        verify: ['Add styles', 'style\\.css \\| 1 \\+'],
      },
      example: { sql: 'git show\ngit show HEAD~2 --stat', note: '`git show` alone shows HEAD with its changes: the green `+` line is what "Welcome text" added.' },
      cheat: { syntax: 'git show\ngit show HEAD~1\ngit show 3f2a1b9', note: 'The latest commit; the one before; any commit by its (short) hash.' },
    },
    {
      id: 'g02-diff',
      title: 'What changed? git diff',
      env: { setup: history },
      card: `\`git diff\` shows changes **line by line**: \`-\` lines were removed, \`+\` lines were added.

It compares different areas depending on how you ask:

- \`git diff\`: your **folder** vs the **staging area**: changes you haven't staged yet.
- \`git diff --staged\`: the **staging area** vs the **last commit**: what the next commit will contain.
- \`git diff HEAD~1 HEAD\`: between two commits.

So right after \`git add\`, plain \`git diff\` shows nothing: the change has moved to the staging area. Check \`git diff --staged\` before committing.`,
      predict: {
        sql: 'echo "<p>Open daily</p>" >> index.html\ngit add index.html\ngit diff',
        question: 'You edited `index.html` and staged it. What does plain `git diff` print?',
        choices: ['The new line, with a +', 'Nothing', 'The whole file', 'An error: the file is staged'],
        answer: 1,
        why: 'Plain `git diff` compares your folder with the staging area, and they\'re the same now. `git diff --staged` would show the `+<p>Open daily</p>` line.',
        verify: ['^$'],
      },
      example: { sql: 'echo "<p>Open daily</p>" >> index.html\ngit diff\ngit add index.html\ngit diff --staged', note: 'The same change, first as unstaged, then as staged.' },
      cheat: { syntax: 'git diff\ngit diff --staged\ngit diff HEAD~1 HEAD', note: 'Unstaged changes; staged changes; changes between two commits.' },
    },
    {
      id: 'g02-ignore',
      title: 'Files Git should never track: .gitignore',
      env: { setup: history },
      card: `Some files don't belong in history: logs, build output, editor junk, and above all **secrets** (passwords, keys).

List them in a file called **\`.gitignore\`** at the top of the repository, one pattern per line:

\`\`\`
*.log
build/
.env
\`\`\`

- \`*.log\` = every file ending in \`.log\`; \`build/\` = the whole folder.
- Ignored files vanish from \`git status\`, and \`git add .\` skips them.
- Commit the \`.gitignore\` itself, so everyone on the team ignores the same files.
- It only affects **untracked** files: a file that's already committed stays tracked.`,
      predict: {
        sql: 'echo "*.log" > .gitignore\necho "error at line 3" > debug.log\ngit status --short',
        question: 'With `*.log` in `.gitignore`, which new files does `git status` list?',
        choices: ['`.gitignore` and `debug.log`', 'Only `.gitignore`', 'Only `debug.log`', 'Nothing at all'],
        answer: 1,
        why: '`debug.log` matches `*.log`, so Git ignores it. `.gitignore` itself is a new file like any other: it should be committed.',
        verify: ['^\\?\\? \\.gitignore$'],
      },
      example: { sql: 'echo "*.log" > .gitignore\necho "error" > debug.log\ngit status\ngit add .\ngit commit -m "Ignore log files"\ngit show --stat', note: '`git add .` took `.gitignore` but skipped `debug.log`.' },
      cheat: { syntax: 'echo "*.log" >> .gitignore\ngit add .gitignore', note: 'Ignore every .log file; commit the .gitignore so the team shares it.' },
    },
    {
      id: 'g02-restore',
      title: 'Undo changes you haven\'t committed: git restore',
      env: { setup: history },
      card: `\`git status\` tells you how to undo, and both use \`git restore\`:

- **\`git restore FILE\`**: throw away your changes to the file in your folder; it goes back to the staged (or last committed) version. ⚠️ Those changes are **gone for good**: they were never committed, so Git can't bring them back.
- **\`git restore --staged FILE\`**: take the file out of the staging area ("unstage"). Your changes stay in the folder, nothing is lost.

So: staged something by mistake? \`--staged\`. Made a mess of a file and want the last good version? Plain \`restore\`.`,
      predict: {
        sql: 'echo "oops" > index.html\ngit restore index.html\ncat index.html',
        question: 'You overwrote `index.html` with "oops", then ran `git restore index.html`. What does the file contain?',
        choices: ['"oops"', 'The last committed version (title and welcome line)', 'Nothing: restore empties it', 'The very first version (title only)'],
        answer: 1,
        why: '`git restore` copies the staged version back into your folder, which (since nothing was staged) is the last commit\'s version. The "oops" edit is gone.',
        verify: ['^<h1>Shop</h1>\\n<p>Welcome!</p>$'],
      },
      example: { sql: 'echo "body { color: red; }" > style.css\ngit add style.css\ngit status\ngit restore --staged style.css\ngit status\ngit restore style.css\ngit status', note: 'Unstage first (the change is still in the folder), then discard it; status ends clean.' },
      cheat: { syntax: 'git restore --staged FILE\ngit restore FILE', note: 'Unstage (keeps your changes); discard your changes to the file (can\'t be undone).' },
    },
    {
      id: 'g02-revert',
      title: 'Undo a commit safely: git revert',
      env: { setup: broken },
      card: `A bad commit is already in history. **\`git revert COMMIT\`** makes a **new commit** that does the exact opposite: lines it added are removed, lines it removed come back.

- The history stays honest: the mistake and its fix are both there. Nothing is rewritten.
- That makes it safe even after you've shared your commits with others (module 5).
- \`git revert HEAD\` undoes the latest commit; use a hash or \`HEAD~2\` for an older one. Its message is \`Revert "…"\`.

(There are commands that *erase* commits, such as \`git reset\`. They're for later: erasing shared history causes trouble for your team.)`,
      predict: {
        sql: 'git revert HEAD\ngit log --oneline',
        question: 'The latest commit, "Shorter title", introduced a typo. After `git revert HEAD`, how many commits does the log show?',
        choices: ['3: the bad commit is removed', '4: unchanged, revert only changes files', '5: a new "Revert" commit on top', '1: history is reset'],
        answer: 2,
        why: 'Revert never removes commits: it adds one more, `Revert "Shorter title"`, whose change puts the old title back.',
        verify: ['Revert "Shorter title"\\n[0-9a-f]{7} Shorter title'],
      },
      example: { sql: 'git show --stat\ngit revert HEAD\ngit show\ncat index.html', note: 'The revert\'s diff is the bad commit\'s diff turned around.' },
      cheat: { syntax: 'git revert HEAD\ngit revert 3f2a1b9', note: 'A new commit undoing the latest commit, or any commit by hash.' },
    },
  ],
  practice: [
    {
      id: 'g02-p1',
      kind: 'write',
      conceptIds: ['g02-log'],
      prompt: 'Show only the **2 newest** commits, **one line each**.',
      solution: 'git log --oneline -2',
      wrongExample: 'git log --oneline',
      hints: ['`--oneline` for one line each.', 'A number like `-2` limits how many commits are shown.'],
      explanation: '`git log --oneline -2` (or `-n 2`) stops after two commits.',
      git: { setup: history, compare: ['stdout'], exactOutput: true },
    },
    {
      id: 'g02-p2',
      kind: 'readQuery',
      conceptIds: ['g02-log'],
      prompt: 'Read the log. What was the **first** commit of this repository?',
      sql: 'git log --oneline',
      choices: ['Shorter title', 'Add home page', 'Welcome text', 'Add styles'],
      answer: 1,
      explanation: 'The log is newest first, so the first commit ever made is on the last line.',
      hints: [],
      git: { setup: broken },
    },
    {
      id: 'g02-p3',
      kind: 'write',
      conceptIds: ['g02-names'],
      prompt: 'Show the commit **just before** the newest one (its details and changes), naming it relative to `HEAD`.',
      solution: 'git show HEAD~1',
      wrongExample: 'git show',
      hints: ['`git show` takes the commit to show.', '`HEAD~1` is the parent of HEAD.'],
      explanation: '`git show HEAD~1` shows "Add styles". `git show` alone shows HEAD.',
      git: { setup: history, compare: ['stdout'] },
    },
    {
      id: 'g02-p4',
      kind: 'fillBlank',
      conceptIds: ['g02-diff'],
      prompt: '`style.css` is staged and `index.html` has unstaged changes. Show **what the next commit will contain**.',
      starterSql: 'git diff ___',
      solution: 'git diff --staged',
      wrongExample: 'git diff',
      hints: ['The next commit is made from the staging area.', '`--staged` (or `--cached`)'],
      explanation: '`git diff --staged` compares the staging area with the last commit: only `style.css` appears. Plain `git diff` shows the unstaged `index.html` change instead.',
      git: { setup: twoKinds, compare: ['stdout'] },
    },
    {
      id: 'g02-p5',
      kind: 'write',
      conceptIds: ['g02-ignore'],
      prompt: 'Your app writes `debug.log`. Create a `.gitignore` containing the line **`*.log`**, and commit it (any message). `debug.log` must not be committed.',
      solution: 'echo "*.log" > .gitignore\ngit add .gitignore\ngit commit -m "Ignore log files"',
      wrongExample: 'git add .\ngit commit -m "Add files"',
      hints: ['`echo "*.log" > .gitignore` writes the file.', 'Then add and commit `.gitignore`.'],
      explanation: 'With `.gitignore` committed, `debug.log` (and every other `.log` file) stays out of `git status` and `git add .` for the whole team.',
      git: { setup: [...history, 'echo "error at line 3" > debug.log'], compare: ['repo', 'staging'] },
    },
    {
      id: 'g02-p6',
      kind: 'write',
      conceptIds: ['g02-restore'],
      prompt: 'You made a mess of `index.html` (not staged). **Throw away your changes**: put it back the way it was in the last commit.',
      solution: 'git restore index.html',
      wrongExample: 'git restore --staged index.html',
      hints: ['`git status` suggests the command.', 'Plain `git restore FILE` (no `--staged`).'],
      explanation: '`git restore index.html` overwrites the file with the staged (here: committed) version. `--staged` only unstages, and nothing was staged.',
      git: { setup: [...history, 'echo "<h1>asdf</h1>" > index.html'], compare: ['files', 'staging'] },
    },
    {
      id: 'g02-p7',
      kind: 'fixBug',
      conceptIds: ['g02-restore'],
      prompt: 'You staged `secrets.txt` by mistake. This command doesn\'t take it out of the next commit. **Fix it**: unstage the file, but keep it in the folder.',
      starterSql: 'git restore secrets.txt',
      solution: 'git restore --staged secrets.txt',
      wrongExample: 'git restore secrets.txt',
      hints: ['Plain `restore` works on your folder, not on the staging area.', 'Add `--staged`.'],
      explanation: '`git restore --staged secrets.txt` unstages it; the file stays in your folder. (Then add it to `.gitignore`!)',
      git: { setup: [...history, 'echo "password=hunter2" > secrets.txt', 'git add secrets.txt'], compare: ['staging', 'files'] },
    },
    {
      id: 'g02-p8',
      kind: 'write',
      conceptIds: ['g02-revert'],
      prompt: 'The newest commit put a typo in the title. **Undo that commit** with a new commit, keeping the history.',
      solution: 'git revert HEAD',
      wrongExample: 'git restore index.html',
      hints: ['There\'s a command that makes the opposite commit.', '`git revert` and the commit to undo.'],
      explanation: '`git revert HEAD` adds `Revert "Shorter title"`, which brings the old title back.',
      git: { setup: broken, compare: ['repo', 'files'] },
    },
    {
      id: 'g02-p9',
      kind: 'parsons',
      conceptIds: ['g02-restore'],
      prompt: 'Both files are staged, but only the `style.css` change is good. Put the steps in order: take `index.html` out of the staging area, commit `style.css`, then throw away the bad `index.html` change.',
      blocks: ['git restore --staged index.html', 'git commit -m "New colour"', 'git restore index.html'],
      distractors: ['git revert HEAD'],
      wrongOrder: ['git commit -m "New colour"', 'git restore --staged index.html', 'git restore index.html'],
      explanation: 'Unstage before committing, or the commit takes both files. Discarding comes last (or after unstaging); it can\'t be undone.',
      hints: ['A commit takes everything that\'s staged at that moment.'],
      git: { setup: [...history, 'echo "body { color: teal; }" > style.css', 'echo "<h1>asdf</h1>" > index.html', 'git add .'], compare: ['repo', 'staging', 'files'] },
    },
    {
      id: 'g02-p10',
      kind: 'readQuery',
      conceptIds: ['g02-diff', 'g02-names'],
      prompt: 'Read the output. What did the commit before the newest one change?',
      sql: 'git diff HEAD~2 HEAD~1',
      choices: ['It added `style.css`', 'It added the welcome line to `index.html`', 'It deleted `index.html`', 'Nothing'],
      answer: 0,
      explanation: '`git diff HEAD~2 HEAD~1` shows what changed from "Add home page" to "Add styles": a new file, `style.css`.',
      hints: [],
      git: { setup: history },
    },
  ],
  test: [
    {
      id: 'g02-t1',
      kind: 'readQuery',
      conceptIds: ['g02-diff'],
      prompt: 'Which command shows the changes that are **staged** (what the next commit will contain)?',
      choices: ['`git diff`', '`git diff --staged`', '`git log`', '`git status --short`'],
      answer: 1,
      explanation: 'Plain `git diff` shows the unstaged changes; `--staged` compares the staging area with the last commit.',
      hints: [],
    },
    {
      id: 'g02-t2',
      kind: 'write',
      conceptIds: ['g02-names'],
      prompt: 'Show the commit **two steps before** the newest one.',
      solution: 'git show HEAD~2',
      wrongExample: 'git show HEAD~1',
      hints: [],
      explanation: '`HEAD~2` is the grandparent of HEAD: "Add home page".',
      git: { setup: history, compare: ['stdout'] },
    },
    {
      id: 'g02-t3',
      kind: 'write',
      conceptIds: ['g02-restore'],
      prompt: '`style.css` is staged, but it isn\'t ready. **Unstage** it, keeping your changes in the folder.',
      solution: 'git restore --staged style.css',
      wrongExample: 'git restore style.css',
      hints: [],
      explanation: '`--staged` moves it out of the staging area only. Plain `git restore style.css` works on the folder instead, so the file would stay staged.',
      git: { setup: [...history, 'echo "body { color: teal; }" > style.css', 'git add style.css'], compare: ['staging', 'files'] },
    },
    {
      id: 'g02-t4',
      kind: 'write',
      conceptIds: ['g02-revert'],
      prompt: 'The styles turned out to be a mistake. Undo the **"Add styles"** commit (not the newest one) without rewriting history.',
      solution: 'git revert HEAD~1',
      wrongExample: 'git revert HEAD',
      hints: [],
      explanation: '`git revert HEAD~1` (or its hash) makes a new commit that removes `style.css` again; "Welcome text" stays.',
      git: { setup: history, compare: ['repo', 'files'] },
    },
    {
      id: 'g02-t5',
      kind: 'fillBlank',
      conceptIds: ['g02-ignore'],
      prompt: 'The folder has `notes.txt` plus temporary files `a.tmp` and `b.tmp`. Fill in the pattern so **every** `.tmp` file is ignored, then everything else is committed.',
      starterSql: 'echo "___" > .gitignore\ngit add .\ngit commit -m "Add notes"',
      solution: 'echo "*.tmp" > .gitignore\ngit add .\ngit commit -m "Add notes"',
      wrongExample: 'echo "a.tmp" > .gitignore\ngit add .\ngit commit -m "Add notes"',
      hints: [],
      explanation: '`*` matches any name, so `*.tmp` covers both files (and future ones).',
      git: { setup: [...history, 'echo "remember milk" > notes.txt', 'echo 1 > a.tmp', 'echo 2 > b.tmp'], compare: ['repo'] },
    },
    {
      id: 'g02-t6',
      kind: 'readQuery',
      conceptIds: ['g02-restore'],
      prompt: 'You edited a file for an hour (never staged or committed), then ran `git restore` on it by accident. Can Git give you the edits back?',
      choices: ['Yes: `git revert`', 'Yes: `git restore --staged`', 'No: they were never in a commit or the staging area', 'Yes: they are in `git log`'],
      answer: 2,
      explanation: 'Git can only bring back what it stored. Edits that were never staged or committed are gone, which is why `git restore FILE` deserves a second look before you press Enter.',
      hints: [],
    },
    {
      id: 'g02-t7',
      kind: 'readQuery',
      conceptIds: ['g02-log'],
      prompt: 'In what order does `git log` list commits?',
      choices: ['Oldest first', 'Newest first', 'Alphabetically by message', 'By file name'],
      answer: 1,
      explanation: 'It starts at HEAD (the newest commit) and walks back through the parents.',
      hints: [],
    },
  ],
};
