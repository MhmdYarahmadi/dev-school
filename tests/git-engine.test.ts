/**
 * The Git simulator's own behaviour: what real Git can't check for us (the events behind the
 * live graph, the hub with its pull requests and protected branches, the teammate, the shell).
 * Output formats are checked against real Git in git-golden.test.ts and git-fuzz.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { GitMachine } from '../src/courses/git/engine';
import { ObjectStore } from '../src/courses/git/engine/objects';

const ALEX = { name: 'Alex Learner', email: 'alex@example.com', time: 1767603600 };

/** Runs lines and fails on the first unexpected exit code; returns the last result. */
function run(m: GitMachine, ...lines: string[]) {
  let last = m.exec('true');
  for (const l of lines) {
    last = m.exec(l);
    if (last.exitCode !== 0) throw new Error(`${l} → ${last.exitCode}\n${last.lines.map((x) => x.text).join('\n')}`);
  }
  return last;
}
const text = (r: { lines: { text: string }[] }) => r.lines.map((l) => l.text).join('\n');

/** A hub repository with one commit (made by Sam) and the learner's clone of it. */
function team(opts: { protect?: boolean; approval?: boolean } = {}) {
  const m = new GitMachine();
  run(m, '@hub init team/shop', '@sam git clone -q https://hub.zilber.tech/team/shop.git', '@sam cd shop', '@sam echo "<h1>Shop</h1>" > index.html', '@sam git add .', '@sam git commit -qm "Home page"', '@sam git push -q');
  if (opts.protect) run(m, `@hub protect team/shop main${opts.approval ? ' --require-approval' : ''}`);
  run(m, 'git clone -q https://hub.zilber.tech/team/shop.git', 'cd shop');
  return m;
}

describe('objects', () => {
  it('hashes blobs, trees and commits exactly like Git', () => {
    const s = new ObjectStore();
    const b = s.put({ type: 'blob', content: 'hi\n' });
    expect(b).toBe('45b983be36b73c0788dc9cbcb76cbb80fc7bb057');
    const t = s.writeTree(new Map([['a.txt', b]]));
    expect(s.put({ type: 'commit', tree: t, parents: [], author: ALEX, committer: ALEX, message: 'First\n' }).slice(0, 7)).toBe('7a85a66');
  });
});

describe('events for the live graph', () => {
  it('reports commits, branch moves, HEAD switches and fast-forwards', () => {
    const m = new GitMachine();
    run(m, 'git init -q app', 'cd app', 'echo a > a.txt', 'git add .');
    const c1 = m.exec('git commit -qm one');
    expect(c1.events).toEqual([
      expect.objectContaining({ type: 'commit', repo: 'learner:/home/learner/app', parents: [], kind: 'commit' }),
      expect.objectContaining({ type: 'ref', ref: 'refs/heads/main', from: null }),
    ]);
    const sw = m.exec('git switch -c feature');
    expect(sw.events).toContainEqual(expect.objectContaining({ type: 'ref', ref: 'refs/heads/feature', from: null }));
    expect(sw.events).toContainEqual(expect.objectContaining({ type: 'head', branch: 'feature' }));
    run(m, 'echo b > b.txt', 'git add .', 'git commit -qm two', 'git switch main');
    const ff = m.exec('git merge feature');
    expect(ff.events).toContainEqual(expect.objectContaining({ type: 'ref', ref: 'refs/heads/main', fastForward: true }));
  });

  it('reports merge commits, conflicts, pushes and fetches', () => {
    const m = team();
    run(m, 'git switch -c f', 'echo x > x.txt', 'git add .', 'git commit -qm x', 'git switch main', 'echo y > y.txt', 'git add .', 'git commit -qm y');
    const merge = m.exec('git merge f');
    expect(merge.events).toContainEqual(expect.objectContaining({ type: 'commit', kind: 'merge' }));
    const push = m.exec('git push');
    expect(push.events).toContainEqual(expect.objectContaining({ type: 'transfer', kind: 'push', from: 'learner:/home/learner/shop', to: 'hub:team/shop' }));
    expect((push.events.find((e) => e.type === 'transfer') as { commits: string[] }).commits).toHaveLength(3);
    expect(push.events).toContainEqual(expect.objectContaining({ type: 'ref', repo: 'hub:team/shop', ref: 'refs/heads/main' }));
    run(m, '@sam git pull -q', '@sam echo "<p>sale</p>" >> index.html', '@sam git commit -qam sale', '@sam git push -q');
    run(m, 'echo "<p>mine</p>" >> index.html', 'git commit -qam mine');
    const pull = m.exec('git pull');
    expect(pull.exitCode).toBe(1);
    expect(pull.events).toContainEqual(expect.objectContaining({ type: 'transfer', kind: 'fetch', commits: [expect.any(String)] }));
    expect(pull.events).toContainEqual({ type: 'conflict', repo: 'learner:/home/learner/shop', paths: ['index.html'] });
  });
});

