import { useEffect, useState } from 'react';
import { tryPython } from '../check';
import type { PyResult } from '../engine/run';
import { PyOutput } from './PyOutput';

/** Learn tab: the worked example the learner can run. */
export function PyExampleRunner({ code, disabled }: { code: string; disabled?: boolean }) {
  const [result, setResult] = useState<PyResult | null>(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    setResult(await tryPython(code));
    setRunning(false);
  };
  return (
    <>
      <pre style={{ margin: 0 }} dir="ltr">{code}</pre>
      <div className="row">
        <button className="btn" disabled={disabled || running} onClick={run}>
          {running ? '… در حال اجرا' : '▶ اجرای مثال'}
        </button>
      </div>
      <PyOutput result={result} />
    </>
  );
}

/** After a prediction: run the code and show what really happens. */
export function PyPredictResult({ code }: { code: string }) {
  const [result, setResult] = useState<PyResult | null>(null);
  useEffect(() => {
    tryPython(code).then(setResult);
  }, [code]);
  return <PyOutput result={result} />;
}
