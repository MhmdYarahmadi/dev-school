/**
 * Mission levels for the Git games: a starting machine, goals checked live against the engine,
 * a par (how many changing git commands an expert needs) and a reference solution.
 * tests/git-games.test.ts proves each mission is unsolved at the start and solved by its solution.
 */
import type { GitMachine, Repo } from '../engine';
import { computeStatus, worktreeFiles } from '../engine/worktree';
import { sha1, utf8 } from '../engine/sha1';
import { sandbox } from '../check';
import { graphData, type GraphData } from '../ui/graphLayout';
import { t } from '../../../shared/i18n';

/** Recorded right after a mission's setup ran. */
export interface MissionStart {
  /** Every commit that existed at the start (in any of the learner's repositories). */
  commits: Set<string>;
  /** HEAD of the mission's repository at the start. */
  head: string | null;
}

export interface Goal {
  label: string;
  check: (m: GitMachine, start: MissionStart) => boolean;
}

export interface GitMission {
  title: string;
  story: string;
  /** Setup lines (run as in exercises: `@sam …` for the teammate, `@hub …` for the hub). */
  setup: string[];
  /** The repository the goals look at (relative to the home folder). */
  repo: string;
  goals: Goal[];
  par: number;
  solution: string[];
  hint: string;
  seconds: number;
  /** Branch Runner: draw the reference solution's graph as the target to reach. */
  target?: boolean;
  /** Push/Pull Race: Sam acts right after the learner's `after`-th counted git command. */
  teammate?: TeammateMove[];
}

export interface TeammateMove {
  after: number;
  /** What the learner is told, e.g. "Sam pushed “Sale banner” to main". */
  say: string;
  /** Run as Sam (each line gets the `@sam ` prefix). */
  cmds: string[];
}

/** Sam's moves due right after the learner's `count`-th counted command. */
export function teammateDue(mission: GitMission, count: number): TeammateMove[] {
  return (mission.teammate ?? []).filter((t) => t.after === count);
}

/** Runs one of Sam's moves on the machine. */
export function playTeammate(m: GitMachine, move: TeammateMove) {
  for (const c of move.cmds) m.exec(`@sam ${c}`);
}

export const HOME = '/home/learner';

// ---------------------------------------------------------------- reading the machine

export const repoOf = (m: GitMachine, name: string): Repo | undefined => m.learner.repos.get(`${HOME}/${name}`);
const fileIn = (r: Repo, sha: string | null, path: string): string | undefined => {
  const blob = r.files(sha).get(path);
  return blob === undefined ? undefined : r.objects.blob(blob);
};
/** Commits made since the start on HEAD's history, oldest first. */
export function newCommits(r: Repo, start: MissionStart): string[] {
  const out: string[] = [];
  let sha = r.headCommit();
  while (sha && !start.commits.has(sha)) {
    out.push(sha);
    sha = r.commit(sha).parents[0] ?? null;
  }
  return out.reverse();
}
/** Paths a commit changed compared with its first parent. */
export function changedBy(r: Repo, sha: string): string[] {
  const c = r.commit(sha);
  const a = r.files(c.parents[0] ?? null);
  const b = r.files(sha);
  return [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p)).sort();
}
const status = (m: GitMachine, r: Repo) => computeStatus(m.learner.fs, r);
const worktreeHas = (m: GitMachine, r: Repo, path: string) => worktreeFiles(m.learner.fs, r).get(path);

/**
 * A commit's place in the graph, ignoring its contents, hash and time: commits that existed at
 * the start are themselves; a new one is "a commit on top of these parents". Two repositories
 * with the same shape give the same keys.
 */
export function shapeKey(r: Repo, start: MissionStart): (sha: string) => string {
  const memo = new Map<string, string>();
  const key = (sha: string): string => {
    if (start.commits.has(sha)) return sha;
    const hit = memo.get(sha);
    if (hit) return hit;
    const k = sha1(utf8(`new|${r.commit(sha).parents.map(key).join(',')}`));
    memo.set(sha, k);
    return k;
  };
  return key;
}

// ---------------------------------------------------------------- goal helpers

const code = (s: string) => `\`${s}\``;
const guard = (repo: string, f: (r: Repo, m: GitMachine, start: MissionStart) => boolean) => (m: GitMachine, start: MissionStart) => {
  const r = repoOf(m, repo);
  return !!r && f(r, m, start);
};

