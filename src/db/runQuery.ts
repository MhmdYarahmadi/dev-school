import type { Results } from '@electric-sql/pglite';
import { createSeededDb, getLessonDb, withLock, type DB } from './engine';
import { usesTransactionControl } from './statements';

export interface ResultSet {
  columns: string[];
  typeIds: number[];
  rows: unknown[][];
  command?: string;
  rowCount: number;
}

export interface PgError {
  message: string;
  code?: string;
  position?: number;
  detail?: string;
  hint?: string;
}

export type RunResult =
  | { ok: true; sets: ResultSet[]; last: ResultSet | null; ms: number }
  | { ok: false; error: PgError; ms: number };

function toResultSet(r: Results): ResultSet {
  return {
    columns: r.fields.map((f) => f.name),
    typeIds: r.fields.map((f) => f.dataTypeID),
    rows: r.rows as unknown[][],
    command: r.command,
    rowCount: r.fields.length ? r.rows.length : (r.rowCount ?? r.affectedRows ?? 0),
  };
}

/** The result worth displaying: the last statement that returned columns, else the last statement. */
export function displaySet(sets: ResultSet[]): ResultSet | null {
  for (let i = sets.length - 1; i >= 0; i--) if (sets[i].columns.length) return sets[i];
  return sets.length ? sets[sets.length - 1] : null;
}

export function toPgError(e: unknown): PgError {
  const err = e as Record<string, unknown>;
  return {
    message: String(err?.message ?? e),
    code: err?.code as string | undefined,
    position: err?.position ? Number(err.position) : undefined,
    detail: err?.detail as string | undefined,
    hint: err?.hint as string | undefined,
  };
}

/** Runs SQL directly (no isolation). Caller is responsible for locking if needed. */
export async function execRaw(db: DB, sql: string): Promise<RunResult> {
  const t0 = performance.now();
  try {
    const results = await db.exec(sql, { rowMode: 'array' });
    const sets = results.map(toResultSet);
    return { ok: true, sets, last: displaySet(sets), ms: performance.now() - t0 };
  } catch (e) {
    return { ok: false, error: toPgError(e), ms: performance.now() - t0 };
  }
}

export type Exec = (sql: string) => Promise<RunResult>;

/**
 * Gives `fn` an exec function whose effects are all thrown away afterwards.
 * Normally that's BEGIN … ROLLBACK on the shared lesson DB; if any SQL
 * manages its own transactions we use a throwaway clone instead.
 */
export async function inSandbox<T>(fn: (exec: Exec) => Promise<T>, opts: { needsFreshDb?: boolean } = {}): Promise<T> {
  if (opts.needsFreshDb) {
    const db = await createSeededDb();
    try {
      return await fn((sql) => execRaw(db, sql));
    } finally {
      await db.close();
    }
  }
  const db = await getLessonDb();
  return withLock(db, async () => {
    await db.exec('BEGIN');
    try {
      return await fn(async (sql) => {
        // A failed statement aborts the transaction; a savepoint lets later steps continue.
        await db.exec('SAVEPOINT step');
        const r = await execRaw(db, sql);
        await db.exec(r.ok ? 'RELEASE SAVEPOINT step' : 'ROLLBACK TO SAVEPOINT step');
        return r;
      });
    } finally {
      await db.exec('ROLLBACK');
    }
  });
}

/** Run some SQL (after optional setup) and throw all changes away. */
export async function runSandboxed(sql: string, setupSql?: string): Promise<RunResult> {
  const needsFreshDb = usesTransactionControl(sql) || (!!setupSql && usesTransactionControl(setupSql));
  return inSandbox(async (exec) => {
    if (setupSql) {
      const s = await exec(setupSql);
      if (!s.ok) throw new Error(`Exercise setup failed: ${s.error.message}`);
    }
    return exec(sql);
  }, { needsFreshDb });
}
