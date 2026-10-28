/**
 * Git course content validation: every reference answer passes the checker, every wrong example
 * fails, no starter is already correct, every setup runs cleanly, and every worked example and
 * prediction behaves as the lesson says (predictions' `verify` patterns must match the real output).
 */
import { describe, expect, it } from 'vitest';
import type { Exercise } from '../src/content/types';
import { answerCommands, checkGitProject, evaluateGit, sandbox, setupErrors } from '../src/courses/git/check';
import { gitContent } from '../src/courses/git/content';
import { detectGitMisconceptions } from '../src/courses/git/misconceptions';
import { GIT_MODULES } from '../src/courses/git/content/index';

const conceptIds = new Set(GIT_MODULES.flatMap((m) => m.concepts.map((c) => c.id)));
const items = GIT_MODULES.flatMap((m) => [...m.practice, ...m.test]);

function runLines(code: string, env?: Parameters<typeof sandbox>[0]) {
  const m = sandbox(env);
  return answerCommands(code).map((cmd) => ({ cmd, ...m.exec(cmd) }));
}
const text = (rs: ReturnType<typeof runLines>) => rs.flatMap((r) => r.lines.map((l) => l.text)).join('\n');

describe('structure', () => {
  it('ids are unique, concept and game references exist', () => {
    const ids = new Set<string>();
    for (const m of GIT_MODULES) {
      for (const x of [...m.concepts, ...m.practice, ...m.test]) {
        expect(ids.has(x.id), x.id).toBe(false);
        ids.add(x.id);
      }
      for (const e of [...m.practice, ...m.test]) for (const c of e.conceptIds) expect(conceptIds.has(c), `${e.id} → ${c}`).toBe(true);
      for (const g of m.games) expect(gitContent.games[g], g).toBeTruthy();
    }
  });
  it('every checked exercise has a git spec; choices are valid', () => {
    for (const e of items) {
      if (e.kind === 'readQuery') expect(e.answer).toBeLessThan(e.choices.length);
      else expect(e.git, e.id).toBeTruthy();
    }
  });
  it('every concept is practised by at least one practice item', () => {
    for (const m of GIT_MODULES) for (const c of m.concepts) expect(m.practice.some((e) => e.conceptIds.includes(c.id)), c.id).toBe(true);
  });
  it('every setup runs without errors', () => {
    const envs = [...items.map((e) => [e.id, e.git] as const), ...GIT_MODULES.flatMap((m) => m.concepts.map((c) => [c.id, c.env] as const)), ...GIT_MODULES.flatMap((m) => m.project?.tasks.map((t) => [t.id, t.git] as const) ?? [])];
    for (const [id, env] of envs) expect(setupErrors(env), id).toEqual([]);
  });
});

describe('worked examples and predictions', () => {
  for (const m of GIT_MODULES)
    for (const c of m.concepts) {
      it(c.id, () => {
        const failing = runLines(c.example.sql, c.env).filter((r) => r.exitCode !== 0);
        expect(failing.map((f) => `${f.cmd} → ${f.lines.map((l) => l.text).join(' ')}`)).toEqual([]);
        if (c.predict) {
          expect(c.predict.answer).toBeLessThan(c.predict.choices.length);
          const p = runLines(c.predict.sql, c.env);
          const bad = p.filter((r) => r.exitCode !== 0);
          if (c.predict.expectError) expect(bad.length, 'expected an error').toBeGreaterThan(0);
          else expect(bad.map((f) => f.cmd)).toEqual([]);
          for (const v of c.predict.verify ?? []) expect(text(p), `${c.id}: /${v}/`).toMatch(new RegExp(v));
        }
      });
    }
});

/** The answer an exercise starts with (what a learner sees before changing anything). */
function starterOf(e: Exercise): string | null {
  if (e.kind === 'fillBlank' || e.kind === 'fixBug') return e.starterSql;
  return null;
}

