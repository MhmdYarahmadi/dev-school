import type { Module } from '../../../content/types';

const URL = 'https://hub.zilber.tech/team/shop.git';
/** The team's repository: Sam's first commit, `main` protected (pull requests with an approval only). */
const hubTeam = [
  '@hub init team/shop',
  `@sam git clone -q ${URL}`,
  '@sam cd shop',
  '@sam echo "<h1>Shop</h1>" > index.html',
  '@sam echo "body { color: navy; }" > style.css',
  '@sam git add .',
  '@sam git commit -qm "Add home page"',
  '@sam git push -q',
  '@hub protect team/shop main --require-approval',
];
/** …and your clone, in ~/shop. */
const team = [...hubTeam, `git clone -q ${URL}`, 'cd shop'];
/** A footer commit on your branch `footer` (not pushed). */
const footerCommitted = [...team, 'git switch -qc footer', 'echo "<footer>Shop</footer>" >> index.html', 'git commit -qam "Add footer"'];
const footerPushed = [...footerCommitted, 'git push -qu origin footer'];
const prOpen = [...footerPushed, 'gh pr create --title "Add footer" --body "A footer for the home page"'];
const changesAsked = [...prOpen, '@sam gh pr review 1 --request-changes --body "Looks good! Please add our phone number to the footer: 555-0100"'];
const approved = [...prOpen, '@sam gh pr review 1 --approve'];
const mergedBySam = [...approved, '@sam gh pr merge 1 --merge'];

