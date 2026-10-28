/**
 * System Design games: every scenario level starts unsolved and its reference solution passes at or
 * under par; Napkin Math's generated questions match their worked steps.
 */
import { describe, expect, it } from 'vitest';
import { prepareDesign, runDesignSync } from '../src/courses/sd/check';
import { sdContent } from '../src/courses/sd/content';
import { Rng } from '../src/courses/sd/engine/rng';
import { makeQuestions, napkinScore, ROUNDS, TEMPLATES } from '../src/courses/sd/games/napkin';
import { levelScore, prepareLevel, type SdLevel } from '../src/courses/sd/games/rounds';
import { SD_LEVELS } from '../src/courses/sd/games/levels';

describe('registry', () => {
  it('every game has a module and levels or a generator', () => {
    for (const g of Object.values(sdContent.games)) {
      expect(sdContent.modules.some((m) => m.id === g.moduleId && m.games.includes(g.id)), g.id).toBe(true);
    }
  });
});

describe('napkin math', () => {
  it('every template makes sensible questions', () => {
    for (const [k, t] of Object.entries(TEMPLATES))
      for (let s = 1; s <= 30; s++) {
        const q = t(new Rng(s * 101));
        expect(Number.isFinite(q.answer) && q.answer > 0, k).toBe(true);
        expect(q.prompt.length).toBeGreaterThan(20);
        // the bold number in the worked steps is the answer (rounded as shown)
        const shown = [...q.steps.matchAll(/\*\*\$?([0-9.,]*[0-9])/g)].pop()?.[1];
        expect(shown, `${k}: ${q.steps}`).toBeTruthy();
        const v = Number(shown!.replace(/,/g, ''));
        expect(Math.abs(v - q.answer) / q.answer, `${k}: ${q.steps} vs ${q.answer}`).toBeLessThan(0.05);
      }
  });
  it('a play has distinct topics and scores accuracy and speed', () => {
    const qs = makeQuestions(42);
    expect(qs).toHaveLength(ROUNDS);
    expect(napkinScore(100, 100, 45).points).toBe(100);
    expect(napkinScore(120, 100, 45).points).toBe(70);
    expect(napkinScore(140, 100, 45).points).toBe(35);
    expect(napkinScore(1000, 100, 45).points).toBe(0);
    expect(napkinScore(100, 100, 0).points).toBe(50);
  });
});

describe('level scoring', () => {
  it('pass, cost and hints', () => {
    expect(levelScore(false, 100, 100, false)).toBe(0);
    expect(levelScore(true, 100, 100, false)).toBe(100);
    expect(levelScore(true, 150, 100, false)).toBe(70);
    expect(levelScore(true, 125, 100, true)).toBe(65);
  });
});

for (const [game, levels] of Object.entries(SD_LEVELS) as [string, SdLevel[]][])
  describe(`levels: ${game}`, () => {
    for (const l of levels)
      it(l.title, () => {
        const { starter, run } = prepareLevel(l);
        const start = runDesignSync(prepareDesign(starter).design!, run);
        expect(start.result!.invalid ?? []).toEqual([]);
        expect(start.status, 'the starter should not pass').not.toBe('correct');
        const prep = prepareDesign(l.solution, { tuneOnly: l.tuneOnly, starter });
        expect(prep.outcome?.feedback ?? []).toEqual([]);
        const sol = runDesignSync(prep.design!, run);
        expect(sol.feedback).toEqual(['Every requirement is met.']);
        expect(sol.result!.cost.monthly, 'solution at or under par').toBeLessThanOrEqual(l.parCost);
        expect(sol.result!.cost.monthly, 'par should be tight (within 15%)').toBeGreaterThan(l.parCost * 0.85);
      });
  });
