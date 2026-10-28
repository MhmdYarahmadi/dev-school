import type { Module } from '../../../content/types';

const URL = 'https://hub.zilber.tech/team/shop.git';
/** The team's repository on the hub, started by Sam (one commit). */
const hubShop = ['@hub init team/shop', `@sam git clone -q ${URL}`, '@sam cd shop', '@sam echo "<h1>Shop</h1>" > index.html', '@sam echo "body { color: navy; }" > style.css', '@sam git add .', '@sam git commit -qm "Add home page"', '@sam git push -q'];
/** …and your clone of it, in ~/shop. */
const cloned = [...hubShop, `git clone -q ${URL}`, 'cd shop'];
/** Sam pushed a sale banner after you cloned (you haven't fetched yet). */
const samPushed = [...cloned, '@sam echo "<p>Sale!</p>" >> index.html', '@sam git commit -qam "Sale banner"', '@sam git push -q'];
/** Your own commit (an about page), not pushed. */
const mine = ['echo "<h1>About us</h1>" > about.html', 'git add about.html', 'git commit -qm "Add about page"'];
/** Both of you changed the title: Sam pushed first. */
const titleClash = [...cloned, '@sam echo "<h1>The Shop</h1>" > index.html', '@sam git commit -qam "New title"', '@sam git push -q', 'echo "<h1>Our Shop</h1>" > index.html', 'git commit -qam "Our title"'];

