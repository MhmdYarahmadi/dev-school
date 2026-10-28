import type { Module } from '../../../content/types';

/** index.html as three lines, with this opening-hours line. */
const page = (hours: string, title = 'Shop') => `printf "<h1>${title}</h1>\\n<p>Welcome!</p>\\n<p>${hours}</p>\\n" > index.html`;
/** The same page as a file answer. */
const pageText = (hours: string, title = 'Shop') => `<h1>${title}</h1>\n<p>Welcome!</p>\n<p>${hours}</p>\n`;

/** A shop with a three-line home page, one commit on main. */
const shop = ['git init -q shop', 'cd shop', page('Open 9-5'), 'echo "body { color: navy; }" > style.css', 'git add .', 'git commit -qm "Add home page"'];
/** `hours` and main both changed the opening hours (line 3); `title` changed only line 1. You're on main. */
const clash = [
  ...shop,
  'git switch -qc title',
  page('Open 9-5', 'Our Shop'),
  'git commit -qam "New title"',
  'git switch -q main',
  'git switch -qc hours',
  page('Open 8-6'),
  'git commit -qam "Longer hours"',
  'git switch -q main',
  page('Open 10-4'),
  'git commit -qam "Shorter hours"',
];
/** In the middle of merging `hours`: index.html has a conflict. */
const stuck = [...clash, 'git merge hours # fails'];
/** Both files conflict: `hours` also changed the colour, and so did main. */
const twoFiles = [
  ...shop,
  'git switch -qc hours',
  page('Open 8-6'),
  'echo "body { color: black; }" > style.css',
  'git commit -qam "Longer hours, darker text"',
  'git switch -q main',
  page('Open 10-4'),
  'echo "body { color: teal; }" > style.css',
  'git commit -qam "Shorter hours, teal text"',
  'git merge hours # fails',
];
/** `sale` changed the price line, main changed the same line's product name. You're on main. */
const priceClash = [
  'git init -q menu',
  'cd menu',
  'printf "Menu\\nTea: 3 EUR\\nCake: 4 EUR\\n" > menu.txt',
  'git add .',
  'git commit -qm "First menu"',
  'git switch -qc sale',
  'printf "Menu\\nTea: 2 EUR\\nCake: 4 EUR\\n" > menu.txt',
  'git commit -qam "Cheaper tea"',
  'git switch -q main',
  'printf "Menu\\nGreen tea: 3 EUR\\nCake: 4 EUR\\n" > menu.txt',
  'git commit -qam "Green tea"',
];

const conflicted = `<h1>Shop</h1>
<p>Welcome!</p>
<<<<<<< HEAD
<p>Open 10-4</p>
=======
<p>Open 8-6</p>
>>>>>>> hours
`;

