// Postgres type OIDs we treat specially.
const DATE = 1082;
const TIMESTAMP = 1114;
const TIMESTAMPTZ = 1184;
const NUMERIC_TYPES = new Set([20, 21, 23, 700, 701, 1700, 790]);

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function formatDate(d: Date, typeId: number): string {
  const ymd = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (typeId === DATE) return ymd;
  const hms = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `${ymd} ${hms}${typeId === TIMESTAMPTZ ? '+00' : ''}`;
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const keys = Object.keys(v as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  return JSON.stringify(v);
}

/** How a value is shown in a results grid (close to what psql prints). */
export function displayValue(v: unknown, typeId = 0): string {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return formatDate(v, typeId);
  if (Array.isArray(v)) {
    if (typeId === 114 || typeId === 3802) return JSON.stringify(v);
    return `{${v.map((x) => (x === null ? 'NULL' : typeof x === 'object' ? stableJson(x) : String(x))).join(',')}}`;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/**
 * Canonical form used when comparing results, so that 19.98 vs '19.980',
 * int vs bigint, etc. count as equal. Numbers are rounded to 4 decimals so
 * AVG() results written two different ways still match.
 */
export function canonicalValue(v: unknown, typeId = 0): string {
  if (v === null || v === undefined) return '\u0000NULL';
  if (v instanceof Date) return `d:${v.getTime()}`;
  if (typeof v === 'number' || typeof v === 'bigint' || (typeof v === 'string' && NUMERIC_TYPES.has(typeId))) {
    const n = Number(v);
    if (Number.isFinite(n)) return `n:${Math.round(n * 10000) / 10000}`;
  }
  if (typeof v === 'object') return `j:${stableJson(v)}`;
  if (typeof v === 'boolean') return `b:${v}`;
  return `s:${String(v)}`;
}

export function canonicalRow(row: unknown[], typeIds: number[]): string {
  return row.map((v, i) => canonicalValue(v, typeIds[i])).join('\u0001');
}

export function isNumericType(typeId: number): boolean {
  return NUMERIC_TYPES.has(typeId);
}

export { TIMESTAMP };