describe('exercises: reference passes, wrong example and starter fail', () => {
  for (const e of items) {
    if (e.kind === 'readQuery') {
      if (e.sql && e.git)
        it(`${e.id} (shown commands run)`, () => {
          const bad = runLines(e.sql!, e.git).filter((r) => r.exitCode !== 0);
          if (!e.expectError) expect(bad.map((b) => b.cmd)).toEqual([]);
        });
      continue;
    }
    it(e.id, () => {
      const reference = e.kind === 'parsons' ? e.blocks.join('\n') : e.solution;
      const ok = evaluateGit(e, reference);
      expect(ok.feedback, `${e.id}: the reference answer should pass`).toEqual([]);
      const wrong = e.kind === 'parsons' ? e.wrongOrder.join('\n') : e.wrongExample ?? '';
      expect(evaluateGit(e, wrong).status, `${e.id}: the wrong example should fail`).toBe('wrong');
      const starter = starterOf(e);
      if (starter && !/___/.test(starter)) expect(evaluateGit(e, starter).status, `${e.id}: the starter should not already be correct`).toBe('wrong');
    });
  }
});

describe.skipIf(!GIT_MODULES.some((m) => m.project))('projects: the reference meets every requirement, an empty answer does not', () => {
  for (const m of GIT_MODULES)
    for (const t of m.project?.tasks ?? []) {
      it(t.id, () => {
        const r = checkGitProject(t, t.referenceSolution);
        expect(r.requirements.map((x, i) => (x.ok ? 'ok' : `${t.requirements[i].label}: ${x.output}`))).toEqual(t.requirements.map(() => 'ok'));
        expect(checkGitProject(t, '').requirements.every((x) => x.ok)).toBe(false);
      });
    }
});

describe('misconceptions: wrong answers get the right explanation', () => {
  const find = (id: string) => items.find((e) => e.id === id)!;
  const ids = (id: string, answer: string) => {
    const e = find(id);
    return detectGitMisconceptions({ answer, spec: e.git!, outcome: evaluateGit(e, answer) }).map((m) => m.id);
  };
  it.each([
    ['g01-p6', 'git commit -m "Update title"', 'commit-without-add'],
    ['g03-p1', 'git switch -c menu', null],
    ['g02-p7', 'git restore secrets.txt', 'unstage-needs-staged'],
    ['g03-p6', 'git switch about\ngit merge main', 'merge-direction'],
    ['g03-t4', 'git branch -d old', 'delete-unmerged'],
    ['g02-p8', 'git restore index.html', 'restore-vs-revert'],
    ['g04-p4', 'git commit -m "Merge branch \'hours\'"', 'commit-during-conflict'],
    ['g04-p10', 'git merge hours\ngit add index.html\ngit commit -m "Merge"', 'markers-left'],
    ['g05-p6', 'git push', 'push-before-pull'],
    ['g05-p5', 'git fetch', 'fetch-not-merge'],
    ['g05-p7', 'git push', 'no-upstream'],
    ['g06-p7', 'echo "<p>Hi</p>" >> index.html\ngit commit -am "Add greeting"\ngit push', 'protected-main'],
  ])('%s: %s', (id, answer, want) => {
    const got = ids(id, answer);
    if (want) expect(got).toContain(want);
    expect(evaluateGit(find(id), answer).status).toBe('wrong');
  });
});

describe('project: other valid routes pass, classic mistakes fail', () => {
  const task = (id: string) => GIT_MODULES.flatMap((m) => m.project?.tasks ?? []).find((t) => t.id === id)!;
  const oks = (id: string, answer: string) => checkGitProject(task(id), answer).requirements.map((r) => r.ok);
  it('task 4: fetch + merge origin/main works as well as pull', () => {
    const resolved = "cat > index.html <<'EOF'\n<h1>Shop</h1>\n<p>Free delivery</p>\n<a href=\"contact.html\">Contact us</a>\nEOF";
    expect(oks('g06-proj-4', `git fetch\ngit merge origin/main\n${resolved}\ngit add index.html\ngit commit -m "Merge main"\ngit push`).every(Boolean)).toBe(true);
  });
  it('task 4: pushing the conflict markers fails', () => {
    expect(oks('g06-proj-4', 'git pull origin main\ngit add index.html\ngit commit -m "Merge main"\ngit push')).toEqual([false, true, false, true]);
  });
  it('task 5: tidying up by hand works as well as --delete-branch', () => {
    expect(oks('g06-proj-5', 'gh pr merge 1 --merge\ngit switch main\ngit pull\ngit branch -d contact\ngit push origin --delete contact').every(Boolean)).toBe(true);
  });
  it('task 5: merging without pulling leaves main behind', () => {
    expect(oks('g06-proj-5', 'gh pr merge 1 --merge\ngit switch main')).toEqual([true, false, false, false, false]);
  });
});
