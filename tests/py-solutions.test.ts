/**
 * Python content validation: every reference solution must pass its own checker,
 * run in real CPython (Pyodide, loaded in Node via the engine's Node fallback).
 * Catches authoring typos before the browser ever loads. Mirrors solutions.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { PYTHON_MODULES } from '../src/courses/python/content/index';
import { evaluatePython, norm } from '../src/courses/python/check';
import { runPython } from '../src/courses/python/engine/run';

/** When the real output is one of the choices, that choice must be the marked answer. */
function answerMatchesOutput(choices: string[], answer: number, stdout: string) {
  const out = norm(stdout);
  const i = choices.findIndex((c) => norm(c.replace(/^`|`$/g, '')) === out);
  if (i >= 0) expect(choices[answer], `the program prints ${JSON.stringify(out)}`).toBe(choices[i]);
}

describe.each(PYTHON_MODULES.map((m) => [m.id, m] as const))('module %s', (_id, m) => {
  it('has unique ids and sane structure', () => {
    const ids = [...m.practice, ...m.test].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(m.concepts.length).toBeGreaterThan(0);
    expect(m.test.length).toBeGreaterThanOrEqual(5);
    const conceptIds = new Set(m.concepts.map((c) => c.id));
    for (const e of [...m.practice, ...m.test]) for (const c of e.conceptIds) expect(conceptIds, `${e.id} → ${c}`).toContain(c);
  });
});

describe('every concept example and prediction runs cleanly', () => {
  for (const m of PYTHON_MODULES) {
    for (const c of m.concepts) {
      it(c.id, async () => {
        const ex = await runPython(c.example.sql);
        expect(ex.error, ex.error).toBe('');
        if (c.predict) {
          const p = await runPython(c.predict.sql);
          expect(p.error, p.error).toBe('');
          expect(c.predict.answer).toBeLessThan(c.predict.choices.length);
          answerMatchesOutput(c.predict.choices, c.predict.answer, p.stdout);
        }
      });
    }
  }
});

describe('every exercise: solution passes, starter/wrong order does not', () => {
  for (const m of PYTHON_MODULES) {
    for (const item of [...m.practice, ...m.test]) {
      it(`${m.id}/${item.id}`, async () => {
        if (item.kind === 'readQuery') {
          expect(item.answer).toBeLessThan(item.choices.length);
          if (item.sql) {
            const r = await runPython(item.sql);
            expect(r.error, r.error).toBe('');
            answerMatchesOutput(item.choices, item.answer, r.stdout);
          }
          return;
        }
        if (item.kind === 'parsons') {
          const good = await evaluatePython(item, item.blocks.join('\n'));
          expect(good.status, good.feedback.join(' ')).toBe('correct');
          const bad = await evaluatePython(item, item.wrongOrder.join('\n'));
          expect(bad.status).not.toBe('correct');
          return;
        }
        const good = await evaluatePython(item, item.solution);
        expect(good.status, good.feedback.join(' ')).toBe('correct');
        if ((item.kind === 'fixBug' || item.kind === 'fillBlank') && item.starterSql) {
          const starter = await evaluatePython(item, item.starterSql);
          expect(starter.status, 'starter code must not already be correct').not.toBe('correct');
        }
      });
    }
  }
});

describe('Persian lessons, English code', () => {
  const FA = /[\u0600-\u06FF]/;
  const CODE = new Set(['sql', 'solution', 'starterSql', 'syntax', 'blocks', 'distractors', 'tests', 'stdin', 'wrongOrder']);
  it('no Persian inside any code (code fields, ```blocks``` and `inline code`)', () => {
    const bad: string[] = [];
    const walk = (v: unknown, k: string, path: string) => {
      if (typeof v === 'string') {
        if (CODE.has(k) && FA.test(v)) bad.push(path);
        for (const m of v.match(/```[\s\S]*?```/g) ?? []) if (FA.test(m)) bad.push(`${path} block`);
        for (const m of v.replace(/```[\s\S]*?```/g, '').match(/`[^`]+`/g) ?? []) if (FA.test(m)) bad.push(`${path} ${m}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, k, `${path}/${i}`));
      else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, kk, `${path}/${kk}`);
    };
    for (const m of PYTHON_MODULES) walk(m, '', m.id);
    expect(bad).toEqual([]);
  });
});
