import { useEffect, useState } from 'react';
import { getLessonDb, type DB } from '../db/engine';

export interface TableInfo {
  name: string;
  columns: { name: string; type: string }[];
}

/** Reads the public schema of a database (tables and columns). */
export async function loadSchema(db: DB): Promise<TableInfo[]> {
  const { rows } = await db.query<{ table_name: string; column_name: string; data_type: string }>(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position`);
  const map = new Map<string, TableInfo>();
  for (const r of rows) {
    const t = map.get(r.table_name) ?? { name: r.table_name, columns: [] };
    t.columns.push({ name: r.column_name, type: r.data_type });
    map.set(r.table_name, t);
  }
  return [...map.values()];
}

let cached: Record<string, string[]> | null = null;

/** Table → column names, for editor autocomplete (bookstore schema). */
export function useSchema(): Record<string, string[]> {
  const [schema, setSchema] = useState<Record<string, string[]>>(cached ?? {});
  useEffect(() => {
    if (cached) return;
    let alive = true;
    getLessonDb()
      .then(loadSchema)
      .then((tables) => {
        cached = Object.fromEntries(tables.map((t) => [t.name, t.columns.map((c) => c.name)]));
        if (alive) setSchema(cached);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return schema;
}