export const isRepo = (repo: string): Goal => ({ label: t('{repo} is a Git repository', { repo: code('~/' + repo) }), check: guard(repo, () => true) });
export const newCommitCount = (repo: string, n: number): Goal => ({ label: n === 1 ? t('Exactly 1 new commit') : t('Exactly {n} new commits', { n }), check: guard(repo, (r, _m, s) => newCommits(r, s).length === n) });
export const clean = (repo: string): Goal => ({
  label: t('Nothing left to commit (`git status`: working tree clean)'),
  check: guard(repo, (r, m) => {
    const s = status(m, r);
    return !s.staged.length && !s.unstaged.length && !s.untracked.length && !s.unmerged.length;
  }),
});
/** The newest commit holds the file (with this text, when given). */
export const committed = (repo: string, path: string, text?: string): Goal => ({
  label: text ? t('The newest commit has {file} with “{text}”', { file: code(path), text }) : t('The newest commit has {file}', { file: code(path) }),
  check: guard(repo, (r, _m, s) => {
    const c = fileIn(r, r.headCommit(), path);
    return newCommits(r, s).length > 0 && c !== undefined && (!text || c.includes(text));
  }),
});
/** Never committed, never staged, but still in the folder. */
export const keptOut = (repo: string, path: string): Goal => ({
  label: t('{file} stays out of every commit and the staging area (but stays in the folder)', { file: code(path) }),
  check: guard(repo, (r, m) => !!worktreeHas(m, r, path) && !r.index.has(path) && !r.branches().some((b) => r.files(r.refs.get(`refs/heads/${b}`)!).has(path))),
});
/** The file's committed version doesn't contain the text, but the folder's does (the draft is kept, not committed). */
export const draftKept = (repo: string, path: string, text: string): Goal => ({
  label: t('The draft in {file} (“{text}”) is not committed, and not lost', { file: code(path), text }),
  check: guard(repo, (r, m) => !fileIn(r, r.headCommit(), path)?.includes(text) && !!worktreeHas(m, r, path)?.includes(text)),
});
/** New commits, oldest first, each changing exactly these files (order of the commits doesn't matter). */
export const commitsChanging = (repo: string, groups: string[][], label: string): Goal => ({
  label,
  check: guard(repo, (r, _m, s) => {
    const got = newCommits(r, s).map((c) => changedBy(r, c).join(','));
    const want = groups.map((g) => [...g].sort().join(','));
    return got.length === want.length && [...got].sort().join('|') === [...want].sort().join('|');
  }),
});
export const authoredBy = (repo: string, name: string, email: string): Goal => ({
  label: t("The newest commit's author is {name} <{email}>", { name, email }),
  check: guard(repo, (r, _m, s) => {
    const n = newCommits(r, s);
    const a = n.length ? r.commit(n[n.length - 1]).author : null;
    return !!a && a.name === name && a.email === email;
  }),
});
export const onBranch = (repo: string, branch: string): Goal => ({ label: t('HEAD is on {branch}', { branch: code(branch) }), check: guard(repo, (r) => r.branch === branch && !r.op) });

const MARKER = /^(<<<<<<< |=======$|>>>>>>> )/m;
/** The merge is finished: no merge in progress, and the newest commit is a new merge commit that brought in `branch`. */
export const mergeDone = (repo: string, branch: string): Goal => ({
  label: t('{branch} is merged: the merge is committed (a commit with two parents)', { branch: code(branch) }),
  check: guard(repo, (r, _m, s) => {
    const head = r.headCommit();
    const tip = r.refs.get(`refs/heads/${branch}`);
    return !r.op && !!head && !!tip && !s.commits.has(head) && r.commit(head).parents.length === 2 && r.isAncestor(tip, head);
  }),
});
/** `branch` was not merged into HEAD. */
export const notMerged = (repo: string, branch: string): Goal => ({
  label: t('{branch} is **not** merged', { branch: code(branch) }),
  check: guard(repo, (r) => {
    const head = r.headCommit();
    const tip = r.refs.get(`refs/heads/${branch}`);
    return !!head && !!tip && !r.isAncestor(tip, head);
  }),
});
/** The newest commit's version of the file contains every one of these texts (and none of `not`). */
export const fileSays = (repo: string, path: string, texts: string[], not: string[] = []): Goal => ({
  label: not.length
    ? t('The committed {file} has {texts}, but not {not}', { file: code(path), texts: texts.map((x) => `“${x}”`).join(t(' and ')), not: not.map((x) => `“${x}”`).join(t(' or ')) })
    : t('The committed {file} has {texts}', { file: code(path), texts: texts.map((x) => `“${x}”`).join(t(' and ')) }),
  check: guard(repo, (r) => {
    const c = fileIn(r, r.headCommit(), path);
    return c !== undefined && texts.every((x) => c.includes(x)) && !not.some((x) => c.includes(x));
  }),
});
/** No conflict markers, in the folder or in the newest commit. */
export const noMarkers = (repo: string): Goal => ({
  label: t('No conflict markers left (`<<<<<<<`, `=======`, `>>>>>>>`), in the folder or in the commit'),
  check: guard(repo, (r, m) => {
    const head = r.headCommit();
    const committedFiles = [...r.files(head).keys()].map((p) => fileIn(r, head, p) ?? '');
    return ![...worktreeFiles(m.learner.fs, r).values(), ...committedFiles].some((x) => MARKER.test(x));
  }),
});

