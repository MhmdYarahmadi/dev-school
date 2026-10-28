/**
 * Line diffs and three-way merges, ported from Git's xdiff library so the
 * results match real Git: `git diff` uses Myers + the indent heuristic, and
 * merges use the histogram algorithm with Git's "zealous" conflict refinement.
 * tests/git-fuzz.test.ts compares random cases against the real `git`.
 *
 * Lines keep their trailing '\n' (the last line of a file may lack it), so
 * "a" at the end of a file and "a\n" are different lines, as in Git.
 */

export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** One change: `chg1` lines at `i1` in the old file became `chg2` lines at `i2` in the new one (0-based). */
export interface Change {
  i1: number;
  i2: number;
  chg1: number;
  chg2: number;
}

export type Algorithm = 'myers' | 'histogram';

/** The two files of a diff, with a change flag per line (guard slots at -1 and n). */
class Side {
  /** rchg[i + 1] is line i's flag. */
  rchg: Uint8Array;
  constructor(public recs: string[], public ha: number[]) {
    this.rchg = new Uint8Array(recs.length + 2);
  }
  get n() {
    return this.recs.length;
  }
  chg(i: number): number {
    return this.rchg[i + 1];
  }
  set(i: number, v: number) {
    this.rchg[i + 1] = v;
  }
}

function classify(a: string[], b: string[]): [number[], number[]] {
  const ids = new Map<string, number>();
  const id = (l: string) => {
    let v = ids.get(l);
    if (v === undefined) ids.set(l, (v = ids.size));
    return v;
  };
  return [a.map(id), b.map(id)];
}

// ---------------------------------------------------------------- Myers (xdiffi.c)

const KPDIS_RUN = 4;
const MAX_EQLIMIT = 1024;
const SIMSCAN_WINDOW = 100;

function bogosqrt(n: number): number {
  let i = 1;
  for (; n > 0; n >>= 2) i <<= 1;
  return i;
}

/** xdl_clean_mmatch: drop a line with many matches when it sits among lines with none. */
function cleanMmatch(dis: Uint8Array, i: number, s: number, e: number): boolean {
  if (i - s > SIMSCAN_WINDOW) s = i - SIMSCAN_WINDOW;
  if (e - i > SIMSCAN_WINDOW) e = i + SIMSCAN_WINDOW;
  let rdis0 = 0;
  let rpdis0 = 1;
  for (let r = 1; i - r >= s; r++) {
    if (!dis[i - r]) rdis0++;
    else if (dis[i - r] === 2) rpdis0++;
    else break;
  }
  if (rdis0 === 0) return false;
  let rdis1 = 0;
  let rpdis1 = 1;
  for (let r = 1; i + r <= e; r++) {
    if (!dis[i + r]) rdis1++;
    else if (dis[i + r] === 2) rpdis1++;
    else break;
  }
  if (rdis1 === 0) return false;
  rdis1 += rdis0;
  rpdis1 += rpdis0;
  return rpdis1 * KPDIS_RUN < rpdis1 + rdis1;
}

