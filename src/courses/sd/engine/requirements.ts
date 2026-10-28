/**
 * Requirements: what a design must achieve, written the way engineers say it
 * ("p99 < 200ms", "errors < 0.1%", "cost < $900", "during outage: errors < 1%"),
 * checked against a simulation result, with feedback that names the cause.
 */
import type { NodeStats, SimResult, WindowStats } from './simulate';
import { KIND_NAMES } from './validate';

/** A result, with or without its window() function (results from the worker are plain data). */
type Result = Omit<SimResult, 'window'>;

export type Metric =
  | 'p50'
  | 'p95'
  | 'p99'
  | 'mean'
  | 'errors'
  | 'availability'
  | 'throughput'
  | 'cost'
  | 'staleReads'
  | 'rywViolations'
  | 'lostWrites'
  | 'duplicates'
  | 'dlq'
  | 'backlog'
  | 'maxBacklog'
  | 'drain'
  | 'messageP99'
  | 'hitRatio'
  | 'degraded'
  | 'keysMoved'
  | 'util';

type Op = '<' | '<=' | '>' | '>=' | '=';

export interface Requirement {
  metric: Metric;
  op: Op;
  /** In the metric's base unit: ms for times, a fraction (0–1) for rates and percentages, $ per month for cost. */
  value: number;
  /** Measure only during this phase of the scenario. */
  phase?: string;
  /** For `util`: which component. */
  node?: string;
  /** The text it was written as. */
  text: string;
}

export interface Check {
  req: Requirement;
  ok: boolean;
  actual: number;
  /** "p99 = 412 ms (needs < 200 ms)". */
  line: string;
}

const UNIT: Record<Metric, 'ms' | 'frac' | '$' | 'count' | 'rate'> = {
  p50: 'ms',
  p95: 'ms',
  p99: 'ms',
  mean: 'ms',
  errors: 'frac',
  availability: 'frac',
  throughput: 'rate',
  cost: '$',
  staleReads: 'count',
  rywViolations: 'count',
  lostWrites: 'count',
  duplicates: 'count',
  dlq: 'count',
  backlog: 'count',
  maxBacklog: 'count',
  drain: 'ms',
  messageP99: 'ms',
  hitRatio: 'frac',
  degraded: 'frac',
  keysMoved: 'count',
  util: 'frac',
};

export const METRIC_NAMES: Record<Metric, string> = {
  p50: 'median latency (p50)',
  p95: 'p95 latency',
  p99: 'p99 latency',
  mean: 'average latency',
  errors: 'error rate',
  availability: 'availability',
  throughput: 'throughput',
  cost: 'monthly cost',
  staleReads: 'stale reads',
  rywViolations: 'read-your-writes violations',
  lostWrites: 'lost writes',
  duplicates: 'duplicate side effects',
  dlq: 'dead-lettered messages',
  backlog: 'messages left in the queue',
  maxBacklog: 'largest queue backlog',
  drain: 'time to drain the backlog',
  messageP99: 'p99 message delay',
  hitRatio: 'cache hit ratio',
  degraded: 'degraded responses',
  keysMoved: 'keys moved between shards',
  util: 'utilisation',
};

const ALIASES: Record<string, Metric> = {
  latency: 'p99',
  error: 'errors',
  errorrate: 'errors',
  stale: 'staleReads',
  stalereads: 'staleReads',
  ryw: 'rywViolations',
  rywviolations: 'rywViolations',
  lostwrites: 'lostWrites',
  lost: 'lostWrites',
  dupes: 'duplicates',
  hitratio: 'hitRatio',
  hits: 'hitRatio',
  messagep99: 'messageP99',
  maxbacklog: 'maxBacklog',
  rps: 'throughput',
  moved: 'keysMoved',
  keysmoved: 'keysMoved',
};

/**
 * Parses "p99 < 200ms", "errors < 0.1%", "availability >= 99.9%", "cost < $900",
 * "staleReads = 0", "util(db) < 70%", "during outage: errors < 1%", "throughput >= 1000/s", "drain < 30s".
 */