export const g04: Module = {
  id: 'g04',
  number: 4,
  title: 'Conflicts',
  tagline: 'When two branches change the same lines, Git asks you to decide. It\'s not an error, and nothing is lost.',
  games: ['conflictdoctor'],
  concepts: [
    {
      id: 'g04-why',
      title: 'Why conflicts happen',
      env: { setup: clash },
      card: `Merging combines two sets of changes. Git compares each branch with the commit where they split:

- Changes to **different files**, or **different lines** of the same file: Git combines them by itself ("Auto-merging").
- The **same lines** changed differently on both sides: Git can't know which one you want. It **stops** and marks the spot: a **merge conflict**.

A conflict isn't a mistake or a broken repository. It's Git asking a question only you can answer. The merge waits, half done, until you decide.`,
      predict: {
        sql: 'git merge hours # fails',
        question: 'main changed line 3 of `index.html` to "Open 10-4"; `hours` changed the same line to "Open 8-6". What does `git merge hours` do?',
        choices: ['Keeps main\'s version, because you\'re on main', 'Keeps the newest change', 'Stops with a conflict in index.html, for you to decide', 'Refuses to start the merge'],
        answer: 2,
        why: 'Both sides changed the same line in different ways. Git won\'t guess: it reports `CONFLICT (content)` and waits for you.',
        expectError: true,
        verify: ['CONFLICT \\(content\\): Merge conflict in index\\.html', 'Automatic merge failed; fix conflicts and then commit the result\\.'],
      },
      example: { sql: 'git log --oneline --graph --all\ngit merge title\ncat index.html', note: '`title` changed line 1 and main changed line 3: different lines of the same file, so Git combines them by itself ("Auto-merging index.html"). Both changes are in the result.' },
      cheat: { syntax: 'CONFLICT (content): Merge conflict in FILE', note: 'Both branches changed the same lines: you decide what the file should say.' },
    },
    {
      id: 'g04-markers',
      title: 'Reading conflict markers',
      env: { setup: stuck },
      card: `Git writes **both** versions into the file, between three marker lines:

\`\`\`
<<<<<<< HEAD
your version (the branch you're on)
=======
their version (the branch you're merging in)
>>>>>>> hours
\`\`\`

- \`<<<<<<< HEAD\` starts **your** side: what the branch you're on has.
- \`=======\` separates the two sides.
- \`>>>>>>> hours\` ends **their** side, named after the branch being merged in.

Everything outside the markers merged fine. Only the part between them needs your decision.`,
      predict: {
        sql: 'cat index.html',
        question: 'You\'re on main, merging `hours`. In `index.html`, which version comes right after `<<<<<<< HEAD`?',
        choices: ['hours\'s version ("Open 8-6")', 'main\'s version ("Open 10-4"): HEAD is the branch you\'re on', 'The original ("Open 9-5")', 'Both, mixed together'],
        answer: 1,
        why: 'HEAD is where you are: main. Its side comes first; the branch you\'re merging in comes after `=======`.',
        verify: ['<<<<<<< HEAD\\n<p>Open 10-4</p>\\n=======\\n<p>Open 8-6</p>\\n>>>>>>> hours'],
      },
      example: { sql: 'cat index.html\ngit diff', note: '`git diff` during a conflict shows both sides at once. Open ✏️ Files to see the markers in the editor.' },
      cheat: { syntax: '<<<<<<< HEAD … ======= … >>>>>>> BRANCH', note: 'Your side first, then theirs.' },
    },
    {
      id: 'g04-resolve',
      title: 'Resolving: edit, add, commit',
      env: { setup: stuck },
      card: `To resolve a conflict:

1. **Edit the file** so it says what it should: keep your side, their side, or a mix of both. **Delete the three marker lines.**
2. \`git add FILE\`: tells Git "this conflict is resolved".
3. \`git commit\`: finishes the merge. The message is ready (\`Merge branch 'hours'\`): \`git commit -m "…"\` or \`git commit --no-edit\` to keep it.

The result is an ordinary merge commit with two parents. Until you \`git add\` the file, Git refuses to commit, so you can't finish a merge with a conflict still in it.`,
      predict: {
        sql: `${page('Open 8-6')}\ngit commit -m "Merge hours" # fails`,
        question: 'You fixed `index.html` in the editor, then ran `git commit` straight away. What happens?',
        choices: ['The merge is committed', 'Refused: "Committing is not possible because you have unmerged files"', 'The markers come back', 'Git commits only main\'s version'],
        answer: 1,
        why: 'Fixing the file isn\'t enough: `git add index.html` is how you tell Git it\'s resolved. Then commit.',
        expectError: true,
        verify: ['Committing is not possible because you have unmerged files'],
      },
      example: { sql: `${page('Open 8-6')}\ngit add index.html\ngit status\ngit commit -m "Merge branch 'hours'"\ngit log --oneline --graph`, note: 'Here the edit keeps the longer hours (in the ✏️ Files tab you\'d edit the file instead). After `git add`, status says "All conflicts fixed but you are still merging".' },
      cheat: { syntax: '(edit the file)\ngit add FILE\ngit commit', note: 'Resolve, mark as resolved, finish the merge.' },
    },
    {
      id: 'g04-status',
      title: 'Where am I? git status during a merge',
      env: { setup: twoFiles },
      card: `Several files can conflict in one merge. \`git status\` keeps track:

- **Unmerged paths … both modified**: files still to resolve.
- **Changes to be committed**: files resolved and added (and the ones that merged by themselves).
- *"All conflicts fixed but you are still merging"*: everything is added; \`git commit\` to finish.

Work through the files one at a time: fix, \`git add\`, check \`git status\`, next. The 📋 Areas tab shows the same thing.`,
      predict: {
        sql: 'echo "body { color: black; }" > style.css\ngit add style.css\ngit status',
        question: 'Both files conflicted. You resolved `style.css` (keeping hours\'s black text) and added it. What does `git status` say now?',
        choices: ['All conflicts fixed', 'index.html is still unmerged ("both modified")', 'The merge was cancelled', 'style.css is still unmerged'],
        answer: 1,
        why: '`style.css` moved to "Changes to be committed"; `index.html` is still under "Unmerged paths" until you fix and add it.',
        verify: ['both modified:   index\\.html', 'Changes to be committed:\\n\\tmodified:   style\\.css'],
      },
      example: { sql: `git status\necho "body { color: black; }" > style.css\ngit add style.css\n${page('Open 8-6')}\ngit add index.html\ngit status\ngit commit --no-edit`, note: 'One file at a time; when status says "All conflicts fixed", commit.' },
      cheat: { syntax: 'git status', note: 'During a merge: what\'s still unmerged, what\'s resolved.' },
    },
    {
      id: 'g04-abort',
      title: 'Changed your mind: git merge --abort',
      env: { setup: stuck },
      card: `Not ready to decide? Merged the wrong branch? \`git merge --abort\` cancels the merge and puts everything back exactly as it was before you typed \`git merge\`.

- Your branch, your files and the staging area return to the state before the merge.
- The other branch isn't touched; you can merge it again later.

Only use it **during** a merge (when status says "You have unmerged paths"). Once the merge is committed, it's history: undo it with \`git revert\` instead.`,
      predict: {
        sql: 'git merge --abort\ncat index.html',
        question: 'After `git merge --abort`, what does line 3 of `index.html` say?',
        choices: ['"Open 8-6" (hours\'s version)', '"Open 10-4", main\'s version from before the merge', 'Still the conflict markers', 'The file is deleted'],
        answer: 1,
        why: 'Abort restores the state before the merge: main\'s own version, no markers.',
        verify: ['<p>Open 10-4</p>'],
      },
      example: { sql: 'git status\ngit merge --abort\ngit status\ngit log --oneline --graph --all', note: 'Clean again, and the graph shows no merge commit: both branches are as they were.' },
      cheat: { syntax: 'git merge --abort', note: 'Cancel a conflicted merge; back to before it started.' },
    },
  ],
  practice: [
    {
      id: 'g04-p1',
      kind: 'readQuery',
      conceptIds: ['g04-why'],
      prompt: '`title` changed **line 1** of `index.html`; `main` changed **line 3** of the same file. What does `git merge title` do?',
      sql: 'git merge title',
      choices: ['Conflict: both changed index.html', 'Merges by itself: different lines don\'t conflict', 'Keeps only main\'s file', 'Refuses: the file changed on both sides'],
      answer: 1,
      explanation: 'Conflicts are about the same **lines**, not the same file. Git combines changes to different lines automatically.',
      hints: [],
      git: { setup: clash },
    },
    {
      id: 'g04-p2',
      kind: 'write',
      conceptIds: ['g04-markers', 'g04-resolve'],
      prompt: 'You\'re merging `hours` into main, and `index.html` has a conflict. The team chose **hours\'s** opening times. Edit the file so it\'s the final version (no markers). We\'ll `git add` and commit it for you.',
      starterSql: conflicted,
      solution: pageText('Open 8-6'),
      wrongExample: conflicted.replace('<p>Open 10-4</p>\n', ''),
      hints: ['hours\'s side is the one after `=======`.', 'Keep `<p>Open 8-6</p>` and delete the three marker lines and main\'s line.'],
      explanation: 'The resolved file is just the final text: the line from hours, no `<<<<<<<`, `=======` or `>>>>>>>`.',
      git: { setup: stuck, target: 'file', file: 'index.html', after: ['git add index.html', 'git commit -q --no-edit'], compare: ['repo', 'files'] },
    },
    {
      id: 'g04-p3',
      kind: 'write',
      conceptIds: ['g04-resolve'],
      prompt: 'Same conflict, different decision: the shop will open **8-6 on weekdays and 10-4 on Saturdays**. Keep **both** lines: `<p>Open 8-6</p>` first, then `<p>Saturday 10-4</p>`.',
      starterSql: conflicted,
      solution: `<h1>Shop</h1>\n<p>Welcome!</p>\n<p>Open 8-6</p>\n<p>Saturday 10-4</p>\n`,
      wrongExample: pageText('Open 8-6'),
      hints: ['A resolution doesn\'t have to pick a side: write what the file should say.', 'Change main\'s line to `<p>Saturday 10-4</p>`, put it after the 8-6 line, and remove the markers.'],
      explanation: 'You can mix both sides or write something new. Git only needs the final text, without markers.',
      git: { setup: stuck, target: 'file', file: 'index.html', after: ['git add index.html', 'git commit -q --no-edit'], compare: ['repo', 'files'] },
    },
    {
      id: 'g04-p4',
      kind: 'write',
      conceptIds: ['g04-resolve'],
      prompt: '`index.html` is already fixed (no markers left). **Finish the merge.**',
      solution: 'git add index.html\ngit commit -m "Merge branch \'hours\'"',
      wrongExample: 'git commit -m "Merge branch \'hours\'"',
      hints: ['Git still thinks the file is unmerged.', '`git add` the file, then commit.'],
      explanation: '`git add` marks the conflict as resolved; the commit finishes the merge with two parents.',
      git: { setup: [...stuck, page('Open 8-6')], compare: ['repo', 'staging'] },
    },
    {
      id: 'g04-p5',
      kind: 'parsons',
      conceptIds: ['g04-resolve', 'g04-why'],
      prompt: 'Put the whole story in order: merge `hours`, look at the conflict, fix the file (keep 8-6), mark it resolved and finish.',
      blocks: ['git merge hours', 'cat index.html', page('Open 8-6'), 'git add index.html', 'git commit -m "Merge branch \'hours\'"'],
      distractors: ['git merge --abort'],
      wrongOrder: ['git merge hours', 'cat index.html', page('Open 8-6'), 'git commit -m "Merge branch \'hours\'"', 'git add index.html'],
      explanation: 'Merge, read, edit, add, commit. Committing before `git add` is refused, and then the merge stays unfinished.',
      hints: ['`git add` comes before the commit.'],
      git: { setup: clash, compare: ['repo', 'staging'] },
    },
    {
      id: 'g04-p6',
      kind: 'write',
      conceptIds: ['g04-abort'],
      prompt: 'You\'re in the middle of a conflicted merge of `hours`, and you\'re not ready to decide. **Cancel the merge**: back to how main was before.',
      solution: 'git merge --abort',
      wrongExample: 'git status',
      hints: ['`git merge` has an option for this.'],
      explanation: '`git merge --abort` undoes the half-done merge: no markers, no merge in progress.',
      git: { setup: stuck },
    },
    {
      id: 'g04-p7',
      kind: 'readQuery',
      conceptIds: ['g04-status'],
      prompt: 'Read the status. What\'s left to do?',
      sql: 'git status',
      choices: ['Nothing: commit now', 'Fix `index.html`, `git add` it, then commit', 'Fix `style.css` again', 'Run `git merge hours` again'],
      answer: 1,
      explanation: '`style.css` is resolved (to be committed); `index.html` is still "both modified" under Unmerged paths.',
      hints: [],
      git: { setup: [...twoFiles, 'echo "body { color: black; }" > style.css', 'git add style.css'] },
    },
    {
      id: 'g04-p8',
      kind: 'readQuery',
      conceptIds: ['g04-markers'],
      prompt: 'You\'re on main, merging `hours`. Which line came from **`hours`**?',
      sql: 'cat index.html',
      choices: ['<p>Welcome!</p>', '<p>Open 10-4</p>', '<p>Open 8-6</p>', '<h1>Shop</h1>'],
      answer: 2,
      explanation: 'The branch being merged in comes after `=======`, ending with `>>>>>>> hours`.',
      hints: [],
      git: { setup: stuck },
    },
    {
      id: 'g04-p9',
      kind: 'write',
      conceptIds: ['g04-status', 'g04-resolve'],
      prompt: 'Both files conflict. Resolve them: keep **main\'s** `style.css` (`body { color: teal; }`) and **hours\'s** `index.html` (Open 8-6). Then finish the merge. (Use ✏️ Files to edit, or `echo`/`printf` in the terminal.)',
      solution: `echo "body { color: teal; }" > style.css\n${page('Open 8-6')}\ngit add style.css index.html\ngit commit -m "Merge branch 'hours'"`,
      wrongExample: `${page('Open 8-6')}\ngit add index.html\ngit commit -m "Merge branch 'hours'"`,
      hints: ['`git status` lists both files under Unmerged paths.', 'Fix each file, `git add` both, then commit.'],
      explanation: 'Every conflicted file needs fixing and adding before the merge can be committed.',
      git: { setup: twoFiles, compare: ['repo', 'files'] },
    },
    {
      id: 'g04-p10',
      kind: 'write',
      conceptIds: ['g04-why', 'g04-resolve'],
      prompt: 'From the start: merge **`hours`** into main. It will conflict. Resolve it keeping **main\'s** hours (**Open 10-4**), and finish the merge.',
      solution: `git merge hours\n${page('Open 10-4')}\ngit add index.html\ngit commit -m "Merge branch 'hours'"`,
      wrongExample: `git merge hours\ngit add index.html\ngit commit -m "Merge branch 'hours'"`,
      hints: ['After `git merge hours`, open the file and remove hours\'s side and the markers.', 'Then `git add index.html` and `git commit`.'],
      explanation: 'Keeping your side is a valid resolution too, but it still needs the merge commit: it records that `hours` was merged.',
      git: { setup: clash, compare: ['repo', 'files'] },
    },
  ],
  test: [
    {
      id: 'g04-t1',
      kind: 'write',
      conceptIds: ['g04-resolve', 'g04-markers'],
      prompt: 'Resolve the conflict in `index.html` keeping **main\'s** version (the one you\'re on). We\'ll add and commit it.',
      starterSql: conflicted,
      solution: pageText('Open 10-4'),
      wrongExample: pageText('Open 8-6'),
      hints: [],
      explanation: 'main is HEAD: its side is the one right after `<<<<<<< HEAD`.',
      git: { setup: stuck, target: 'file', file: 'index.html', after: ['git add index.html', 'git commit -q --no-edit'], compare: ['repo', 'files'] },
    },
    {
      id: 'g04-t2',
      kind: 'readQuery',
      conceptIds: ['g04-markers'],
      prompt: 'In a conflicted file, what does the `=======` line separate?',
      choices: ['Old and new commits', 'Your side (the branch you\'re on) from their side (the branch being merged in)', 'Staged and unstaged changes', 'The two files that conflict'],
      answer: 1,
      explanation: '`<<<<<<< HEAD` … your side … `=======` … their side … `>>>>>>> branch`.',
      hints: [],
    },
    {
      id: 'g04-t3',
      kind: 'fillBlank',
      conceptIds: ['g04-resolve'],
      prompt: '`index.html` is fixed. Fill in the blank to finish the merge.',
      starterSql: 'git ___ index.html\ngit commit -m "Merge branch \'hours\'"',
      solution: 'git add index.html\ngit commit -m "Merge branch \'hours\'"',
      wrongExample: 'git restore index.html\ngit commit -m "Merge branch \'hours\'"',
      hints: [],
      explanation: '`git add` marks a conflict as resolved.',
      git: { setup: [...stuck, page('Open 8-6')], compare: ['repo', 'staging'] },
    },
    {
      id: 'g04-t4',
      kind: 'readQuery',
      conceptIds: ['g04-why'],
      prompt: 'Why did this merge stop with a conflict?',
      sql: 'git merge hours # fails',
      choices: ['The branches are too old', 'Both branches changed the same line of index.html in different ways', 'index.html wasn\'t committed', 'You can\'t merge into main'],
      answer: 1,
      explanation: 'Same lines, different changes: Git needs you to decide.',
      expectError: true,
      hints: [],
      git: { setup: clash },
    },
    {
      id: 'g04-t5',
      kind: 'write',
      conceptIds: ['g04-abort'],
      prompt: 'You started merging the wrong branch and it conflicted. **Cancel the merge.**',
      solution: 'git merge --abort',
      wrongExample: 'git commit -m "Stop"',
      hints: [],
      explanation: '`git merge --abort` returns to the state before the merge.',
      git: { setup: stuck },
    },
    {
      id: 'g04-t6',
      kind: 'write',
      conceptIds: ['g04-why', 'g04-resolve'],
      prompt: 'In `~/menu`, merge **`sale`** into main. Both changed the tea line: `sale` made it cheaper (2 EUR), main renamed it (Green tea). Keep **both changes**: the line must read `Green tea: 2 EUR`. Finish the merge.',
      solution: 'git merge sale\nprintf "Menu\\nGreen tea: 2 EUR\\nCake: 4 EUR\\n" > menu.txt\ngit add menu.txt\ngit commit -m "Merge branch \'sale\'"',
      wrongExample: 'git merge sale\nprintf "Menu\\nTea: 2 EUR\\nCake: 4 EUR\\n" > menu.txt\ngit add menu.txt\ngit commit -m "Merge branch \'sale\'"',
      hints: [],
      explanation: 'Neither side alone is right: the resolution combines the new name and the new price.',
      git: { setup: priceClash, compare: ['repo', 'files'] },
    },
  ],
};