function myers(x: Side, y: Side) {
  // xdl_trim_ends: common lines at both ends are never part of a change.
  const lim = Math.min(x.n, y.n);
  let start = 0;
  while (start < lim && x.ha[start] === y.ha[start]) start++;
  let tail = 0;
  while (tail < lim - start && x.ha[x.n - 1 - tail] === y.ha[y.n - 1 - tail]) tail++;
  const dend1 = x.n - tail - 1;
  const dend2 = y.n - tail - 1;

  // xdl_cleanup_records: lines with no match elsewhere are changed for sure; only the rest go to the search.
  const count = (ha: number[], from: number, to: number) => {
    const m = new Map<number, number>();
    for (let i = from; i <= to; i++) m.set(ha[i], (m.get(ha[i]) ?? 0) + 1);
    return m;
  };
  // Git's classifier counts each line over the whole other file, trimmed ends included.
  const in1 = count(x.ha, 0, x.n - 1);
  const in2 = count(y.ha, 0, y.n - 1);
  const reduce = (s: Side, other: Map<number, number>, dend: number) => {
    const mlim = Math.min(bogosqrt(s.n), MAX_EQLIMIT);
    const dis = new Uint8Array(s.n + 1);
    for (let i = start; i <= dend; i++) {
      const nm = other.get(s.ha[i]) ?? 0;
      dis[i] = nm === 0 ? 0 : nm >= mlim ? 2 : 1;
    }
    const ha: number[] = [];
    const rindex: number[] = [];
    for (let i = start; i <= dend; i++) {
      if (dis[i] === 1 || (dis[i] === 2 && !cleanMmatch(dis, i, start, dend))) {
        rindex.push(i);
        ha.push(s.ha[i]);
      } else s.set(i, 1);
    }
    return { ha, rindex };
  };
  const d1 = reduce(x, in2, dend1);
  const d2 = reduce(y, in1, dend2);

  const off = d2.ha.length + 1;
  const size = d1.ha.length + d2.ha.length + 3;
  const kvdf = new Int32Array(size);
  const kvdb = new Int32Array(size);
  const LINE_MAX = 0x7fffffff;

  /** xdl_split: the middle snake of the box, searched from both ends at once. */
  const split = (h1: number[], off1: number, lim1: number, h2: number[], off2: number, lim2: number): [number, number] => {
    const dmin = off1 - lim2;
    const dmax = lim1 - off2;
    const fmid = off1 - off2;
    const bmid = lim1 - lim2;
    const odd = (fmid - bmid) & 1;
    let fmin = fmid;
    let fmax = fmid;
    let bmin = bmid;
    let bmax = bmid;
    kvdf[fmid + off] = off1;
    kvdb[bmid + off] = lim1;
    for (;;) {
      if (fmin > dmin) kvdf[--fmin - 1 + off] = -1;
      else ++fmin;
      if (fmax < dmax) kvdf[++fmax + 1 + off] = -1;
      else --fmax;
      for (let d = fmax; d >= fmin; d -= 2) {
        let i1 = kvdf[d - 1 + off] >= kvdf[d + 1 + off] ? kvdf[d - 1 + off] + 1 : kvdf[d + 1 + off];
        let i2 = i1 - d;
        while (i1 < lim1 && i2 < lim2 && h1[i1] === h2[i2]) {
          i1++;
          i2++;
        }
        kvdf[d + off] = i1;
        if (odd && bmin <= d && d <= bmax && kvdb[d + off] <= i1) return [i1, i2];
      }
      if (bmin > dmin) kvdb[--bmin - 1 + off] = LINE_MAX;
      else ++bmin;
      if (bmax < dmax) kvdb[++bmax + 1 + off] = LINE_MAX;
      else --bmax;
      for (let d = bmax; d >= bmin; d -= 2) {
        let i1 = kvdb[d - 1 + off] < kvdb[d + 1 + off] ? kvdb[d - 1 + off] : kvdb[d + 1 + off] - 1;
        let i2 = i1 - d;
        while (i1 > off1 && i2 > off2 && h1[i1 - 1] === h2[i2 - 1]) {
          i1--;
          i2--;
        }
        kvdb[d + off] = i1;
        if (!odd && fmin <= d && d <= fmax && i1 <= kvdf[d + off]) return [i1, i2];
      }
      // Git's cost-cutting heuristics only start after 256 steps: far beyond the files in this course.
    }
  };

  const recs = (off1: number, lim1: number, off2: number, lim2: number) => {
    const h1 = d1.ha;
    const h2 = d2.ha;
    while (off1 < lim1 && off2 < lim2 && h1[off1] === h2[off2]) {
      off1++;
      off2++;
    }
    while (off1 < lim1 && off2 < lim2 && h1[lim1 - 1] === h2[lim2 - 1]) {
      lim1--;
      lim2--;
    }
    if (off1 === lim1) for (; off2 < lim2; off2++) y.set(d2.rindex[off2], 1);
    else if (off2 === lim2) for (; off1 < lim1; off1++) x.set(d1.rindex[off1], 1);
    else {
      const [s1, s2] = split(h1, off1, lim1, h2, off2, lim2);
      recs(off1, s1, off2, s2);
      recs(s1, lim1, s2, lim2);
    }
  };
  recs(0, d1.ha.length, 0, d2.ha.length);
}

// ---------------------------------------------------------------- histogram (xhistogram.c)