// Remotes: the hub's copy of the team repository, and what Sam did.
const HUB_REPO = 'team/shop';
const hubTip = (m: GitMachine, branch: string) => m.hub.repos.get(HUB_REPO)?.refs.get(`refs/heads/${branch}`);
const onHubBranch = (m: GitMachine, branch: string, sha: string) => {
  const tip = hubTip(m, branch);
  return !!tip && m.hub.repos.get(HUB_REPO)!.ancestors([tip]).has(sha);
};
/** The learner's own commits (not merges) on a local branch. Everything the hub starts with is Sam's. */
function myCommits(r: Repo, branch: string): string[] {
  const tip = r.refs.get(`refs/heads/${branch}`);
  if (!tip) return [];
  return [...r.ancestors([tip])].filter((c) => r.commit(c).parents.length === 1 && r.commit(c).author.name === 'Alex Learner');
}
/** Every commit you made on `branch` is on the hub's `branch`. */
export const pushed = (repo: string, branch: string): Goal => ({
  label: branch === 'main' ? t('Your commit is on the hub (in its {branch})', { branch: code(branch) }) : t('Your commit on {branch} is on the hub (in its {branch})', { branch: code(branch) }),
  check: guard(repo, (r, m) => {
    const mine = myCommits(r, branch);
    return mine.length > 0 && mine.every((c) => onHubBranch(m, branch, c));
  }),
});
/** Sam's latest commit is still on the hub's `branch` (nobody forced it away). */
export const samKept = (branch = 'main'): Goal => ({
  label: t("All of Sam's work is still on the hub's {branch}", { branch: code(branch) }),
  check: (m) => {
    const sam = m.users.get('sam');
    const r = sam && [...sam.repos.values()][0];
    const head = r?.refs.get(`refs/heads/${branch}`);
    return !!head && onHubBranch(m, branch, head);
  },
});
/** Your branch is exactly the hub's (status: up to date). */
export const inSync = (repo: string, branch = 'main'): Goal => ({
  label: t("Your {branch} matches the hub's {branch} exactly (nothing to push, nothing to pull)", { branch: code(branch) }),
  check: guard(repo, (r, m) => !!r.refs.get(`refs/heads/${branch}`) && r.refs.get(`refs/heads/${branch}`) === hubTip(m, branch)),
});
export const tracks = (repo: string, branch: string, upstream: string): Goal => ({
  label: t('{branch} tracks {upstream} (its upstream is set)', { branch: code(branch), upstream: code(upstream) }),
  check: guard(repo, (r) => r.upstream(branch)?.tracking === upstream),
});
/** The hub's `branch` has the file with this text and no conflict markers. */
export const hubFileSays = (branch: string, path: string, text: string): Goal => ({
  label: t("On the hub, {branch}'s {file} says “{text}” (and has no conflict markers)", { branch: code(branch), file: code(path), text }),
  check: (m) => {
    const hub = m.hub.repos.get(HUB_REPO);
    const tip = hubTip(m, branch);
    const c = hub && tip ? fileIn(hub, tip, path) : undefined;
    return c !== undefined && c.includes(text) && !MARKER.test(c);
  },
});

// ---------------------------------------------------------------- target graphs (Branch Runner)

/** The machine after the reference solution: the target the learner's graph must match. */
export function solvedMachine(mission: GitMission): GitMachine {
  const { machine } = prepareMission(mission);
  for (const c of mission.solution) machine.exec(c);
  return machine;
}

/** The target as a graph to draw (hashes hidden: yours will differ). */
export function targetGraph(mission: GitMission): GraphData | null {
  const r = repoOf(solvedMachine(mission), mission.repo);
  return r ? { ...graphData(r, 'target', t('🎯 Target')), anonymous: true } : null;
}

