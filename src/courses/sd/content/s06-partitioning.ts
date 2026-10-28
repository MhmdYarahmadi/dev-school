import type { Module } from '../../../content/types';
import type { Traffic } from '../engine/types';

/** An orders service: six app servers (5 DB connections each) in front of a database that may be split into shards. */
const ORDERS = (db: string, cache = false) => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 6, size: medium, dbPool: 5 }
${cache ? '  cache: { type: cache, memoryMb: 32 }\n' : ''}  db: { type: db${db} }
connections:
  - users -> lb
  - lb -> app
${cache ? '  - app -> cache\n' : ''}  - app -> db
`;
const RUN = 'run: { duration: 30s, warmup: 5s }\n';

/** Write-heavy: 2,000 requests/s, half of them writes. */
const WRITES_T: Traffic = { rps: 2000, mix: { read: 0.5, write: 0.5 }, keys: 100_000, readKb: 0.5 };
const WRITES = `traffic: { rps: 2000, mix: { read: 0.5, write: 0.5 }, keys: 100000, readKb: 0.5 }\n${RUN}`;

/** New orders get increasing ids (like timestamps or auto-increment). */
const SEQ_T: Traffic = { ...WRITES_T, sequentialWrites: true };
const SEQ = `traffic: { rps: 2000, mix: { read: 0.5, write: 0.5 }, keys: 100000, readKb: 0.5, sequentialWrites: true }\n${RUN}`;

/** From 10 s, one item gets 60% of all reads (a viral product). */
const HOT_T: Traffic = { rps: 2000, mix: { read: 0.8, write: 0.2 }, keys: 100_000, readKb: 0.5, hotKey: { share: 0.6, fromMs: 10_000 } };
const HOT = `traffic: { rps: 2000, mix: { read: 0.8, write: 0.2 }, keys: 100000, readKb: 0.5, hotKey: { share: 0.6, fromMs: 10000 } }
run: { duration: 30s, warmup: 5s }
phases:
  - { name: viral, from: 12s, to: 30s }
`;

/** At 10 s a fifth shard is added. */
const GROW_T: Traffic = { rps: 1500, mix: { read: 0.5, write: 0.5 }, keys: 100_000, readKb: 0.5 };
const GROW = `traffic: { rps: 1500, mix: { read: 0.5, write: 0.5 }, keys: 100000, readKb: 0.5 }
run: { duration: 30s, warmup: 5s }
events:
  - { at: 10s, action: addShard, node: db }
`;

/** 20% of requests are "my orders" queries (all orders of one user). */
const MINE_T: Traffic = { rps: 1000, mix: { read: 0.6, write: 0.2, query: 0.2 }, keys: 100_000, readKb: 0.5 };
const MINE = `traffic: { rps: 1000, mix: { read: 0.6, write: 0.2, query: 0.2 }, keys: 100000, readKb: 0.5 }\n${RUN}`;

/** Module 6: partitioning. Checked by tests/sd-content.test.ts. */
export const s06: Module = {
  id: 's06',
  number: 6,
  title: 'Partitioning',
  tagline: 'Split data over several databases: hash or range, hot partitions, adding shards with consistent hashing, and queries that span shards.',
  games: ['shards'],
  concepts: [
    {
      id: 's06-why',
      title: 'Why partition?',
      card: `Replicas and caches multiply **read** capacity. Every **write**, though, still lands on one primary, and all the data still lives on one machine. When either outgrows the biggest server you can buy (or afford), you **partition** (shard) the data: split it into pieces, each owned by its own primary.

- Each shard holds **a part of the keys** and takes **only their writes**.
- A **partition key** (order id, user id, tenant id…) decides which shard owns each row.
- Each shard can still have its own replicas.

The price: every query must know which shard to ask, transactions across shards get hard, and adding shards later means moving data. That's why it comes **last** on the scaling path.