function histogram(x: Side, y: Side) {
  const MAX_CHAIN = 64;
  const A = (l: number) => x.ha[l - 1];
  const B = (l: number) => y.ha[l - 1];

  const findLcs = (line1: number, count1: number, line2: number, count2: number) => {
    const end1 = line1 + count1 - 1;
    const end2 = line2 + count2 - 1;
    // scanA: occurrences of each line of A, as chains from the first occurrence.
    const recByHa = new Map<number, { ptr: number; cnt: number }>();
    const lineMap = new Map<number, { ptr: number; cnt: number }>();
    const next = new Map<number, number>();
    for (let ptr = end1; ptr >= line1; ptr--) {
      const rec = recByHa.get(A(ptr));
      if (rec) {
        next.set(ptr, rec.ptr);
        rec.ptr = ptr;
        rec.cnt++;
        lineMap.set(ptr, rec);
      } else {
        const r = { ptr, cnt: 1 };
        recByHa.set(A(ptr), r);
        lineMap.set(ptr, r);
      }
    }
    const lcs = { begin1: 0, end1: 0, begin2: 0, end2: 0 };
    let cnt = MAX_CHAIN + 1;
    let hasCommon = false;
    for (let bPtr = line2; bPtr <= end2; ) {
      let bNext = bPtr + 1;
      const rec = recByHa.get(B(bPtr));
      if (rec) {
        if (rec.cnt > cnt) hasCommon = true;
        else {
          hasCommon = true;
          let as = rec.ptr;
          for (;;) {
            let np = next.get(as) ?? 0;
            let bs = bPtr;
            let ae = as;
            let be = bs;
            let rc = rec.cnt;
            while (line1 < as && line2 < bs && A(as - 1) === B(bs - 1)) {
              as--;
              bs--;
              if (1 < rc) rc = Math.min(rc, lineMap.get(as)!.cnt);
            }
            while (ae < end1 && be < end2 && A(ae + 1) === B(be + 1)) {
              ae++;
              be++;
              if (1 < rc) rc = Math.min(rc, lineMap.get(ae)!.cnt);
            }
            if (bNext <= be) bNext = be + 1;
            if (lcs.end1 - lcs.begin1 < ae - as || rc < cnt) {
              lcs.begin1 = as;
              lcs.begin2 = bs;
              lcs.end1 = ae;
              lcs.end2 = be;
              cnt = rc;
            }
            if (np === 0) break;
            let stop = false;
            while (np <= ae) {
              np = next.get(np) ?? 0;
              if (np === 0) {
                stop = true;
                break;
              }
            }
            if (stop) break;
            as = np;
          }
        }
      }
      bPtr = bNext;
    }
    return { lcs, fallback: hasCommon && MAX_CHAIN < cnt };
  };

  const run = (line1: number, count1: number, line2: number, count2: number): void => {
    for (;;) {
      if (count1 <= 0 && count2 <= 0) return;
      if (!count1) {
        while (count2--) y.set(line2++ - 1, 1);
        return;
      }
      if (!count2) {
        while (count1--) x.set(line1++ - 1, 1);
        return;
      }
      const { lcs, fallback } = findLcs(line1, count1, line2, count2);
      if (fallback) {
        // A line repeated more than 64 times: Git falls back to Myers for this range.
        const sx = new Side(x.recs.slice(line1 - 1, line1 - 1 + count1), x.ha.slice(line1 - 1, line1 - 1 + count1));
        const sy = new Side(y.recs.slice(line2 - 1, line2 - 1 + count2), y.ha.slice(line2 - 1, line2 - 1 + count2));
        myers(sx, sy);
        for (let i = 0; i < count1; i++) x.set(line1 - 1 + i, sx.chg(i));
        for (let i = 0; i < count2; i++) y.set(line2 - 1 + i, sy.chg(i));
        return;
      }
      if (lcs.begin1 === 0 && lcs.begin2 === 0) {
        while (count1--) x.set(line1++ - 1, 1);
        while (count2--) y.set(line2++ - 1, 1);
        return;
      }
      run(line1, lcs.begin1 - line1, line2, lcs.begin2 - line2);
      const e1 = line1 + count1 - 1;
      const e2 = line2 + count2 - 1;
      count1 = e1 - lcs.end1;
      line1 = lcs.end1 + 1;
      count2 = e2 - lcs.end2;
      line2 = lcs.end2 + 1;
    }
  };
  run(1, x.n, 1, y.n);
}