/** One goal per branch of the target (same shape), plus "no other branches" and "HEAD on …". */
export function targetGoals(mission: GitMission): Goal[] {
  const target = repoOf(solvedMachine(mission), mission.repo);
  if (!target) return [];
  const { start } = prepareMission(mission);
  const kt = shapeKey(target, start);
  const branches = target.branches();
  const goals: Goal[] = branches.map((b) => ({
    label: t('{branch} looks like the target', { branch: code(b) }),
    check: guard(mission.repo, (r, _m, s) => {
      const mine = r.refs.get(`refs/heads/${b}`);
      return !!mine && shapeKey(r, s)(mine) === kt(target.refs.get(`refs/heads/${b}`)!);
    }),
  }));
  goals.push({ label: t('No other branches (only {branches})', { branches: branches.map(code).join(', ') }), check: guard(mission.repo, (r) => r.branches().length === branches.length && r.branches().every((b) => branches.includes(b))) });
  if (target.branch) goals.push(onBranch(mission.repo, target.branch));
  return goals;
}

// ---------------------------------------------------------------- running missions

/** A fresh machine with the mission's setup applied. */
export function prepareMission(mission: GitMission): { machine: GitMachine; start: MissionStart } {
  const machine = sandbox({ setup: mission.setup });
  const commits = new Set<string>();
  for (const r of machine.learner.repos.values()) for (const c of r.ancestors([...r.refs.values(), r.headCommit()])) commits.add(c);
  return { machine, start: { commits, head: repoOf(machine, mission.repo)?.headCommit() ?? null } };
}

export function goalsOf(mission: GitMission): Goal[] {
  return mission.target ? [...targetGoals(mission), ...mission.goals] : mission.goals;
}

export function goalsMet(goals: Goal[], m: GitMachine, start: MissionStart): boolean[] {
  return goals.map((g) => {
    try {
      return g.check(m, start);
    } catch {
      return false;
    }
  });
}

/** Commands that don't count against par: anything that isn't git (editing files, ls, cd), and git commands that only look. */
export function isFree(cmd: string): boolean {
  const c = cmd.trim();
  if (!/^(git|gh)\b/.test(c)) return true;
  return /^git (status|log|show|diff|help|remote( -v)?$|branch( (-a|-v|-vv|-r|--list|--all|--show-current))*$|config --get|config [\w.]+$)/.test(c) || /^gh (pr (list|view|diff)|repo view)\b/.test(c);
}

// ---------------------------------------------------------------- Stage Manager (module 1)

const shop = (...lines: string[]) => ['git init -q shop', 'cd shop', ...lines];
const shopWithHistory = shop(
  'echo "<h1>Shop</h1>" > index.html',
  'echo "<h1>About us</h1>" > about.html',
  'echo "body { color: navy; }" > style.css',
  'git add .',
  'git commit -qm "First version"',
);

