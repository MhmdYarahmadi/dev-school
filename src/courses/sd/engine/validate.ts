/**
 * Structural checks on a design, before it runs. Errors stop the run (with a
 * plain-language reason); warnings run anyway but are shown to the learner.
 */
import type { Design, DesignNode, NodeKind } from './types';

/** Which components may call which. */
export const CONNECTS: Record<NodeKind, NodeKind[]> = {
  client: ['cdn', 'ratelimiter', 'lb', 'app'],
  cdn: ['lb', 'app', 'objectstore', 'ratelimiter'],
  ratelimiter: ['lb', 'app'],
  lb: ['app'],
  app: ['cache', 'db', 'queue', 'external', 'objectstore'],
  queue: ['worker'],
  worker: ['db', 'cache', 'external'],
  cache: [],
  db: [],
  objectstore: [],
  external: [],
};

export const KIND_NAMES: Record<NodeKind, string> = {
  client: 'Users',
  cdn: 'CDN',
  ratelimiter: 'Rate limiter',
  lb: 'Load balancer',
  app: 'App servers',
  cache: 'Cache',
  db: 'Database',
  queue: 'Queue',
  worker: 'Workers',
  objectstore: 'Object storage',
  external: 'External API',
};

export function validateDesign(d: Design): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map<string, DesignNode>();
  for (const n of d.nodes) {
    if (!n.id || !/^[a-zA-Z0-9_-]{1,40}$/.test(n.id)) errors.push(`"${n.id}" isn't a valid name: use letters, digits, - and _.`);
    else if (byId.has(n.id)) errors.push(`Two components are called "${n.id}".`);
    if (!(n.kind in CONNECTS)) errors.push(`"${n.id}" has an unknown type "${(n as { kind: string }).kind}".`);
    byId.set(n.id, n);
  }
  const name = (id: string) => `${KIND_NAMES[byId.get(id)!.kind]} "${id}"`;
  const outs = new Map<string, DesignNode[]>();
  const ins = new Map<string, DesignNode[]>();
  for (const e of d.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) {
      errors.push(`A connection points to "${!a ? e.from : e.to}", which doesn't exist.`);
      continue;
    }
    if (!CONNECTS[a.kind]?.includes(b.kind)) {
      errors.push(`${name(a.id)} can't call ${name(b.id)}. ${KIND_NAMES[a.kind]} can call: ${CONNECTS[a.kind].map((k) => KIND_NAMES[k]).join(', ') || 'nothing'}.`);
      continue;
    }
    if (e.retries !== undefined && (e.retries < 0 || e.retries > 10)) errors.push(`Retries on ${a.id} → ${b.id} must be between 0 and 10.`);
    if (e.timeoutMs !== undefined && e.timeoutMs <= 0) errors.push(`The timeout on ${a.id} → ${b.id} must be more than 0 ms.`);
    if (a.kind === 'lb' && (e.breaker || e.maxConcurrent !== undefined || e.optional))
      warnings.push(`On ${a.id} → ${b.id}, a load balancer uses only timeoutMs, retries, backoffMs and jitter; breaker, maxConcurrent and optional are ignored there.`);
    outs.set(a.id, [...(outs.get(a.id) ?? []), b]);
    ins.set(b.id, [...(ins.get(b.id) ?? []), a]);
  }
  if (errors.length) return { errors, warnings };

  const clients = d.nodes.filter((n) => n.kind === 'client');
  if (clients.length !== 1) errors.push(clients.length ? 'A design has exactly one Users component.' : 'Add a Users component: that is where the traffic comes from.');
  for (const c of clients) if (!outs.get(c.id)?.length) errors.push('Connect Users to something (usually a load balancer).');

  for (const n of d.nodes) {
    const o = outs.get(n.id) ?? [];
    const kinds = o.map((x) => x.kind);
    const dup = (k: NodeKind) => kinds.filter((x) => x === k).length > 1;
    switch (n.kind) {
      case 'lb':
        if (!o.length) errors.push(`${name(n.id)} has no app servers behind it.`);
        break;
      case 'ratelimiter':
        if (o.length !== 1) errors.push(`${name(n.id)} needs exactly one thing behind it.`);
        if (!(n.rate > 0)) errors.push(`${name(n.id)} needs a rate above 0.`);
        break;
      case 'cdn':
        if (o.length > 1) errors.push(`${name(n.id)} can have one origin.`);
        break;
      case 'app':
        for (const k of ['cache', 'db', 'queue'] as NodeKind[]) if (dup(k)) errors.push(`${name(n.id)} is connected to two ${KIND_NAMES[k].toLowerCase()}s; use one.`);
        if (n.writeVia === 'queue' && !kinds.includes('queue')) errors.push(`${name(n.id)} sends writes to a queue but isn't connected to one.`);
        if (n.cacheOnWrite === 'write_back' && !kinds.includes('cache')) errors.push(`${name(n.id)} uses write-back caching but has no cache.`);
        if (n.autoscale && (n.autoscale.min < 1 || n.autoscale.max < n.autoscale.min)) errors.push(`${name(n.id)}: autoscaling needs 1 ≤ min ≤ max.`);
        if ((n.instances ?? 1) > 1 && !(ins.get(n.id) ?? []).some((x) => x.kind === 'lb'))
          warnings.push(`${name(n.id)} has ${n.instances} instances but no load balancer: users reach them by DNS round robin, with no health checks.`);
        if ((n.instances ?? 1) > 200) errors.push(`${name(n.id)}: at most 200 instances.`);
        break;
      case 'queue':
        if (!o.length) warnings.push(`${name(n.id)} has no workers: messages will pile up.`);
        break;
      case 'worker':
        if (!(ins.get(n.id) ?? []).some((x) => x.kind === 'queue')) errors.push(`${name(n.id)} needs a queue to read from.`);
        break;
      case 'db': {
        if (n.quorum) {
          const { n: N, w, r } = n.quorum;
          if (!(N >= 1 && w >= 1 && r >= 1 && w <= N && r <= N)) errors.push(`${name(n.id)}: a quorum needs 1 ≤ w ≤ n and 1 ≤ r ≤ n.`);
          if (n.replicas) errors.push(`${name(n.id)}: quorum replication has no primary, so no read replicas either (use n).`);
        }
        if ((n.shards ?? 1) > 64) errors.push(`${name(n.id)}: at most 64 shards.`);
        if ((n.syncReplicas ?? 0) > (n.replicas ?? 0)) errors.push(`${name(n.id)}: syncReplicas can't be more than replicas.`);
        break;
      }
      case 'cache':
        if ((n.memoryMb ?? 1) <= 0) errors.push(`${name(n.id)} needs some memory.`);
        break;
    }
    if (n.kind !== 'client' && !(ins.get(n.id) ?? []).length) warnings.push(`${name(n.id)} isn't connected to anything that calls it.`);
  }
  return { errors, warnings };
}
