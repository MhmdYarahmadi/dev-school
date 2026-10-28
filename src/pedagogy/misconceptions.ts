import { splitStatements, stripCommentsAndLiterals, firstKeyword } from '../db/statements';

export interface MisconceptionContext {
  sql: string;
  /** Present when the query ran and was compared against an answer. */
  actualRows?: number;
  expectedRows?: number;
  errorMessage?: string;
}

export interface Misconception {
  id: string;
  title: string;
  explain: string;
  /** Returns true when this mistake is (probably) present. */
  test: (code: string, ctx: MisconceptionContext) => boolean;
}

const AGG = String.raw`\b(COUNT|SUM|AVG|MIN|MAX)\s*\(`;

export const MISCONCEPTIONS: Misconception[] = [
  {
    id: 'eq-null',
    title: '= NULL never matches',
    explain:
      'NULL means "unknown", so `x = NULL` is itself unknown, never true, and the row is dropped. Use `x IS NULL` or `x IS NOT NULL` instead.',
    test: (c) => /(=|<>|!=)\s*NULL\b/i.test(c),
  },
  {
    id: 'agg-in-where',
    title: 'Aggregate inside WHERE',
    explain:
      'WHERE runs *before* rows are grouped, so it can only look at one row at a time. Conditions on COUNT/SUM/AVG… go in HAVING, after GROUP BY.',
    test: (c) => new RegExp(String.raw`\bWHERE\b[\s\S]*?${AGG}`, 'i').test(c.split(/\bGROUP\s+BY\b|\bHAVING\b/i)[0] ?? ''),
  },
  {
    id: 'having-without-group',
    title: 'HAVING without GROUP BY',
    explain: 'HAVING filters *groups*. To filter individual rows, use WHERE.',
    test: (c) => /\bHAVING\b/i.test(c) && !/\bGROUP\s+BY\b/i.test(c) && !new RegExp(AGG, 'i').test(c.split(/\bHAVING\b/i)[1] ?? ''),
  },
  {
    id: 'ungrouped-column',
    title: 'Column not in GROUP BY',
    explain:
      'After GROUP BY, each output row is a whole group. Every SELECT column must be in the GROUP BY or inside an aggregate, otherwise Postgres can\'t know which value to show.',
    test: (_c, ctx) => /must appear in the GROUP BY clause/.test(ctx.errorMessage ?? ''),
  },
  {
    id: 'double-quoted-string',
    title: 'Double quotes around text',
    explain:
      'In SQL, \'single quotes\' are for text values and "double quotes" are for column/table names. `WHERE genre = "Mystery"` looks for a *column* called Mystery.',
    test: (_c, ctx) => /column "[^"]*[ A-Z][^"]*" does not exist/.test(ctx.errorMessage ?? '') || (/column "[^"]+" does not exist/.test(ctx.errorMessage ?? '') && /=\s*"/.test(_c)),
  },
  {
    id: 'or-precedence',
    title: 'AND binds tighter than OR',
    explain:
      '`a OR b AND c` means `a OR (b AND c)`. If you meant `(a OR b) AND c`, add parentheses. When mixing AND and OR, always use parentheses.',
    test: (c) => {
      const where = /\bWHERE\b([\s\S]*?)(\bGROUP\b|\bORDER\b|\bLIMIT\b|\bHAVING\b|$)/i.exec(c)?.[1] ?? '';
      return /\bOR\b/i.test(where) && /\bAND\b/i.test(where) && !/\(/.test(where.replace(/\b\w+\s*\(/g, ''));
    },
  },
  {
    id: 'missing-join-condition',
    title: 'Join without a matching condition',
    explain:
      'Listing tables with a comma (or CROSS JOIN) without an ON/WHERE condition pairs *every* row with *every* other row, which multiplies the row count. Use `JOIN … ON a.id = b.a_id`.',
    test: (c, ctx) => {
      const commaJoin = /\bFROM\s+\w+(\s+\w+)?\s*,\s*\w+/i.test(c) && !/\bWHERE\b[\s\S]*\w+\.\w+\s*=\s*\w+\.\w+/i.test(c);
      const exploded = ctx.actualRows !== undefined && ctx.expectedRows !== undefined && ctx.actualRows > ctx.expectedRows * 3 && /\bJOIN\b|,/i.test(c);
      return commaJoin || (exploded && /\bJOIN\b(?![\s\S]*\bON\b)(?![\s\S]*\bUSING\b)/i.test(c));
    },
  },
  {
    id: 'update-without-where',
    title: 'UPDATE/DELETE without WHERE',
    explain:
      'Without WHERE, UPDATE and DELETE affect *every row in the table*. Always write the WHERE first, and try it as a SELECT to check which rows match.',
    test: (_c, ctx) =>
      splitStatements(ctx.sql).some((s) => {
        const k = firstKeyword(s);
        return (k === 'UPDATE' || k === 'DELETE') && !/\bWHERE\b/i.test(stripCommentsAndLiterals(s));
      }),
  },
  {
    id: 'alias-in-where',
    title: 'Using a SELECT alias in WHERE',
    explain:
      'Postgres runs WHERE *before* SELECT, so aliases defined in SELECT don\'t exist yet. Repeat the expression in WHERE (or use a subquery/CTE). ORDER BY runs last, so it *can* use aliases.',
    test: (c, ctx) => {
      const m = /column "([^"]+)" does not exist/.exec(ctx.errorMessage ?? '');
      return !!m && new RegExp(String.raw`\bAS\s+${m[1]}\b`, 'i').test(c);
    },
  },
  {
    id: 'like-without-wildcard',
    title: 'LIKE without % or _',
    explain: 'LIKE only does pattern matching through wildcards: `%` matches any text and `_` matches one character. Without them, it is just `=`.',
    test: (_c, ctx) => /\bI?LIKE\s*'[^%_']*'/i.test(ctx.sql),
  },
  {
    id: 'count-column-nulls',
    title: 'COUNT(column) skips NULLs',
    explain: '`COUNT(*)` counts rows; `COUNT(col)` counts only rows where col is not NULL. Pick the one that matches the question.',
    test: (c, ctx) =>
      /\bCOUNT\s*\(\s*(?!\*)(?!DISTINCT)\w/i.test(c) && ctx.actualRows !== undefined && ctx.actualRows === ctx.expectedRows,
  },
  {
    id: 'distinct-misuse',
    title: 'DISTINCT applies to the whole row',
    explain: '`SELECT DISTINCT a, b` removes duplicate *(a, b) pairs*, not duplicates of a alone.',
    test: (c, ctx) => /\bSELECT\s+DISTINCT\s+\w+\s*,/i.test(c) && ctx.actualRows !== undefined && ctx.actualRows > (ctx.expectedRows ?? Infinity),
  },
  {
    id: 'integer-division',
    title: 'Integer division',
    explain: 'Dividing two integers in Postgres drops the remainder: 7 / 2 = 3. Cast one side to get decimals: `7::numeric / 2` = 3.5.',
    test: (c) => /\b\d+\s*\/\s*\d+\b/.test(c) && !/::\s*(numeric|decimal|float|real|double)/i.test(c),
  },
];

/** Returns the misconceptions that apply to a wrong or failed answer. */
export function detectMisconceptions(ctx: MisconceptionContext): Misconception[] {
  const code = stripCommentsAndLiterals(ctx.sql);
  return MISCONCEPTIONS.filter((m) => {
    try {
      return m.test(code, ctx);
    } catch {
      return false;
    }
  });
}
