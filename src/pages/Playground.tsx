import { useCallback, useRef, useState } from 'react';
import { getPlaygroundDb, resetPlaygroundDb, withLock } from '../db/engine';
import { execRaw, type RunResult } from '../db/runQuery';
import { SqlEditor, type SqlEditorHandle } from '../components/SqlEditor';
import { ResultView } from '../components/ResultView';
import { SchemaBrowser } from '../components/SchemaBrowser';
import { ExecutionStepper } from '../components/ExecutionStepper';
import { addPlaygroundHistory, useProgress } from '../progress/store';

const STARTER = `-- The playground is yours: anything you create here is saved in your browser.
-- Press Ctrl+Enter (Cmd+Enter on Mac) to run.
SELECT title, price, genre
FROM books
ORDER BY price DESC
LIMIT 10;`;

export default function Playground() {
  const [sql, setSql] = useState(STARTER);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [stepping, setStepping] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const editor = useRef<SqlEditorHandle>(null);
  const progress = useProgress();

  const run = useCallback(async () => {
    setRunning(true);
    setStepping(false);
    const db = await getPlaygroundDb();
    const r = await withLock(db, () => execRaw(db, sql));
    setResult(r);
    setRunning(false);
    if (r.ok) {
      addPlaygroundHistory(sql.trim());
      if (r.sets.some((s) => /CREATE|DROP|ALTER/.test(s.command ?? ''))) setRefreshKey((k) => k + 1);
    }
  }, [sql]);

  const reset = async () => {
    await resetPlaygroundDb();
    setConfirmReset(false);
    setRefreshKey((k) => k + 1);
    setResult(null);
  };

  return (
    <div className="sidebar-layout">
      <aside className="card">
        <h3 style={{ marginTop: 0 }}>Tables</h3>
        <SchemaBrowser getDb={getPlaygroundDb} onInsert={(t) => editor.current?.insert(t)} refreshKey={refreshKey} />
        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' }} />
        {!confirmReset ? (
          <button className="btn small" onClick={() => setConfirmReset(true)}>Reset database…</button>
        ) : (
          <div className="callout warn small">
            <p>Delete everything you created here and restore the original bookstore data?</p>
            <div className="row">
              <button className="btn small" onClick={reset}>Yes, reset</button>
              <button className="btn small ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          </div>
        )}
      </aside>
      <section className="stack">
        <div className="card stack">
          <div className="row">
            <h2 style={{ margin: 0 }}>Playground</h2>
            <span className="tag accent">real PostgreSQL</span>
            <div className="grow" />
            <span className="small muted"><span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> to run</span>
          </div>
          <SqlEditor ref={editor} value={sql} onChange={setSql} onRun={run} minHeight="160px" />
          <div className="row">
            <button className="btn primary" onClick={run} disabled={running}>{running ? 'Running…' : '▶ Run'}</button>
            <button className="btn" onClick={() => setStepping(true)} title="See how Postgres processes this query, step by step">🔍 Step through</button>
          </div>
        </div>
        {stepping && <ExecutionStepper sql={sql} onClose={() => setStepping(false)} />}
        {result && (
          <div className="card">
            <ResultView result={result} sql={sql} />
          </div>
        )}
        {progress.playgroundHistory.length > 0 && (
          <details className="card">
            <summary><b>History</b> <span className="muted small">({progress.playgroundHistory.length})</span></summary>
            <div className="stack" style={{ marginTop: 10, gap: 6 }}>
              {progress.playgroundHistory.slice(0, 20).map((h, i) => (
                <button key={i} className="choice mono small" onClick={() => setSql(h)} style={{ whiteSpace: 'pre-wrap' }}>
                  {h.length > 300 ? h.slice(0, 300) + '…' : h}
                </button>
              ))}
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