export const STAGE_MANAGER: GitMission[] = [
  {
    title: t('Clean desk'),
    story: t('Three new files in `shop`. The home page and the styles are ready; `notes.txt` is your private to-do list. Commit the two ready files **in one commit**, and keep the notes out.'),
    setup: shop('echo "<h1>Shop</h1>" > index.html', 'echo "body { color: navy; }" > style.css', 'echo "call the printer" > notes.txt'),
    repo: 'shop',
    goals: [newCommitCount('shop', 1), committed('shop', 'index.html'), committed('shop', 'style.css'), keptOut('shop', 'notes.txt')],
    par: 2,
    solution: ['git add index.html style.css', 'git commit -m "Add home page and styles"'],
    hint: t('Name the two files in `git add`, then commit. `git add .` would take the notes too.'),
    seconds: 120,
  },
  {
    title: t('One change per commit'),
    story: t('You changed two things: a **sale banner** in `index.html` and a **new colour** in `style.css`. They\'re unrelated, so they belong in **two separate commits**. Leave nothing behind.'),
    setup: [...shopWithHistory, 'echo "<p>Sale: 20% off</p>" >> index.html', 'echo "body { color: teal; }" > style.css'],
    repo: 'shop',
    goals: [commitsChanging('shop', [['index.html'], ['style.css']], t('Two new commits: one changes only `index.html`, the other only `style.css`')), clean('shop')],
    par: 4,
    solution: ['git add index.html', 'git commit -m "Add sale banner"', 'git add style.css', 'git commit -m "Change colour to teal"'],
    hint: t('Stage one file, commit, then the other. `git commit -am` would put both in one commit.'),
    seconds: 150,
  },
  {
    title: t('The late edit'),
    story: t('You staged `index.html`, then added one more line to it. Commit the page **with both changes** and leave the folder clean.'),
    setup: [...shopWithHistory, 'echo "<p>Open daily</p>" >> index.html', 'git add index.html', 'echo "<p>Free delivery</p>" >> index.html'],
    repo: 'shop',
    goals: [newCommitCount('shop', 1), committed('shop', 'index.html', 'Free delivery'), clean('shop')],
    par: 1,
    solution: ['git commit -am "Opening hours and delivery"'],
    hint: t('The staged copy is the old one. Stage the file again (`git add`), or let `git commit -am` stage it for you.'),
    seconds: 120,
  },
  {
    title: t('Leave the draft'),
    story: t('The home page change is finished. `about.html` has a half-written paragraph (“DRAFT”) that is **not** ready. Commit the home page only, and don\'t lose the draft.'),
    setup: [...shopWithHistory, 'echo "<p>New arrivals every Monday</p>" >> index.html', 'echo "<p>DRAFT: our story so far</p>" >> about.html'],
    repo: 'shop',
    goals: [newCommitCount('shop', 1), committed('shop', 'index.html', 'New arrivals'), draftKept('shop', 'about.html', 'DRAFT')],
    par: 2,
    solution: ['git add index.html', 'git commit -m "Announce new arrivals"'],
    hint: t('`git commit -am` stages every tracked file, the draft too. Add just `index.html`.'),
    seconds: 120,
  },
  {
    title: t('A brand-new project'),
    story: t('The folder `blog` has two files but **no repository** yet. Make it a repository, and save both files in its first commit.'),
    setup: ['mkdir blog', 'cd blog', 'echo "# My blog" > README.md', 'echo "Hello, world" > first-post.md'],
    repo: 'blog',
    goals: [isRepo('blog'), newCommitCount('blog', 1), committed('blog', 'README.md'), committed('blog', 'first-post.md'), clean('blog')],
    par: 3,
    solution: ['git init', 'git add .', 'git commit -m "Start the blog"'],
    hint: t('`git init` inside the folder, then `git add .` and a commit.'),
    seconds: 120,
  },
  {
    title: t('New laptop'),
    story: t('On a brand-new computer, `notes.txt` is staged and ready, but Git doesn\'t know who you are. Commit it as **Alex Learner**, **alex@example.com** (for every repository on this computer).'),
    setup: ['git config --global --unset user.name', 'git config --global --unset user.email', 'git init -q notes', 'cd notes', 'echo "first note" > notes.txt', 'git add notes.txt'],
    repo: 'notes',
    goals: [authoredBy('notes', 'Alex Learner', 'alex@example.com'), { label: t('Your name and email are saved for every repository (`--global`)'), check: (m) => m.learner.global.get('user.name') === 'Alex Learner' && m.learner.global.get('user.email') === 'alex@example.com' }],
    par: 3,
    solution: ['git config --global user.name "Alex Learner"', 'git config --global user.email "alex@example.com"', 'git commit -m "First note"'],
    hint: t('`git config --global user.name "…"` and `user.email`, then commit.'),
    seconds: 150,
  },
];

// ---------------------------------------------------------------- Branch Runner (module 3)

const site = ['git init -q site', 'cd site', 'echo "<h1>Shop</h1>" > index.html', 'echo "body { color: navy; }" > style.css', 'git add .', 'git commit -qm "Add home page"', 'echo "<p>Welcome!</p>" >> index.html', 'git commit -qam "Welcome text"'];

