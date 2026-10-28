import { explainError } from '../db/friendlyErrors';
import type { RunResult } from '../db/runQuery';
import { ResultsTable } from './ResultsTable';

export function ErrorBox({ message, help, sql, position }: { message: string; help?: string; sql?: string; position?: number }) {
  let pointer: string | null = null;
  if (sql && position && position <= sql.length) {
    // Show the line containing the error, with a caret under the position.
    const before = sql.slice(0, position - 1);
    const lineStart = before.lastIndexOf('\n') + 1;
    const lineEnd = sql.indexOf('\n', position - 1);
    const line = sql.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    pointer = `${line}\n${' '.repeat(position - 1 - lineStart)}^`;
  }
  return (
    <div className="callout bad">
      <div className="error-box">ERROR: {message}</div>
      {pointer && <pre style={{ margin: '6px 0' }}>{pointer}</pre>}
      {help && <p>💡 {help}</p>}
    </div>
  );
}

export function ResultView({ result, sql }: { result: RunResult | null; sql?: string }) {
  if (!result) return null;
  if (!result.ok) {
    return <ErrorBox message={result.error.message} help={explainError(result.error)} sql={sql} position={result.error.position} />;
  }
  const set = result.last;
  return (
    <div>
      <div className="result-meta">
        {set && set.columns.length ? `${set.rows.length} row${set.rows.length === 1 ? '' : 's'}` : 'Done'} · {result.ms.toFixed(0)} ms
        {result.sets.length > 1 && ` · ${result.sets.length} statements (showing the last result)`}
      </div>
      {set && <ResultsTable set={set} />}
    </div>
  );
}
