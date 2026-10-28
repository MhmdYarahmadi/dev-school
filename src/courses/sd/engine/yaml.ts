/**
 * The text form of a design (the canvas and this YAML are two views of the same model):
 *
 *   components:
 *     users: { type: client }
 *     lb:    { type: lb, algorithm: least_conn }
 *     app:   { type: app, instances: 3, size: medium }
 *     db:    { type: db, replicas: 1 }
 *   connections:
 *     - users -> lb
 *     - lb -> app
 *     - app -> db: { timeoutMs: 200, retries: 2, backoffMs: 50, jitter: true }
 */
import { Document, isMap, parse, type YAMLMap, type YAMLSeq } from 'yaml';
import type { Design, DesignNode, Edge, NodeKind } from './types';
import { CONNECTS } from './validate';

type FieldType = 'number' | 'int' | 'bool' | string[] | 'azs' | 'object';

const COMMON: Record<string, FieldType> = { label: [], azs: 'azs', mtbfMs: 'number', mttrMs: 'number' };
const SIZE = ['small', 'medium', 'large', 'xlarge'];
const DIST = ['exp', 'const', 'lognormal'];

/** Every setting each component accepts (with its type), for checking hand-written YAML. */
export const FIELDS: Record<NodeKind, Record<string, FieldType>> = {
  client: {},
  cdn: { capacity: 'int', ttlMs: 'number', cacheReads: 'bool' },
  ratelimiter: { rate: 'number', burst: 'number', per: ['global', 'user'] },
  lb: { algorithm: ['round_robin', 'least_conn', 'random', 'sticky'], healthCheck: 'object' },
  app: {
    instances: 'int',
    size: SIZE,
    threads: 'int',
    maxQueue: 'int',
    cpuMs: 'number',
    dist: DIST,
    sessions: ['none', 'local', 'shared'],
    readFrom: ['primary', 'replicas'],
    cacheOnWrite: ['invalidate', 'write_through', 'write_back', 'none'],
    singleFlight: 'bool',
    writeVia: ['db', 'queue'],
    dbPool: 'int',
    externalRatio: 'number',
    autoscale: 'object',
  },
  cache: { memoryMb: 'number', instances: 'int', ttlMs: 'number', opMs: 'number', flushMs: 'number' },
  db: {
    size: SIZE,
    replicas: 'int',
    shards: 'int',
    shardBy: ['key', 'user'],
    partitioning: ['hash', 'range', 'consistent'],
    readMs: 'number',
    writeMs: 'number',
    dist: DIST,
    maxConnections: 'int',
    replicationLagMs: 'number',
    replicaApplyRate: 'number',
    syncReplicas: 'int',
    failoverMs: 'number',
    quorum: 'object',
  },
  queue: { mode: ['queue', 'topic'], maxBacklog: 'int', visibilityTimeoutMs: 'number', maxReceives: 'int', dlq: 'bool' },
  worker: { instances: 'int', concurrency: 'int', cpuMs: 'number', dist: DIST, fanout: 'int', idempotent: 'bool', autoscale: 'object' },
  objectstore: { latencyMs: 'number' },
  external: { latencyMs: 'number', failRate: 'number', rateLimit: 'number', pricePerMillion: 'number' },
};

export const EDGE_FIELDS: Record<string, FieldType> = {
  timeoutMs: 'number',
  retries: 'int',
  backoffMs: 'number',
  jitter: 'bool',
  breaker: 'object',
  maxConcurrent: 'int',
  optional: 'bool',
};

function checkField(where: string, key: string, v: unknown, t: FieldType, errors: string[]): void {
  const bad = (what: string) => errors.push(`${where}: "${key}" should be ${what}.`);
  if (Array.isArray(t)) {
    if (t.length === 0) {
      if (typeof v !== 'string') bad('text');
    } else if (!t.includes(v as string)) bad(`one of ${t.join(', ')}`);
  } else if (t === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) bad('a number (0 or more)');
  } else if (t === 'int') {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) bad('a whole number (0 or more)');
  } else if (t === 'bool') {
    if (typeof v !== 'boolean') bad('true or false');
  } else if (t === 'azs') {
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) bad('a list of zone names, like [a, b]');
  } else if (t === 'object') {
    if (v === false && key === 'healthCheck') return;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) bad('a group of settings, like { min: 2, max: 10 }');
  }
}