export const BRANCH_RUNNER: GitMission[] = [
  {
    title: t('Sprout'),
    story: t('Start a branch called **`menu`** and make one commit on it (edit any file). `main` must stay where it is.'),
    setup: site,
    repo: 'site',
    target: true,
    goals: [],
    par: 2,
    solution: ['git switch -c menu', 'echo "<nav>Menu</nav>" >> index.html', 'git commit -am "Add menu"'],
    hint: t('`git switch -c menu` creates the branch and moves HEAD onto it. Then edit a file and `git commit -am "…"`.'),
    seconds: 120,
  },
  {
    title: t('Catch up'),
    story: t('The `fix` branch is two commits ahead of `main`, and nothing happened on `main` since. Bring `main` up to date, then tidy up: `fix` isn\'t needed any more.'),
    setup: [...site, 'git switch -qc fix', 'echo "body { color: black; }" > style.css', 'git commit -qam "Darker text"', 'echo "<p>Welcome back!</p>" >> index.html', 'git commit -qam "Friendlier welcome"'],
    repo: 'site',
    target: true,
    goals: [],
    par: 3,
    solution: ['git switch main', 'git merge fix', 'git branch -d fix'],
    hint: t('Switch to `main`, `git merge fix` (a fast-forward: `main` just slides up), then `git branch -d fix`.'),
    seconds: 120,
  },
  {
    title: t('Join the paths'),
    story: t('`main` and `about` both moved on since they split. Bring `about` into `main` with a merge commit, and delete `about` afterwards.'),
    setup: [...site, 'git switch -qc about', 'echo "<h1>About us</h1>" > about.html', 'git add .', 'git commit -qm "Add about page"', 'git switch -q main', 'echo "body { color: teal; }" > style.css', 'git commit -qam "Teal text"'],
    repo: 'site',
    target: true,
    goals: [],
    par: 2,
    solution: ['git merge about', 'git branch -d about'],
    hint: t('You\'re on `main` already: `git merge about` makes a merge commit with two parents. Then `git branch -d about`.'),
    seconds: 120,
  },
  {
    title: t('Side quest'),
    story: t('Build it yourself: a branch **`nav`** with one commit, **one new commit on `main`** too (while `nav` waits), then `nav` merged into `main`, and `nav` deleted. Edit different files on each branch.'),
    setup: site,
    repo: 'site',
    target: true,
    goals: [],
    par: 6,
    solution: ['git switch -c nav', 'echo "<nav>Home | Shop</nav>" >> index.html', 'git commit -am "Add navigation"', 'git switch main', 'echo "h1 { color: teal; }" >> style.css', 'git commit -am "Teal headings"', 'git merge nav', 'git branch -d nav'],
    hint: t('`switch -c nav`, edit + `commit -am`, `switch main`, edit another file + `commit -am`, `merge nav`, `branch -d nav`.'),
    seconds: 240,
  },
  {
    title: t('Two features'),
    story: t('Two branches from the same commit: **`header`** and **`footer`**, one commit each (different files). Merge both into `main` (the first merge is a fast-forward, the second makes a merge commit), then delete both branches.'),
    setup: site,
    repo: 'site',
    target: true,
    goals: [],
    par: 9,
    solution: ['git switch -c header', 'echo "<header>Shop</header>" >> index.html', 'git commit -am "Add header"', 'git switch main', 'git switch -c footer', 'echo "footer { color: gray; }" >> style.css', 'git commit -am "Style the footer"', 'git switch main', 'git merge header', 'git merge footer', 'git branch -d header footer'],
    hint: t('Make both branches from `main` before merging either. On `main`: `git merge header` (fast-forward), `git merge footer` (merge commit). `git branch -d` takes several names.'),
    seconds: 300,
  },
];

// ---------------------------------------------------------------- Conflict Doctor (module 4)

const page = (hours: string) => `printf "<h1>Shop</h1>\\n<p>Welcome!</p>\\n<p>${hours}</p>\\n" > index.html`;
const shopPage = ['git init -q shop', 'cd shop', page('Open 9-5'), 'echo "body { color: navy; }" > style.css', 'git add .', 'git commit -qm "Add home page"'];
/** `hours` (8-6) and main (10-4) changed the same line; you're on main. */
const hoursClash = [...shopPage, 'git switch -qc hours', page('Open 8-6'), 'git commit -qam "Longer hours"', 'git switch -q main', page('Open 10-4'), 'git commit -qam "Shorter hours"'];
const drinks = (...items: string[]) => `printf "<h1>Drinks</h1>\\n<ul>\\n${items.map((i) => `<li>${i}</li>\\n`).join('')}</ul>\\n" > menu.html`;