// ---------------------------------------------------------------- sliding changes (xdl_change_compact)

const MAX_INDENT = 200;
const MAX_BLANKS = 20;
const INDENT_WEIGHT = 60;
const INDENT_HEURISTIC_MAX_SLIDING = 100;

function getIndent(rec: string): number {
  let ret = 0;
  for (const c of rec) {
    if (!/\s/.test(c)) return ret;
    if (c === ' ') ret += 1;
    else if (c === '\t') ret += 8 - (ret % 8);
    if (ret >= MAX_INDENT) return MAX_INDENT;
  }
  return -1;
}

interface Measure {
  eof: boolean;
  indent: number;
  preBlank: number;
  preIndent: number;
  postBlank: number;
  postIndent: number;
}

function measureSplit(s: Side, split: number): Measure {
  const m: Measure = { eof: false, indent: -1, preBlank: 0, preIndent: -1, postBlank: 0, postIndent: -1 };
  if (split >= s.n) m.eof = true;
  else m.indent = getIndent(s.recs[split]);
  for (let i = split - 1; i >= 0; i--) {
    m.preIndent = getIndent(s.recs[i]);
    if (m.preIndent !== -1) break;
    m.preBlank++;
    if (m.preBlank === MAX_BLANKS) {
      m.preIndent = 0;
      break;
    }
  }
  for (let i = split + 1; i < s.n; i++) {
    m.postIndent = getIndent(s.recs[i]);
    if (m.postIndent !== -1) break;
    m.postBlank++;
    if (m.postBlank === MAX_BLANKS) {
      m.postIndent = 0;
      break;
    }
  }
  return m;
}

function scoreAddSplit(m: Measure, s: { effectiveIndent: number; penalty: number }) {
  if (m.preIndent === -1 && m.preBlank === 0) s.penalty += 1;
  if (m.eof) s.penalty += 21;
  const postBlank = m.indent === -1 ? 1 + m.postBlank : 0;
  const totalBlank = m.preBlank + postBlank;
  s.penalty += -30 * totalBlank;
  s.penalty += 6 * postBlank;
  const indent = m.indent !== -1 ? m.indent : m.postIndent;
  const anyBlanks = totalBlank !== 0;
  s.effectiveIndent += indent;
  if (indent === -1 || m.preIndent === -1) return;
  if (indent > m.preIndent) s.penalty += anyBlanks ? 10 : -4;
  else if (indent === m.preIndent) return;
  else if (m.postIndent !== -1 && m.postIndent > indent) s.penalty += anyBlanks ? 17 : 24;
  else s.penalty += anyBlanks ? 17 : 23;
}

