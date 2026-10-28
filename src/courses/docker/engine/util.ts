/** Formatting helpers that reproduce the Docker CLI's output exactly (calibrated against Docker 29.7.2). */

/** Deterministic hex ids (xorshift128+ seeded per engine). */
export class IdGen {
  private s0: number;
  private s1: number;
  constructor(seed = 1) {
    this.s0 = (seed * 2654435761) >>> 0 || 1;
    this.s1 = (seed * 1597334677 + 12345) >>> 0 || 7;
  }
  private next(): number {
    let x = this.s0;
    const y = this.s1;
    this.s0 = y;
    x ^= x << 23;
    x ^= x >>> 17;
    x ^= y ^ (y >>> 26);
    this.s1 = x >>> 0;
    return (this.s0 + this.s1) >>> 0;
  }
  hex(n: number): string {
    let s = '';
    while (s.length < n) s += this.next().toString(16).padStart(8, '0');
    return s.slice(0, n);
  }
}

/**
 * Docker's tables use Go's tabwriter with minwidth 10, padding 3: each column is
 * max(longest cell + 3, 10) wide. Some columns (sizes) are right-aligned.
 */
export function table(header: string[], rows: string[][], rightAlign: number[] = [], trailingPad = false): string[] {
  const cols = header.length;
  const widths = header.map((h, i) => Math.max(10, Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)) + 3));
  const fmt = (cells: string[]) =>
    cells
      .map((c, i) => {
        const last = i === cols - 1;
        if (rightAlign.includes(i)) {
          const inner = widths[i] - 3;
          return ' '.repeat(Math.max(0, inner - c.length)) + c + (last && !trailingPad ? '' : '   ');
        }
        return last && !trailingPad ? c : c.padEnd(widths[i]);
      })
      .join('')
      .replace(/\s+$/, (m) => (trailingPad ? m : ''));
  return [fmt(header), ...rows.map(fmt)];
}

/** go-units HumanSize: 3 significant digits, decimal units. Input in MB. */
export function humanSize(mb: number): string {
  let v = mb * 1e6;
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const s = v >= 100 ? Math.round(v).toString() : v >= 10 ? (Math.round(v * 10) / 10).toString() : (Math.round(v * 100) / 100).toString();
  return s + units[i];
}

/** "Less than a second", "5 seconds", "About a minute", "3 minutes", "About an hour", "2 hours", "3 days". */
export function humanDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 1) return 'Less than a second';
  if (s === 1) return '1 second';
  if (s < 60) return `${s} seconds`;
  const m = Math.round(s / 60);
  if (m === 1) return 'About a minute';
  if (m < 60) return `${m} minutes`;
  const h = Math.round(s / 3600);
  if (h === 1) return 'About an hour';
  if (h < 48) return `${h} hours`;
  return `${Math.round(h / 24)} days`;
}

/** `"/docker-entrypoint.…"`: quoted, cut to 20 characters. */
export function quoteCommand(cmd: string, max = 20): string {
  return `"${cmd.length > max ? cmd.slice(0, max - 1) + '…' : cmd}"`;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Splits a shell word list, honouring single/double quotes and backslash escapes. */
export function shellWords(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let q: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q) q = null;
      else if (ch === '\\' && q === '"' && i + 1 < s.length && '$`"\\\n'.includes(s[i + 1])) cur += s[++i]; // other backslashes stay, as in bash
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      has = true;
    } else if (ch === '\\' && i + 1 < s.length) {
      cur += s[++i];
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

/**
 * Splits a shell line into top-level segments on `;`, `&&`, `||` and `|`
 * (outside quotes). Returns tokens like {cmd, op} where op joins to the next.
 */
export function splitShell(line: string): { text: string; op: ';' | '&&' | '||' | '|' | null }[] {
  const parts: { text: string; op: ';' | '&&' | '||' | '|' | null }[] = [];
  let cur = '';
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      parts.push({ text: cur.trim(), op: two });
      cur = '';
      i++;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '\n') {
      parts.push({ text: cur.trim(), op: ch === '|' ? '|' : ';' });
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push({ text: cur.trim(), op: null });
  return parts.filter((p, i) => p.text || i === parts.length - 1).filter((p) => p.text);
}

export function isoZ(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Simple glob → RegExp (supports * and ?). */
export function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${esc}$`);
}

export function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

export function joinPath(base: string, p: string): string {
  return normalizePath(p.startsWith('/') ? p : `${base}/${p}`);
}
