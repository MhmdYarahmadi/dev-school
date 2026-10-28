/**
 * Random cases run on both the simulator and the real `git`, which must agree byte for byte:
 * line diffs (Myers + indent heuristic) and three-way merges (histogram + zealous conflicts).
 * Skipped when git isn't installed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { merge3, splitLines, unifiedHunks } from '../src/courses/git/engine/diff';
import { GitMachine, START } from '../src/courses/git/engine';

const hasGit = spawnSync('git', ['--version']).status === 0;
const dir = mkdtempSync(join(tmpdir(), 'zs-gitfuzz-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Lines from a small vocabulary (so lines repeat, which is where diff algorithms differ), some indented or blank. */
function randomFile(r: () => number, n: number): string[] {
  const words = ['alpha', 'beta', 'gamma', 'delta', '}', '{', 'return x;', 'if (a) {', ''];
  return Array.from({ length: n }, () => {
    const w = words[Math.floor(r() * words.length)];
    const indent = r() < 0.3 ? '    ' : r() < 0.1 ? '\t' : '';
    return `${w ? indent + w : ''}\n`;
  });
}

function mutate(r: () => number, lines: string[]): string[] {
  const out = [...lines];
  const edits = 1 + Math.floor(r() * 4);
  for (let e = 0; e < edits; e++) {
    const at = Math.floor(r() * (out.length + 1));
    const k = r();
    if (k < 0.35 && out.length) out.splice(Math.min(at, out.length - 1), 1 + Math.floor(r() * 2));
    else if (k < 0.7) out.splice(at, 0, ...randomFile(r, 1 + Math.floor(r() * 3)));
    else if (out.length) out.splice(Math.min(at, out.length - 1), 1, ...randomFile(r, 1));
  }
  return out;
}

describe.skipIf(!hasGit)('diff matches real git', () => {
  it('300 random file pairs give identical hunks', () => {
    const r = rng(42);
    let failures = 0;
    for (let n = 0; n < 300; n++) {
      const a = randomFile(r, 3 + Math.floor(r() * 25));
      let b = mutate(r, a);
      if (r() < 0.1 && b.length) b[b.length - 1] = b[b.length - 1].replace(/\n$/, '') || 'x';
      writeFileSync(join(dir, 'a'), a.join(''));
      writeFileSync(join(dir, 'b'), b.join(''));
      const res = spawnSync('git', ['diff', '--no-index', '--no-color', 'a', 'b'], { cwd: dir, encoding: 'utf8' });
      const real = res.stdout.split('\n').slice(4, -1);
      const sim = a.join('') === b.join('') ? [] : unifiedHunks(splitLines(a.join('')), splitLines(b.join('')));
      if (JSON.stringify(real) !== JSON.stringify(sim)) {
        if (failures++ < 3) expect.soft(sim, `case ${n}\nA:\n${a.join('')}\nB:\n${b.join('')}`).toEqual(real);
      }
    }
    expect(failures).toBe(0);
  });
});

describe.skipIf(!hasGit)('three-way merge matches real git merge', () => {
  it('150 random merges give identical files (conflict markers included)', () => {
    const r = rng(1234);
    const repo = join(dir, 'm');
    const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const git = (...args: string[]) => spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { env });
    let failures = 0;
    let conflicted = 0;
    for (let n = 0; n < 150; n++) {
      const base = randomFile(r, 4 + Math.floor(r() * 20));
      const ours = mutate(r, base);
      const theirs = r() < 0.15 ? [...ours] : mutate(r, base);
      git('checkout', '-q', '--orphan', `b${n}`);
      git('rm', '-rq', '--cached', '.');
      writeFileSync(join(repo, 'f'), base.join(''));
      git('add', 'f');
      git('commit', '-qm', 'base');
      git('branch', `feature${n}`);
      writeFileSync(join(repo, 'f'), ours.join(''));
      git('commit', '-qam', 'ours', '--allow-empty');
      git('checkout', '-q', `feature${n}`);
      writeFileSync(join(repo, 'f'), theirs.join(''));
      git('commit', '-qam', 'theirs', '--allow-empty');
      git('checkout', '-q', `b${n}`);
      const res = git('merge', '-q', '--no-edit', `feature${n}`);
      const real = execFileSync('cat', [join(repo, 'f')], { encoding: 'utf8' });
      const sim = merge3(base.join(''), ours.join(''), theirs.join(''), 'HEAD', `feature${n}`);
      if (sim.conflicts) conflicted++;
      if (sim.text !== real || (sim.conflicts > 0) !== (res.status !== 0)) {
        if (failures++ < 3) expect.soft(sim.text, `case ${n}\nBASE:\n${base.join('')}\nOURS:\n${ours.join('')}\nTHEIRS:\n${theirs.join('')}`).toBe(real);
      }
      git('merge', '--abort');
      git('reset', '-q', '--hard');
    }
    expect(failures).toBe(0);
    expect(conflicted).toBeGreaterThan(30);
  });
});

