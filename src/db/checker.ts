import { explainError } from './friendlyErrors';
import { inSandbox, type PgError, type ResultSet, type RunResult } from './runQuery';
import { usesTransactionControl } from './statements';
import { diffRows, sameOrder, type RowDiff } from '../pedagogy/rowDiff';

export interface CheckSpec {
  /** Reference answer. Its result is the target. */
  solution: string;
  /** Compare rows in order (only when the exercise asks for ORDER BY). */
  orderMatters?: boolean;
  /** For INSERT/UPDATE/DELETE/DDL: query run afterwards whose result is compared instead. */
  checkQuery?: string;
  /** Extra tables/data loaded before both the user's SQL and the solution. */
  setupSql?: string;
}

export type CheckStatus = 'correct' | 'wrong' | 'error';

export interface CheckOutcome {
  status: CheckStatus;
  /** What we compared on the user's side (their result, or the checkQuery result). */
  actual?: ResultSet;
  expected?: ResultSet;
  /** The raw result of the user's own SQL, for display. */
  userResult?: RunResult;
  diff?: RowDiff;
  error?: PgError;
  errorHelp?: string;
  feedback: string[];
}

interface Observed {
  run: RunResult;
  compared?: ResultSet;
}

async function observe(sql: string, spec: CheckSpec): Promise<Observed> {
  const needsFreshDb = usesTransactionControl(sql) || usesTransactionControl(spec.solution);
  return inSandbox(async (exec) => {
    if (spec.setupSql) {
      const s = await exec(spec.setupSql);
      if (!s.ok) throw new Error(`Exercise setup failed: ${s.error.message}`);
    }
    const run = await exec(sql);
    if (!run.ok) return { run };
    if (spec.checkQuery) {
      const c = await exec(spec.checkQuery);
      if (!c.ok) throw new Error(`Exercise checkQuery failed: ${c.error.message}`);
      return { run, compared: c.last ?? undefined };
    }
    return { run, compared: run.last ?? undefined };
  }, { needsFreshDb });
}

const expectedCache = new Map<string, ResultSet>();

export async function expectedResult(spec: CheckSpec): Promise<ResultSet> {
  const key = JSON.stringify([spec.setupSql, spec.solution, spec.checkQuery]);
  const hit = expectedCache.get(key);
  if (hit) return hit;
  const o = await observe(spec.solution, spec);
  if (!o.run.ok) throw new Error(`Reference solution failed: ${o.run.error.message}\n${spec.solution}`);
  if (!o.compared) throw new Error('Reference solution returned no result');
  expectedCache.set(key, o.compared);
  return o.compared;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Compares two result sets. Column names are ignored, so aliases never matter. */
export function compareResults(actual: ResultSet, expected: ResultSet, orderMatters = false, isCheckQuery = false) {
  const feedback: string[] = [];
  if (actual.columns.length !== expected.columns.length) {
    feedback.push(
      `Your result has ${plural(actual.columns.length, 'column')}, but the answer has ${plural(expected.columns.length, 'column')} (${expected.columns.join(', ')}).`,
    );
    return { match: false, feedback };
  }
  const diff = diffRows(actual, expected);
  const what = isCheckQuery ? 'After your change, the table' : 'Your query';
  if (diff.extraActual.length || diff.missingExpected.length) {
    if (actual.rows.length !== expected.rows.length)
      feedback.push(`${what} returned ${plural(actual.rows.length, 'row')}; expected ${expected.rows.length}.`);
    if (diff.missingExpected.length) feedback.push(`${plural(diff.missingExpected.length, 'expected row')} missing (shown in red).`);
    if (diff.extraActual.length) feedback.push(`${plural(diff.extraActual.length, 'row')} shouldn't be there (shown in yellow).`);
    return { match: false, feedback, diff };
  }
  if (orderMatters && !sameOrder(actual, expected)) {
    feedback.push('All the right rows, but in the wrong order. Check your ORDER BY (which column, and ASC vs DESC).');
    return { match: false, feedback, diff };
  }
  return { match: true, feedback, diff };
}

export async function checkAnswer(userSql: string, spec: CheckSpec): Promise<CheckOutcome> {
  if (!userSql.trim()) return { status: 'wrong', feedback: ['Write a query first!'] };
  const expected = await expectedResult(spec);
  const mine = await observe(userSql, spec);
  if (!mine.run.ok) {
    return {
      status: 'error',
      userResult: mine.run,
      expected,
      error: mine.run.error,
      errorHelp: explainError(mine.run.error),
      feedback: [],
    };
  }
  if (!mine.compared) {
    return { status: 'wrong', userResult: mine.run, expected, feedback: ['Your SQL ran, but it returned no result to compare.'] };
  }
  const cmp = compareResults(mine.compared, expected, spec.orderMatters, !!spec.checkQuery);
  return {
    status: cmp.match ? 'correct' : 'wrong',
    userResult: mine.run,
    actual: mine.compared,
    expected,
    diff: cmp.diff,
    feedback: cmp.feedback,
  };
}