export const CONFLICT_DOCTOR: GitMission[] = [
  {
    title: t('First aid'),
    story: t('A merge of `hours` stopped with a conflict in `index.html`. The team picked **hours\'s** times: **Open 8-6**. Fix the file (✏️ Files), mark it resolved and finish the merge.'),
    setup: [...hoursClash, 'git merge hours # fails'],
    repo: 'shop',
    goals: [mergeDone('shop', 'hours'), fileSays('shop', 'index.html', ['Open 8-6'], ['Open 10-4']), noMarkers('shop'), clean('shop')],
    par: 2,
    solution: [page('Open 8-6'), 'git add index.html', 'git commit --no-edit'],
    hint: t('In ✏️ Files, keep `<p>Open 8-6</p>` and delete main\'s line and the three marker lines. Save, then `git add index.html` and `git commit --no-edit`.'),
    seconds: 150,
  },
  {
    title: t('Best of both'),
    story: t('In `~/cafe`, you added **Tea** to the drinks list on main; the `cakes` branch added **Cake** in the same spot. Merge `cakes` and keep **both**: Coffee, Tea, Cake.'),
    setup: ['git init -q cafe', 'cd cafe', drinks('Coffee'), 'git add .', 'git commit -qm "Drinks menu"', 'git switch -qc cakes', drinks('Coffee', 'Cake'), 'git commit -qam "Add cake"', 'git switch -q main', drinks('Coffee', 'Tea'), 'git commit -qam "Add tea"'],
    repo: 'cafe',
    goals: [mergeDone('cafe', 'cakes'), fileSays('cafe', 'menu.html', ['<li>Coffee</li>', '<li>Tea</li>', '<li>Cake</li>']), noMarkers('cafe'), clean('cafe')],
    par: 3,
    solution: ['git merge cakes', drinks('Coffee', 'Tea', 'Cake'), 'git add menu.html', 'git commit --no-edit'],
    hint: t('`git merge cakes`, then in the file keep both `<li>` lines and delete only the markers. `git add`, `git commit --no-edit`.'),
    seconds: 180,
  },
  {
    title: t('Two patients'),
    story: t('Merging `hours` will conflict in **two** files. The decisions: `index.html` keeps **main\'s** times (**Open 10-4**); `style.css` takes **hours\'s** colour (**black**). Merge and resolve both.'),
    setup: [...shopPage, 'git switch -qc hours', page('Open 8-6'), 'echo "body { color: black; }" > style.css', 'git commit -qam "Longer hours, darker text"', 'git switch -q main', page('Open 10-4'), 'echo "body { color: teal; }" > style.css', 'git commit -qam "Shorter hours, teal text"'],
    repo: 'shop',
    goals: [mergeDone('shop', 'hours'), fileSays('shop', 'index.html', ['Open 10-4'], ['Open 8-6']), fileSays('shop', 'style.css', ['black'], ['teal']), noMarkers('shop'), clean('shop')],
    par: 3,
    solution: ['git merge hours', page('Open 10-4'), 'echo "body { color: black; }" > style.css', 'git add index.html style.css', 'git commit --no-edit'],
    hint: t('`git status` lists both files under "Unmerged paths". Fix each one, `git add` both, then commit.'),
    seconds: 210,
  },
  {
    title: t('Wrong turn'),
    story: t('Oops: you merged **`experiment`** by mistake, and it conflicted. Cancel that merge. Then merge **`hours`** instead, keeping **Open 8-6**.'),
    setup: [...hoursClash, 'git branch -q experiment hours~1', 'git switch -q experiment', page('Closed for good'), 'git commit -qam "Try closing"', 'git switch -q main', 'git merge experiment # fails'],
    repo: 'shop',
    goals: [notMerged('shop', 'experiment'), mergeDone('shop', 'hours'), fileSays('shop', 'index.html', ['Open 8-6'], ['Closed']), noMarkers('shop'), clean('shop')],
    par: 4,
    solution: ['git merge --abort', 'git merge hours', page('Open 8-6'), 'git add index.html', 'git commit --no-edit'],
    hint: t('`git merge --abort` puts everything back as before the merge. Then `git merge hours` and resolve as usual.'),
    seconds: 210,
  },
  {
    title: t('Price check'),
    story: t('In `~/menu`, the `sale` branch made tea cheaper (**2 EUR**) while main renamed it (**Green tea**). Merge `sale`: the final line must be **`Green tea: 2 EUR`**, with both changes.'),
    setup: ['git init -q menu', 'cd menu', 'printf "Menu\\nTea: 3 EUR\\nCake: 4 EUR\\n" > menu.txt', 'git add .', 'git commit -qm "First menu"', 'git switch -qc sale', 'printf "Menu\\nTea: 2 EUR\\nCake: 4 EUR\\n" > menu.txt', 'git commit -qam "Cheaper tea"', 'git switch -q main', 'printf "Menu\\nGreen tea: 3 EUR\\nCake: 4 EUR\\n" > menu.txt', 'git commit -qam "Green tea"'],
    repo: 'menu',
    goals: [mergeDone('menu', 'sale'), fileSays('menu', 'menu.txt', ['Green tea: 2 EUR', 'Cake: 4 EUR'], ['3 EUR']), noMarkers('menu'), clean('menu')],
    par: 3,
    solution: ['git merge sale', 'printf "Menu\\nGreen tea: 2 EUR\\nCake: 4 EUR\\n" > menu.txt', 'git add menu.txt', 'git commit --no-edit'],
    hint: t('Neither side is right on its own. Replace the whole conflict (markers and both lines) with `Green tea: 2 EUR`.'),
    seconds: 180,
  },
];

// ---------------------------------------------------------------- Push/Pull Race (module 5)

const HUB = 'https://hub.zilber.tech/team/shop.git';
const teamShop = ['@hub init team/shop', `@sam git clone -q ${HUB}`, '@sam cd shop', '@sam echo "<h1>Shop</h1>" > index.html', '@sam echo "body { color: navy; }" > style.css', '@sam git add .', '@sam git commit -qm "Add home page"', '@sam git push -q', `git clone -q ${HUB}`, 'cd shop'];
/** Sam pulls, changes a file of their own and pushes (always succeeds: Sam pulls first). */
const samPush = (file: string, text: string, message: string): string[] => ['git pull -q', `echo "${text}" >> ${file}`, 'git add .', `git commit -qm "${message}"`, 'git push -q'];