const HISTORIES = Number(process.env.GIT_FUZZ_HISTORIES ?? 30);

describe.skipIf(!hasGit)('random histories match real git command by command', () => {
  /** Runs one command line in bash in `cwd` with the simulator's clock for command number `n`. */
  function realRun(home: string, cwd: string, line: string, n: number) {
    const t = START + 60 * n;
    const res = spawnSync('bash', ['-c', `cd "${cwd}" && { ${line}\n}`], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, LANG: 'C', LC_ALL: 'C', GIT_PAGER: 'cat', GIT_EDITOR: 'true', GIT_AUTHOR_DATE: `@${t} +0000`, GIT_COMMITTER_DATE: `@${t} +0000`, GIT_CONFIG_NOSYSTEM: '1' },
    });
    const norm = (x: string) => x.split(home).join('/home/learner').replace(/\n$/, '');
    return { out: norm(res.stdout), err: norm(res.stderr), exit: res.status };
  }

  it('30 random histories: identical output for every command', () => {
    const r = rng(Number(process.env.GIT_FUZZ_SEED ?? 99));
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const words = ['apple', 'pear', 'plum', 'fig', 'kiwi', 'lime'];
    const problems: string[] = [];
    for (let h = 0; h < HISTORIES && problems.length < 3; h++) {
      const home = mkdtempSync(join(dir, 'h-'));
      writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Alex Learner\n\temail = alex@example.com\n[init]\n\tdefaultBranch = main\n[pull]\n\trebase = false\n[log]\n\tdecorate = short\n');
      const m = new GitMachine();
      let n = 0;
      const run = (line: string) => {
        n++;
        const cwd = home + m.learner.cwd.slice('/home/learner'.length);
        const sim = m.exec(line);
        const real = realRun(home, cwd, line, n);
        const text = (err: boolean) => sim.lines.filter((l) => (l.kind === 'err') === err).map((l) => l.text).join('\n');
        if (text(false) !== real.out || text(true) !== real.err || sim.exitCode !== real.exit) {
          problems.push(`history ${h}, command ${n}: ${line}\n--- real stdout:\n${real.out}\n--- sim stdout:\n${text(false)}\n--- real stderr:\n${real.err}\n--- sim stderr:\n${text(true)}\n--- exit ${real.exit} vs ${sim.exitCode}\n--- journal:\n${m.journal.join('\n')}`);
        }
        return sim;
      };
      run('git init -q repo');
      run('cd repo');
      let branchNo = 0;
      for (let step = 0; step < 22 && !problems.length; step++) {
        const repo = m.learner.repos.get('/home/learner/repo')!;
        if (repo.op) {
          // A merge or revert stopped on conflicts: resolve (or give up) the way a learner would.
          const k = r();
          if (k < 0.3) run(`git ${repo.op.kind} --abort`);
          else {
            for (const p of repo.unmerged.keys()) run(`printf '${pick(words)}\\n${pick(words)}\\n' > ${p}`);
            run('git add -A');
            run(repo.op.kind === 'merge' ? (r() < 0.5 ? 'git commit' : 'git commit -m "Resolve"') : 'git revert --continue');
          }
          continue;
        }
        const k = r();
        const branches = repo.branches();
        if (k < 0.45 || !repo.headCommit()) {
          const f = pick(['a.txt', 'b.txt', 'c.txt']);
          const lines = Array.from({ length: 2 + Math.floor(r() * 4) }, () => pick(words));
          run(`printf '${lines.join('\\n')}\\n' > ${f}`);
          if (r() < 0.3) run('git status');
          if (r() < 0.2) run('git diff');
          run('git add -A');
          run(`git commit -m "Change ${f} (${step})"`);
        } else if (k < 0.6) run(`git switch -c b${++branchNo}`);
        else if (k < 0.75 && branches.length > 1) run(`git switch ${pick(branches)}`);
        else if (k < 0.92 && branches.length > 1) run(`git merge ${pick(branches)}`);
        else if (k < 0.97) run('git revert --no-edit HEAD');
        else run('git log --oneline -3');
      }
      if (!problems.length) {
        run('git log --oneline --graph --all');
        run('git log --graph -4');
        run('git status');
      }
    }
    expect(problems.slice(0, 2).join('\n\n=====\n\n')).toBe('');
  });
});
