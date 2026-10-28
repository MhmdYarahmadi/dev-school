import { PGlite } from '@electric-sql/pglite';
import seedSql from './seed.sql?raw';

export type DB = PGlite;
export { seedSql };

/**
 * A tiny promise mutex. Our sandboxing wraps several statements in
 * BEGIN … ROLLBACK, so two callers must never interleave on the same DB.
 */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
const locks = new WeakMap<DB, Mutex>();

export function withLock<T>(db: DB, fn: () => Promise<T>): Promise<T> {
  let m = locks.get(db);
  if (!m) {
    m = new Mutex();
    locks.set(db, m);
  }
  return m.run(fn);
}

let pristineDump: Promise<Blob> | null = null;

/** A tarball of a freshly seeded database; cloning from it (~0.2s) beats re-running initdb. */
function getPristineDump(): Promise<Blob> {
  if (!pristineDump) {
    pristineDump = (async () => {
      const db = new PGlite();
      await db.exec(seedSql);
      const dump = await db.dumpDataDir('none');
      await db.close();
      return dump;
    })();
  }
  return pristineDump;
}

/** A brand-new, seeded, in-memory database. Caller owns it and should close() it. */
export async function createSeededDb(): Promise<DB> {
  const db = new PGlite({ loadDataDir: await getPristineDump() });
  await db.waitReady;
  return db;
}

let lessonDb: Promise<DB> | null = null;

/** Shared in-memory DB for lessons, exercises, tests and games. Every run is rolled back. */
export function getLessonDb(): Promise<DB> {
  if (!lessonDb) lessonDb = createSeededDb();
  return lessonDb;
}

let playgroundDb: Promise<DB> | null = null;

/** The playground DB persists in IndexedDB so your own tables survive a reload. */
export function getPlaygroundDb(): Promise<DB> {
  if (!playgroundDb) {
    playgroundDb = (async () => {
      const dataDir = typeof indexedDB !== 'undefined' ? 'idb://pgschool-playground' : undefined;
      const db = new PGlite(dataDir);
      await db.waitReady;
      const { rows } = await db.query<{ seeded: boolean }>(
        "SELECT to_regclass('public.books') IS NOT NULL AS seeded",
      );
      if (!rows[0].seeded) await db.exec(seedSql);
      return db;
    })();
  }
  return playgroundDb;
}

export async function resetPlaygroundDb(): Promise<void> {
  const db = await getPlaygroundDb();
  await withLock(db, async () => {
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await db.exec(seedSql);
  });
}