export function parseRequirement(text: string): Requirement {
  let rest = text.trim();
  let phase: string | undefined;
  const ph = /^(?:during\s+)?([a-zA-Z0-9_-]+)\s*:\s*(.+)$/.exec(rest);
  if (ph && !/^util\(/.test(rest)) {
    phase = ph[1];
    rest = ph[2];
  }
  const m = /^([a-zA-Z0-9]+)(?:\(([a-zA-Z0-9_-]+)\))?\s*(<=|>=|<|>|=)\s*\$?\s*([0-9]*\.?[0-9]+)\s*(ms|s|%|k\/s|\/s|k)?$/.exec(rest);
  if (!m) throw new Error(`Can't read the requirement "${text}"`);
  const raw = m[1];
  const metric = (raw in UNIT ? raw : ALIASES[raw.toLowerCase()]) as Metric | undefined;
  if (!metric) throw new Error(`Unknown measure "${raw}" in "${text}"`);
  let value = Number(m[4]);
  const unit = m[5];
  const kind = UNIT[metric];
  if (kind === 'ms' && unit === 's') value *= 1000;
  if (kind === 'frac') value = unit === '%' ? value / 100 : value > 1 ? value / 100 : value;
  if (unit === 'k' || unit === 'k/s') value *= 1000;
  if (metric === 'util' && !m[2]) throw new Error(`Say which component: util(db) < 70%`);
  return { metric, op: m[3] as Op, value, phase, node: m[2], text };
}

function measure(r: Result, req: Requirement): number {
  const w: WindowStats = req.phase ? (r.phases[req.phase] ?? r) : r;
  switch (req.metric) {
    case 'p50':
    case 'p95':
    case 'p99':
    case 'mean':
    case 'throughput':
    case 'availability':
    case 'staleReads':
    case 'rywViolations':
      return w[req.metric];
    case 'errors':
      return w.errorRate;
    case 'degraded':
      return w.ok ? w.degraded / w.ok : 0;
    case 'cost':
      return r.cost.monthly;
    case 'lostWrites':
    case 'duplicates':
    case 'dlq':
    case 'keysMoved':
      return r[req.metric];
    case 'backlog':
      return r.messages.finalBacklog;
    case 'maxBacklog':
      return r.messages.maxBacklog;
    case 'drain':
      return r.messages.drainedAtMs ?? Infinity;
    case 'messageP99':
      return r.messages.p99;
    case 'hitRatio':
      return r.cache.hitRatio ?? r.cdn.hitRatio ?? 0;
    case 'util':
      return r.nodes[req.node!]?.maxInstanceUtilisation ?? 0;
  }
}

export function formatValue(metric: Metric, v: number): string {
  if (!Number.isFinite(v)) return metric === 'drain' ? 'never' : '∞';
  switch (UNIT[metric]) {
    case 'ms':
      return v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
    case 'frac': {
      const p = v * 100;
      return `${p === 0 || p === 100 ? p : p < 0.1 || p > 99.9 ? p.toFixed(3) : p < 1 || p > 99 ? p.toFixed(2) : p.toFixed(1)}%`;
    }
    case '$':
      return `$${v >= 100 ? Math.round(v).toLocaleString('en') : v.toFixed(2)}/month`;
    case 'rate':
      return `${Math.round(v).toLocaleString('en')}/s`;
    default:
      return Math.round(v).toLocaleString('en');
  }
}

function holds(op: Op, a: number, b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '=':
      return Math.abs(a - b) < 1e-9;
  }
}

