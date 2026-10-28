import type { SdLevel } from './rounds';

/** The orders service every level starts from: six app servers (5 DB connections each) and a database. */
const orders = (db: string, cache = '') => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 6, size: medium, dbPool: 5 }
${cache ? `  cache: { type: cache${cache} }\n` : ''}  db: { type: db${db} }
connections:
  - users -> lb
  - lb -> app
${cache ? '  - app -> cache\n' : ''}  - app -> db
`;

/** Shard Shuffle (after module 6): pick shard counts, partitioning and partition keys; survive a viral product and a new shard. */
export const SHARD_LEVELS: SdLevel[] = [
  {
    title: 'Too many orders',
    story: 'A sale: **2,000 requests/s, half of them new orders**, and one small database. Split it into the fewest shards that keep **p99 under 150 ms** with no errors.',
    scenario: `${orders('')}traffic: { rps: 2000, mix: { read: 0.5, write: 0.5 }, keys: 100000, readKb: 0.5 }
run: { duration: 30s, warmup: 5s }
requirements:
  - p99 < 150ms
  - errors < 0.1%
`,
    tuneOnly: true,
    parCost: 1000,
    solution: orders(', shards: 6'),
    hint: 'About 8 cores of work: 1,000 writes × 6 ms + 1,000 reads × 2 ms. A small shard has 2 cores, and the busiest shard is busier than the average.',
  },
  {
    title: 'Ever-increasing ids',
    story: 'Order ids now come from a clock, so **every new id is larger** than the last. The database is range-partitioned, and one shard is on fire while five are idle. Fix it without adding shards.',
    scenario: `${orders(', shards: 6, partitioning: range')}traffic: { rps: 2000, mix: { read: 0.5, write: 0.5 }, keys: 100000, readKb: 0.5, sequentialWrites: true }
run: { duration: 30s, warmup: 5s }
requirements:
  - p99 < 150ms
  - errors < 0.1%
`,
    tuneOnly: true,
    parCost: 1000,
    solution: orders(', shards: 6, partitioning: hash'),
    hint: 'With range partitioning, increasing ids all fall in the last range. Which partitioning spreads consecutive ids?',
  },
  {
    title: 'The viral product',
    story: 'At **10 s**, a product goes viral: it gets **60% of all reads**. Its shard collapses. Keep **errors under 0.1%** and **p99 under 100 ms** while it’s viral, as cheaply as you can.',
    scenario: `${orders(', shards: 4')}traffic: { rps: 2000, mix: { read: 0.8, write: 0.2 }, keys: 100000, readKb: 0.5, hotKey: { share: 0.6, fromMs: 10000 } }
run: { duration: 30s, warmup: 5s }
phases:
  - { name: viral, from: 12s, to: 30s }
requirements:
  - "viral: errors < 0.1%"
  - "viral: p99 < 100ms"
`,
    parCost: 920,
    solution: orders(', shards: 4', ', memoryMb: 32'),
    hint: 'More shards can’t split one key. Something that remembers popular reads can: add a cache (even a small one) between the app and the database.',
  },
  {
    title: 'Growing pains',
    story: 'Orders keep coming, so a **fifth shard** goes in at **10 s**. Last time, the data migration took all weekend. Make sure **fewer than 30,000** of the 100,000 orders have to move.',
    scenario: `${orders(', shards: 4')}traffic: { rps: 1500, mix: { read: 0.5, write: 0.5 }, keys: 100000, readKb: 0.5 }
run: { duration: 30s, warmup: 5s }
events:
  - { at: 10s, action: addShard, node: db }
requirements:
  - keysMoved < 30000
  - errors < 0.1%
`,
    tuneOnly: true,
    parCost: 870,
    solution: orders(', shards: 4, partitioning: consistent'),
    hint: 'hash mod N moves almost every key when N changes. Consistent hashing moves only what the new shard takes over.',
  },
  {
    title: 'My orders, please',
    story: '20% of requests are “show **my** orders”. The orders are sharded by order id over 6 shards, so every one of those queries asks all six. Keep the busiest shard **under 60%** and **p99 under 100 ms**, for less.',
    scenario: `${orders(', shards: 6')}traffic: { rps: 1000, mix: { read: 0.6, write: 0.2, query: 0.2 }, keys: 100000, readKb: 0.5 }
run: { duration: 30s, warmup: 5s }
requirements:
  - util(db) < 60%
  - p99 < 100ms
  - errors < 0.1%
`,
    tuneOnly: true,
    parCost: 730,
    solution: orders(', shards: 3, shardBy: user'),
    hint: 'Partition by the key the query names: shardBy: user puts each user’s orders on one shard. Then each shard does much less, and you need fewer of them.',
  },
];
