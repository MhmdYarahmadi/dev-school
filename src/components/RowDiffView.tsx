import type { ResultSet } from '../db/runQuery';
import type { RowDiff } from '../pedagogy/rowDiff';
import { ResultsTable } from './ResultsTable';

/** Your result next to the expected one: extra rows yellow, missing rows red. */
export function RowDiffView({ actual, expected, diff }: { actual: ResultSet; expected: ResultSet; diff?: RowDiff }) {
  const extra = new Set(diff?.extraActual ?? []);
  const missing = new Set(diff?.missingExpected ?? []);
  return (
    <div className="diff-grid">
      <div>
        <div className="result-meta">
          <b>Your result</b> · {actual.rows.length} rows{extra.size > 0 && <span className="tag warn" style={{ marginLeft: 6 }}>{extra.size} extra</span>}
        </div>
        <ResultsTable set={actual} rowClass={(i) => (extra.has(i) ? 'extra' : undefined)} maxRows={100} showTypes={false} />
      </div>
      <div>
        <div className="result-meta">
          <b>Expected</b> · {expected.rows.length} rows
          {missing.size > 0 && <span className="tag bad" style={{ marginLeft: 6 }}>{missing.size} missing</span>}
        </div>
        <ResultsTable set={expected} rowClass={(i) => (missing.has(i) ? 'missing' : undefined)} maxRows={100} showTypes={false} />
      </div>
    </div>
  );
}