export const PUSH_PULL: GitMission[] = [
  {
    title: t('Share it'),
    story: t('You wrote `about.html` in your clone of the team\'s shop. Commit it and get it onto the hub, so Sam can see it.'),
    setup: [...teamShop, 'echo "<h1>About us</h1>" > about.html'],
    repo: 'shop',
    goals: [pushed('shop', 'main'), inSync('shop'), clean('shop')],
    par: 3,
    solution: ['git add about.html', 'git commit -m "Add about page"', 'git push'],
    hint: t('`git add`, `git commit -m "…"`, then `git push`.'),
    seconds: 120,
  },
  {
    title: t('Sam was faster'),
    story: t('You committed an about page. Meanwhile Sam pushed a sale banner (you haven\'t pulled it). Get your commit onto the hub, **keep Sam\'s**, and end in sync.'),
    setup: [...teamShop, ...samPush('index.html', '<p>Sale!</p>', 'Sale banner').map((c) => `@sam ${c}`), 'echo "<h1>About us</h1>" > about.html', 'git add .', 'git commit -qm "Add about page"'],
    repo: 'shop',
    goals: [pushed('shop', 'main'), samKept(), inSync('shop'), clean('shop')],
    par: 2,
    solution: ['git pull', 'git push'],
    hint: t('A push now would be rejected. `git pull` first (it makes a merge commit), then `git push`. Never `--force`: it would delete Sam\'s banner.'),
    seconds: 120,
  },
  {
    title: t('Busy Sam'),
    story: t('Sam is pushing all morning. Watch the 📣 messages! Get your commit (already made) onto the hub, keep all of Sam\'s work, and **end** with your `main` in sync with the hub\'s.'),
    setup: [...teamShop, 'echo "<h1>About us</h1>" > about.html', 'git add .', 'git commit -qm "Add about page"'],
    repo: 'shop',
    goals: [pushed('shop', 'main'), samKept(), inSync('shop'), clean('shop')],
    teammate: [
      { after: 1, say: t('Sam pushed “Opening hours” to main.'), cmds: samPush('index.html', '<p>Open 9-5</p>', 'Opening hours') },
      { after: 3, say: t('Sam pushed “Teal headings” to main.'), cmds: samPush('style.css', 'h1 { color: teal; }', 'Teal headings') },
    ],
    par: 4,
    solution: ['git pull', 'git pull', 'git push', 'git pull'],
    hint: t('Every time Sam pushes, your view of the hub is out of date: `git pull` before you push, and once more at the end if Sam pushed after you.'),
    seconds: 180,
  },
  {
    title: t('Same line'),
    story: t('You changed the shop\'s title to **Our Shop** (committed). Sam changed the same line and pushed. The team picked **your** title. Get it onto the hub with Sam\'s commit kept, and end in sync.'),
    setup: [...teamShop, '@sam echo "<h1>The Shop</h1>" > index.html', '@sam git commit -qam "New title"', '@sam git push -q', 'echo "<h1>Our Shop</h1>" > index.html', 'git commit -qam "Our title"'],
    repo: 'shop',
    goals: [pushed('shop', 'main'), samKept(), hubFileSays('main', 'index.html', '<h1>Our Shop</h1>'), inSync('shop'), clean('shop')],
    par: 4,
    solution: ['git pull', 'echo "<h1>Our Shop</h1>" > index.html', 'git add index.html', 'git commit --no-edit', 'git push'],
    hint: t('`git pull` stops on a conflict. Fix `index.html` (keep `<h1>Our Shop</h1>`, delete the markers), `git add`, `git commit --no-edit`, `git push`.'),
    seconds: 210,
  },
  {
    title: t('Your branch, the team\'s main'),
    story: t('Start a branch **`sale`**, commit a change on it, and put it on the hub with its **upstream set**. Then bring your `main` up to date with the hub\'s: Sam keeps pushing to it.'),
    setup: teamShop,
    repo: 'shop',
    goals: [pushed('shop', 'sale'), tracks('shop', 'sale', 'origin/sale'), samKept(), inSync('shop', 'main'), onBranch('shop', 'main'), clean('shop')],
    teammate: [{ after: 2, say: t('Sam pushed “Free delivery” to main.'), cmds: samPush('index.html', '<p>Free delivery</p>', 'Free delivery') }],
    par: 5,
    solution: ['git switch -c sale', 'echo "<p>Sale!</p>" >> index.html', 'git commit -am "Sale banner"', 'git push -u origin sale', 'git switch main', 'git pull'],
    hint: t('`git switch -c sale`, edit, `git commit -am`, `git push -u origin sale`, then `git switch main` and `git pull`.'),
    seconds: 240,
  },
];
