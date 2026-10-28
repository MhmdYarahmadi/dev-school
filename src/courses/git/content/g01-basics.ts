import type { Module } from '../../../content/types';

/** A folder with two untracked files, inside a fresh repository. */
const twoFiles = ['git init -q shop', 'cd shop', 'echo "<h1>Shop</h1>" > index.html', 'echo "todo: prices" > draft.txt'];
/** A repository with one commit. */
const oneCommit = ['git init -q shop', 'cd shop', 'echo "<h1>Shop</h1>" > index.html', 'git add index.html', 'git commit -qm "Add home page"'];

export const g01: Module = {
  id: 'g01',
  number: 1,
  title: 'Repositories, the three areas and commits',
  tagline: 'What Git is, how a folder becomes a repository, and how changes go from your files into history.',
  games: ['stagemanager'],
  concepts: [
    {
      id: 'g01-repo',
      title: 'A repository is a folder with a history',
      card: `**Git** records the history of a folder: every saved version of every file, who saved it, when and why. You can look back at any version, see what changed, and undo mistakes.

A folder whose history Git keeps is a **repository** ("repo"). \`git init\` turns the current folder into one. It creates a hidden **\`.git\`** folder: that's where the whole history lives. Your own files stay exactly as they are.

- \`git init\` = start keeping history for this folder (once per project).
- \`git status\` = "what's going on here?" Run it all the time: it's always safe, and it tells you what to do next.

Delete the \`.git\` folder and the history is gone, but your files stay: it's just a normal folder again.`,
      predict: {
        sql: 'mkdir shop\ncd shop\ngit init\ngit status',
        question: 'The folder is empty. What does `git status` say right after `git init`?',
        choices: ['It lists the .git folder as a new file', '"No commits yet" and "nothing to commit"', 'An error: there\'s nothing to track yet', '"working tree clean" and 1 commit'],
        answer: 1,
        why: 'A new repository has no history yet ("No commits yet"), and the folder has no files, so there is nothing to commit. The `.git` folder itself is never tracked: it *is* the repository.',
        verify: ['No commits yet', 'nothing to commit \\(create/copy files'],
      },
      example: { sql: 'mkdir shop\ncd shop\ngit init\nls -A\ngit status', note: '`ls -A` shows the hidden `.git` folder. The prompt now shows `(main)`: you\'re on the branch main, waiting for a first commit.' },
      cheat: { syntax: 'git init\ngit status', note: 'Make the current folder a repository; ask Git what\'s going on.' },
    },
    {
      id: 'g01-areas',
      title: 'Three areas: working folder, staging area, repository',
      env: { setup: ['git init -q shop', 'cd shop'] },
      card: `Your work moves through **three areas**:

1. **Working folder**: your files as they are right now. You edit them with any editor.
2. **Staging area** (also called the *index*): the draft of your **next commit**. You choose what goes in.
3. **Repository**: the saved history. Each **commit** is a snapshot of the staging area.

\`git add FILE\` copies a file's current content into the staging area. \`git status\` shows each file's state:

- **Untracked**: a new file Git has never been told about.
- **Changes to be committed**: staged, ready for the next commit.
- **Changes not staged for commit**: edited since you last staged it.

Staging lets you commit some changes and leave others for later: a commit should be **one logical change**.`,
      predict: {
        sql: 'echo "<h1>Shop</h1>" > index.html\necho "notes" > draft.txt\ngit add index.html\ngit status',
        question: 'Two new files, but only `index.html` was added. What does `git status` show for `draft.txt`?',
        choices: ['Changes to be committed', 'Untracked', 'Nothing: Git ignores it', 'Changes not staged for commit'],
        answer: 1,
        why: '`draft.txt` was never added, so Git lists it as untracked. `index.html` is staged ("Changes to be committed"), so it will be in the next commit; `draft.txt` won\'t.',
        verify: ['Changes to be committed:\\n.*\\n\\tnew file:   index.html', 'Untracked files:\\n.*\\n\\tdraft.txt'],
      },
      example: { sql: 'echo "<h1>Shop</h1>" > index.html\ngit status\ngit add index.html\ngit status', note: 'Watch the 📋 Areas panel: `git add` moves the file into the staging area.' },
      cheat: { syntax: 'git add FILE\ngit add .', note: 'Stage one file; stage everything in the current folder (new and changed files).' },
    },
    {
      id: 'g01-commit',
      title: 'A commit saves a snapshot',
      env: { setup: ['git init -q shop', 'cd shop', 'echo "<h1>Shop</h1>" > index.html', 'git add index.html'] },
      card: `\`git commit -m "message"\` saves everything in the staging area as a new **commit**: a snapshot of the whole project at that moment.

- The **message** says *why*, in a few words: "Add home page", "Fix price typo". Write it as a command: "Add…", not "Added…".
- After a commit the staging area matches the commit, and \`git status\` says **working tree clean**.
- The first commit of a repository is the **root commit**: it has no parent.

Git prints a summary: the branch, a short **hash** (the commit's ID, like \`d0469eb\`), the message, and how many files and lines changed.`,
      predict: {
        sql: 'git commit -m "Add home page"\ngit status',
        question: 'After the commit, what does `git status` report?',
        choices: ['index.html is still staged', 'nothing to commit, working tree clean', 'index.html is untracked again', 'Your branch is ahead by 1 commit'],
        answer: 1,
        why: 'The commit saved the staged snapshot. Your folder, the staging area and the last commit now all agree, so there\'s nothing to commit. "ahead by…" only appears when there\'s a remote to compare with.',
        verify: ['\\(root-commit\\)', 'nothing to commit, working tree clean'],
      },
      example: { sql: 'git commit -m "Add home page"\ngit log', note: '`git log` lists the history: here, one commit with its full hash, author, date and message.' },
      cheat: { syntax: 'git commit -m "Add home page"', note: 'Save the staged changes as a commit, with a message saying why.' },
    },
    {
      id: 'g01-modify',
      title: 'Changing a file: modified, stage, commit',
      env: { setup: oneCommit },
      card: `Once a file is in a commit, Git **tracks** it. Edit it and \`git status\` shows **modified** under "Changes not staged for commit".

The cycle is always the same: **edit → \`git add\` → \`git commit\`**.

- A commit takes only what's **staged**. Edit a file, forget \`git add\`, and \`git commit\` says *no changes added to commit*.
- Shortcut: \`git commit -a -m "…"\` (or \`-am\`) stages every change to **tracked** files, then commits. New files still need \`git add\`.
- Changed it again after staging? Then it's in both lists: the staged version, plus newer changes not staged yet. \`git add\` it again.`,
      predict: {
        sql: 'echo "<p>Welcome!</p>" >> index.html\ngit commit -m "Welcome text"',
        question: '`index.html` was changed but not added. What does the commit do?',
        choices: ['Commits the change anyway', 'Nothing: "no changes added to commit"', 'Commits an empty commit', 'Asks whether to add the file'],
        answer: 1,
        why: 'Commits come from the staging area, which still matches the last commit. Git refuses and lists the modified file. Use `git add index.html` first, or `git commit -am "Welcome text"`.',
        expectError: true,
        verify: ['no changes added to commit'],
      },
      example: { sql: 'echo "<p>Welcome!</p>" >> index.html\ngit status\ngit commit -am "Welcome text"\ngit log --oneline', note: '`-am` stages the tracked change and commits it. `git log --oneline` shows one line per commit, newest first.' },
      cheat: { syntax: 'git commit -am "message"', note: 'Stage all changes to tracked files and commit (new files still need git add).' },
    },
    {
      id: 'g01-anatomy',
      title: 'What a commit is: hash, parent, author, message',
      env: { setup: oneCommit },
      card: `Every commit has:

- a **hash**: a 40-character ID computed from its content (\`git log\` shows it in full; \`d0469eb\`, the first 7 characters, is enough to name it);
- a **snapshot** of every file;
- its **parent**: the commit before it (the root commit has none);
- the **author** and **date**, and the **message**.

Because each commit points to its parent, the commits form a chain: the **history**. Watch the 🌳 Graph panel: each dot is a commit, and the line goes to its parent.

\`git log\` lists commits newest first; \`git log --oneline\` shows one line each; \`git show\` shows the latest commit and exactly what it changed.`,
      predict: {
        sql: 'echo "body { color: navy; }" > style.css\ngit add style.css\ngit commit -m "Add styles"\ngit log --oneline',
        question: 'How many lines does `git log --oneline` print now?',
        choices: ['1: only the newest commit', '2: both commits, newest first', '2: both commits, oldest first', '3: one per file'],
        answer: 1,
        why: 'There are two commits: "Add home page" and, on top of it, "Add styles". The log starts at the newest commit and follows each parent back.',
        verify: ['Add styles\\n[0-9a-f]{7} Add home page'],
      },
      example: { sql: 'echo "body { color: navy; }" > style.css\ngit add style.css\ngit commit -m "Add styles"\ngit log\ngit show --stat', note: '`git show --stat` lists the files the latest commit changed.' },
      cheat: { syntax: 'git log --oneline\ngit show', note: 'The history, one line per commit; the latest commit and its changes.' },
    },
    {
      id: 'g01-identity',
      title: 'Tell Git who you are',
      env: { setup: ['git config --global --unset user.name', 'git config --global --unset user.email', 'git init -q notes', 'cd notes', 'echo "first note" > notes.txt', 'git add notes.txt'] },
      card: `Every commit records an **author**. On a new computer Git doesn't know you yet, and refuses to commit until you tell it:

\`\`\`
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
\`\`\`

\`--global\` saves it for every repository on this computer (in \`~/.gitconfig\`); you do it once. Without \`--global\` it applies to the current repository only, for example a work email for work projects.

\`git config user.name\` (with no value) shows the current setting. In this course's terminals your name is already set to **Alex Learner**, except where an exercise starts on a brand-new computer.`,
      predict: {
        sql: 'git commit -m "First note"',
        question: 'This computer has never been told a name. What happens?',
        choices: ['The commit is saved as "unknown"', 'Git refuses: "Author identity unknown"', 'Git asks for your name interactively', 'The commit is saved without an author'],
        answer: 1,
        why: 'Git won\'t make a commit without an author name and email. It stops and prints the exact `git config --global` commands to run.',
        expectError: true,
        verify: ['Author identity unknown'],
      },
      example: { sql: 'git config --global user.name "Alex Learner"\ngit config --global user.email "alex@example.com"\ngit commit -m "First note"\ngit log', note: 'Now the commit works, and `git log` shows the author.' },
      cheat: { syntax: 'git config --global user.name "Your Name"\ngit config --global user.email "you@example.com"', note: 'Once per computer, before your first commit.' },
    },
  ],
  practice: [
    {
      id: 'g01-p1',
      kind: 'write',
      conceptIds: ['g01-repo'],
      prompt: 'Make a new repository in a folder called **`notes`** (inside your home folder, where the terminal starts).',
      solution: 'git init notes',
      wrongExample: 'mkdir notes',
      hints: ['`git init` can take a folder name; it creates the folder if needed.', 'Or: `mkdir notes`, `cd notes`, `git init`.'],
      explanation: '`git init notes` creates the folder and the `.git` folder inside it. `mkdir` alone makes a plain folder without any history.',
      git: { compare: ['repo'] },
    },
    {
      id: 'g01-p2',
      kind: 'write',
      conceptIds: ['g01-areas'],
      prompt: 'The repository `shop` has two new files. Stage **only `index.html`**: `draft.txt` must stay out of the next commit.',
      solution: 'git add index.html',
      wrongExample: 'git add .',
      hints: ['Name the file you want to stage.', '`git add index.html`'],
      explanation: '`git add index.html` stages just that file. `git add .` would stage everything, including the draft.',
      git: { setup: twoFiles, compare: ['repo', 'staging'] },
    },
    {
      id: 'g01-p3',
      kind: 'write',
      conceptIds: ['g01-commit'],
      prompt: '`index.html` is staged. **Commit** it with the message **`Add home page`**.',
      solution: 'git commit -m "Add home page"',
      wrongExample: 'git add index.html',
      hints: ['`git commit` with `-m` and the message in quotes.'],
      explanation: '`git commit -m "Add home page"` saves the staged file as the first commit.',
      git: { setup: [...twoFiles, 'git add index.html'], compare: ['repo', 'messages', 'staging'] },
    },
    {
      id: 'g01-p4',
      kind: 'write',
      conceptIds: ['g01-areas', 'g01-commit'],
      prompt: 'Save **both** new files in **one** commit (any message).',
      solution: 'git add index.html draft.txt\ngit commit -m "Add home page and draft"',
      wrongExample: 'git commit -m "Add files"',
      hints: ['First stage, then commit.', '`git add .` stages every new file in the folder.'],
      explanation: 'Stage both (`git add .` or by name), then one `git commit`. Committing first does nothing: the staging area is empty.',
      git: { setup: twoFiles, compare: ['repo', 'staging'] },
    },
    {
      id: 'g01-p5',
      kind: 'fillBlank',
      conceptIds: ['g01-modify'],
      prompt: '`index.html` was edited. Fill in the blanks to stage it and commit it with the message `Welcome text`.',
      starterSql: 'git ___ index.html\ngit commit ___ "Welcome text"',
      solution: 'git add index.html\ngit commit -m "Welcome text"',
      wrongExample: 'git add index.html\ngit commit "Welcome text"',
      hints: ['The first command stages.', 'The message goes after `-m`.'],
      explanation: '`git add` stages the change; `git commit -m "…"` saves it with a message.',
      git: { setup: [...oneCommit, 'echo "<p>Welcome!</p>" >> index.html'], compare: ['repo', 'messages'] },
    },
    {
      id: 'g01-p6',
      kind: 'fixBug',
      conceptIds: ['g01-modify'],
      prompt: '`index.html` was changed, but this commit doesn\'t save anything ("no changes added to commit"). **Fix it** so the change is committed.',
      starterSql: 'git commit -m "Update title"',
      solution: 'git add index.html\ngit commit -m "Update title"',
      wrongExample: 'git commit -m "Update title"\ngit add index.html',
      hints: ['What does a commit take its content from?', 'Stage the change first (or use `-am`).'],
      explanation: 'A commit only saves what\'s staged. `git add` first, or `git commit -am "Update title"`, which stages tracked files for you.',
      git: { setup: [...oneCommit, 'echo "<h1>The Shop</h1>" > index.html'], compare: ['repo', 'staging'] },
    },
    {
      id: 'g01-p7',
      kind: 'readQuery',
      conceptIds: ['g01-areas', 'g01-modify'],
      prompt: 'Read the status. If you run `git commit -m "Save"` now, what goes into the commit?',
      sql: 'git status',
      choices: ['`style.css` only', '`style.css` and `index.html`', '`index.html` only', 'Nothing'],
      answer: 0,
      explanation: 'Only staged changes are committed: `style.css` is under "Changes to be committed". The edit to `index.html` is "not staged", so it stays in your folder for a later commit.',
      hints: [],
      git: { setup: [...oneCommit, 'echo "body {}" > style.css', 'git add style.css', 'echo "<p>Sale!</p>" >> index.html'] },
    },
    {
      id: 'g01-p8',
      kind: 'parsons',
      conceptIds: ['g01-repo', 'g01-areas', 'g01-commit'],
      prompt: 'Put the steps in order: start a new project `blog`, write its first file, and save it in the history.',
      blocks: ['mkdir blog', 'cd blog', 'git init', 'echo "# My blog" > README.md', 'git add README.md', 'git commit -m "Start blog"'],
      distractors: ['git commit README.md'],
      wrongOrder: ['mkdir blog', 'cd blog', 'echo "# My blog" > README.md', 'git commit -m "Start blog"', 'git init', 'git add README.md'],
      explanation: 'Folder, repository, file, stage, commit. A commit before `git add` has nothing to save.',
      hints: ['You can only commit after staging.', '`git init` needs to run inside the folder.'],
      git: { compare: ['repo'] },
    },
    {
      id: 'g01-p9',
      kind: 'write',
      conceptIds: ['g01-identity'],
      prompt: 'This is a brand-new computer: Git doesn\'t know your name yet. Set your name to **`Alex Learner`** and email to **`alex@example.com`** for every repository, then commit the staged note (any message).',
      solution: 'git config --global user.name "Alex Learner"\ngit config --global user.email "alex@example.com"\ngit commit -m "First note"',
      wrongExample: 'git commit -m "First note"',
      hints: ['`git config --global user.name "…"`', 'and `git config --global user.email "…"`, then commit.'],
      explanation: 'With a name and email set (once per computer, thanks to `--global`), the commit works.',
      git: { setup: ['git config --global --unset user.name', 'git config --global --unset user.email', 'git init -q notes', 'cd notes', 'echo "first note" > notes.txt', 'git add notes.txt'], compare: ['repo'] },
    },
    {
      id: 'g01-p10',
      kind: 'write',
      conceptIds: ['g01-anatomy'],
      prompt: 'Show the history of `shop` with **one line per commit**.',
      solution: 'git log --oneline',
      wrongExample: 'git status',
      hints: ['`git log` has an option for a compact view.', '`--oneline`'],
      explanation: '`git log --oneline` prints the short hash and message of each commit, newest first.',
      git: { setup: [...oneCommit, 'echo "body {}" > style.css', 'git add .', 'git commit -qm "Add styles"'], compare: ['repo', 'stdout'] },
    },
  ],
  test: [
    {
      id: 'g01-t1',
      kind: 'readQuery',
      conceptIds: ['g01-repo'],
      prompt: 'Where does Git keep a repository\'s history?',
      choices: ['In the hidden `.git` folder inside the project', 'In each file, as hidden lines', 'On the hub, never on your computer', 'In `~/.gitconfig`'],
      answer: 0,
      explanation: 'Everything Git knows about the repository lives in `.git`. `~/.gitconfig` only holds your settings, like your name.',
      hints: [],
    },
    {
      id: 'g01-t2',
      kind: 'write',
      conceptIds: ['g01-areas', 'g01-commit'],
      prompt: 'Commit **only `index.html`** (any message). `draft.txt` must stay uncommitted and unstaged.',
      solution: 'git add index.html\ngit commit -m "Add home page"',
      wrongExample: 'git add .\ngit commit -m "Add home page"',
      hints: [],
      explanation: 'Stage just that file, then commit.',
      git: { setup: twoFiles, compare: ['repo', 'staging'] },
    },
    {
      id: 'g01-t3',
      kind: 'readQuery',
      conceptIds: ['g01-modify'],
      prompt: 'What does `git status` say about `index.html`?',
      sql: 'git status',
      choices: ['Untracked', 'Changes to be committed', 'Both staged and not staged', 'Changes not staged for commit'],
      answer: 2,
      explanation: 'It was edited and staged, then edited again. The staged version goes in the next commit; the newer edit is listed as not staged.',
      hints: [],
      git: { setup: [...oneCommit, 'echo "<p>a</p>" >> index.html', 'git add index.html', 'echo "<p>b</p>" >> index.html'] },
    },
    {
      id: 'g01-t4',
      kind: 'write',
      conceptIds: ['g01-modify'],
      prompt: '`index.html` (already tracked) was changed. Commit the change in a **single command** (any message).',
      solution: 'git commit -am "Update home page"',
      wrongExample: 'git commit -m "Update home page"',
      hints: [],
      explanation: '`git commit -am` stages changes to tracked files and commits them in one go.',
      git: { setup: [...oneCommit, 'echo "<h1>The Shop</h1>" > index.html'], compare: ['repo', 'staging'] },
    },
    {
      id: 'g01-t5',
      kind: 'readQuery',
      conceptIds: ['g01-anatomy'],
      prompt: 'A commit\'s **parent** is…',
      choices: ['the commit that came just before it', 'the folder it was made in', 'the branch it belongs to', 'the person who made it'],
      answer: 0,
      explanation: 'Each commit points to the one before it; following parents from the newest commit gives the whole history. The very first commit has no parent.',
      hints: [],
    },
    {
      id: 'g01-t6',
      kind: 'fillBlank',
      conceptIds: ['g01-identity'],
      prompt: 'Fill in the blank so the name is set for **every** repository on this computer.',
      starterSql: 'git config ___ user.name "Alex Learner"\ngit config --global user.email "alex@example.com"\ngit commit -m "First note"',
      solution: 'git config --global user.name "Alex Learner"\ngit config --global user.email "alex@example.com"\ngit commit -m "First note"',
      wrongExample: 'git config user.name\ngit config --global user.email "alex@example.com"\ngit commit -m "First note"',
      hints: [],
      explanation: '`--global` stores the setting for your user, so every repository uses it.',
      git: { setup: ['git config --global --unset user.name', 'git config --global --unset user.email', 'git init -q notes', 'cd notes', 'echo "first note" > notes.txt', 'git add notes.txt'], compare: ['repo'] },
    },
  ],
};
