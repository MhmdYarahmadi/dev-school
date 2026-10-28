/**
 * Builds the "step through" view: a series of queries showing what the rows
 * look like after each logical stage of a SELECT, in the order Postgres
 * conceptually evaluates them:
 *   FROM/JOIN → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT
 */

export interface VisualStep {
  stage: string;
  explain: string;
  sql: string;
}

/** Same length as the input, with comments blanked and literal contents masked, so indices line up. */
export function maskSql(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (sql[i] === "'" || sql[i] === '"') {
      const q = sql[i];
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === q) {
          if (sql[j + 1] === q) j += 2;
          else break;
        } else j++;
      }
      const stop = Math.min(j + 1, sql.length);
      out += q + 'x'.repeat(Math.max(0, stop - i - 2)) + (stop - i >= 2 ? q : '');
      i = stop;
    } else {
      out += sql[i];
      i++;
    }
  }
  return out;
}

const CLAUSES = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'WINDOW', 'ORDER BY', 'LIMIT', 'OFFSET', 'FETCH'] as const;
type Clause = (typeof CLAUSES)[number];

/** Finds top-level (depth-0) clause keywords in `masked`, starting at `from`. */
function topLevelClauses(masked: string, from: number): { clause: Clause | 'SETOP'; index: number; length: number }[] {
  const found: { clause: Clause | 'SETOP'; index: number; length: number }[] = [];
  let depth = 0;
  const upper = masked.toUpperCase();
  for (let i = from; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth !== 0) continue;
    if (i > 0 && /[A-Za-z0-9_]/.test(masked[i - 1])) continue;
    for (const c of [...CLAUSES, 'UNION', 'INTERSECT', 'EXCEPT'] as const) {
      const pattern = c.replace(' ', String.raw`\s+`);
      const m = new RegExp(`^${pattern}\\b`).exec(upper.slice(i, i + 30));
      if (m) {
        const isSetop = c === 'UNION' || c === 'INTERSECT' || c === 'EXCEPT';
        found.push({ clause: isSetop ? 'SETOP' : (c as Clause), index: i, length: m[0].length });
        i += m[0].length - 1;
        break;
      }
    }
  }
  return found;
}

export interface ParsedSelect {
  prefix: string; // WITH … (CTEs), kept on every step
  distinct: string; // 'DISTINCT' / 'DISTINCT ON (…)' / ''
  parts: Partial<Record<Clause, string>>;
}

export function parseSelect(sql: string): ParsedSelect | { error: string } {
  const src = sql.trim().replace(/;\s*$/, '');
  const masked = maskSql(src);
  if (masked.includes(';')) return { error: 'The step-through view works on one SELECT statement at a time.' };
  let start = 0;
  if (/^\s*WITH\b/i.test(masked)) {
    // Skip CTE definitions: find the first depth-0 SELECT after WITH.
    let depth = 0;
    const upper = masked.toUpperCase();
    start = -1;
    for (let i = 4; i < masked.length; i++) {
      if (masked[i] === '(') depth++;
      else if (masked[i] === ')') depth--;
      else if (depth === 0 && /^SELECT\b/.test(upper.slice(i, i + 7)) && !/[A-Za-z0-9_]/.test(masked[i - 1])) {
        start = i;
        break;
      }
    }
    if (start < 0) return { error: 'Could not find the main SELECT after WITH.' };
  }
  const found = topLevelClauses(masked, start);
  if (!found.length || found[0].clause !== 'SELECT') return { error: 'The step-through view only works on SELECT queries.' };
  if (found.some((f) => f.clause === 'SETOP')) return { error: 'The step-through view does not support UNION/INTERSECT/EXCEPT yet.' };
  const parts: Partial<Record<Clause, string>> = {};
  found.forEach((f, k) => {
    const end = k + 1 < found.length ? found[k + 1].index : src.length;
    parts[f.clause as Clause] = src.slice(f.index + f.length, end).trim();
  });
  let distinct = '';
  const sel = parts.SELECT ?? '';
  const dm = /^DISTINCT(\s+ON\s*\([^)]*\))?/i.exec(sel);
  if (dm) {
    distinct = dm[0];
    parts.SELECT = sel.slice(dm[0].length).trim();
  }
  return { prefix: src.slice(0, start).trim(), distinct, parts };
}

