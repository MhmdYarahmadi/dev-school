/**
 * System Design content validation. Designs are judged by running them, so every one runs here:
 * reference designs meet their requirements, wrong examples and starters don't, predictions and
 * diagnose questions are backed by facts about real runs (`verify`), and estimates add up.
 */
import { describe, expect, it } from 'vitest';
import type { Exercise } from '../src/content/types';
import { checkEstimate, checkParsons, evaluateSd, parseEstimate, runDesignSync } from '../src/courses/sd/check';
import { sdContent } from '../src/courses/sd/content';
import { SD_MODULES } from '../src/courses/sd/content/index';
import { checkRequirements, parseRequirement, simulate, yamlToDesign } from '../src/courses/sd/engine';
import { scenarioFromYaml, toRunSpec } from '../src/courses/sd/engine/scenario';
import { taskRun } from '../src/courses/sd/ui/ProjectView';
import { PRESETS } from '../src/courses/sd/ui/Sandbox';

const conceptIds = new Set(SD_MODULES.flatMap((m) => m.concepts.map((c) => c.id)));
const items = SD_MODULES.flatMap((m) => [...m.practice, ...m.test]);

/** Runs a scenario and returns the requirement-style facts that don't hold. */
function failingFacts(code: string, facts: string[]): string[] {
  const p = scenarioFromYaml(code);
  expect(p.errors).toEqual([]);
  const { design, ...run } = p.scenario!;
  const r = simulate(toRunSpec(design, run));
  expect(r.invalid ?? []).toEqual([]);
  return checkRequirements(r, facts)
    .filter((c) => !c.ok)
    .map((c) => c.line);
}

describe('structure', () => {
  it('ids are unique and references exist', () => {
    const ids = new Set<string>();
    for (const m of SD_MODULES) {
      for (const x of [...m.concepts, ...m.practice, ...m.test]) {
        expect(ids.has(x.id), x.id).toBe(false);
        ids.add(x.id);
      }
      for (const e of [...m.practice, ...m.test]) for (const c of e.conceptIds) expect(conceptIds.has(c), `${e.id} → ${c}`).toBe(true);
      for (const g of m.games) expect(sdContent.games[g], g).toBeTruthy();
    }
  });
  it('every concept is practised; every checked item says how it is checked', () => {
    for (const m of SD_MODULES) for (const c of m.concepts) expect(m.practice.some((e) => e.conceptIds.includes(c.id)), c.id).toBe(true);
    for (const e of items) {
      if (e.kind === 'readQuery') expect(e.answer).toBeLessThan(e.choices.length);
      else if (e.kind !== 'parsons') {
        expect(e.sd, e.id).toBeTruthy();
        if (e.sd!.target === 'design') expect(e.sd!.run?.requirements?.length, `${e.id} needs requirements`).toBeGreaterThan(0);
      }
    }
  });
  it('every requirement parses', () => {
    for (const e of items) for (const q of e.sd?.run?.requirements ?? []) expect(() => parseRequirement(q), `${e.id}: ${q}`).not.toThrow();
  });
});

describe('worked examples and predictions', () => {
  for (const m of SD_MODULES)
    for (const c of m.concepts) {
      it(c.id, () => {
        failingFacts(c.example.sql, []);
        if (c.predict) {
          expect(c.predict.answer).toBeLessThan(c.predict.choices.length);
          expect(c.predict.verify?.length, 'a prediction needs facts that prove its answer').toBeGreaterThan(0);
          expect(failingFacts(c.predict.sql, c.predict.verify!)).toEqual([]);
        }
      });
    }
});

describe('diagnose questions', () => {
  for (const e of items)
    if (e.kind === 'readQuery' && e.sql)
      it(e.id, () => {
        expect(e.verify?.length, 'a diagnose question needs facts that prove its answer').toBeGreaterThan(0);
        expect(failingFacts(e.sql!, e.verify!)).toEqual([]);
      });
});

const answerOf = (e: Exercise, which: 'solution' | 'wrong'): string => {
  if (e.kind === 'parsons') return (which === 'solution' ? e.blocks : e.wrongOrder).join('\n');
  if (e.kind === 'readQuery') return '';
  return which === 'solution' ? e.solution : e.wrongExample;
};

describe('exercises', () => {
  for (const e of items.filter((x) => x.kind !== 'readQuery')) {
    it(e.id, async () => {
      if (e.kind === 'parsons') {
        expect(checkParsons(e.blocks, e.blocks)).toBe(true);
        expect(checkParsons(e.blocks, e.wrongOrder)).toBe(false);
        return;
      }
      const good = await evaluateSd(e, answerOf(e, 'solution'), true);
      expect(good.feedback, 'solution should pass').toEqual(good.status === 'correct' ? good.feedback : []);
      expect(good.status).toBe('correct');
      const bad = await evaluateSd(e, answerOf(e, 'wrong'), true);
      expect(bad.status, 'wrong example should fail').not.toBe('correct');
      if ('starterSql' in e && e.starterSql) expect((await evaluateSd(e, e.starterSql, true)).status, 'starter should not pass').not.toBe('correct');
      if (e.sd?.tuneOnly) {
        const start = yamlToDesign(e.starterSql!).design!;
        const sol = yamlToDesign(e.solution).design!;
        expect(sol.nodes.map((n) => n.id).sort()).toEqual(start.nodes.map((n) => n.id).sort());
      }
      if (e.sd?.target === 'estimate') expect(parseEstimate(e.solution)).not.toBeNull();
    });
  }
});

describe.runIf(SD_MODULES.some((m) => m.project))('projects', () => {
  for (const m of SD_MODULES)
    for (const t of m.project?.tasks ?? []) {
      it(`${m.id} ${t.id}`, () => {
        if (t.sd?.target === 'estimate') {
          expect(checkEstimate(t.sd, t.referenceSolution, t.referenceSolution).status).toBe('correct');
          return;
        }
        const run = taskRun(t);
        const ref = runDesignSync(yamlToDesign(t.referenceSolution).design!, run);
        expect(ref.feedback).toEqual(['Every requirement is met.']);
        if (t.sd?.starter) {
          const start = yamlToDesign(t.sd.starter).design;
          if (start) expect(runDesignSync(start, run).status).not.toBe('correct');
        }
      });
    }
});

describe('sandbox presets', () => {
  for (const p of PRESETS)
    it(p.id, () => {
      const s = scenarioFromYaml(p.yaml);
      expect(s.errors).toEqual([]);
      if (p.id !== 'empty') {
        const o = runDesignSync(s.scenario!.design, s.scenario!);
        expect(o.result!.invalid ?? []).toEqual([]);
        // a starting point should work as given
        expect(o.feedback).toEqual(['Every requirement is met.']);
      }
    });
});
