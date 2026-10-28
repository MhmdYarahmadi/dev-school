import { useEffect, useState } from 'react';
import type { DB } from '../db/engine';
import { loadSchema, type TableInfo } from './useSchema';

interface Props {
  getDb: () => Promise<DB>;
  onInsert?: (text: string) => void;
  /** Bump to reload (e.g. after the learner creates a table). */
  refreshKey?: number;
}

export function SchemaBrowser({ getDb, onInsert, refreshKey }: Props) {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ books: true });

  useEffect(() => {
    getDb().then(loadSchema).then(setTables).catch(() => setTables([]));
  }, [getDb, refreshKey]);

  if (!tables) return <div className="muted small">Loading schema…</div>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="small muted">Click a name to insert it into the editor.</div>
      {tables.map((t) => (
        <div key={t.name}>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn ghost small" onClick={() => setOpen({ ...open, [t.name]: !open[t.name] })} aria-label={`Toggle ${t.name}`}>
              {open[t.name] ? '▾' : '▸'}
            </button>
            <button className="btn ghost small mono" onClick={() => onInsert?.(t.name)} style={{ fontWeight: 700 }}>
              {t.name}
            </button>
          </div>
          {open[t.name] && (
            <div style={{ paddingLeft: 28 }}>
              {t.columns.map((c) => (
                <div key={c.name} className="row small" style={{ gap: 6 }}>
                  <button className="btn ghost small mono" style={{ padding: '1px 6px', fontWeight: 400 }} onClick={() => onInsert?.(c.name)}>
                    {c.name}
                  </button>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>{c.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
