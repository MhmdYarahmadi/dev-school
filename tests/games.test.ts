/**
 * Game level validation: every level must be solvable, and its puzzle must
 * actually require the skill (bad answers fail, clues narrow things down…).
 */
import { describe, expect, it } from 'vitest';
import { createSeededDb } from '../src/db/engine';
import { checkAnswer } from '../src/db/checker';
import { execRaw, runSandboxed } from '../src/db/runQuery';
import { PODIUM_LEVELS, WAREHOUSE_LEVELS, BRIDGE_LEVELS, RANKRACE_LEVELS } from '../src/games/levels/queryGames';
import { SNAPSHOT_LEVELS } from '../src/games/Snapshot';
import { LINEUP_CASES, SUSPECTS_SETUP } from '../src/games/levels/lineup';
import { FORGE_LEVELS, FORGE_SETUP, forgeQuery } from '../src/games/levels/forge';
import { CASEFILES, FINALE } from '../src/games/levels/cases';
import { COLLATERAL, DOCTOR_REFERENCE_CURE, DOCTOR_SETUP, SYMPTOMS } from '../src/games/levels/doctor';
import { GATE_WAVES } from '../src/games/levels/gatekeeper';
import { tryAllQuery } from '../src/content/ddlCheck';
import { costFromExplain, EVENTS_SETUP, explainSql, RACE_LEVELS } from '../src/games/levels/indexracer';

describe('query-round games: every level\'s solution runs and matches itself', () => {
  const all = [
    ...SNAPSHOT_LEVELS.map((l, i) => ({ name: `snapshot ${i + 1}`, solution: l.target, setupSql: undefined, orderMatters: false })),
    ...PODIUM_LEVELS.map((l, i) => ({ name: `podium ${i + 1}`, ...l })),
    ...WAREHOUSE_LEVELS.map((l, i) => ({ name: `warehouse ${i + 1}`, ...l })),
    ...BRIDGE_LEVELS.map((l, i) => ({ name: `bridge ${i + 1}`, ...l })),
    ...RANKRACE_LEVELS.map((l, i) => ({ name: `rankrace ${i + 1}`, ...l })),
  ];
  for (const l of all) {
    it(l.name, async () => {
      const o = await checkAnswer(l.solution, { solution: l.solution, setupSql: l.setupSql, orderMatters: l.orderMatters });
      expect(o.status, o.error?.message).toBe('correct');
      expect(o.actual!.rows.length).toBeGreaterThan(0);
    });
  }
  it('podium levels with order have no ties in their output', async () => {
    for (const l of PODIUM_LEVELS) {
      const r = await runSandboxed(l.solution, l.setupSql);
      if (!r.ok) throw new Error(r.error.message);
      const keys = r.last!.rows.map((row) => JSON.stringify(row));
      expect(new Set(keys).size, l.prompt).toBe(keys.length);
    }
  });
});

describe('suspect lineup', () => {
  for (const c of LINEUP_CASES) {
    it(c.title, async () => {
      const all = c.clues.map((cl) => `(${cl.sql})`).join(' AND ');
      const r = await runSandboxed(`SELECT suspect_id FROM suspects WHERE ${all}`, SUSPECTS_SETUP);
      if (!r.ok) throw new Error(r.error.message);
      expect(r.last!.rows.map((x) => x[0])).toEqual([c.culpritId]);
      // Every single clue on its own must leave several suspects.
      for (const cl of c.clues) {
        const one = await runSandboxed(`SELECT count(*) FROM suspects WHERE ${cl.sql}`, SUSPECTS_SETUP);
        if (!one.ok) throw new Error(one.error.message);
        expect(Number(one.last!.rows[0][0]), cl.text).toBeGreaterThan(1);
      }
      // All clues but the last must still be ambiguous.
      const most = c.clues.slice(0, -1).map((cl) => `(${cl.sql})`).join(' AND ');
      const m = await runSandboxed(`SELECT count(*) FROM suspects WHERE ${most}`, SUSPECTS_SETUP);
      if (!m.ok) throw new Error(m.error.message);
      expect(Number(m.last!.rows[0][0])).toBeGreaterThan(1);
    });
  }
});