export const g05: Module = {
  id: 'g05',
  number: 5,
  title: 'Remotes: working with the hub',
  tagline: 'Share your repository through a hub: clone it, send your commits, bring in your teammate\'s.',
  games: ['pushpull'],
  concepts: [
    {
      id: 'g05-clone',
      title: 'The hub and git clone',
      env: { setup: hubShop },
      card: `So far your repository lived only on your computer. A team shares one through a **hub**: a server that hosts repositories (GitHub, GitLab and Bitbucket are real ones; ours is \`hub.zilber.tech\`).

\`git clone URL\` copies a hub repository to your computer:

- a new folder with the files, and **the whole history**;
- a **remote** named \`origin\`: Git's name for "the hub I cloned from". \`git remote -v\` shows its URL.

Your clone is a full repository: you commit locally, offline, as before. You only talk to the hub when you say so.

Your teammate **Sam** has a clone too. In the terminal, lines starting with \`@sam\` run on Sam's computer.`,
      predict: {
        sql: `git clone ${URL}\ncd shop\ngit remote -v`,
        question: 'After cloning, what is `origin`?',
        choices: ['A branch', 'The name of the remote: the hub URL you cloned from', 'Sam\'s computer', 'The first commit'],
        answer: 1,
        why: '`git clone` records where it came from as the remote `origin`. Push and pull go there by default.',
        verify: ['origin\\thttps://hub\\.zilber\\.tech/team/shop\\.git \\(fetch\\)'],
      },
      example: { sql: `git clone ${URL}\ncd shop\nls\ngit log --oneline\ngit remote -v`, note: 'Sam\'s commit came along: a clone has the whole history. The 🌐 Hub tab shows the hub\'s copy.' },
      cheat: { syntax: 'git clone URL\ngit remote -v', note: 'Copy a hub repository; show where origin points.' },
    },
    {
      id: 'g05-push',
      title: 'Sending your commits: git push',
      env: { setup: cloned },
      card: `Committing saves to **your** repository only. To share commits, **push** them to the hub:

- \`git push\`: sends your branch's new commits to the same branch on \`origin\`.
- Afterwards \`git status\` says *"Your branch is up to date with 'origin/main'"*.

A **new branch** doesn't exist on the hub yet. Its first push names the remote and branch, and \`-u\` remembers the link (the **upstream**), so a plain \`git push\` / \`git pull\` works from then on:

\`\`\`
git push -u origin about
\`\`\``,
      predict: {
        sql: 'echo "<h1>About us</h1>" > about.html\ngit add about.html\ngit commit -qm "Add about page"\ngit status',
        question: 'You committed `about.html`. Can Sam get it from the hub now?',
        choices: ['Yes: commits go to the hub automatically', 'No: it\'s only in your repository until you `git push` ("ahead of origin/main by 1 commit")', 'Only if Sam clones again', 'Yes, but only the file, not the commit'],
        answer: 1,
        why: 'Commits are local. `git status` tells you how many aren\'t on the hub yet: "ahead … by 1 commit".',
        verify: ["Your branch is ahead of 'origin/main' by 1 commit\\."],
      },
      example: { sql: 'echo "<h1>About us</h1>" > about.html\ngit add about.html\ngit commit -m "Add about page"\ngit push\ngit status', note: 'Watch the 🌳 Graph: the commit flies to the hub\'s copy, and `origin/main` catches up with `main`.' },
      cheat: { syntax: 'git push\ngit push -u origin BRANCH', note: 'Send commits; first push of a new branch.' },
    },
    {
      id: 'g05-tracking',
      title: 'origin/main: your last look at the hub',
      env: { setup: samPushed },
      card: `Your repository keeps a bookmark of each hub branch: **\`origin/main\`**, a *remote-tracking branch*. It shows where the hub's \`main\` was **the last time you talked to the hub** (clone, fetch, pull or push).

\`git status\` compares your \`main\` with that bookmark:

- **ahead by N**: you have N commits the hub doesn't (push them);
- **behind by N**: the hub has N you don't (pull them);
- **diverged**: both.

The bookmark doesn't update by itself. If Sam pushed a minute ago, your status still says "up to date" until you fetch.`,
      predict: {
        sql: 'git status',
        question: 'Sam pushed a commit a minute ago. You haven\'t contacted the hub since cloning. What does `git status` say?',
        choices: ['"Your branch is behind \'origin/main\' by 1 commit"', '"Your branch is up to date with \'origin/main\'"', '"Your branch and \'origin/main\' have diverged"', 'It shows Sam\'s commit'],
        answer: 1,
        why: '`origin/main` is a bookmark from your last contact. Git doesn\'t check the hub on its own, so as far as it knows, you\'re up to date.',
        verify: ["Your branch is up to date with 'origin/main'\\."],
      },
      example: { sql: 'git branch -a\ngit status\ngit fetch\ngit status', note: 'After `git fetch`, the bookmark moves and status knows you\'re behind by 1.' },
      cheat: { syntax: 'git branch -a\ngit status', note: 'See remote-tracking branches; ahead/behind (as of your last fetch).' },
    },
    {
      id: 'g05-fetch',
      title: 'git fetch: download, but don\'t touch',
      env: { setup: samPushed },
      card: `\`git fetch\` downloads the hub's new commits and moves the \`origin/…\` bookmarks. That's all:

- your own \`main\` doesn't move;
- your files don't change.

It's the safe way to look before you take: fetch, then \`git log --oneline --all\` (or the 🌳 Graph) shows what Sam did. When you're ready, \`git merge origin/main\` brings it into your branch.`,
      predict: {
        sql: 'git fetch\ngit status',
        question: 'After `git fetch`, is Sam\'s sale banner in your `index.html`?',
        choices: ['Yes, fetch updates your files', 'No: fetch only downloads; your branch is now "behind by 1"', 'Only if there\'s no conflict', 'No, fetch didn\'t download anything'],
        answer: 1,
        why: 'Fetch moved `origin/main`, not `main`. Status now knows you\'re behind; your files are unchanged.',
        verify: ["Your branch is behind 'origin/main' by 1 commit, and can be fast-forwarded\\."],
      },
      example: { sql: 'git fetch\ngit log --oneline --all\ncat index.html\ngit merge origin/main\ncat index.html', note: 'The banner only appears after the merge (a fast-forward here).' },
      cheat: { syntax: 'git fetch\ngit merge origin/main', note: 'Download the hub\'s commits; then bring them into your branch.' },
    },
    {
      id: 'g05-pull',
      title: 'git pull = fetch + merge',
      env: { setup: samPushed },
      card: `\`git pull\` does both steps at once: **fetch** the hub's commits, then **merge** them into your current branch.

- No new commits of your own: a **fast-forward**, your branch just moves up.
- New commits on both sides: a **merge commit** (the merge message names the hub URL).
- Both changed the same lines: a **conflict**, resolved exactly as in module 4 (edit, \`git add\`, \`git commit\`).

A good habit: **pull before you start working**, and before you push.`,
      predict: {
        sql: `${mine.join('\n')}\ngit pull`,
        question: 'You made a commit (an about page) and Sam pushed one (a banner). What does `git pull` do?',
        choices: ['Fast-forward', 'A merge commit joining your commit and Sam\'s', 'Throws away your commit', 'Refuses until you push'],
        answer: 1,
        why: 'Both sides have a new commit, so the merge part of pull makes a merge commit (different files: no conflict).',
        verify: ["Merge made by the 'ort' strategy\\."],
      },
      example: { sql: 'git pull\ncat index.html\ngit log --oneline', note: 'No local commits, so pull fast-forwards: Sam\'s banner arrives.' },
      cheat: { syntax: 'git pull', note: 'Fetch and merge the hub\'s changes into your branch.' },
    },
    {
      id: 'g05-rejected',
      title: 'Rejected push: pull first',
      env: { setup: [...samPushed, ...mine] },
      card: `If Sam pushed since your last pull, your push is **rejected**:

\`\`\`
 ! [rejected]        main -> main (fetch first)
\`\`\`

The hub won't accept a push that would throw away commits it has (Sam's). Nothing is broken. The fix:

1. \`git pull\`: bring Sam's commits in (resolve a conflict if there is one);
2. \`git push\` again.

Never "fix" this with \`git push --force\` on a shared branch: it **replaces** the hub's branch with yours and deletes your teammates' commits.`,
      predict: {
        sql: 'git push # fails',
        question: 'Sam pushed after you cloned. You committed and run `git push`. What happens?',
        choices: ['Your commit replaces Sam\'s', 'Rejected: the hub has commits you don\'t have yet', 'Git merges on the hub', 'It works, both commits are kept'],
        answer: 1,
        why: 'Your main doesn\'t contain Sam\'s commit, so pushing would drop it. Pull first, then push.',
        expectError: true,
        verify: ['! \\[rejected\\]        main -> main \\(fetch first\\)', "hint: 'git pull' before pushing again"],
      },
      example: { sql: 'git pull\ngit push\ngit log --oneline --graph', note: 'After the pull, your main contains Sam\'s commit too, so the push is accepted.' },
      cheat: { syntax: 'git pull\ngit push', note: 'Push rejected? Pull, then push again.' },
    },
  ],
  practice: [
    {
      id: 'g05-p1',
      kind: 'write',
      conceptIds: ['g05-clone'],
      prompt: `Make your own copy of the team's repository. Its URL is \`${URL}\`.`,
      solution: `git clone ${URL}`,
      wrongExample: 'git init shop',
      hints: ['One command copies a hub repository.', '`git clone URL`'],
      explanation: '`git clone` creates `shop/` with the files, the history and the `origin` remote.',
      git: { setup: hubShop, compare: ['repo'] },
    },
    {
      id: 'g05-p2',
      kind: 'write',
      conceptIds: ['g05-push'],
      prompt: '`about.html` is written. Commit it, and **share it on the hub** so Sam can get it.',
      solution: 'git add about.html\ngit commit -m "Add about page"\ngit push',
      wrongExample: 'git add about.html\ngit commit -m "Add about page"',
      hints: ['Add and commit as usual…', '…then send it with `git push`.'],
      explanation: 'A commit stays on your computer until `git push`.',
      git: { setup: [...cloned, 'echo "<h1>About us</h1>" > about.html'], compare: ['repo', 'hub'] },
    },
    {
      id: 'g05-p3',
      kind: 'readQuery',
      conceptIds: ['g05-tracking'],
      prompt: 'Read the status. What does it mean?',
      sql: 'git status',
      choices: ['The hub has 2 commits you don\'t', 'You have 2 commits the hub doesn\'t (as of your last contact): push them', '2 files are staged', 'You\'re 2 branches away from main'],
      answer: 1,
      explanation: '"Ahead by 2": two local commits that aren\'t on `origin/main`. `git push` sends them.',
      hints: [],
      git: { setup: [...cloned, ...mine, 'echo "<p>Hi</p>" >> index.html', 'git commit -qam "Greeting"'] },
    },
    {
      id: 'g05-p4',
      kind: 'write',
      conceptIds: ['g05-fetch'],
      prompt: 'Sam may have pushed something. **Download** what\'s new on the hub, **without** changing your `main` or your files.',
      solution: 'git fetch',
      wrongExample: 'git pull',
      hints: ['Not pull: that merges too.'],
      explanation: '`git fetch` only moves `origin/main`. Your branch and files stay put.',
      git: { setup: samPushed, compare: ['repo', 'files'] },
    },
    {
      id: 'g05-p5',
      kind: 'write',
      conceptIds: ['g05-pull'],
      prompt: 'Sam pushed a sale banner. Bring it into your `main` (and your files).',
      solution: 'git pull',
      wrongExample: 'git fetch',
      hints: ['Fetch and merge in one command.'],
      explanation: '`git pull` fetches and merges; here it\'s a fast-forward.',
      git: { setup: samPushed, compare: ['repo', 'files'] },
    },
    {
      id: 'g05-p6',
      kind: 'fixBug',
      conceptIds: ['g05-rejected'],
      prompt: 'Your push was **rejected** because Sam pushed first. Fix the commands so your about page reaches the hub **and Sam\'s banner stays there**.',
      starterSql: 'git push',
      solution: 'git pull\ngit push',
      wrongExample: 'git push --force',
      hints: ['The hub has a commit you don\'t.', 'Bring it in first.'],
      explanation: 'Pull (here a merge of different files), then push. `--force` would delete Sam\'s commit from the hub.',
      git: { setup: [...samPushed, ...mine], compare: ['repo', 'hub'] },
    },
    {
      id: 'g05-p7',
      kind: 'write',
      conceptIds: ['g05-push'],
      prompt: 'Your branch **`about`** exists only on your computer. Push it to the hub and **set its upstream**, so later a plain `git push` works.',
      solution: 'git push -u origin about',
      wrongExample: 'git push',
      hints: ['A new branch\'s first push names the remote and the branch.', '`-u` sets the upstream.'],
      explanation: '`git push -u origin about` creates `about` on the hub and makes your branch track `origin/about`.',
      git: { setup: [...cloned, 'git switch -qc about', ...mine], compare: ['repo', 'hub'] },
    },
    {
      id: 'g05-p8',
      kind: 'readQuery',
      conceptIds: ['g05-tracking'],
      prompt: 'Sam pushed a commit a minute ago, but your `git status` says "up to date". Why?',
      sql: 'git status',
      choices: ['Sam\'s push failed', '`origin/main` only moves when you contact the hub (fetch, pull, push)', 'Status ignores other people\'s commits', 'You\'re on the wrong branch'],
      answer: 1,
      explanation: 'Status compares with your bookmark from the last contact. `git fetch` first to see the truth.',
      hints: [],
      git: { setup: samPushed },
    },
    {
      id: 'g05-p9',
      kind: 'parsons',
      conceptIds: ['g05-pull', 'g05-push'],
      prompt: 'Put a good day\'s work in order: catch up with the hub, write the about page, commit it, and share it.',
      blocks: ['git pull', 'echo "<h1>About us</h1>" > about.html', 'git add about.html', 'git commit -m "Add about page"', 'git push'],
      distractors: ['git push --force'],
      wrongOrder: ['git pull', 'git push', 'echo "<h1>About us</h1>" > about.html', 'git add about.html', 'git commit -m "Add about page"'],
      explanation: 'Pull first, work and commit, push last. A push before the commit sends nothing new.',
      hints: ['Push sends commits, so it comes after the commit.'],
      git: { setup: samPushed, compare: ['repo', 'hub'] },
    },
    {
      id: 'g05-p10',
      kind: 'write',
      conceptIds: ['g05-fetch', 'g05-tracking'],
      prompt: 'Find out the **truth** about your `main` compared with the hub: first update what you know about the hub (without merging), then show the status.',
      solution: 'git fetch\ngit status',
      wrongExample: 'git status',
      hints: ['Status alone uses an old bookmark.', '`git fetch`, then `git status`.'],
      explanation: 'After the fetch, status says "behind \'origin/main\' by 1 commit".',
      git: { setup: samPushed, compare: ['repo', 'stdout'] },
    },
  ],
  test: [
    {
      id: 'g05-t1',
      kind: 'fillBlank',
      conceptIds: ['g05-clone'],
      prompt: 'Fill in the blank to copy the team\'s repository to your computer.',
      starterSql: `git ___ ${URL}`,
      solution: `git clone ${URL}`,
      wrongExample: `git pull ${URL}`,
      hints: [],
      explanation: '`git clone URL`.',
      git: { setup: hubShop, compare: ['repo'] },
    },
    {
      id: 'g05-t2',
      kind: 'write',
      conceptIds: ['g05-push'],
      prompt: 'You committed an about page. Send it to the hub.',
      solution: 'git push',
      wrongExample: 'git fetch',
      hints: [],
      explanation: '`git push` sends your new commits to `origin`.',
      git: { setup: [...cloned, ...mine], compare: ['repo', 'hub'] },
    },
    {
      id: 'g05-t3',
      kind: 'readQuery',
      conceptIds: ['g05-fetch', 'g05-pull'],
      prompt: 'What\'s the difference between `git fetch` and `git pull`?',
      choices: ['None', 'fetch only downloads (moves origin/main); pull downloads and merges into your branch', 'fetch sends, pull receives', 'pull only works on new branches'],
      answer: 1,
      explanation: '`pull` = `fetch` + `merge`.',
      hints: [],
    },
    {
      id: 'g05-t4',
      kind: 'write',
      conceptIds: ['g05-rejected'],
      prompt: 'Sam pushed after you cloned, and you have a commit of your own. Get your commit onto the hub **without losing Sam\'s**.',
      solution: 'git pull\ngit push',
      wrongExample: 'git push',
      hints: [],
      explanation: 'Pull, then push.',
      git: { setup: [...samPushed, ...mine], compare: ['repo', 'hub'] },
    },
    {
      id: 'g05-t5',
      kind: 'readQuery',
      conceptIds: ['g05-rejected'],
      prompt: 'Why was this push rejected?',
      sql: 'git push # fails',
      expectError: true,
      choices: ['You have no permission', 'The hub has commits (Sam\'s) that your main doesn\'t contain', 'Your commit has a conflict', 'You forgot `-u`'],
      answer: 1,
      explanation: '"fetch first": the hub has work you haven\'t pulled. Pushing would remove it, so the hub refuses.',
      hints: [],
      git: { setup: [...samPushed, ...mine] },
    },
    {
      id: 'g05-t6',
      kind: 'write',
      conceptIds: ['g05-pull', 'g05-rejected'],
      prompt: 'You and Sam both changed the title. Sam pushed first. Pull, resolve the conflict keeping **your** title (`<h1>Our Shop</h1>`), and push the result.',
      solution: 'git pull\necho "<h1>Our Shop</h1>" > index.html\ngit add index.html\ngit commit -m "Merge the hub\'s main"\ngit push',
      wrongExample: 'git pull\ngit add index.html\ngit commit -m "Merge the hub\'s main"\ngit push',
      hints: [],
      explanation: 'A pull can conflict like any merge: edit, add, commit, then push.',
      git: { setup: titleClash, compare: ['repo', 'files', 'hub'] },
    },
  ],
};
