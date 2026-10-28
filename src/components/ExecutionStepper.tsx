import { useEffect, useState } from 'react';
import { runSandboxed, type RunResult } from '../db/runQuery';
import { buildSteps, type VisualStep } from '../pedagogy/visualizer';
import { ResultView } from './ResultView';

/** "Step through": shows the rows after each logical stage of a SELECT. */
export function ExecutionStepper({ sql, setupSql, onClose }: { sql: string; setupSql?: string; onClose?: () => void }) {
  const [steps, setSteps] = useState<VisualStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<(RunResult | null)[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const built = buildSteps(sql);
    if ('error' in built) {
      setError(built.error);
      setSteps(null);
      return;
    }
    setError(null);
    setSteps(built);
    setIdx(0);
    setResults(built.map(() => null));
    let alive = true;
    (async () => {
      const out: RunResult[] = [];
      for (const s of built) out.push(await runSandboxed(s.sql, setupSql));
      if (alive) setResults(out);
    })();
    return () => {
      alive = false;
    };
  }, [sql, setupSql]);

  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>🔍 Step through: how Postgres runs this</h3>
        <div className="grow" />
        {onClose && <button className="btn ghost small" onClick={onClose}>Close</button>}
      </div>
      {error && <p className="muted">{error}</p>}
      {steps && (
        <>
          <div className="steps" role="tablist">
            {steps.map((s, i) => (
              <button key={i} role="tab" aria-selected={i === idx} className={`step-btn ${i === idx ? 'active' : ''}`} onClick={() => setIdx(i)}>
                {i + 1}. {s.stage}
              </button>
            ))}
          </div>
          <p style={{ margin: '4px 0 8px' }}>{steps[idx].explain}</p>
          <details>
            <summary className="small muted">Query for this step</summary>
            <pre>{steps[idx].sql}</pre>
          </details>
          {results[idx] ? <ResultView result={results[idx]} /> : <div className="muted small">Running…</div>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← Previous step</button>
            <button className="btn small primary" disabled={idx === steps.length - 1} onClick={() => setIdx(idx + 1)}>Next step →</button>
          </div>
        </>
      )}
    </div>
  );
}