export function checkRequirements(r: Result, reqs: (Requirement | string)[]): Check[] {
  return reqs.map((x) => {
    const req = typeof x === 'string' ? parseRequirement(x) : x;
    const actual = measure(r, req);
    const ok = !r.invalid?.length && holds(req.op, actual, req.value);
    const name = req.metric === 'util' ? `${req.node} utilisation (busiest instance)` : METRIC_NAMES[req.metric];
    const where = req.phase ? ` during ${req.phase}` : '';
    const line = `${cap(name)}${where}: ${formatValue(req.metric, actual)} (needs ${req.op === '=' ? '=' : req.op} ${formatValue(req.metric, req.value)})`;
    return { req, ok, actual, line };
  });
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ diagnosis

const ERROR_TEXT: Record<string, (node: string, n?: NodeStats) => string> = {
  overloaded: (x) => `${x} is overloaded: its waiting line is full, so new requests are turned away (503).`,
  refused: (x) => `${x} refused connections: an instance was down but still got traffic.`,
  reset: (x) => `Requests in progress on ${x} were lost when an instance died.`,
  timeout: (x) => `Calls made by ${x} timed out: something behind it was too slow or unreachable.`,
  too_many_connections: (x, n) => `${x} ran out of connections (limit ${n?.maxConnections ?? '?'}): every app instance keeps its own pool open, so instances × pool size must stay under the limit.`,
  session_lost: (x) => `Users were logged out by ${x}: sessions live in one server's memory, but the load balancer sends users to any server.`,
  rate_limited: (x) => `${x} rejected requests over its rate limit (429).`,
  no_backend: (x) => `${x} had no healthy servers to send requests to.`,
  queue_full: (x) => `${x} is full: consumers aren't keeping up.`,
  circuit_open: (x) => `${x}'s circuit breaker is open: calls fail fast while the dependency recovers.`,
  bulkhead_full: (x) => `${x}'s bulkhead is full: extra calls to a slow dependency fail fast (the rest of the service keeps working).`,
  external_error: (x) => `${x} (an external service) returned errors.`,
  no_quorum: (x) => `${x} couldn't reach enough copies for a quorum.`,
  unavailable: (x) => `${x} had no primary to take writes (it died and there's no failover).`,
  poison_message: (x) => `${x} keeps failing on some messages (poison messages).`,
};

/** Plain-language reasons for what went wrong in a run, most important first. */
export function diagnose(r: Result): string[] {
  const out: string[] = [];
  if (r.invalid?.length) return [...r.invalid];
  const label = (id: string) => {
    const n = r.nodes[id];
    return n ? `${KIND_NAMES[n.kind]} "${id}"` : id === 'users' ? 'The users’ browsers' : `"${id}"`;
  };
  const errs = Object.entries(r.byError).sort((a, b) => b[1] - a[1]);
  for (const [k, n] of errs.slice(0, 3)) {
    const [type, at] = k.split('@');
    const f = ERROR_TEXT[type];
    const share = r.requests ? n / r.requests : 0;
    const pct = share >= 0.001 ? ` (${formatValue('errors', share)} of requests)` : '';
    out.push((f ? f(label(at), r.nodes[at]) : `${label(at)}: ${type}`) + pct);
  }
  const hot = Object.entries(r.nodes)
    .filter(([, n]) => n.kind !== 'client' && n.maxInstanceUtilisation > 0.85)
    .sort((a, b) => b[1].maxInstanceUtilisation - a[1].maxInstanceUtilisation);
  for (const [id, n] of hot.slice(0, 2)) {
    const busiest = formatValue('util', n.maxInstanceUtilisation);
    const uneven = n.instances > 1 && n.maxInstanceUtilisation > 1.5 * n.utilisation;
    out.push(
      uneven
        ? `${label(id)} has a hot spot: its busiest instance is at ${busiest} while the average is ${formatValue('util', n.utilisation)}.`
        : `${label(id)} is the bottleneck: ${busiest} busy${n.avgQueue > 1 ? `, with about ${Math.round(n.avgQueue)} requests waiting on average` : ''}.`,
    );
  }
  if (r.cache.hitRatio !== null && r.cache.hitRatio < 0.5 && r.cache.hits + r.cache.misses > 100) out.push(`The cache only answers ${formatValue('hitRatio', r.cache.hitRatio)} of reads: most still go to the database.`);
  if (r.staleReads > 0) out.push(`${r.staleReads.toLocaleString('en')} reads returned data older than a write that had already been acknowledged.`);
  if (r.rywViolations > 0) out.push(`${r.rywViolations.toLocaleString('en')} times, users didn't see their own change right after making it (replication lag).`);
  if (r.lostWrites > 0) out.push(`${r.lostWrites.toLocaleString('en')} acknowledged writes were lost.`);
  if (r.duplicates > 0) out.push(`${r.duplicates.toLocaleString('en')} messages were processed twice (at-least-once delivery without idempotency).`);
  if (r.messages.finalBacklog > 100) out.push(`${r.messages.finalBacklog.toLocaleString('en')} messages are still waiting in the queue at the end.`);
  return out;
}
