import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExecutionStepper } from '../../components/ExecutionStepper';
import { ResultView } from '../../components/ResultView';
import { runSandboxed, type RunResult } from '../../db/runQuery';

/** Learn tab: the worked example with Run and Step-through. */
export function PgExampleRunner({ code, disabled }: { code: string; disabled?: boolean }) {
  const [result, setResult] = useState<RunResult | null>(null);
  const [stepping, setStepping] = useState(false);
  return (
    <>
      <pre style={{ margin: 0 }}>{code}</pre>
      <div className="row">
        <button className="btn" disabled={disabled} onClick={async () => setResult(await runSandboxed(code))}>▶ Run example</button>
        <button className="btn ghost" disabled={disabled} onClick={() => setStepping((s) => !s)}>🔍 Step through</button>
        <Link className="small" to="/playground">Experiment in the playground →</Link>
      </div>
      {stepping && <ExecutionStepper sql={code} onClose={() => setStepping(false)} />}
      <ResultView result={result} />
    </>
  );
}

/** After a prediction: run the query and show what really happens. */
export function PgPredictResult({ code }: { code: string }) {
  const [result, setResult] = useState<RunResult | null>(null);
  useEffect(() => {
    runSandboxed(code).then(setResult);
  }, [code]);
  return <ResultView result={result} />;
}
