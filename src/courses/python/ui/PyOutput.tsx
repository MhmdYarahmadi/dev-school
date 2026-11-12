import type { PyResult } from '../engine/run';

/** Program output. Python output is LTR even inside the RTL Persian page. */
export function PyOutput({ result, label = 'خروجی' }: { result: PyResult | null; label?: string }) {
  if (!result) return null;
  const empty = !result.stdout && !result.error;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="small muted">{label}</div>
      {result.error ? (
        <pre className="py-output err" dir="ltr">{result.error}</pre>
      ) : (
        <pre className="py-output" dir="ltr">{empty ? '(چیزی چاپ نشد)' : result.stdout}</pre>
      )}
    </div>
  );
}