export function buildSteps(sql: string): VisualStep[] | { error: string } {
  const parsed = parseSelect(sql);
  if ('error' in parsed) return parsed;
  const { prefix, distinct, parts } = parsed;
  const pre = prefix ? prefix + '\n' : '';
  const steps: VisualStep[] = [];
  if (!parts.FROM) {
    return [{ stage: 'SELECT', explain: 'No FROM: Postgres just evaluates the expressions once.', sql }];
  }
  let base = `FROM ${parts.FROM}`;
  const joined = /\bJOIN\b|,/i.test(maskSql(parts.FROM));
  steps.push({
    stage: joined ? 'FROM + JOIN' : 'FROM',
    explain: joined
      ? 'First, Postgres gathers the rows from the tables and glues them together using the JOIN conditions. Every column of every table is still here.'
      : 'First, Postgres reads every row of the table. Nothing is filtered or chosen yet.',
    sql: `${pre}SELECT * ${base}`,
  });
  if (parts.WHERE) {
    base += ` WHERE ${parts.WHERE}`;
    steps.push({
      stage: 'WHERE',
      explain: 'WHERE keeps only the rows where the condition is true. Rows where it is false *or NULL* are dropped. SELECT hasn\'t run yet, which is why its aliases can\'t be used here.',
      sql: `${pre}SELECT * ${base}`,
    });
  }
  if (parts['GROUP BY']) {
    base += ` GROUP BY ${parts['GROUP BY']}`;
    steps.push({
      stage: 'GROUP BY',
      explain: 'GROUP BY collapses rows with the same values into one row per group. Here you can see each group\'s key and how many rows fell into it.',
      sql: `${pre}SELECT ${parts['GROUP BY']}, count(*) AS rows_in_group ${base}`,
    });
    if (parts.HAVING) {
      base += ` HAVING ${parts.HAVING}`;
      steps.push({
        stage: 'HAVING',
        explain: 'HAVING filters whole groups, after the aggregates are computed. It\'s WHERE for groups.',
        sql: `${pre}SELECT ${parts['GROUP BY']}, count(*) AS rows_in_group ${base}`,
      });
    }
  }
  const windowPart = parts.WINDOW ? ` WINDOW ${parts.WINDOW}` : '';
  steps.push({
    stage: 'SELECT',
    explain: 'Only now does SELECT pick and compute the output columns (and give them their aliases).',
    sql: `${pre}SELECT ${parts.SELECT} ${base}${windowPart}`,
  });
  if (distinct) {
    steps.push({
      stage: 'DISTINCT',
      explain: 'DISTINCT removes duplicate output rows. It compares the whole row, not just the first column.',
      sql: `${pre}SELECT ${distinct} ${parts.SELECT} ${base}${windowPart}`,
    });
  }
  const sel = `${pre}SELECT ${distinct ? distinct + ' ' : ''}${parts.SELECT} ${base}${windowPart}`;
  if (parts['ORDER BY']) {
    steps.push({
      stage: 'ORDER BY',
      explain: 'ORDER BY sorts the finished rows. It runs after SELECT, so it *can* use column aliases.',
      sql: `${sel} ORDER BY ${parts['ORDER BY']}`,
    });
  }
  if (parts.LIMIT || parts.OFFSET || parts.FETCH) {
    steps.push({
      stage: 'LIMIT / OFFSET',
      explain: 'Finally, OFFSET skips rows and LIMIT keeps only the first N. Without ORDER BY, "first" is not guaranteed!',
      sql: sql.trim().replace(/;\s*$/, ''),
    });
  }
  return steps;
}