describe('formula forge', () => {
  for (const l of FORGE_LEVELS) {
    it(l.title, async () => {
      const r = await runSandboxed(forgeQuery(l.target), FORGE_SETUP);
      expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
      // The raw input column alone must not already be the answer.
      const raw = await checkAnswer(forgeQuery(l.inputs[0]), { solution: forgeQuery(l.target), setupSql: FORGE_SETUP, orderMatters: true });
      expect(raw.status).not.toBe('correct');
    });
  }
});

describe('mystery cases', () => {
  for (const c of [CASEFILES, FINALE]) {
    for (const [i, s] of c.steps.entries()) {
      it(`${c.id} step ${i + 1}`, async () => {
        const r = await runSandboxed(s.solution, c.setupSql);
        expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
        expect(r.ok && r.last!.rows.length).toBeGreaterThan(0);
      });
    }
    it(`${c.id} culprit is among the suspects`, () => expect(c.suspects).toContain(c.culprit));
  }
  it('casefiles narrows to Ravi', async () => {
    const r = await runSandboxed(CASEFILES.steps[2].solution, CASEFILES.setupSql);
    expect(r.ok && r.last!.rows.map((x) => x[0]).sort()).toEqual(['Leo Fischer', 'Ravi Nair']);
    const s = await runSandboxed(CASEFILES.steps[3].solution, CASEFILES.setupSql);
    const swipes = Object.fromEntries((s.ok ? s.last!.rows : []).map((x) => [x[0], Number(x[1])]));
    expect(swipes['Ravi Nair']).toBeGreaterThan(swipes['Leo Fischer']);
  });
});

describe('data doctor', () => {
  it('starts sick, the reference cure heals everything without collateral damage', async () => {
    const db = await createSeededDb();
    try {
      await db.exec(DOCTOR_SETUP);
      for (const s of SYMPTOMS) expect((await execRaw(db, s.healthy)).ok && (await execRaw(db, s.healthy) as any).last.rows[0][0], s.label).toBe(false);
      await db.exec(DOCTOR_REFERENCE_CURE);
      for (const s of SYMPTOMS) {
        const r = await execRaw(db, s.healthy);
        expect(r.ok && r.last!.rows[0][0], s.label).toBe(true);
      }
      const c = await execRaw(db, COLLATERAL);
      expect(c.ok && Number(c.last!.rows[0][0])).toBe(0);
      // A careless cure causes collateral damage.
      await db.exec('UPDATE shop SET in_stock = 0');
      const c2 = await execRaw(db, COLLATERAL);
      expect(c2.ok && Number(c2.last!.rows[0][0])).toBeGreaterThan(0);
    } finally {
      await db.close();
    }
  });
});

describe('gatekeeper', () => {
  for (const w of GATE_WAVES) {
    it(w.table, async () => {
      const run = async (ddl: string) => {
        const r = await runSandboxed(`${w.setupSql ?? ''}\n${ddl}\n${tryAllQuery(w.rows.map((x) => x.sql))}`);
        if (!r.ok) throw new Error(r.error.message);
        return r.last!.rows.map((x) => String(x[1]).startsWith('accepted'));
      };
      expect(await run(w.reference)).toEqual(w.rows.map((x) => x.good));
      // The naive starter table must let at least one bad row through.
      const naive = await run(w.starter);
      expect(naive.some((ok, i) => ok && !w.rows[i].good)).toBe(true);
    });
  }
});

describe('index racer', () => {
  it('every level: slow before, under target after the reference fix', async () => {
    const db = await createSeededDb();
    try {
      await db.exec(EVENTS_SETUP);
      for (const l of RACE_LEVELS) {
        const before = costFromExplain((await db.query(explainSql(l.query))).rows[0] && Object.values((await db.query(explainSql(l.query))).rows[0] as object)[0]);
        expect(before, `${l.title} before`).toBeGreaterThan(l.targetCost);
        await db.exec(l.referenceDdl);
        await db.exec('ANALYZE events');
        const q = l.referenceQuery ?? l.query;
        const after = costFromExplain(Object.values((await db.query(explainSql(q))).rows[0] as object)[0]);
        expect(after, `${l.title} after`).toBeLessThanOrEqual(l.targetCost);
        if (l.referenceQuery) {
          const a = await db.query(l.query);
          const b = await db.query(l.referenceQuery);
          expect(b.rows).toEqual(a.rows);
        }
      }
    } finally {
      await db.close();
    }
  });
});
