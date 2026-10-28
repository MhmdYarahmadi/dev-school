/**
 * Content validation: every reference answer must pass its own checker and
 * every deliberately wrong answer must fail. This catches mistakes in the
 * course content as well as bugs in the checker.
 */
import { describe, expect, it } from 'vitest';
import { allConcepts, allItems, MODULES } from '../src/content';
import { evaluateSql, parsonsSql } from '../src/content/evaluate';
import { runSandboxed } from '../src/db/runQuery';
import { checkProjectTask } from '../src/content/projectCheck';

describe.each(MODULES.map((m) => [m.id, m] as const))('module %s', (_id, m) => {
  it('has unique ids and sane structure', () => {
    const ids = [...m.practice, ...m.test].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(m.concepts.length).toBeGreaterThan(0);
    expect(m.test.length).toBeGreaterThanOrEqual(5);
    const conceptIds = new Set(m.concepts.map((c) => c.id));
    for (const e of [...m.practice, ...m.test]) for (const c of e.conceptIds) expect(conceptIds, `${e.id} → ${c}`).toContain(c);
  });
});

describe('every concept example and prediction runs', () => {
  for (const { concept } of allConcepts()) {
    it(concept.id, async () => {
      const ex = await runSandboxed(concept.example.sql);
      expect(ex.ok, ex.ok ? '' : ex.error.message).toBe(true);
      if (concept.predict) {
        const p = await runSandboxed(concept.predict.sql);
        expect(p.ok, p.ok ? 'expected an error' : p.error.message).toBe(!concept.predict.expectError);
        expect(concept.predict.answer).toBeLessThan(concept.predict.choices.length);
      }
    });
  }
});

describe('every exercise: solution passes, wrong answer fails', () => {
  for (const { id, item } of allItems()) {
    it(id, async () => {
      if (item.kind === 'readQuery') {
        expect(item.answer).toBeLessThan(item.choices.length);
        if (item.sql) {
          const r = await runSandboxed(item.sql);
          expect(r.ok, r.ok ? 'expected an error' : r.error.message).toBe(!item.expectError);
        }
        return;
      }
      if (item.kind === 'parsons') {
        const good = await evaluateSql(item, parsonsSql(item.blocks));
        expect(good.status, good.error?.message ?? good.feedback.join(' ')).toBe('correct');
        const bad = await evaluateSql(item, parsonsSql(item.wrongOrder));
        expect(bad.status).not.toBe('correct');
        return;
      }
      const good = await evaluateSql(item, item.solution);
      expect(good.status, good.error?.message ?? good.feedback.join(' ')).toBe('correct');
      const bad = await evaluateSql(item, item.wrongExample!);
      expect(bad.status, `wrongExample unexpectedly passed: ${item.wrongExample}`).not.toBe('correct');
      if (item.kind === 'fixBug' || item.kind === 'fillBlank') {
        const starter = await evaluateSql(item, item.starterSql);
        expect(starter.status, 'starter SQL must not already be correct').not.toBe('correct');
      }
    });
  }
});

describe('every project task: reference passes all requirements, a junk answer does not', () => {
  for (const m of MODULES) {
    for (const t of m.project?.tasks ?? []) {
      it(t.id, async () => {
        const good = await checkProjectTask(t, t.referenceSolution);
        if ('error' in good) throw new Error(good.error);
        for (const r of good.requirements) expect(r.ok, r.label).toBe(true);
        const junk = await checkProjectTask(t, 'SELECT 1 AS x');
        expect('error' in junk || junk.requirements.some((r) => !r.ok)).toBe(true);
      });
    }
  }
});
