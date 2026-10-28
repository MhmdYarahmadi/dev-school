import type { ResultSet } from '../db/runQuery';
import { displayValue, isNumericType } from '../db/values';

const TYPE_NAMES: Record<number, string> = {
  16: 'bool', 20: 'int8', 21: 'int2', 23: 'int4', 25: 'text', 700: 'float4', 701: 'float8', 1043: 'varchar',
  1082: 'date', 1114: 'timestamp', 1184: 'timestamptz', 1700: 'numeric', 3802: 'jsonb', 114: 'json',
  1009: 'text[]', 1007: 'int4[]', 1186: 'interval',
};

interface Props {
  set: ResultSet;
  /** Per-row highlight class: 'extra' | 'missing' | 'matched'. */
  rowClass?: (i: number) => string | undefined;
  maxRows?: number;
  showTypes?: boolean;
}

export function ResultsTable({ set, rowClass, maxRows = 200, showTypes = true }: Props) {
  if (!set.columns.length) {
    return (
      <div className="result-meta">
        {set.command ?? 'OK'}
        {set.rowCount ? ` · ${set.rowCount} row${set.rowCount === 1 ? '' : 's'} affected` : ''}
      </div>
    );
  }
  const rows = set.rows.slice(0, maxRows);
  return (
    <div className="table-scroll">
      <table className="results">
        <thead>
          <tr>
            <th className="rownum">#</th>
            {set.columns.map((c, i) => (
              <th key={i}>
                {c}
                {showTypes && TYPE_NAMES[set.typeIds[i]] && <span className="type">{TYPE_NAMES[set.typeIds[i]]}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={rowClass?.(i)}>
              <td className="rownum">{i + 1}</td>
              {r.map((v, j) => (
                <td key={j} className={v === null ? 'null' : isNumericType(set.typeIds[j]) ? 'num' : undefined}>
                  {displayValue(v, set.typeIds[j])}
                </td>
              ))}
            </tr>
          ))}
          {set.rows.length === 0 && (
            <tr>
              <td colSpan={set.columns.length + 1} className="muted">
                (no rows)
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {set.rows.length > maxRows && <div className="result-meta">…showing {maxRows} of {set.rows.length} rows</div>}
    </div>
  );
}