function compact(s: Side, o: Side, indentHeuristic: boolean) {
  const g = { start: 0, end: 0 };
  const go = { start: 0, end: 0 };
  const init = (side: Side, gr: { start: number; end: number }) => {
    gr.start = gr.end = 0;
    while (side.chg(gr.end)) gr.end++;
  };
  const next = (side: Side, gr: { start: number; end: number }) => {
    if (gr.end === side.n) return false;
    gr.start = gr.end + 1;
    for (gr.end = gr.start; side.chg(gr.end); gr.end++);
    return true;
  };
  const prev = (side: Side, gr: { start: number; end: number }) => {
    if (gr.start === 0) return false;
    gr.end = gr.start - 1;
    for (gr.start = gr.end; side.chg(gr.start - 1); gr.start--);
    return true;
  };
  const slideDown = () => {
    if (g.end < s.n && s.recs[g.start] === s.recs[g.end]) {
      s.set(g.start++, 0);
      s.set(g.end++, 1);
      while (s.chg(g.end)) g.end++;
      return true;
    }
    return false;
  };
  const slideUp = () => {
    if (g.start > 0 && s.recs[g.start - 1] === s.recs[g.end - 1]) {
      s.set(--g.start, 1);
      s.set(--g.end, 0);
      while (s.chg(g.start - 1)) g.start--;
      return true;
    }
    return false;
  };

  init(s, g);
  init(o, go);
  for (;;) {
    if (g.end !== g.start) {
      let groupsize: number;
      let earliestEnd: number;
      let endMatchingOther: number;
      do {
        groupsize = g.end - g.start;
        endMatchingOther = -1;
        while (slideUp()) prev(o, go);
        earliestEnd = g.end;
        if (go.end > go.start) endMatchingOther = g.end;
        while (slideDown()) {
          next(o, go);
          if (go.end > go.start) endMatchingOther = g.end;
        }
      } while (groupsize !== g.end - g.start);

      if (g.end === earliestEnd) {
        // It can't move.
      } else if (endMatchingOther !== -1) {
        while (go.end === go.start) {
          slideUp();
          prev(o, go);
        }
      } else if (indentHeuristic) {
        let shift = earliestEnd;
        if (g.end - groupsize - 1 > shift) shift = g.end - groupsize - 1;
        if (g.end - INDENT_HEURISTIC_MAX_SLIDING > shift) shift = g.end - INDENT_HEURISTIC_MAX_SLIDING;
        let bestShift = -1;
        let best = { effectiveIndent: 0, penalty: 0 };
        for (; shift <= g.end; shift++) {
          const score = { effectiveIndent: 0, penalty: 0 };
          scoreAddSplit(measureSplit(s, shift), score);
          scoreAddSplit(measureSplit(s, shift - groupsize), score);
          const cmp = INDENT_WEIGHT * Math.sign(score.effectiveIndent - best.effectiveIndent) + (score.penalty - best.penalty);
          if (bestShift === -1 || cmp <= 0) {
            best = score;
            bestShift = shift;
          }
        }
        while (g.end > bestShift) {
          slideUp();
          prev(o, go);
        }
      }
    }
    if (!next(s, g)) break;
    next(o, go);
  }
}

function buildScript(x: Side, y: Side): Change[] {
  const out: Change[] = [];
  for (let i1 = x.n, i2 = y.n; i1 >= 0 || i2 >= 0; i1--, i2--) {
    if (x.chg(i1 - 1) || y.chg(i2 - 1)) {
      const l1 = i1;
      const l2 = i2;
      while (x.chg(i1 - 1)) i1--;
      while (y.chg(i2 - 1)) i2--;
      out.unshift({ i1, i2, chg1: l1 - i1, chg2: l2 - i2 });
    }
  }
  return out;
}

/** The changes from `a` to `b` (arrays of lines). */
export function diffLines(a: string[], b: string[], algorithm: Algorithm = 'myers', indentHeuristic = algorithm === 'myers'): Change[] {
  const [ha, hb] = classify(a, b);
  const x = new Side(a, ha);
  const y = new Side(b, hb);
  if (algorithm === 'myers') myers(x, y);
  else histogram(x, y);
  compact(x, y, indentHeuristic);
  compact(y, x, indentHeuristic);
  return buildScript(x, y);
}

// ---------------------------------------------------------------- unified diff output

const NO_NEWLINE = '\\ No newline at end of file';

/** Git's default "function name" for a hunk header: the nearest line above that starts with a letter, _ or $. */
function funcLine(line: string): string | null {
  if (!/^[A-Za-z_$]/.test(line)) return null;
  // Git copies at most 80 bytes, then trims trailing whitespace.
  let s = line.replace(/\n$/, '');
  const bytes = new TextEncoder().encode(s);
  if (bytes.length > 80) s = new TextDecoder().decode(bytes.slice(0, 80)).replace(/�+$/, '');
  return s.replace(/\s+$/, '');
}

