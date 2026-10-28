/**
 * Splits SQL text into statements, respecting quotes, dollar-quoting and
 * comments. Also used to strip comments/literals before pattern matching.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      cur += sql.slice(i, stop);
      i = stop;
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      cur += sql.slice(i, stop);
      i = stop;
    } else if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) j += 2;
          else break;
        } else j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        cur += sql.slice(i, stop);
        i = stop;
      } else {
        cur += ch;
        i++;
      }
    } else if (ch === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((s) => stripCommentsAndLiterals(s).trim() !== '');
}

/** Replaces comments with spaces and string literals with '' so regexes only see code. */
export function stripCommentsAndLiterals(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/'(?:[^']|'')*'/g, "''");
}

export function firstKeyword(statement: string): string {
  const m = /^\s*\(?\s*([A-Za-z]+)/.exec(stripCommentsAndLiterals(statement));
  return m ? m[1].toUpperCase() : '';
}

const TXN_KEYWORDS = new Set(['BEGIN', 'COMMIT', 'ROLLBACK', 'START', 'SAVEPOINT', 'RELEASE', 'END', 'ABORT']);

/** True when the SQL manages its own transactions, so it can't be wrapped in our BEGIN … ROLLBACK. */
export function usesTransactionControl(sql: string): boolean {
  return splitStatements(sql).some((s) => TXN_KEYWORDS.has(firstKeyword(s)));
}