In the simulator: \`shards: N\` on a database. Each shard is a primary of the database's size, plus its replicas.`,
      predict: {
        sql: ORDERS('') + WRITES,
        question: 'An orders service does 2,000 requests/s, **half of them writes**, on one small database. What happens?',
        choices: ['It copes: writes are quick', 'It collapses: most requests fail', 'Only the reads are slow'],
        answer: 1,
        why: '1,000 writes/s × 6 ms is 6 cores of work, plus 2 cores of reads. A small database has 2 cores. Requests queue until the app servers start rejecting them.',
        verify: ['errors > 50%', 'util(db) > 95%'],
      },
      example: {
        sql: ORDERS(', shards: 6') + WRITES,
        note: 'Six shards share the work. Try 4, 5, 6 and 8. Notice that the busiest shard is busier than the average: popular orders are not spread perfectly evenly.',
      },
      cheat: { syntax: 'shards: N', note: 'Partitioning spreads writes and data; each shard owns a part of the keys.' },
    },
    {
      id: 's06-hash-range',
      title: 'Hash or range?',
      card: `How does a key find its shard?

**Range partitioning**: each shard owns a range: ids 0–99,999 on shard 1, 100,000–199,999 on shard 2, …
- ✅ Range queries ("orders from last week") hit one or two shards.
- ❌ If new keys always increase (timestamps, auto-increment ids), **every new write goes to the last shard**: a hot partition, while the others sit idle.

**Hash partitioning**: shard = hash(key) mod N.
- ✅ Keys, old and new, spread evenly.
- ❌ A range query must ask every shard.

Rule of thumb: hash by default; range only when range scans matter **and** the key doesn’t grow monotonically (or prefix it with something that spreads, like a user id).

In the simulator: \`partitioning: hash | range | consistent\`, and \`sequentialWrites: true\` in the traffic makes new writes use increasing ids.`,
      predict: {
        sql: ORDERS(', shards: 6, partitioning: range') + SEQ,
        question: 'Six shards, **range-partitioned** by order id. New orders get increasing ids. What happens?',
        choices: ['Load spreads over the six shards', 'All new orders land on the last shard, which is overwhelmed', 'Writes are spread, but reads are not'],
        answer: 1,
        why: 'Every new id is larger than the last, so every insert falls in the last shard’s range. One shard takes all 1,000 writes/s while the other five are mostly idle.',
        verify: ['errors > 20%', 'util(db) > 95%'],
      },
      example: {
        sql: ORDERS(', shards: 6') + SEQ,
        note: 'The same ids with hash partitioning: the writes spread over all six shards. Switch to partitioning: range and compare the busiest shard.',
      },
      cheat: { syntax: 'partitioning: hash | range', note: 'Hash spreads keys evenly; range on increasing ids makes a hot last shard.' },
    },
    {
      id: 's06-hot',
      title: 'Hot keys',
      card: `Even perfect hashing can’t split **one key**. When a single item gets a large share of the traffic (a celebrity’s profile, a viral product, the one global counter), its shard does all of that work alone: a **hot partition**.

More shards don’t help: the hot key still lives on exactly one of them. What does help:

- **Cache it**: hot keys are the easiest thing to cache. One cache entry absorbs nearly all of their reads.
- **Replicas** on the shards, so the hot shard’s reads are spread over copies (with the usual lag).
- For hot **writes** (a like counter): split the key into several sub-keys (\`likes:42:0\` … \`likes:42:9\`), write to a random one and add them up on read.

Plan for skew: real traffic is never uniform, and one hot key is often what takes a sharded system down.`,
      predict: {
        sql: ORDERS(', shards: 12') + HOT,
        question: 'From 10 s, one product gets **60% of all reads**. The database has **12 shards**. What happens during the viral phase?',
        choices: ['Nothing: 12 shards share the load', 'The shard that owns the product is overwhelmed, and requests fail', 'Every shard slows down equally'],
        answer: 1,
        why: '960 reads/s × 2 ms is about 2 cores of work for that one key, all on one small shard. The other 11 shards are mostly idle, and the more shards there are, the smaller each one is relative to the hot key.',
        verify: ['viral: errors > 5%', 'util(db) > 85%'],
      },
      example: {
        sql: ORDERS(', shards: 4', true) + HOT,
        note: 'A small cache in front absorbs the hot key: four shards are enough again. Remove the cache, or raise the shards to 12, and compare.',
      },
      cheat: { syntax: 'hot key → cache / replicas / split the key', note: 'More shards never split one key.' },
    },
    {
      id: 's06-rebalance',
      title: 'Adding shards: consistent hashing',
      card: `With **hash mod N**, adding a shard changes N, and so changes the shard of **almost every key**: going from 4 to 5 shards moves about **80%** of the data. All of it has to be copied while the system is live.

**Consistent hashing** places shards and keys on a ring of hash values. Each key belongs to the next shard clockwise. Adding a shard only takes keys from its neighbours, so about **1/N** of the data moves: going from 4 to 5 shards moves about 20%.

(Real systems give each shard many points on the ring, “virtual nodes”, to keep the shares even.)

Two other common answers:
- **Many fixed partitions**: create 1,000 logical partitions up front and move whole partitions between machines (Kafka, Elasticsearch, Cassandra’s vnodes).
- **A directory**: a lookup table from key range to shard, changed one range at a time.`,
      predict: {
        sql: ORDERS(', shards: 4') + GROW,
        question: 'At 10 s a **fifth shard** is added to a database with 100,000 orders, sharded by **hash mod N**. Roughly how many orders have to move?',
        choices: ['About 20,000 (a fifth)', 'About 80,000', 'None: existing orders stay where they are'],
        answer: 1,
        why: 'A key stays only if hash mod 4 equals hash mod 5, which is true for about 1 key in 5. The other 80% move. Check “keys moved between shards” in the results.',
        verify: ['keysMoved > 70000'],
      },
      example: {
        sql: ORDERS(', shards: 4, partitioning: consistent') + GROW,
        note: 'The same growth with partitioning: consistent: about 20% of the keys move. Switch to hash and compare.',
      },
      cheat: { syntax: 'partitioning: consistent', note: 'Adding a shard moves ~1/N of the keys instead of almost all.' },
    },
    {
      id: 's06-cross',
      title: 'Choosing the partition key',
      card: `The partition key decides which queries are cheap. A query that names the key goes to **one shard**. Any other query is **scatter-gather**: ask every shard, wait for the slowest, merge.

Choose the key so that the **most frequent** queries stay on one shard:

| System | Common query | Good key |
|---|---|---|
| Shop orders | “my orders” | user id |
| Chat | messages of a conversation | conversation id |
| SaaS app | everything of one customer | tenant id |

Scatter-gather isn’t forbidden, but each one costs **every** shard some work, so adding shards doesn’t make it cheaper, and its latency is the slowest shard’s.

In the simulator: \`shardBy: user\` keeps each user’s items on one shard, so per-user queries (\`query\` in the traffic mix) hit one shard; \`shardBy: key\` (the default) spreads them by item id.`,
      predict: {
        sql: ORDERS(', shards: 6') + MINE,
        question: '20% of requests are “show my orders”. Orders are sharded by **order id** over 6 shards. What does each “my orders” query cost?',
        choices: ['One shard does the work', 'All six shards do work for every query', 'The query is served by a replica'],
        answer: 1,
        why: 'A user’s orders are spread over all shards by order id, so every shard is asked. 200 queries/s become 1,200 shard queries/s.',
        verify: ['util(db) > 55%'],
      },
      example: {
        sql: ORDERS(', shards: 6, shardBy: user') + MINE,
        note: 'Sharded by user: “my orders” goes to one shard, and the shards are half as busy. Switch to shardBy: key and compare the database’s utilisation.',
      },
      cheat: { syntax: 'shardBy: user', note: 'Partition by the key your frequent queries name; others scatter to all shards.' },
    },
  ],
  practice: [
    {
      id: 's06-p1',
      kind: 'write',
      conceptIds: ['s06-why'],
      prompt: 'Each small shard comfortably takes **300 writes/s**. You need **2,000 writes/s**. How many shards?',
      solution: '7',
      wrongExample: '3',
      hints: ['2,000 ÷ 300, rounded up.'],
      explanation: '2,000 ÷ 300 ≈ 6.7, so **7** shards. Leave room: popular keys make some shards busier than the average.',
      sd: { target: 'estimate', unit: 'shards', tolerance: 0.1 },
    },
    {
      id: 's06-p2',
      kind: 'fixBug',
      conceptIds: ['s06-why'],
      prompt: 'The orders database is overwhelmed by writes. Split it into enough **shards** for **p99 < 150 ms** and no errors, for **under $1,000 a month**.',
      starterSql: ORDERS(''),
      solution: ORDERS(', shards: 6'),
      wrongExample: ORDERS(', size: xlarge'),
      hints: ['About 8 cores of work: 1,000 writes × 6 ms plus 1,000 reads × 2 ms.', 'A small shard has 2 cores. Leave headroom for the busiest one.'],
      explanation: '**Six** small shards (12 cores) run at about 67% on average, 79% on the busiest: p99 ≈ 100 ms. Five work, but the busiest shard sits at 93% and p99 is over 300 ms. One xlarge database (16 cores) also copes, for $560 instead of $420, and it is the last size there is.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: WRITES_T, durationMs: 30_000, warmupMs: 5_000, requirements: ['p99 < 150ms', 'errors < 0.1%', 'cost < $1000'] } },
    },
    {
      id: 's06-p3',
      kind: 'readQuery',
      conceptIds: ['s06-hash-range'],
      prompt: 'An events table is keyed by **timestamp**, and you often query “the events of the last hour”. Which partitioning avoids a hot shard **and** keeps that query cheap?',
      choices: ['Range by timestamp', 'Hash of the timestamp', 'Range by (device id, timestamp): each device’s events are in time order within its range', 'One shard per day'],
      answer: 2,
      hints: ['Range by timestamp sends all new events to one shard; hashing scatters the last hour everywhere.'],
      explanation: 'Leading with the device id spreads new events over all shards, while each device’s recent events are still contiguous. “One shard per day” is range by time: today’s shard takes every write.',
    },
    {
      id: 's06-p4',
      kind: 'fixBug',
      conceptIds: ['s06-hash-range'],
      prompt: 'New orders get increasing ids, and the last shard is drowning. Fix the partitioning so that **errors < 0.1%** and **p99 < 150 ms**, without adding shards.',
      starterSql: ORDERS(', shards: 6, partitioning: range'),
      solution: ORDERS(', shards: 6, partitioning: hash'),
      wrongExample: ORDERS(', shards: 6, partitioning: range, size: medium'),
      hints: ['The problem isn’t the shards’ size; it’s which shard gets the writes.'],
      explanation: '**Hash** partitioning sends consecutive ids to different shards, so the 1,000 writes/s spread over all six. Doubling every shard’s size still leaves one shard with all the writes.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: SEQ_T, durationMs: 30_000, warmupMs: 5_000, requirements: ['errors < 0.1%', 'p99 < 150ms'] } },
    },
    {
      id: 's06-p5',
      kind: 'readQuery',
      conceptIds: ['s06-hot'],
      prompt: 'Requests start failing at 10 s, but the database as a whole is only about half busy. The simulator ran it. **What is happening?**',
      sql: ORDERS(', shards: 4') + HOT,
      choices: ['The app servers are out of CPU', 'One shard owns a suddenly hot product and is overwhelmed; the others are fine', 'Replication lag', 'The load balancer is misconfigured'],
      answer: 1,
      verify: ['viral: errors > 10%', 'util(db) > 90%', 'util(app) < 50%'],
      hints: [],
      explanation: 'The busiest shard is at 100% while the average is about 50%: a hot partition. From 10 s, one product gets 60% of the reads, and they all land on its shard.',
    },
    {
      id: 's06-p6',
      kind: 'write',
      conceptIds: ['s06-hot'],
      prompt: 'A product goes viral at 10 s and its shard collapses. Change the design so that **errors < 0.1%** and **p99 < 100 ms** during the viral phase, for **under $1,000 a month**.',
      starterSql: ORDERS(', shards: 4'),
      solution: ORDERS(', shards: 4', true),
      wrongExample: ORDERS(', shards: 12'),
      hints: ['More shards can’t split one key.', 'What absorbs repeated reads of the same item?'],
      explanation: 'A **cache** keeps the viral product in memory, so its reads never reach the database. Even 32 MB holds it. Twelve shards still leave that product on one small shard, and cost more.',
      sd: { target: 'design', run: { traffic: HOT_T, durationMs: 30_000, warmupMs: 5_000, phases: [{ name: 'viral', fromMs: 12_000, toMs: 30_000 }], requirements: ['viral: errors < 0.1%', 'viral: p99 < 100ms', 'cost < $1000'] } },
    },
    {
      id: 's06-p7',
      kind: 'write',
      conceptIds: ['s06-rebalance'],
      prompt: 'Sharding is **hash mod N**. You go from **9 to 10** shards. About what **percentage** of the keys move?',
      solution: '90',
      wrongExample: '10',
      hints: ['A key stays only if hash mod 9 = hash mod 10.', 'That’s true for about 1 key in 10.'],
      explanation: 'About 1 key in N+1 keeps its shard, so about **90%** move. With consistent hashing, only about 10% (the new shard’s share) would.',
      sd: { target: 'estimate', unit: '%', tolerance: 0.1 },
    },
    {
      id: 's06-p8',
      kind: 'fixBug',
      conceptIds: ['s06-rebalance'],
      prompt: 'A fifth shard will be added at 10 s. Moving data is expensive. Change the settings so that **fewer than 30,000 keys** move (and requests still succeed).',
      starterSql: ORDERS(', shards: 4'),
      solution: ORDERS(', shards: 4, partitioning: consistent'),
      wrongExample: ORDERS(', shards: 4, partitioning: range'),
      hints: ['With hash mod N, a change of N moves almost everything.'],
      explanation: '**Consistent hashing** moves only the keys the new shard takes over: about a fifth. Range partitioning moves even more here, because every range boundary shifts.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: GROW_T, durationMs: 30_000, warmupMs: 5_000, events: [{ atMs: 10_000, action: 'addShard', node: 'db' }], requirements: ['keysMoved < 30000', 'errors < 0.1%'] } },
    },
    {
      id: 's06-p9',
      kind: 'fillBlank',
      conceptIds: ['s06-cross'],
      prompt: '20% of requests are “show my orders”. Fill in the partition key so those queries hit **one shard**, keeping the busiest shard **under 45%**.',
      starterSql: ORDERS(', shards: 6, shardBy: ___'),
      solution: ORDERS(', shards: 6, shardBy: user'),
      wrongExample: ORDERS(', shards: 6, shardBy: key'),
      hints: ['“My orders” names the user, not an order.'],
      explanation: 'With **shardBy: user**, all of a user’s orders live on one shard, so the query asks one shard instead of six. The shards drop from about 60% to about 30% busy.',
      sd: { target: 'design', run: { traffic: MINE_T, durationMs: 30_000, warmupMs: 5_000, requirements: ['util(db) < 45%', 'errors < 0.1%'] } },
    },
    {
      id: 's06-p10',
      kind: 'parsons',
      conceptIds: ['s06-rebalance'],
      prompt: 'Put the steps of moving a range of keys to a new shard, **without downtime**, in order.',
      blocks: ['Create the new shard', 'Copy the range’s existing rows to it', 'Replicate changes made to the range during the copy', 'Switch routing for the range to the new shard', 'Delete the range from the old shard'],
      wrongOrder: ['Create the new shard', 'Switch routing for the range to the new shard', 'Copy the range’s existing rows to it', 'Replicate changes made to the range during the copy', 'Delete the range from the old shard'],
      hints: ['Never route reads to a shard that doesn’t have the data yet.'],
      explanation: 'Copy first, keep copying new changes, switch only when the new shard is caught up, and clean up last. Switching early serves reads from an empty shard.',
    },
  ],
  test: [
    {
      id: 's06-t1',
      kind: 'readQuery',
      conceptIds: ['s06-rebalance'],
      prompt: 'Why do systems that add and remove nodes often (caches, Cassandra, DynamoDB) use **consistent hashing**?',
      choices: ['It spreads keys more evenly than hash mod N', 'Adding or removing a node moves only about 1/N of the keys', 'It makes range queries cheap', 'It avoids hot keys'],
      answer: 1,
      hints: [],
      explanation: 'With mod N, changing N remaps almost every key: a cache would lose nearly all its hits, a database would copy nearly all its data. Consistent hashing moves only the share the new node takes.',
    },
    {
      id: 's06-t2',
      kind: 'write',
      conceptIds: ['s06-why'],
      prompt: 'You will store **4 TB**, and you want each shard to hold at most **500 GB**. How many shards?',
      solution: '8',
      wrongExample: '4',
      hints: ['4,000 GB ÷ 500 GB.'],
      explanation: '4,000 ÷ 500 = **8** shards (and more later, as the data grows).',
      sd: { target: 'estimate', unit: 'shards', tolerance: 0.1 },
    },
    {
      id: 's06-t3',
      kind: 'readQuery',
      conceptIds: ['s06-cross'],
      prompt: 'A chat app stores messages. The most common query is “the latest 50 messages of this conversation”. Which partition key?',
      choices: ['Message id', 'Sender id', 'Conversation id', 'Timestamp'],
      answer: 2,
      hints: [],
      explanation: 'Partition by **conversation id** and the most frequent query reads one shard. By message id or timestamp it would ask every shard. By sender, a conversation’s messages would be spread over its members’ shards.',
    },
    {
      id: 's06-t4',
      kind: 'fixBug',
      conceptIds: ['s06-hot'],
      prompt: 'A viral product overwhelms its shard. Without adding components, change the settings so that **errors < 0.1%** in the viral phase.',
      starterSql: ORDERS(', shards: 4'),
      solution: ORDERS(', shards: 4, replicas: 2'),
      wrongExample: ORDERS(', shards: 12'),
      hints: ['The hot shard needs more copies of its data to read from.'],
      explanation: 'With **2 replicas** per shard, the hot product’s reads are spread over its shard’s two replicas. More shards don’t split one key. (A cache would be cheaper, but this round allows settings only. Notice the stale reads replicas bring.)',
      sd: { target: 'design', tuneOnly: true, run: { traffic: HOT_T, durationMs: 30_000, warmupMs: 5_000, phases: [{ name: 'viral', fromMs: 12_000, toMs: 30_000 }], requirements: ['viral: errors < 0.1%'] } },
    },
    {
      id: 's06-t5',
      kind: 'readQuery',
      conceptIds: ['s06-cross'],
      prompt: 'Every shard is busier than expected, though writes are spread evenly. 20% of requests list a user’s orders. The simulator ran it. **Why?**',
      sql: ORDERS(', shards: 6') + MINE,
      choices: ['Range partitioning', 'Each “my orders” query is sent to all six shards, because orders are sharded by order id', 'A hot key', 'Replication lag'],
      answer: 1,
      verify: ['util(db) > 55%', 'errors < 0.1%'],
      hints: [],
      explanation: 'Sharded by order id, a user’s orders are everywhere: each query costs all six shards some work. Sharding by user id puts them on one shard.',
    },
    {
      id: 's06-t6',
      kind: 'readQuery',
      conceptIds: ['s06-hash-range'],
      prompt: 'Which partitioning sends every new row to the **same** shard?',
      choices: ['Hash of a random UUID', 'Range on an auto-increment id', 'Hash of the user id', 'Consistent hashing of the order id'],
      answer: 1,
      hints: [],
      explanation: 'Auto-increment ids only grow, so with range partitioning every insert lands in the last range. The hashed options spread new rows over all shards.',
    },
  ],
};