/** The hunks of a unified diff (`@@ … @@` and the lines below), with 3 lines of context. */
export function unifiedHunks(a: string[], b: string[], ctx = 3): string[] {
  const changes = diffLines(a, b);
  const out: string[] = [];
  const emit = (prefix: string, line: string) => {
    out.push(prefix + line.replace(/\n$/, ''));
    if (!line.endsWith('\n')) out.push(NO_NEWLINE);
  };
  let func = '';
  let funcPrev = -1;
  for (let k = 0; k < changes.length; ) {
    // Changes closer than 2 × context lines share a hunk.
    let last = k;
    while (last + 1 < changes.length && changes[last + 1].i1 - (changes[last].i1 + changes[last].chg1) <= 2 * ctx) last++;
    const first = changes[k];
    const end = changes[last];
    const s1 = Math.max(first.i1 - ctx, 0);
    const s2 = Math.max(first.i2 - ctx, 0);
    const lctx = Math.min(ctx, a.length - (end.i1 + end.chg1), b.length - (end.i2 + end.chg2));
    const e1 = end.i1 + end.chg1 + lctx;
    const e2 = end.i2 + end.chg2 + lctx;
    for (let l = s1 - 1; l !== funcPrev && l >= 0; l--) {
      const f = funcLine(a[l]);
      if (f !== null) {
        func = f;
        break;
      }
    }
    funcPrev = s1 - 1;
    const range = (s: number, c: number) => `${c ? s + 1 : s}${c === 1 ? '' : `,${c}`}`;
    out.push(`@@ -${range(s1, e1 - s1)} +${range(s2, e2 - s2)} @@${func ? ' ' + func : ''}`);
    let i = s1;
    for (let j = k; j <= last; j++) {
      const c = changes[j];
      for (; i < c.i1; i++) emit(' ', a[i]);
      for (let d = 0; d < c.chg1; d++) emit('-', a[c.i1 + d]);
      for (let d = 0; d < c.chg2; d++) emit('+', b[c.i2 + d]);
      i = c.i1 + c.chg1;
    }
    for (; i < e1; i++) emit(' ', a[i]);
    k = last + 1;
  }
  return out;
}

/** Lines added and removed (for `--stat` and commit summaries). */
export function countChanges(a: string[], b: string[]): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const c of diffLines(a, b)) {
    add += c.chg2;
    del += c.chg1;
  }
  return { add, del };
}

// ---------------------------------------------------------------- three-way merge (xmerge.c)

interface MergeHunk {
  /** 0 = conflict, 1 = ours, 2 = theirs, 4 = both made the same change. */
  mode: number;
  i0: number;
  chg0: number;
  i1: number;
  chg1: number;
  i2: number;
  chg2: number;
}

export interface MergeResult {
  text: string;
  conflicts: number;
}

/**
 * Merges the changes from base→ours and base→theirs. Overlapping (or touching)
 * changes become conflicts, written with Git's markers and labels.
 */
