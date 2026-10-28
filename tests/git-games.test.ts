/** Git game missions: unsolved at the start, solved by their solution within par, and the classic wrong moves don't pass. */
import { describe, expect, it } from 'vitest';
import { BRANCH_RUNNER, CONFLICT_DOCTOR, goalsMet, goalsOf, isFree, playTeammate, prepareMission, PUSH_PULL, STAGE_MANAGER, targetGraph, teammateDue, type GitMission } from '../src/courses/git/games/missions';

const all: [string, GitMission[]][] = [
  ['Stage Manager', STAGE_MANAGER],
  ['Branch Runner', BRANCH_RUNNER],
  ['Conflict Doctor', CONFLICT_DOCTOR],
  ['Push/Pull Race', PUSH_PULL],
];

/** Plays commands as the game does: Sam's moves happen right after the learner's n-th counted command. */
function play(m: GitMission, cmds: string[]) {
  const { machine, start } = prepareMission(m);
  let count = 0;
  const codes = cmds.map((c) => {
    const r = machine.exec(c);
    if (!isFree(c)) for (const t of teammateDue(m, ++count)) playTeammate(machine, t);
    return { c, r };
  });
  return { met: goalsMet(goalsOf(m), machine, start), codes };
}

for (const [game, missions] of all) {
  describe(game, () => {
    for (const m of missions) {
      it(m.title, () => {
        const goals = goalsOf(m);
        expect(goals.length).toBeGreaterThan(0);
        expect(play(m, []).met.every(Boolean), 'already solved at the start').toBe(false);
        const { met, codes } = play(m, m.solution);
        // A merge that stops on a conflict exits 1: that's the mission, not a mistake.
        for (const { c, r } of codes) if (!r.lines.some((l) => l.text.startsWith('CONFLICT'))) expect(r.exitCode, `${c}: ${r.lines.map((l) => l.text).join(' ')}`).toBe(0);
        expect(met, goals.map((g) => g.label).join(' / ')).toEqual(goals.map(() => true));
        expect(m.solution.filter((c) => !isFree(c)).length).toBeLessThanOrEqual(m.par);
        if (m.target) expect(targetGraph(m)?.commits.length).toBeGreaterThan(0);
      });
    }
  });
}

describe('mission traps', () => {
  it('Clean desk: git add . takes the notes too', () => {
    expect(play(STAGE_MANAGER[0], ['git add .', 'git commit -m "x"']).met).toEqual([true, true, true, false]);
  });
  it('One change per commit: commit -am makes one commit with both', () => {
    expect(play(STAGE_MANAGER[1], ['git commit -am "x"']).met).toEqual([false, true]);
  });
  it('The late edit: committing the staged copy leaves the newer line behind', () => {
    expect(play(STAGE_MANAGER[2], ['git commit -m "x"']).met).toEqual([true, false, false]);
  });
  it('Leave the draft: commit -am commits the draft', () => {
    expect(play(STAGE_MANAGER[3], ['git commit -am "x"']).met).toEqual([true, true, false]);
  });
  it('New laptop: without --global the name is only set for this repository', () => {
    expect(play(STAGE_MANAGER[5], ['git config user.name "Alex Learner"', 'git config user.email "alex@example.com"', 'git commit -m "x"']).met).toEqual([true, false]);
  });
  it('Sprout: committing on main instead of a branch', () => {
    const r = play(BRANCH_RUNNER[0], ['git branch menu', 'echo x >> index.html', 'git commit -am "x"']).met;
    expect(r.every(Boolean)).toBe(false);
  });
  it('Join the paths: merging main into about is the wrong way round', () => {
    const r = play(BRANCH_RUNNER[2], ['git switch about', 'git merge main', 'git switch main', 'git merge about', 'git branch -d about']).met;
    expect(r.every(Boolean)).toBe(false);
  });
  it('Two features: branching footer from header changes the shape', () => {
    const m = BRANCH_RUNNER[4];
    const r = play(m, ['git switch -c header', 'echo a >> index.html', 'git commit -am "a"', 'git switch -c footer', 'echo b >> style.css', 'git commit -am "b"', 'git switch main', 'git merge header', 'git merge footer', 'git branch -d header footer']).met;
    expect(r.every(Boolean)).toBe(false);
  });
  it('First aid: committing without fixing leaves markers in the commit', () => {
    expect(play(CONFLICT_DOCTOR[0], ['git add index.html', 'git commit --no-edit']).met).toEqual([true, false, false, true]);
  });
  it('First aid: fixing the file without git add leaves the merge unfinished', () => {
    const p = CONFLICT_DOCTOR[0];
    expect(play(p, [p.solution[0], 'git commit --no-edit']).met[0]).toBe(false);
  });
  it('Best of both: taking one side loses the other drink', () => {
    expect(play(CONFLICT_DOCTOR[1], ['git merge cakes', 'printf "<h1>Drinks</h1>\\n<ul>\\n<li>Coffee</li>\\n<li>Tea</li>\\n</ul>\\n" > menu.html', 'git add .', 'git commit --no-edit']).met).toEqual([true, false, true, true]);
  });
  it('Wrong turn: resolving the wrong merge merges experiment', () => {
    const p = CONFLICT_DOCTOR[3];
    const r = play(p, [p.solution[2], 'git add index.html', 'git commit --no-edit', 'git merge hours']).met;
    expect(r[0]).toBe(false);
  });
  it('Price check: taking one side keeps the old name or price', () => {
    expect(play(CONFLICT_DOCTOR[4], ['git merge sale', 'printf "Menu\\nTea: 2 EUR\\nCake: 4 EUR\\n" > menu.txt', 'git add .', 'git commit --no-edit']).met[1]).toBe(false);
  });
  it('Sam was faster: --force pushes your commit but deletes Sam\'s', () => {
    const r = play(PUSH_PULL[1], ['git push --force']).met;
    expect(r[0]).toBe(true);
    expect(r[1]).toBe(false);
  });
  it('Busy Sam: pushing without a final pull leaves you out of sync', () => {
    expect(play(PUSH_PULL[2], ['git pull', 'git pull', 'git push']).met).toEqual([true, true, false, true]);
  });
  it('Same line: pushing the conflict markers is not a fix', () => {
    const r = play(PUSH_PULL[3], ['git pull', 'git add index.html', 'git commit --no-edit', 'git push']).met;
    expect(r[2]).toBe(false);
  });
  it('Your branch: pushing without -u leaves no upstream', () => {
    const r = play(PUSH_PULL[4], ['git switch -c sale', 'echo x >> index.html', 'git commit -am x', 'git push origin sale', 'git switch main', 'git pull']).met;
    expect(r[0]).toBe(true);
    expect(r[1]).toBe(false);
  });
  it('isFree: looking and editing files are free, changing git commands count', () => {
    for (const c of ['git status', 'git log --oneline --graph --all', 'git branch', 'git branch -a', 'git diff --staged', 'echo hi > a.txt', 'ls', 'cd site']) expect(isFree(c), c).toBe(true);
    for (const c of ['git add .', 'git commit -m x', 'git branch menu', 'git switch main', 'git merge fix', 'git config --global user.name "A"']) expect(isFree(c), c).toBe(false);
  });
});
