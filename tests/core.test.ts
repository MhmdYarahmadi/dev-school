import { describe, expect, it } from 'vitest';
import { checkAnswer } from '../src/db/checker';
import { runSandboxed } from '../src/db/runQuery';
import { splitStatements, usesTransactionControl } from '../src/db/statements';
import { detectMisconceptions } from '../src/pedagogy/misconceptions';
import { buildSteps } from '../src/pedagogy/visualizer';
import { newCard, quality, schedule } from '../src/pedagogy/review';

describe('statements', () => {
  it('splits respecting quotes and comments', () => {
    expect(splitStatements("SELECT ';'; -- x;\nSELECT 2;")).toEqual(["SELECT ';'", '-- x;\nSELECT 2']);
    expect(usesTransactionControl('BEGIN; UPDATE books SET price = 1; COMMIT;')).toBe(true);
    expect(usesTransactionControl("SELECT 'begin'")).toBe(false);
  });
});

describe('sandbox', () => {
  it('rolls back changes', async () => {
    await runSandboxed('DELETE FROM order_items; DELETE FROM orders');
    const r = await runSandboxed('SELECT count(*) FROM orders');
    expect(r.ok && r.last?.rows[0][0]).toBe(32);
  });
  it('survives user transaction control', async () => {
    await runSandboxed('BEGIN; DELETE FROM order_items; COMMIT;');
    const r = await runSandboxed('SELECT count(*) FROM order_items');
    expect(r.ok && Number(r.last?.rows[0][0])).toBeGreaterThan(0);
  });
});

describe('checker', () => {
  const spec = { solution: "SELECT title, price FROM books WHERE genre = 'Mystery'" };
  it('accepts equivalent answers with different aliases and order', async () => {
    const o = await checkAnswer("SELECT title AS t, price p FROM books WHERE genre ILIKE 'mystery' ORDER BY price", spec);
    expect(o.status).toBe('correct');
  });
  it('explains wrong row counts', async () => {
    const o = await checkAnswer('SELECT title, price FROM books', spec);
    expect(o.status).toBe('wrong');
    expect(o.feedback.join(' ')).toMatch(/30 rows; expected 3/);
  });
  it('detects wrong column count', async () => {
    const o = await checkAnswer("SELECT title FROM books WHERE genre = 'Mystery'", spec);
    expect(o.feedback[0]).toMatch(/1 column/);
  });
  it('reports errors with friendly help', async () => {
    const o = await checkAnswer('SELECT titel FROM books', spec);
    expect(o.status).toBe('error');
    expect(o.errorHelp).toMatch(/no column called "titel"/);
  });
  it('enforces order when asked', async () => {
    const s = { solution: 'SELECT title FROM books ORDER BY price DESC LIMIT 3', orderMatters: true };
    expect((await checkAnswer('SELECT title FROM books ORDER BY price DESC LIMIT 3', s)).status).toBe('correct');
    const w = await checkAnswer('SELECT title FROM (SELECT title, price FROM books ORDER BY price DESC LIMIT 3) t ORDER BY price', s);
    expect(w.feedback[0]).toMatch(/wrong order/);
  });
  it('checks DML through a checkQuery', async () => {
    const s = { solution: "UPDATE books SET price = price * 0.9 WHERE genre = 'Mystery'", checkQuery: 'SELECT book_id, price FROM books' };
    expect((await checkAnswer("UPDATE books SET price = price * 0.9 WHERE genre = 'Mystery'", s)).status).toBe('correct');
    expect((await checkAnswer('UPDATE books SET price = price * 0.9', s)).status).toBe('wrong');
  });
});

describe('misconceptions', () => {
  const ids = (sql: string, errorMessage?: string) => detectMisconceptions({ sql, errorMessage }).map((m) => m.id);
  it('flags = NULL', () => expect(ids('SELECT * FROM books WHERE pages = NULL')).toContain('eq-null'));
  it('does not flag IS NULL', () => expect(ids('SELECT * FROM books WHERE pages IS NULL')).not.toContain('eq-null'));
  it('flags aggregate in WHERE', () => expect(ids('SELECT genre FROM books WHERE count(*) > 2 GROUP BY genre')).toContain('agg-in-where'));
  it('does not flag aggregate in HAVING', () => expect(ids('SELECT genre FROM books GROUP BY genre HAVING count(*) > 2')).not.toContain('agg-in-where'));
  it('flags UPDATE without WHERE', () => expect(ids('UPDATE books SET price = 0')).toContain('update-without-where'));
  it('flags OR/AND mix', () => expect(ids("SELECT * FROM books WHERE genre = 'A' OR genre = 'B' AND price < 10")).toContain('or-precedence'));
  it('accepts parenthesised OR', () => expect(ids("SELECT * FROM books WHERE (genre = 'A' OR genre = 'B') AND price < 10")).not.toContain('or-precedence'));
  it('flags double quotes for text', () => expect(ids('SELECT * FROM books WHERE genre = "Mystery"', 'column "Mystery" does not exist')).toContain('double-quoted-string'));
  it('flags alias used in WHERE', () => expect(ids('SELECT price * 2 AS doubled FROM books WHERE doubled > 20', 'column "doubled" does not exist')).toContain('alias-in-where'));
  it('flags LIKE without wildcard', () => expect(ids("SELECT * FROM books WHERE title LIKE 'The'")).toContain('like-without-wildcard'));
  it('flags comma join without condition', () => expect(ids('SELECT * FROM books, authors')).toContain('missing-join-condition'));
});

describe('visualizer', () => {
  it('builds steps in logical order', () => {
    const steps = buildSteps("SELECT genre, count(*) AS n FROM books WHERE price > 10 GROUP BY genre HAVING count(*) > 1 ORDER BY n DESC LIMIT 3");
    expect(Array.isArray(steps) && steps.map((s) => s.stage)).toEqual(['FROM', 'WHERE', 'GROUP BY', 'HAVING', 'SELECT', 'ORDER BY', 'LIMIT / OFFSET']);
  });
  it('every step query runs', async () => {
    const steps = buildSteps("WITH x AS (SELECT * FROM books) SELECT DISTINCT genre FROM x WHERE title <> 'a; b' ORDER BY genre");
    if (!Array.isArray(steps)) throw new Error(steps.error);
    for (const s of steps) expect((await runSandboxed(s.sql)).ok, s.sql).toBe(true);
  });
  it('rejects non-select', () => expect(buildSteps('DELETE FROM books')).toHaveProperty('error'));
});

describe('review scheduling', () => {
  it('spaces out confident answers and resets misses', () => {
    let c = newCard('x', 0);
    c = schedule(c, quality(true, 'confident'), 0);
    expect(c.intervalDays).toBe(2);
    c = schedule(c, quality(true, 'confident'), 0);
    expect(c.intervalDays).toBe(6);
    const guessed = schedule(c, quality(true, 'guessed'), 0);
    const sure = schedule(c, quality(true, 'confident'), 0);
    expect(guessed.intervalDays).toBeLessThan(sure.intervalDays);
    expect(schedule(c, quality(false, 'unsure'), 0).reps).toBe(0);
  });
});