export function merge3(base: string, ours: string, theirs: string, oursLabel: string, theirsLabel: string): MergeResult {
  if (ours === theirs) return { text: ours, conflicts: 0 };
  if (base === ours) return { text: theirs, conflicts: 0 };
  if (base === theirs) return { text: ours, conflicts: 0 };
  const b = splitLines(base);
  const o = splitLines(ours);
  const t = splitLines(theirs);
  const x1 = diffLines(b, o, 'histogram');
  const x2 = diffLines(b, t, 'histogram');
  if (!x1.length) return { text: theirs, conflicts: 0 };
  if (!x2.length) return { text: ours, conflicts: 0 };

  const ms: MergeHunk[] = [];
  const append = (mode: number, i0: number, chg0: number, i1: number, chg1: number, i2: number, chg2: number) => {
    const m = ms[ms.length - 1];
    if (m && (i1 <= m.i1 + m.chg1 || i2 <= m.i2 + m.chg2)) {
      if (mode !== m.mode) m.mode = 0;
      m.chg0 = i0 + chg0 - m.i0;
      m.chg1 = i1 + chg1 - m.i1;
      m.chg2 = i2 + chg2 - m.i2;
    } else ms.push({ mode, i0, chg0, i1, chg1, i2, chg2 });
  };
  const sameLines = (i1: number, i2: number, n: number) => {
    for (let k = 0; k < n; k++) if (o[i1 + k] !== t[i2 + k]) return false;
    return true;
  };

  let p = 0;
  let q = 0;
  while (p < x1.length && q < x2.length) {
    const c1 = x1[p];
    const c2 = x2[q];
    if (c1.i1 + c1.chg1 < c2.i1) {
      append(1, c1.i1, c1.chg1, c1.i2, c1.chg2, c2.i2 - c2.i1 + c1.i1, c1.chg1);
      p++;
      continue;
    }
    if (c2.i1 + c2.chg1 < c1.i1) {
      append(2, c2.i1, c2.chg1, c1.i2 - c1.i1 + c2.i1, c2.chg1, c2.i2, c2.chg2);
      q++;
      continue;
    }
    if (c1.i1 !== c2.i1 || c1.chg1 !== c2.chg1 || c1.chg2 !== c2.chg2 || !sameLines(c1.i2, c2.i2, c1.chg2)) {
      const off = c1.i1 - c2.i1;
      const ffo = off + c1.chg1 - c2.chg1;
      let i0 = c1.i1;
      let i1 = c1.i2;
      let i2 = c2.i2;
      if (off > 0) {
        i0 -= off;
        i1 -= off;
      } else i2 += off;
      let chg0 = c1.i1 + c1.chg1 - i0;
      let chg1 = c1.i2 + c1.chg2 - i1;
      let chg2 = c2.i2 + c2.chg2 - i2;
      if (ffo < 0) {
        chg0 -= ffo;
        chg1 -= ffo;
      } else chg2 += ffo;
      append(0, i0, chg0, i1, chg1, i2, chg2);
    }
    const e1 = c1.i1 + c1.chg1;
    const e2 = c2.i1 + c2.chg1;
    if (e1 >= e2) q++;
    if (e2 >= e1) p++;
  }
  for (; p < x1.length; p++) {
    const c1 = x1[p];
    append(1, c1.i1, c1.chg1, c1.i2, c1.chg2, c1.i1 + t.length - b.length, c1.chg1);
  }
  for (; q < x2.length; q++) {
    const c2 = x2[q];
    append(2, c2.i1, c2.chg1, c2.i1 + o.length - b.length, c2.chg1, c2.i2, c2.chg2);
  }

  // Zealous: shrink each conflict to the lines that really differ between the two sides.
  for (let k = 0; k < ms.length; k++) {
    const m = ms[k];
    if (m.mode || m.chg1 === 0 || m.chg2 === 0) continue;
    const sub = diffLines(o.slice(m.i1, m.i1 + m.chg1), t.slice(m.i2, m.i2 + m.chg2), 'histogram');
    if (!sub.length) {
      m.mode = 4;
      continue;
    }
    const base1 = m.i1;
    const base2 = m.i2;
    const parts = sub.map((c) => ({ mode: 0, i0: m.i0, chg0: m.chg0, i1: c.i1 + base1, chg1: c.chg1, i2: c.i2 + base2, chg2: c.chg2 }));
    ms.splice(k, 1, ...parts);
    k += parts.length - 1;
  }
  // Conflicts separated by 3 lines or fewer become one.
  for (let k = 0; k + 1 < ms.length; ) {
    const m = ms[k];
    const n = ms[k + 1];
    const begin = m.i1 + m.chg1;
    const end = n.i1;
    if (m.mode !== 0 || n.mode !== 0 || end - begin > 3) k++;
    else {
      m.chg1 = n.i1 + n.chg1 - m.i1;
      m.chg2 = n.i2 + n.chg2 - m.i2;
      ms.splice(k + 1, 1);
    }
  }

  const res: string[] = [];
  let conflicts = 0;
  const copy = (lines: string[], from: number, n: number, addNl = false) => {
    for (let k = 0; k < n; k++) res.push(lines[from + k]);
    if (addNl && n > 0 && !res[res.length - 1].endsWith('\n')) res[res.length - 1] += '\n';
  };
  let i = 0;
  for (const m of ms) {
    if (m.mode === 0) {
      conflicts++;
      copy(o, i, m.i1 - i);
      res.push(`<<<<<<< ${oursLabel}\n`);
      copy(o, m.i1, m.chg1, true);
      res.push('=======\n');
      copy(t, m.i2, m.chg2, true);
      res.push(`>>>>>>> ${theirsLabel}\n`);
    } else if (m.mode & 3) {
      copy(o, i, m.i1 - i);
      if (m.mode & 1) copy(o, m.i1, m.chg1, (m.mode & 2) !== 0);
      if (m.mode & 2) copy(t, m.i2, m.chg2);
    } else continue;
    i = m.i1 + m.chg1;
  }
  copy(o, i, o.length - i);
  return { text: res.join(''), conflicts };
}