export const g06: Module = {
  id: 'g06',
  number: 6,
  title: 'Team workflow: pull requests',
  tagline: 'How teams really work: a branch per change, a pull request, a review, then merge on the hub.',
  games: [],
  concepts: [
    {
      id: 'g06-feature',
      title: 'A branch for every change',
      env: { setup: team },
      card: `Teams keep \`main\` working at all times. Every change, however small, is made on its own **feature branch**:

1. \`git switch -c footer\` (from an up-to-date \`main\`: pull first);
2. commit your work there, as many commits as you need;
3. \`git push -u origin footer\`: put the branch on the hub.

Pushing a branch doesn't change \`main\`, so you can share unfinished work safely. Name branches after what they do: \`footer\`, \`fix-typo\`, \`contact-page\`.`,
      predict: {
        sql: 'git switch -c footer\necho "<footer>Shop</footer>" >> index.html\ngit commit -qam "Add footer"\ngit push -u origin footer',
        question: 'You pushed `footer` to the hub. What changed on the hub?',
        choices: ['main now has the footer', 'A new branch `footer` with your commit; main is unchanged', 'Nothing until Sam pulls', 'A pull request was opened'],
        answer: 1,
        why: 'Pushing a branch creates (or updates) that branch on the hub. main only changes when the branch is merged.',
        verify: ['\\* \\[new branch\\]      footer -> footer', "branch 'footer' set up to track 'origin/footer'\\."],
      },
      example: { sql: 'git pull\ngit switch -c footer\necho "<footer>Shop</footer>" >> index.html\ngit commit -am "Add footer"\ngit push -u origin footer\ngit branch -a', note: 'The 🌐 Hub tab now lists two branches: main and footer.' },
      cheat: { syntax: 'git switch -c NAME\ngit push -u origin NAME', note: 'Start a feature branch; put it on the hub.' },
    },
    {
      id: 'g06-pr',
      title: 'Opening a pull request',
      env: { setup: footerPushed },
      card: `A **pull request** (PR) asks the team: *"please merge my branch into main"*. On the hub it shows the commits, the changes (a diff) and a conversation, where teammates review before anything reaches \`main\`.

Open one in the 🌐 Hub tab, or from the terminal with \`gh\`, the hub's command-line tool (the same commands as GitHub's \`gh\`):

\`\`\`
gh pr create --title "Add footer" --body "A footer for the home page"
\`\`\`

\`gh pr list\` lists open PRs, \`gh pr view 1\` shows one, \`gh pr diff 1\` shows its changes. A PR is about a **branch**: push more commits to the branch and the PR updates by itself.`,
      predict: {
        sql: 'gh pr create --title "Add footer" --body "A footer for the home page"\ngh pr list',
        question: 'What does `gh pr create` do?',
        choices: ['Merges footer into main', 'Opens a request, on the hub, to merge footer into main', 'Pushes the branch', 'Sends an email to Sam'],
        answer: 1,
        why: 'It opens PR #1 (from footer into main). Nothing is merged yet.',
        verify: ['https://hub\\.zilber\\.tech/team/shop/pull/1', '#1\\s+Add footer\\s+footer'],
      },
      example: { sql: 'gh pr create --title "Add footer" --body "A footer for the home page"\ngh pr view 1\ngh pr diff 1', note: 'The 🌐 Hub tab shows the PR too, with a Merge button (blocked until someone approves).' },
      cheat: { syntax: 'gh pr create --title "…" --body "…"\ngh pr list\ngh pr view N', note: 'Open a pull request; list them; show one.' },
    },
    {
      id: 'g06-review',
      title: 'Reviews: fix and push again',
      env: { setup: changesAsked },
      card: `Teammates **review** a PR: they read the diff and either **approve** it or **request changes** with a comment.

When changes are requested, you don't open a new PR. You just:

1. make the change on the **same branch**,
2. commit,
3. \`git push\`.

The PR picks up the new commit by itself, and the reviewer looks again. Reviewing each other's code catches bugs early and spreads knowledge through the team. (You can't approve your own PR.)`,
      predict: {
        sql: 'echo "<p>Call us: 555-0100</p>" >> index.html\ngit commit -qam "Add phone number"\ngit push -q\ngh pr view 1',
        question: 'You pushed a new commit to `footer`. What happens to PR #1?',
        choices: ['You need to open PR #2', 'PR #1 now has 2 commits: it follows the branch', 'The PR is closed', 'The commit goes straight to main'],
        answer: 1,
        why: 'A PR shows its branch. New commits on the branch appear in it automatically.',
        verify: ['wants to merge 2 commits into main from footer'],
      },
      example: { sql: 'gh pr view 1\necho "<p>Call us: 555-0100</p>" >> index.html\ngit commit -am "Add phone number to footer"\ngit push\n@sam gh pr review 1 --approve\ngh pr view 1', note: 'After the fix, Sam approves (the `@sam` line runs on Sam\'s computer), and the PR is ready to merge.' },
      cheat: { syntax: '(edit)\ngit commit -am "…"\ngit push', note: 'Answer a review: commit on the same branch and push; the PR updates.' },
    },
    {
      id: 'g06-merge',
      title: 'Merging the PR, then cleaning up',
      env: { setup: approved },
      card: `Once a PR is approved, merge it on the hub: the **Merge** button in the 🌐 Hub tab, or

\`\`\`
gh pr merge 1 --merge
\`\`\`

The hub makes a merge commit on its \`main\` ("Merge pull request #1 from …"). Your computer doesn't know yet. Clean up:

1. \`git switch main\`
2. \`git pull\`: get the merge;
3. \`git branch -d footer\`: the branch is merged, its label isn't needed.

\`gh pr merge 1 --merge --delete-branch\` does all of that for you, and deletes the branch on the hub too.`,
      predict: {
        sql: 'gh pr merge 1 --merge\ngit log --oneline -1 origin/main',
        question: 'You merged PR #1 on the hub. Has your local `main` changed?',
        choices: ['Yes: merging on the hub updates everyone', 'No: the hub\'s main has a merge commit; your main gets it with `git pull`', 'Yes, but only the files', 'The PR merge fails'],
        answer: 1,
        why: 'The merge happened on the hub. Your main is untouched until you switch to it and pull (origin/main isn\'t even updated until you fetch).',
        verify: ['✓ Merged pull request #1 \\(Add footer\\)'],
      },
      example: { sql: 'gh pr merge 1 --merge\ngit switch main\ngit pull\ngit branch -d footer\ngit log --oneline --graph', note: 'The graph shows the merge commit made on the hub, now in your main too.' },
      cheat: { syntax: 'gh pr merge N --merge\ngit switch main\ngit pull\ngit branch -d NAME', note: 'Merge a PR, update main, delete the branch.' },
    },
    {
      id: 'g06-protected',
      title: 'A protected main',
      env: { setup: team },
      card: `Most teams **protect** \`main\` on the hub:

- no direct pushes: every change goes through a pull request;
- often a required **approval** from someone else before merging.

Pushing commits on \`main\` gets refused:

\`\`\`
 ! [remote rejected] main -> main (protected branch hook declined)
\`\`\`

That's not an error to work around; it's the rule. Put the work on a branch, push the branch, open a PR. (Our team's \`main\` is protected, with one approval required.)`,
      predict: {
        sql: 'echo "<p>Hi</p>" >> index.html\ngit commit -qam "Greeting"\ngit push # fails',
        question: 'main is protected. You committed on main and push. What happens?',
        choices: ['It works', 'The hub refuses: changes must go through a pull request', 'Git opens a PR automatically', 'Sam is asked to approve the push'],
        answer: 1,
        why: 'A protected branch only changes through merged pull requests.',
        expectError: true,
        verify: ['Changes must be made through a pull request', '! \\[remote rejected\\] main -> main \\(protected branch hook declined\\)'],
      },
      example: { sql: 'git switch -c greeting\necho "<p>Hi</p>" >> index.html\ngit commit -am "Add greeting"\ngit push -u origin greeting\ngh pr create --title "Add greeting" --body "Say hello on the home page"', note: 'The right way: a branch, a push, a PR.' },
      cheat: { syntax: 'remote rejected … (protected branch hook declined)', note: 'main is protected: use a branch and a pull request.' },
    },
    {
      id: 'g06-messages',
      title: 'Good commit messages',
      env: { setup: [...team, 'git switch -qc tidy', 'echo "<p>a</p>" >> index.html', 'git commit -qam "stuff"', 'echo "<p>b</p>" >> index.html', 'git commit -qam "fix"', 'echo "footer { color: gray; }" >> style.css', 'git commit -qam "Make the footer text gray"'] },
      card: `Your history is read by teammates (and by you, in six months). A good commit message:

- **subject line** (the first line) says what the commit does, in the imperative: *"Add footer"*, *"Fix typo in the price list"*, not *"stuff"*, *"fix"* or *"changes"*;
- keeps the subject short (about 50 characters), so \`git log --oneline\` stays readable;
- optionally a blank line, then a **body** saying *why*.

One change per commit (module 1) makes good messages easy to write. Pull request titles follow the same rules.`,
      predict: {
        sql: 'git log --oneline -3',
        question: 'Which of these commits will a teammate understand without opening it?',
        choices: ['"stuff"', '"fix"', '"Make the footer text gray"', 'All three equally'],
        answer: 2,
        why: 'Only that subject says what changed. "stuff" and "fix" force everyone to read the diff.',
        verify: ['Make the footer text gray\\n[0-9a-f]{7} fix\\n[0-9a-f]{7} stuff'],
      },
      example: { sql: 'git log --oneline\ngit show --stat HEAD~1', note: 'With a vague message, you have to read the change to know what "fix" fixed.' },
      cheat: { syntax: 'git commit -m "Add footer to the home page"', note: 'Imperative, specific, short subject line.' },
    },
  ],
  practice: [
    {
      id: 'g06-p1',
      kind: 'write',
      conceptIds: ['g06-feature'],
      prompt: 'Start a feature branch **`footer`**, commit the line `<footer>Shop</footer>` added to the end of `index.html`, and **put the branch on the hub** with its upstream set.',
      solution: 'git switch -c footer\necho "<footer>Shop</footer>" >> index.html\ngit commit -am "Add footer"\ngit push -u origin footer',
      wrongExample: 'echo "<footer>Shop</footer>" >> index.html\ngit commit -am "Add footer"\ngit push',
      hints: ['Branch first, then commit.', '`git push -u origin footer`'],
      explanation: 'Branch, commit, push the branch. main stays untouched (locally and on the hub).',
      git: { setup: team, compare: ['repo', 'hub'] },
    },
    {
      id: 'g06-p2',
      kind: 'write',
      conceptIds: ['g06-pr'],
      prompt: '`footer` is on the hub. **Open a pull request** to merge it into `main`, titled **Add footer** (any description). Use `gh` in the terminal or the 🌐 Hub tab.',
      solution: 'gh pr create --title "Add footer" --body "A footer for the home page"',
      wrongExample: 'git push',
      hints: ['`gh pr create` with `--title` and `--body`.'],
      explanation: '`gh pr create` opens PR #1 from your current branch into main.',
      git: { setup: footerPushed, compare: ['hub'] },
    },
    {
      id: 'g06-p3',
      kind: 'readQuery',
      conceptIds: ['g06-review'],
      prompt: 'Read the pull request. What happens next?',
      sql: 'gh pr view 1',
      choices: ['Merge it now', 'Add the phone number on `footer`, commit and push: the PR updates', 'Open a new pull request with the phone number', 'Sam will add it'],
      answer: 1,
      explanation: 'Sam requested changes, so it can\'t merge yet. Fix it on the same branch and push.',
      hints: [],
      git: { setup: changesAsked },
    },
    {
      id: 'g06-p4',
      kind: 'write',
      conceptIds: ['g06-review'],
      prompt: 'Sam asked for the phone number. Add the line `<p>Call us: 555-0100</p>` to the end of `index.html` on your branch, commit it, and **update the pull request**.',
      solution: 'echo "<p>Call us: 555-0100</p>" >> index.html\ngit commit -am "Add phone number to footer"\ngit push',
      wrongExample: 'echo "<p>Call us: 555-0100</p>" >> index.html\ngit commit -am "Add phone number to footer"',
      hints: ['You\'re already on `footer`.', 'The PR follows the branch on the hub: push.'],
      explanation: 'Commit and push on the same branch; PR #1 now shows both commits.',
      git: { setup: changesAsked, compare: ['repo', 'hub'] },
    },
    {
      id: 'g06-p5',
      kind: 'write',
      conceptIds: ['g06-merge'],
      prompt: 'Sam approved PR #1. **Merge it on the hub** (with a merge commit).',
      solution: 'gh pr merge 1 --merge',
      wrongExample: 'git switch main\ngit merge footer',
      hints: ['`gh pr merge` (or the Merge button in the 🌐 Hub tab).', '`--merge` asks for a merge commit.'],
      explanation: 'The hub merges the PR into its main. A local `git merge` only changes your computer, and main is protected anyway.',
      git: { setup: approved, compare: ['hub'] },
    },
    {
      id: 'g06-p6',
      kind: 'write',
      conceptIds: ['g06-merge'],
      prompt: 'Sam merged your PR on the hub. **Clean up**: get the merged `main` onto your computer and delete your local `footer` branch.',
      solution: 'git switch main\ngit pull\ngit branch -d footer',
      wrongExample: 'git pull\ngit branch -d footer',
      hints: ['You\'re still on `footer`.', 'Switch to main, pull, then delete the branch.'],
      explanation: 'On main, `git pull` brings the merge commit; then `-d` sees footer is merged.',
      git: { setup: mergedBySam, compare: ['repo'] },
    },
    {
      id: 'g06-p7',
      kind: 'fixBug',
      conceptIds: ['g06-protected', 'g06-feature'],
      prompt: 'These commands try to push straight to the protected `main`, and the hub refuses. **Fix them**: put the change on a branch called **`greeting`** and push that branch (with upstream). Leave `main` alone.',
      starterSql: 'echo "<p>Hi</p>" >> index.html\ngit commit -am "Add greeting"\ngit push',
      solution: 'git switch -c greeting\necho "<p>Hi</p>" >> index.html\ngit commit -am "Add greeting"\ngit push -u origin greeting',
      wrongExample: 'echo "<p>Hi</p>" >> index.html\ngit commit -am "Add greeting"\ngit push --force',
      hints: ['Create the branch before committing.', '`git push -u origin greeting`'],
      explanation: 'Protected main means: branch, push the branch, open a PR. Forcing doesn\'t get past the protection either.',
      git: { setup: team, compare: ['repo', 'hub'] },
    },
    {
      id: 'g06-p8',
      kind: 'parsons',
      conceptIds: ['g06-feature', 'g06-pr'],
      prompt: 'Put the team workflow in order: start a branch, commit, push it, open a pull request.',
      blocks: ['git switch -c contact', 'echo "<p>Call us</p>" > contact.html', 'git add contact.html', 'git commit -m "Add contact page"', 'git push -u origin contact', 'gh pr create --title "Add contact page" --body "A page with our phone number"'],
      distractors: ['git push origin main'],
      wrongOrder: ['git switch -c contact', 'echo "<p>Call us</p>" > contact.html', 'git add contact.html', 'git commit -m "Add contact page"', 'gh pr create --title "Add contact page" --body "A page with our phone number"', 'git push -u origin contact'],
      explanation: 'A pull request needs the branch on the hub, so push comes before `gh pr create`.',
      hints: ['The hub must have the branch before a PR can point at it.'],
      git: { setup: team, compare: ['repo', 'hub'] },
    },
    {
      id: 'g06-p9',
      kind: 'readQuery',
      conceptIds: ['g06-messages'],
      prompt: 'Which is the best commit message for a commit that adds a phone number to the footer?',
      choices: ['"update"', '"Add phone number to the footer"', '"I added the phone number that Sam asked for in the review yesterday afternoon"', '"footer stuff"'],
      answer: 1,
      explanation: 'Short, specific, imperative. Details (like who asked) can go in the body.',
      hints: [],
    },
    {
      id: 'g06-p10',
      kind: 'readQuery',
      conceptIds: ['g06-protected'],
      prompt: 'You committed on `main` and pushed. Read the output: what now?',
      sql: 'echo "<p>Hi</p>" >> index.html\ngit commit -qam "Greeting"\ngit push # fails',
      expectError: true,
      choices: ['Push again with `--force`', 'Put the work on a branch, push the branch and open a pull request', 'Ask Sam to push it', 'Delete main'],
      answer: 1,
      explanation: '"protected branch hook declined": main only changes through pull requests.',
      hints: [],
      git: { setup: team },
    },
  ],
  test: [
    {
      id: 'g06-t1',
      kind: 'write',
      conceptIds: ['g06-feature'],
      prompt: 'Start a branch **`contact`**, add a file `contact.html` containing `<p>Call us</p>` in a commit, and push the branch to the hub with its upstream set.',
      solution: 'git switch -c contact\necho "<p>Call us</p>" > contact.html\ngit add contact.html\ngit commit -m "Add contact page"\ngit push -u origin contact',
      wrongExample: 'git switch -c contact\necho "<p>Call us</p>" > contact.html\ngit add contact.html\ngit commit -m "Add contact page"\ngit push origin main',
      hints: [],
      explanation: 'Branch, commit, `git push -u origin contact`.',
      git: { setup: team, compare: ['repo', 'hub'] },
    },
    {
      id: 'g06-t2',
      kind: 'write',
      conceptIds: ['g06-pr'],
      prompt: 'Open a pull request for your pushed branch `footer` into `main` (any title and description).',
      solution: 'gh pr create --title "Add footer" --body "A footer for the home page"',
      wrongExample: 'git merge footer',
      hints: [],
      explanation: '`gh pr create --title … --body …` (or the 🌐 Hub tab).',
      git: { setup: footerPushed, compare: ['hub'] },
    },
    {
      id: 'g06-t3',
      kind: 'readQuery',
      conceptIds: ['g06-protected'],
      prompt: 'Why do teams protect `main` on the hub?',
      choices: ['To make Git faster', 'So every change is reviewed in a pull request before it reaches main', 'To stop anyone from reading main', 'Because main can\'t have merge commits'],
      answer: 1,
      explanation: 'Protection forces changes through PRs (and approvals), keeping main working.',
      hints: [],
    },
    {
      id: 'g06-t4',
      kind: 'write',
      conceptIds: ['g06-review'],
      prompt: 'Sam requested a change on PR #1: add `<p>Call us: 555-0100</p>` to the end of `index.html`. Do it and update the PR.',
      solution: 'echo "<p>Call us: 555-0100</p>" >> index.html\ngit commit -am "Add phone number to footer"\ngit push',
      wrongExample: 'echo "<p>Call us: 555-0100</p>" >> index.html\ngit commit -am "Add phone number to footer"\ngit push origin main',
      hints: [],
      explanation: 'Same branch, commit, push.',
      git: { setup: changesAsked, compare: ['repo', 'hub'] },
    },
    {
      id: 'g06-t5',
      kind: 'write',
      conceptIds: ['g06-merge'],
      prompt: 'PR #1 is approved. Merge it on the hub, then update your local `main` (end on `main`).',
      solution: 'gh pr merge 1 --merge\ngit switch main\ngit pull',
      wrongExample: 'gh pr merge 1 --merge',
      hints: [],
      explanation: 'Merge on the hub, then switch to main and pull the merge commit.',
      git: { setup: approved, compare: ['repo', 'hub'] },
    },
    {
      id: 'g06-t6',
      kind: 'readQuery',
      conceptIds: ['g06-messages'],
      prompt: 'Which commit subject line follows the usual rules?',
      choices: ['"Fixed some things"', '"Fix price of green tea on the menu"', '"WIP"', '"changes from today"'],
      answer: 1,
      explanation: 'Imperative ("Fix"), specific, short.',
      hints: [],
    },
  ],
  project: {
    id: 'g06-project',
    title: 'Ship a feature with a team',
    story: `You've joined the team behind **team/shop** on the hub. Sam is your teammate; \`main\` is protected (pull requests with one approval). Your job: add a **contact page**, from the first clone to a merged pull request, including a review and a clash with Sam's work.

Each task starts from a prepared machine (lines with \`@sam\` run on Sam's computer). Work in the terminal as you would for real; every requirement is checked by running a command on your result.`,
    tasks: [
      {
        id: 'g06-proj-1',
        prompt: `**Join the team.** Clone \`${URL}\` into \`~/shop\`, and start a feature branch called **\`contact\`** from the latest \`main\`.`,
        requirements: [
          { label: '`~/shop` is a clone of team/shop (`origin` points to the hub)', sql: 'cd ~/shop && git remote -v', expect: 'origin\\thttps://hub\\.zilber\\.tech/team/shop\\.git \\(push\\)' },
          { label: 'You\'re on a branch called `contact`', sql: 'cd ~/shop && git branch --show-current', expect: '^contact$' },
          { label: '`contact` starts at the hub\'s latest `main` (with Sam\'s merged opening hours)', sql: 'cd ~/shop && git log --oneline -1', expect: 'Merge pull request #1 from team/hours' },
        ],
        referenceSolution: `git clone ${URL}\ncd shop\ngit switch -c contact`,
        discussion: '`git clone` gives you the whole history and `origin`. Starting the branch right after cloning (or after `git pull` on main) means it begins at the team\'s latest work.',
        hints: ['`git clone URL`, then `cd shop`.', '`git switch -c contact`'],
        git: { setup: [...hubTeam, '@sam echo "<p>Open 9-5</p>" >> index.html', '@sam git switch -qc hours', '@sam git commit -qam "Add opening hours"', '@sam git push -qu origin hours', '@sam gh pr create --fill', '@hub protect team/shop main', '@sam gh pr merge 1 --merge --delete-branch'] },
      },
      {
        id: 'g06-proj-2',
        prompt: 'You\'re on `contact` in `~/shop`. **Build the feature**: a new file `contact.html` containing `<p>Call us: 555-0100</p>`, and a link to it at the end of `index.html`: `<a href="contact.html">Contact</a>`. Commit your work on `contact` with good messages (one commit or two). Leave `main` alone and the folder clean.',
        requirements: [
          { label: 'The newest commit on `contact` has `contact.html` with the phone number', sql: 'git show contact:contact.html', expect: 'Call us: 555-0100' },
          { label: '`index.html` on `contact` links to the page', sql: 'git show contact:index.html', expect: '<a href="contact.html">Contact</a>' },
          { label: '`main` is unchanged (no new commits)', sql: 'git log --oneline origin/main..main', expect: '^$' },
          { label: 'Nothing left uncommitted', sql: 'git status --short', expect: '^$' },
        ],
        referenceSolution: 'echo "<p>Call us: 555-0100</p>" > contact.html\necho \'<a href="contact.html">Contact</a>\' >> index.html\ngit add contact.html index.html\ngit commit -m "Add contact page with a link from the home page"',
        discussion: 'One commit for a small feature is fine; two ("Add contact page", "Link to contact page") is also fine. What matters: the work is on `contact`, the messages say what changed, and nothing is left behind.',
        hints: ['`echo "…" > contact.html` creates the file; `>>` appends to `index.html`. The ✏️ Files tab works too.', 'Single quotes around the link line keep its double quotes intact.'],
        git: { setup: [...team, 'git switch -qc contact'] },
      },
      {
        id: 'g06-proj-3',
        prompt: 'Your `contact` branch has its commit. **Open a pull request**: put the branch on the hub (with its upstream set) and open a PR into `main` titled **Add contact page**.',
        requirements: [
          { label: '`contact` is on the hub, and your branch tracks it', sql: 'git status', expect: "Your branch is up to date with 'origin/contact'" },
          { label: 'A pull request from `contact` is open', sql: 'gh pr list', expect: '#1\\s+Add contact page\\s+contact' },
        ],
        referenceSolution: 'git push -u origin contact\ngh pr create --title "Add contact page" --body "A contact page with our phone number, linked from the home page"',
        discussion: 'The PR needs the branch on the hub first. A useful description says what and why, so the reviewer knows what to look for.',
        hints: ['`git push -u origin contact`', '`gh pr create --title "Add contact page" --body "…"` (or the 🌐 Hub tab).'],
        git: { setup: [...team, 'git switch -qc contact', 'echo "<p>Call us: 555-0100</p>" > contact.html', 'echo \'<a href="contact.html">Contact</a>\' >> index.html', 'git add .', 'git commit -qm "Add contact page"'] },
      },
      {
        id: 'g06-proj-4',
        prompt: `**Review and a clash.** Sam reviewed PR #1: *"Please make the link text **Contact us**."* Meanwhile Sam also merged a change into \`main\` that added a line at the end of \`index.html\`, right where your link is, so your PR now **conflicts** with main.

Fix both on \`contact\`: bring the hub's \`main\` into your branch, resolve the conflict keeping **Sam's line and your link** (with the new text \`Contact us\`), and push. When Sam approves, the PR must be mergeable.`,
        requirements: [
          { label: 'The pushed `index.html` has the link as `<a href="contact.html">Contact us</a>`', sql: 'git show origin/contact:index.html', expect: '<a href="contact.html">Contact us</a>' },
          { label: 'Sam\'s line from main is kept', sql: 'git show origin/contact:index.html', expect: 'Free delivery' },
          { label: 'No conflict markers in what you pushed', sql: 'git show origin/contact:index.html | grep "<<<<<<<"', code: 1 },
          { label: 'After Sam approves, the PR is ready to merge', sql: '@sam gh pr review 1 --approve\ngh pr view 1', expect: 'Merge: ready to merge' },
        ],
        referenceSolution: 'git pull origin main\ncat > index.html <<\'EOF\'\n<h1>Shop</h1>\n<p>Free delivery</p>\n<a href="contact.html">Contact us</a>\nEOF\ngit add index.html\ngit commit -m "Merge main into contact"\ngit push',
        discussion: '`git pull origin main` (or `git fetch` + `git merge origin/main`) brings main\'s new commit into your branch, so the conflict is resolved on your side, where you can test it. Then one push updates the PR with both the review fix and the merge. Rebasing is another way some teams do this; merging is the simplest and never rewrites shared history.',
        hints: ['`git pull origin main` merges the hub\'s main into the branch you\'re on.', 'Keep both lines in the conflict, change `Contact` to `Contact us`, delete the markers, then `git add`, `git commit`, `git push`.'],
        git: {
          setup: [
            ...team,
            'git switch -qc contact',
            'echo "<p>Call us: 555-0100</p>" > contact.html',
            'echo \'<a href="contact.html">Contact</a>\' >> index.html',
            'git add .',
            'git commit -qm "Add contact page"',
            'git push -qu origin contact',
            'gh pr create --title "Add contact page" --body "A contact page"',
            '@sam gh pr review 1 --request-changes --body "Please make the link text Contact us"',
            '@sam git switch -qc delivery',
            '@sam echo "<p>Free delivery</p>" >> index.html',
            '@sam git commit -qam "Free delivery"',
            '@sam git push -qu origin delivery',
            '@sam gh pr create --fill',
            'gh pr review 2 --approve',
            '@sam gh pr merge 2 --merge --delete-branch',
          ],
        },
      },
      {
        id: 'g06-proj-5',
        prompt: '**Ship it.** Sam approved PR #1. Merge it on the hub, then tidy up: your local `main` up to date with the hub\'s, you on `main`, and the `contact` branch deleted (locally and on the hub).',
        requirements: [
          { label: 'PR #1 is merged', sql: 'gh pr view 1', expect: '^Merged' },
          { label: 'You\'re on `main`, up to date with the hub', sql: 'git fetch -q\ngit status', expect: "On branch main\\nYour branch is up to date with 'origin/main'" },
          { label: 'Your `main` has the merge of PR #1', sql: 'git log --oneline -1', expect: 'Merge pull request #1 from team/contact' },
          // The lookbehind pins the check to the start of the output: no "contact" anywhere in it.
          { label: 'No local `contact` branch', sql: 'git branch', expect: '(?<![\\s\\S])(?![\\s\\S]*contact)' },
          { label: 'No `contact` branch on the hub', sql: 'gh repo view', expect: '^Branches: main$' },
        ],
        referenceSolution: 'gh pr merge 1 --merge --delete-branch',
        discussion: '`--delete-branch` does the whole tidy-up: deletes the branch on the hub, switches you to main, pulls the merge and deletes your local branch. By hand: `gh pr merge 1 --merge`, `git switch main`, `git pull`, `git branch -d contact`, `git push origin --delete contact`.',
        hints: ['`gh pr merge 1 --merge` (or the 🌐 Hub tab), then `git switch main` and `git pull`.', '`git branch -d contact` locally; `git push origin --delete contact` on the hub. Or let `--delete-branch` do it all.'],
        git: { setup: [...team, 'git switch -qc contact', 'echo "<p>Call us: 555-0100</p>" > contact.html', 'echo \'<a href="contact.html">Contact us</a>\' >> index.html', 'git add .', 'git commit -qm "Add contact page"', 'git push -qu origin contact', 'gh pr create --title "Add contact page" --body "A contact page"', '@sam gh pr review 1 --approve'] },
      },
    ],
  },
};