export function yamlToDesign(text: string): { design?: Design; errors: string[] } {
  const errors: string[] = [];
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0];
    return { errors: [`The YAML can't be read: ${msg}`] };
  }
  if (!doc || typeof doc !== 'object') return { errors: ['Expected "components:" and "connections:".'] };
  const { components, connections, ...extra } = doc as Record<string, unknown>;
  for (const k of Object.keys(extra)) errors.push(`Unknown section "${k}" (use components and connections).`);
  if (!components || typeof components !== 'object' || Array.isArray(components)) return { errors: [...errors, 'Add a "components:" section.'] };
  const nodes: DesignNode[] = [];
  for (const [id, raw] of Object.entries(components as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') {
      errors.push(`Component "${id}" needs settings, at least { type: … }.`);
      continue;
    }
    const { type, ...fields } = raw as Record<string, unknown>;
    if (typeof type !== 'string' || !(type in FIELDS)) {
      errors.push(`Component "${id}": type must be one of ${Object.keys(FIELDS).join(', ')}.`);
      continue;
    }
    const allowed = { ...COMMON, ...FIELDS[type as NodeKind] };
    for (const [k, v] of Object.entries(fields)) {
      if (!(k in allowed)) errors.push(`Component "${id}" (${type}) has no setting "${k}".`);
      else checkField(`Component "${id}"`, k, v, allowed[k], errors);
    }
    nodes.push({ id, kind: type, ...fields } as DesignNode);
  }
  const edges: Edge[] = [];
  const list = connections ?? [];
  if (!Array.isArray(list)) errors.push('"connections:" should be a list, like - users -> lb');
  else
    for (const item of list) {
      let spec: string;
      let opts: Record<string, unknown> = {};
      if (typeof item === 'string') spec = item;
      else if (item && typeof item === 'object' && Object.keys(item).length === 1) {
        spec = Object.keys(item)[0];
        opts = ((item as Record<string, unknown>)[spec] ?? {}) as Record<string, unknown>;
      } else {
        errors.push('Each connection looks like "- a -> b" or "- a -> b: { timeoutMs: 200 }".');
        continue;
      }
      const m = /^\s*([a-zA-Z0-9_-]+)\s*->\s*([a-zA-Z0-9_-]+)\s*$/.exec(spec);
      if (!m) {
        errors.push(`"${spec}" isn't a connection: write it as "from -> to".`);
        continue;
      }
      for (const [k, v] of Object.entries(opts)) {
        if (!(k in EDGE_FIELDS)) errors.push(`Connection ${m[1]} -> ${m[2]} has no setting "${k}".`);
        else checkField(`Connection ${m[1]} -> ${m[2]}`, k, v, EDGE_FIELDS[k], errors);
      }
      edges.push({ from: m[1], to: m[2], ...opts });
    }
  return errors.length ? { errors } : { design: { nodes, edges }, errors };
}

export function designToYaml(d: Design): string {
  const components: Record<string, Record<string, unknown>> = {};
  for (const n of d.nodes) {
    const { id, kind, ...rest } = n;
    components[id] = { type: kind, ...rest };
  }
  const connections = d.edges.map((e) => {
    const { from, to, ...opts } = e;
    const key = `${from} -> ${to}`;
    return Object.keys(opts).length ? { [key]: opts } : key;
  });
  // one line per component and per connection, like the example at the top
  const doc = new Document({ components, connections });
  const comps = doc.get('components') as YAMLMap;
  for (const item of comps.items) if (isMap(item.value)) item.value.flow = true;
  const conns = doc.get('connections') as YAMLSeq;
  for (const item of conns.items) if (isMap(item)) for (const pair of item.items) if (isMap(pair.value)) pair.value.flow = true;
  return doc.toString({ flowCollectionPadding: true, lineWidth: 0 });
}

/** Which kinds can be connected from a kind (re-exported for the canvas). */
export { CONNECTS };
