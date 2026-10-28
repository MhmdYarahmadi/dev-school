import type { ResultSet } from '../db/runQuery';
import { canonicalRow } from '../db/values';

export interface RowDiff {
  /** Indices into actual.rows that also appear in expected. */
  matchedActual: Set<number>;
  /** Indices into actual.rows that should not be there. */
  extraActual: number[];
  /** Indices into expected.rows that are missing from actual. */
  missingExpected: number[];
}

/** Multiset diff: duplicates count, order does not. */
export function diffRows(actual: ResultSet, expected: ResultSet): RowDiff {
  const pool = new Map<string, number[]>();
  expected.rows.forEach((r, i) => {
    const k = canonicalRow(r, expected.typeIds);
    const list = pool.get(k) ?? [];
    list.push(i);
    pool.set(k, list);
  });
  const matchedActual = new Set<number>();
  const extraActual: number[] = [];
  actual.rows.forEach((r, i) => {
    const list = pool.get(canonicalRow(r, actual.typeIds));
    if (list && list.length) {
      list.shift();
      matchedActual.add(i);
    } else extraActual.push(i);
  });
  const missingExpected = [...pool.values()].flat().sort((a, b) => a - b);
  return { matchedActual, extraActual, missingExpected };
}

export function sameOrder(actual: ResultSet, expected: ResultSet): boolean {
  if (actual.rows.length !== expected.rows.length) return false;
  return actual.rows.every(
    (r, i) => canonicalRow(r, actual.typeIds) === canonicalRow(expected.rows[i], expected.typeIds),
  );
}
