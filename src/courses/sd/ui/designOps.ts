/**
 * Edits to a design, as pure functions (the canvas and the settings panel call these,
 * and tests check them). Every edit returns a new design.
 */
import { CONNECTS, KIND_NAMES, type Design, type DesignNode, type Edge, type NodeKind } from '../engine';
import { NEW_NODE } from './fields';

const BASE_ID: Record<NodeKind, string> = {
  client: 'users',
  cdn: 'cdn',
  ratelimiter: 'limiter',
  lb: 'lb',
  app: 'app',
  cache: 'cache',
  db: 'db',
  queue: 'queue',
  worker: 'workers',
  objectstore: 'files',
  external: 'api',
};

export function freshId(d: Design, kind: NodeKind): string {
  const base = BASE_ID[kind];
  const taken = new Set(d.nodes.map((n) => n.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

export function addNode(d: Design, kind: NodeKind): { design: Design; id: string } | { error: string } {
  if (kind === 'client' && d.nodes.some((n) => n.kind === 'client')) return { error: 'A design has one Users component.' };
  const id = freshId(d, kind);
  const node = { id, kind, ...NEW_NODE[kind] } as DesignNode;
  return { design: { ...d, nodes: [...d.nodes, node] }, id };
}

export function removeNode(d: Design, id: string): Design {
  return { nodes: d.nodes.filter((n) => n.id !== id), edges: d.edges.filter((e) => e.from !== id && e.to !== id) };
}

export function renameNode(d: Design, id: string, to: string): Design | { error: string } {
  if (to === id) return d;
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(to)) return { error: 'Use letters, digits, - and _ (up to 40).' };
  if (d.nodes.some((n) => n.id === to)) return { error: `There is already a component called "${to}".` };
  const fix = (x: string) => (x === id ? to : x);
  return {
    nodes: d.nodes.map((n) => (n.id === id ? { ...n, id: to } : n)),
    edges: d.edges.map((e) => ({ ...e, from: fix(e.from), to: fix(e.to) })),
  };
}

/** Sets (or, with undefined, removes) one setting of a component. */
export function setField(d: Design, id: string, key: string, value: unknown): Design {
  return {
    ...d,
    nodes: d.nodes.map((n) => {
      if (n.id !== id) return n;
      const next = { ...n } as Record<string, unknown>;
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next as unknown as DesignNode;
    }),
  };
}

export function connect(d: Design, from: string, to: string): Design | { error: string } {
  const a = d.nodes.find((n) => n.id === from);
  const b = d.nodes.find((n) => n.id === to);
  if (!a || !b) return { error: 'Connect two components.' };
  if (from === to) return { error: 'A component can’t call itself.' };
  if (d.edges.some((e) => e.from === from && e.to === to)) return { error: `${from} is already connected to ${to}.` };
  if (!CONNECTS[a.kind].includes(b.kind)) {
    const back = CONNECTS[b.kind].includes(a.kind);
    return {
      error: back
        ? `Connections point from the caller: drag from ${KIND_NAMES[b.kind]} "${to}" to ${KIND_NAMES[a.kind]} "${from}".`
        : `${KIND_NAMES[a.kind]} can’t call ${KIND_NAMES[b.kind]}. ${KIND_NAMES[a.kind]} can call: ${CONNECTS[a.kind].map((k) => KIND_NAMES[k]).join(', ') || 'nothing'}.`,
    };
  }
  return { ...d, edges: [...d.edges, { from, to }] };
}

export function disconnect(d: Design, from: string, to: string): Design {
  return { ...d, edges: d.edges.filter((e) => !(e.from === from && e.to === to)) };
}

export function setEdgeField(d: Design, from: string, to: string, key: string, value: unknown): Design {
  return {
    ...d,
    edges: d.edges.map((e) => {
      if (e.from !== from || e.to !== to) return e;
      const next = { ...e } as Record<string, unknown>;
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next as unknown as Edge;
    }),
  };
}

/**
 * Left-to-right layers: a component sits one column right of the furthest component that calls it
 * (users first, then edge, load balancers, apps, data stores). Returns positions in px.
 */
export function layout(d: Design, colWidth = 230, rowHeight = 110): Record<string, { x: number; y: number }> {
  const layer = new Map<string, number>();
  for (const n of d.nodes) layer.set(n.id, 0);
  // longest path, bounded (designs have no cycles: CONNECTS only points "downstream")
  for (let pass = 0; pass < d.nodes.length; pass++) {
    let changed = false;
    for (const e of d.edges) {
      const want = (layer.get(e.from) ?? 0) + 1;
      if (layer.has(e.to) && layer.get(e.to)! < want) {
        layer.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const cols = new Map<number, string[]>();
  for (const n of d.nodes) {
    const l = layer.get(n.id)!;
    cols.set(l, [...(cols.get(l) ?? []), n.id]);
  }
  const tallest = Math.max(1, ...[...cols.values()].map((c) => c.length));
  const out: Record<string, { x: number; y: number }> = {};
  for (const [l, ids] of cols) {
    const offset = ((tallest - ids.length) * rowHeight) / 2;
    ids.forEach((id, i) => (out[id] = { x: l * colWidth, y: offset + i * rowHeight }));
  }
  return out;
}

/** One line under a component's name: its most important settings. */
export function nodeSummary(n: DesignNode): string {
  const parts: string[] = [];
  switch (n.kind) {
    case 'app':
      parts.push(n.autoscale ? `${n.autoscale.min}–${n.autoscale.max} × ${n.size ?? 'small'} (auto)` : `${n.instances ?? 1} × ${n.size ?? 'small'}`);
      if (n.sessions === 'local') parts.push('local sessions');
      if (n.writeVia === 'queue') parts.push('writes → queue');
      break;
    case 'db':
      if (n.quorum) parts.push(`quorum n${n.quorum.n} w${n.quorum.w} r${n.quorum.r}`);
      else parts.push(n.size ?? 'small');
      if ((n.shards ?? 1) > 1) parts.push(`${n.shards} shards`);
      if (n.replicas) parts.push(`+${n.replicas} replica${n.replicas === 1 ? '' : 's'}`);
      if (n.failoverMs !== undefined) parts.push('failover');
      break;
    case 'cache': {
      const mb = n.memoryMb ?? 1024;
      parts.push(`${n.instances && n.instances > 1 ? `${n.instances} × ` : ''}${mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${+mb.toFixed(1)} MB`}`);
      if (n.ttlMs) parts.push(`TTL ${n.ttlMs >= 1000 ? `${n.ttlMs / 1000}s` : `${n.ttlMs}ms`}`);
      break;
    }
    case 'lb':
      parts.push((n.algorithm ?? 'round_robin').replace('_', ' '));
      if (n.healthCheck === false) parts.push('no health checks');
      break;
    case 'ratelimiter':
      parts.push(`${n.rate}/s${n.per === 'user' ? ' per user' : ''}`);
      break;
    case 'cdn':
      parts.push(n.cacheReads ? 'static + API reads' : 'static files');
      break;
    case 'queue':
      parts.push(n.mode === 'topic' ? 'topic' : 'queue');
      if (n.dlq) parts.push('DLQ');
      break;
    case 'worker':
      parts.push(n.autoscale ? `${n.autoscale.min}–${n.autoscale.max} (auto)` : `${n.instances ?? 1} × ${n.concurrency ?? 4} at once`);
      if (n.idempotent) parts.push('idempotent');
      break;
    case 'external':
      parts.push(`${n.latencyMs ?? 100} ms`);
      if (n.failRate) parts.push(`${Math.round(n.failRate * 100)}% fail`);
      break;
    case 'objectstore':
      parts.push(`${n.latencyMs ?? 20} ms`);
      break;
    case 'client':
      break;
  }
  if (n.azs && n.azs.length > 1) parts.push(`zones ${n.azs.join(',')}`);
  return parts.join(' · ');
}

/** A short label on a connection: its resilience settings. */
export function edgeSummary(e: Edge): string {
  const p: string[] = [];
  if (e.timeoutMs !== undefined) p.push(`⏱ ${e.timeoutMs}ms`);
  if (e.retries) p.push(`↻ ${e.retries}${e.backoffMs ? ` +${e.backoffMs}ms${e.jitter ? '~' : ''}` : ''}`);
  if (e.breaker) p.push('⚡ breaker');
  if (e.maxConcurrent !== undefined) p.push(`▥ ${e.maxConcurrent}`);
  if (e.optional) p.push('optional');
  return p.join(' ');
}