describe('the hub and pull requests', () => {
  it('protected main: direct pushes are refused, changes go through a pull request', () => {
    const m = team({ protect: true });
    run(m, 'echo "<p>sale</p>" >> index.html', 'git commit -qam "Sale banner"');
    const push = m.exec('git push');
    expect(push.exitCode).toBe(1);
    expect(text(push)).toContain('remote: error: Protected branch update failed for refs/heads/main.');
    expect(text(push)).toContain(' ! [remote rejected] main -> main (protected branch hook declined)');
    run(m, 'git switch -c sale', 'git push -u origin sale');
    const pr = run(m, 'gh pr create --title "Sale banner" --body "Adds a banner"');
    expect(text(pr)).toContain('https://hub.zilber.tech/team/shop/pull/1');
    expect(text(m.exec('gh pr list'))).toMatch(/#1\s+Sale banner\s+sale/);
    expect(text(m.exec('gh pr create --title again'))).toContain('already exists');
    const merged = run(m, 'gh pr merge 1 --merge --delete-branch');
    expect(text(merged)).toContain('✓ Merged pull request #1 (Sale banner)');
    expect(m.learner.repos.get('/home/learner/shop')!.branch).toBe('main');
    expect(text(m.exec('git log --oneline -1'))).toMatch(/Merge pull request #1 from team\/sale/);
    expect(text(m.exec('cat index.html'))).toContain('sale');
    expect(text(m.exec('git branch -a'))).not.toContain('sale');
  });

  it('reviews: changes requested block the merge until approved; you cannot approve your own', () => {
    const m = team({ protect: true, approval: true });
    run(m, 'git switch -c about', 'echo "<h1>About</h1>" > about.html', 'git add .', 'git commit -qm "About page"', 'git push -qu origin about', 'gh pr create --fill');
    expect(text(m.exec('gh pr review 1 --approve'))).toContain('Can not approve your own pull request');
    run(m, '@sam gh pr review 1 --request-changes --body "Please add a footer"');
    const blocked = m.exec('gh pr merge 1 --merge');
    expect(blocked.exitCode).toBe(1);
    expect(text(blocked)).toContain('not mergeable: the base branch policy prohibits the merge');
    expect(text(m.exec('gh pr view'))).toContain('Please add a footer');
    run(m, 'echo "<footer>Shop</footer>" >> about.html', 'git commit -qam "Add footer"', 'git push -q', '@sam gh pr review 1 --approve');
    run(m, 'gh pr merge 1 --merge');
    expect(m.hub.prs.get('team/shop')![0].state).toBe('MERGED');
  });

  it('a pull request that conflicts with main cannot be merged', () => {
    const m = team();
    run(m, 'git switch -c title', 'echo "<h1>Our Shop</h1>" > index.html', 'git commit -qam title', 'git push -qu origin title', 'gh pr create --title Title');
    run(m, '@sam echo "<h1>The Shop</h1>" > index.html', '@sam git commit -qam other', '@sam git push -q');
    const res = m.exec('gh pr merge 1 --merge');
    expect(text(res)).toContain('the merge commit cannot be cleanly created');
    // The learner fixes it: merge main into the branch, resolve, push.
    expect(m.exec('git pull origin main').exitCode).toBe(1);
    run(m, 'echo "<h1>Our Shop</h1>" > index.html', 'git add index.html', 'git commit -q', 'git push -q', 'gh pr merge 1 --merge');
  });

  it('gh pr checkout fetches a teammate\'s branch', () => {
    const m = team();
    run(m, '@sam git switch -qc menu', '@sam echo menu > menu.html', '@sam git add .', '@sam git commit -qm Menu', '@sam git push -qu origin menu', '@sam gh pr create --title Menu');
    run(m, 'gh pr checkout 1');
    expect(m.learner.repos.get('/home/learner/shop')!.branch).toBe('menu');
    expect(text(m.exec('cat menu.html'))).toBe('menu');
    expect(text(m.exec('gh pr diff 1'))).toContain('+menu');
  });

  it('a push is rejected when the teammate pushed first, and works after a pull', () => {
    const m = team();
    run(m, '@sam echo "<p>sam</p>" >> index.html', '@sam git commit -qam sam', '@sam git push -q', 'echo b > b.txt', 'git add .', 'git commit -qm b');
    const push = m.exec('git push');
    expect(push.exitCode).toBe(1);
    expect(text(push)).toContain('(fetch first)');
    run(m, 'git pull -q', 'git push -q');
    expect(m.hub.repos.get('team/shop')!.refs.get('refs/heads/main')).toBe(m.learner.repos.get('/home/learner/shop')!.headCommit());
  });
});

describe('the shell', () => {
  it('redirects, appends, pipes, globs and here-documents', () => {
    const m = new GitMachine();
    run(m, 'mkdir -p site/css', 'cd site', 'echo one > a.txt', 'echo two >> a.txt', 'printf "x\\ny\\n" > b.txt', 'touch css/s.css');
    expect(text(m.exec('cat a.txt'))).toBe('one\ntwo');
    expect(text(m.exec('cat *.txt | wc -l'))).toBe('4');
    expect(text(m.exec('ls'))).toBe('a.txt  b.txt  css');
    run(m, "cat > note.md <<'EOF'\n# Note\nHello\nEOF");
    expect(m.learner.fs.read('/home/learner/site/note.md')).toBe('# Note\nHello\n');
    expect(m.exec('cd nowhere').exitCode).toBe(1);
    expect(text(m.exec('nano a.txt'))).toContain('Edit');
    expect(m.exec('false && echo no || echo yes').lines.map((l) => l.text)).toEqual(['yes']);
  });

  it('shows the .git folder and forgets the repository when it is deleted', () => {
    const m = new GitMachine();
    run(m, 'git init -q p', 'cd p');
    expect(text(m.exec('ls -A'))).toBe('.git');
    expect(text(m.exec('cat .git/HEAD'))).toBe('ref: refs/heads/main');
    run(m, 'echo a > a', 'git add a', 'git commit -qm a');
    expect(text(m.exec('cat .git/refs/heads/main'))).toMatch(/^[0-9a-f]{40}$/);
    const del = run(m, 'rm -rf .git');
    expect(del.events).toContainEqual({ type: 'repo', repo: 'learner:/home/learner/p', action: 'delete' });
    expect(m.exec('git status').exitCode).toBe(128);
  });

  it('a fresh machine without a name asks who you are', () => {
    const m = new GitMachine({ identity: false });
    run(m, 'git init -q p', 'cd p', 'echo a > a', 'git add a');
    const res = m.exec('git commit -m a');
    expect(res.exitCode).toBe(128);
    expect(text(res)).toContain('Please tell me who you are');
    run(m, 'git config --global user.name "Kim"', 'git config --global user.email kim@example.com', 'git commit -qm a');
    expect(text(m.exec('git log --format=x -1'))).toContain('Kim');
  });
});
