import type { Module } from '../../../content/types';
import type { Traffic } from '../engine/types';
import { projectA } from './projectA';

/** A bookshop's API: four app servers in front of one database, 2,000 requests/s, mostly reads. */
const SHOP = (db: string, app = '', n = 4) => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: ${n}, size: medium${app} }
  db: { type: db${db} }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`;
const SHOP_T: Traffic = { rps: 2000, mix: { read: 0.95, write: 0.05 }, keys: 100_000, readKb: 0.5 };
const SHOP_RUN = `traffic: { rps: 2000, mix: { read: 0.95, write: 0.05 }, keys: 100000, readKb: 0.5 }
run: { duration: 30s, warmup: 5s }
`;
const shop = (db: string, app = '', n = 4) => SHOP(db, app, n) + SHOP_RUN;

/** The same shop, where half the users re-read what they just wrote (a profile page after saving). */
const RYW_T: Traffic = { ...SHOP_T, readAfterWrite: 0.5 };
const RYW_RUN = `traffic: { rps: 2000, mix: { read: 0.95, write: 0.05 }, keys: 100000, readKb: 0.5, readAfterWrite: 0.5 }
run: { duration: 30s, warmup: 5s }
`;

/** Write-heavy: 1,000 requests/s, half of them writes. */
const WRITES_T: Traffic = { rps: 1000, mix: { read: 0.5, write: 0.5 }, keys: 100_000, readKb: 0.5 };
const WRITES_RUN = `traffic: { rps: 1000, mix: { read: 0.5, write: 0.5 }, keys: 100000, readKb: 0.5 }
run: { duration: 30s, warmup: 5s }
`;

/** Thirty small app servers; at 10 s a spike pushes the database to its limit for 5 seconds. */
const SPIKE_T: Traffic = {
  rps: [
    [0, 800],
    [10_000, 800],
    [11_000, 1800],
    [15_000, 1800],
    [16_000, 800],
    [30_000, 800],
  ],
  mix: { read: 0.9, write: 0.1 },
  keys: 100_000,
  readKb: 0.5,
};
const POOL = (pool: string) => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 30${pool} }
  db: { type: db, size: medium }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`;
const POOL_RUN = `traffic: { rps: [[0, 800], [10s, 800], [11s, 1800], [15s, 1800], [16s, 800], [30s, 800]], mix: { read: 0.9, write: 0.1 }, keys: 100000, readKb: 0.5 }
run: { duration: 30s, warmup: 5s }
`;

/** Module 5: databases at scale. Checked by tests/sd-content.test.ts. */
export const s05: Module = {
  id: 's05',
  number: 5,
  title: 'Databases at scale',
  tagline: 'Choose a database, spread reads over replicas, live with replication lag, keep read-your-writes, and size connection pools.',
  games: [],
  project: projectA,
  concepts: [
    {
      id: 's05-choose',
      title: 'SQL or NoSQL?',
      card: `Pick a database by **how you access the data** and **what must never go wrong**, not by fashion.

| | Relational (PostgreSQL, MySQL) | Key-value / document / wide-column (DynamoDB, MongoDB, Cassandra) |
|---|---|---|
| Data | Tables, relations, constraints | Items looked up by a key; flexible shape |
| Queries | Any query, joins, aggregates | Mostly by key (and a few planned indexes) |
| Transactions | Multi-row ACID | Usually per item or per partition |
| Scaling | One primary for writes; replicas for reads; sharding is extra work | Built to spread by key over many machines |

Most products start relational: it is flexible while you are still learning your access patterns, and one well-sized server goes a long way. Reach for a key-value store when the access pattern is simple (get/put by key) and the volume is beyond one machine, or when you need its built-in replication across regions.

The usual path for a growing relational database: **cache → read replicas → bigger primary → partitioning**. The rest of this module walks through it.`,
      example: {
        sql: shop(', size: large'),
        note: 'One large database (8 cores) handles 2,000 requests/s at about 55% busy. Try size: small (2 cores) to see where one machine ends, then medium.',
      },
      cheat: { syntax: 'access pattern + guarantees → database', note: 'Relational by default; key-value when access is by key and volume is beyond one machine.' },
    },
    {
      id: 's05-replicas',
      title: 'Read replicas',
      card: `A **read replica** is a copy of the database that follows the primary: the primary ships every change (its write-ahead log) and the replica replays it.

- **Writes** still go to the one **primary**.
- **Reads** can go to any replica, so read capacity grows with each one.
- A replica is also a warm standby: if the primary dies, one can be promoted (module 9).

Replicas help **read-heavy** systems, which most are. They do **nothing for writes**: every replica must apply every write too. When writes are the bottleneck, you need a bigger primary, fewer writes (batching, a queue) or partitioning (module 6).

In the simulator, add \`replicas: N\` to a database. Apps read from the replicas when there are any (\`readFrom: primary\` changes that).`,
      predict: {
        sql: SHOP(', replicas: 3') + WRITES_RUN,
        question: 'This app does 1,000 requests/s, **half of them writes**. The small database has 3 read replicas. Is that enough?',
        choices: ['Yes: four database servers is plenty', 'No: every write still goes to the one primary, which is overloaded', 'No: the replicas are overloaded by reads'],
        answer: 1,
        why: '500 writes/s at 6 ms each is 3 cores of work, and a small primary has 2. The replicas sit mostly idle with 500 reads/s between them. Replicas scale reads, never writes.',
        verify: ['errors > 5%', 'util(db) > 95%'],
      },
      example: {
        sql: shop(', replicas: 3'),
        note: 'Reads are spread over three replicas; the primary only takes writes. Try replicas: 0, 1 and 2 and watch the database’s utilisation and the p99.',
      },
      cheat: { syntax: 'replicas: N', note: 'Replicas add read capacity. Writes all go to the primary.' },
    },
    {
      id: 's05-lag',
      title: 'Replication lag',
      card: `Replication is usually **asynchronous**: the primary confirms a write as soon as it has it, then ships it to the replicas. The delay until a replica has it is the **replication lag**.

- Normally milliseconds.
- Seconds when the network is slow, the replica is busy, or writes arrive faster than the replica can apply them (it replays them one at a time).

During the lag, a read from a replica returns the **old** value: a **stale read**. For a product description that's harmless. For a balance, a stock count or "did my payment go through", it isn't.

Watch the lag (every managed database graphs it) and decide, per read, whether slightly old data is acceptable.`,
      predict: {
        sql: SHOP(', replicas: 3, replicationLagMs: 1000') + RYW_RUN,
        question: 'The replicas fall about **a second** behind the primary. Products change 100 times a second. Roughly how many stale reads in 25 seconds?',
        choices: ['None: replicas are copies', 'A handful', 'Thousands'],
        answer: 2,
        why: 'Every read of a product updated in the last second, served by a replica, is stale. Popular products are both read and updated often, so that adds up to thousands.',
        verify: ['staleReads > 5000'],
      },
      example: {
        sql: SHOP(', replicas: 3, replicationLagMs: 1000') + RYW_RUN,
        note: 'Count the stale reads. Then try replicationLagMs: 50 (a healthy replica): fewer, but not zero.',
      },
      cheat: { syntax: 'async replication → stale reads', note: 'Replicas lag; decide per read whether old data is OK.' },
    },
    {
      id: 's05-ryw',
      title: 'Read-your-writes',
      card: `The stale read users notice most is their **own** change: save your profile, the page reloads from a replica… and shows the old one. The guarantee that prevents it is **read-your-writes** (read-after-write consistency).

Ways to get it:

1. **Read your own recent data from the primary**: e.g. for a few seconds after a user writes, or for "my" pages only. Most reads still use replicas.
2. **Wait for the replicas** before confirming the write (**synchronous** replication). Each write waits a little longer (a network round trip in one region, far more across regions), but every replica is up to date when the user is told "saved". The catch: if a synchronous replica goes down, writes wait for it (module 8).
3. **Write through a cache** the reads check first, so the new value is there immediately.
4. Remember the write's position in the log and only read from a replica that has reached it.

In the simulator: \`readFrom: primary\` on the app sends **all** its reads to the primary, and \`syncReplicas: N\` on the database makes writes wait for N replicas. The result shows "didn't see own write" when it goes wrong.`,
      predict: {
        sql: SHOP(', replicas: 3') + RYW_RUN,
        question: 'Half the users re-read an item right after changing it. Reads go to 3 replicas with a normal ~50 ms lag. Do users always see their own change?',
        choices: ['Yes: 50 ms is too short to notice', 'No: some re-reads reach a replica that hasn’t applied the write yet', 'No: every re-read is stale'],
        answer: 1,
        why: 'Most re-reads happen after the lag and are fine, but a few hundred land on a replica that hasn’t caught up, and the user sees their change undone.',
        verify: ['rywViolations > 100'],
      },
      example: {
        sql: SHOP(', replicas: 3, syncReplicas: 3') + RYW_RUN,
        note: 'With syncReplicas: 3, every write waits until all replicas have applied it: no missed own writes, for a millisecond or two per write. Try syncReplicas: 1: the other two replicas still lag. Then try readFrom: primary on the app instead: what happens to the primary?',
      },
      cheat: { syntax: 'readFrom: primary · syncReplicas: N', note: 'Read-your-writes: read own data from the primary, or wait for the replicas.' },
    },
    {
      id: 's05-pool',
      title: 'Connection pools',
      card: `Opening a database connection is slow (a TCP and TLS handshake, authentication, a server process), so each app server keeps a **pool** of open connections and reuses them.

Every connection also costs the database memory: PostgreSQL defaults to **100** connections, and each is a process. The arithmetic that bites:

> app servers × pool size per server ≤ the database's connection limit

30 servers × 10 connections = 300 possible connections. That is fine when queries are quick, and a disaster in a spike: queries slow down, every server opens more connections, and the database starts **refusing** them. "Too many connections" errors pile on top of the slowdown.

Fixes:
- **Smaller pools per server**, so the total stays under the limit; requests wait briefly in the app instead.
- A **connection pooler** (PgBouncer, RDS Proxy) between the apps and the database.
- Re-check the math whenever autoscaling can add servers.`,
      predict: {
        sql: POOL('') + POOL_RUN,
        question: '30 app servers, each with a pool of up to 10 connections; the database accepts 100. A 5-second spike pushes the database to its limit. What happens?',
        choices: ['Requests just wait a little longer', 'The database refuses connections, and those requests fail', 'Nothing: the database is only half busy on average'],
        answer: 1,
        why: 'During the spike, queries queue at the database and each waiting query holds a connection. The servers together try to open up to 300; the database stops at 100 and refuses the rest.',
        verify: ['errors > 1%'],
      },
      example: {
        sql: POOL(', dbPool: 3') + POOL_RUN,
        note: 'With dbPool: 3, the servers can open at most 90 connections. Requests queue in the app during the spike instead of failing. Compare with dbPool: 10.',
      },
      cheat: { syntax: 'servers × dbPool ≤ max connections', note: 'Size pools so the total fits; use a pooler when it can’t.' },
    },
  ],
  practice: [
    {
      id: 's05-p1',
      kind: 'readQuery',
      conceptIds: ['s05-replicas'],
      prompt: 'Your database’s primary is at 100% CPU. **40%** of its work is writes. A colleague proposes adding two read replicas. What will happen?',
      choices: ['The primary drops to about 40% busy, since reads move to the replicas', 'Nothing changes: replicas only help writes', 'The primary is still overloaded: replicas also apply every write'],
      answer: 0,
      hints: ['Where do reads go once there are replicas? Where do writes go?'],
      explanation: 'Reads move to the replicas, so the primary keeps only its write work: about 40% busy. That’s a real relief, but writes stay on the primary, so this only buys time if writes keep growing.',
    },
    {
      id: 's05-p2',
      kind: 'fixBug',
      conceptIds: ['s05-replicas'],
      prompt: 'The bookshop’s database is overwhelmed by reads. Give it enough **read replicas** that **p99 < 90 ms** with no errors.',
      starterSql: SHOP(''),
      solution: SHOP(', replicas: 3'),
      wrongExample: SHOP(', replicas: 1'),
      hints: ['1,900 reads/s at 2 ms each is 3.8 cores of work. A small replica has 2.', 'Keep each replica well under 100% busy, or the queueing shows up in the p99.'],
      explanation: 'Reads need about 3.8 cores. Two small replicas (4 cores) would run at 95%, where queues explode; **three** run at about 63% and the p99 is around 70 ms. The primary keeps only the writes.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: SHOP_T, durationMs: 30_000, warmupMs: 5_000, requirements: ['p99 < 90ms', 'errors < 0.1%'] } },
    },
    {
      id: 's05-p3',
      kind: 'write',
      conceptIds: ['s05-replicas'],
      prompt: 'Each replica serves **800 reads/s** comfortably. You need **6,000 reads/s**. How many replicas?',
      solution: '8',
      wrongExample: '4',
      hints: ['6,000 ÷ 800, rounded up.'],
      explanation: '6,000 ÷ 800 = 7.5, so **8** replicas (and in practice one more, so losing one doesn’t overload the rest).',
      sd: { target: 'estimate', unit: 'replicas', tolerance: 0.1 },
    },
    {
      id: 's05-p4',
      kind: 'readQuery',
      conceptIds: ['s05-lag'],
      prompt: 'Users report that product updates take “about a second” to show up. The simulator ran the system. **What is going on?**',
      sql: SHOP(', replicas: 3, replicationLagMs: 1000') + RYW_RUN,
      choices: ['The database is overloaded', 'Reads come from replicas that are about a second behind the primary', 'The cache has a 1-second TTL', 'The network is slow'],
      answer: 1,
      verify: ['staleReads > 5000', 'util(db) < 80%', 'p99 < 100ms'],
      hints: [],
      explanation: 'Nothing is overloaded and latency is fine, but thousands of reads are stale: replication lag. There is no cache in this design. Look at the replicas’ lag in the components table.',
    },
    {
      id: 's05-p5',
      kind: 'fixBug',
      conceptIds: ['s05-ryw'],
      prompt: 'Users who save a change and reload sometimes see the old version. Make sure **nobody misses their own write**, with **no errors** and **p99 under 400 ms**. You can change settings only.',
      starterSql: SHOP(', replicas: 3'),
      solution: SHOP(', replicas: 3, syncReplicas: 3'),
      wrongExample: SHOP(', replicas: 3', ', readFrom: primary'),
      hints: ['Sending every read to the primary undoes what the replicas were for.', 'Can a write wait until the replicas have it?'],
      explanation: '**syncReplicas: 3** makes each write wait until all three replicas have applied it, so any later read sees it. Writes get slower (watch the p99), but reads keep using the replicas. `readFrom: primary` sends all 1,900 reads/s to a small primary, which collapses.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: RYW_T, durationMs: 30_000, warmupMs: 5_000, requirements: ['rywViolations = 0', 'errors < 0.1%', 'p99 < 400ms'] } },
    },
    {
      id: 's05-p6',
      kind: 'fillBlank',
      conceptIds: ['s05-pool'],
      prompt: '30 app servers share a database that accepts **100 connections**. Fill in each server’s pool size so a spike causes **no errors** (p99 under 500 ms).',
      starterSql: POOL(', dbPool: ___'),
      solution: POOL(', dbPool: 3'),
      wrongExample: POOL(', dbPool: 10'),
      hints: ['30 × pool must stay at or below 100.'],
      explanation: '30 × 3 = 90 connections at most, under the limit of 100. In the spike, requests wait briefly for a free connection in the app instead of being refused by the database. With 10, the servers try to open up to 300.',
      sd: { target: 'design', run: { traffic: SPIKE_T, durationMs: 30_000, warmupMs: 5_000, requirements: ['errors < 0.1%', 'p99 < 500ms'] } },
    },
    {
      id: 's05-p7',
      kind: 'write',
      conceptIds: ['s05-pool'],
      prompt: 'Autoscaling can grow your API to **50 servers**. The database allows **100 connections**, and you keep 10 for admin tools. What is the largest pool size per server?',
      solution: '1.8',
      wrongExample: '10',
      hints: ['(100 − 10) ÷ 50.'],
      explanation: '90 ÷ 50 = **1.8**, so in practice 1 per server, or a connection pooler between the servers and the database so the servers can keep larger pools.',
      sd: { target: 'estimate', unit: 'connections', tolerance: 0.15 },
    },
    {
      id: 's05-p8',
      kind: 'parsons',
      conceptIds: ['s05-choose', 's05-replicas'],
      prompt: 'A relational database is running out of capacity. Put the usual steps in the order you’d try them (cheapest and simplest first).',
      blocks: ['Find and fix the slow queries (indexes)', 'Cache hot reads', 'Add read replicas', 'Move to a bigger primary', 'Partition the data across several databases'],
      wrongOrder: ['Partition the data across several databases', 'Find and fix the slow queries (indexes)', 'Cache hot reads', 'Add read replicas', 'Move to a bigger primary'],
      hints: ['Partitioning is powerful but changes how the whole application works.'],
      explanation: 'Each step is more work and more moving parts than the one before. Partitioning comes last because every query must then know where its data lives.',
    },
    {
      id: 's05-p9',
      kind: 'write',
      conceptIds: ['s05-replicas', 's05-ryw'],
      prompt: 'Design the bookshop’s database tier for **2,000 requests/s** where half the users re-read what they just changed. Meet **p99 < 100 ms**, **no errors**, **no missed own writes**, for **under $850 a month**.',
      starterSql: SHOP(''),
      solution: SHOP(', size: large'),
      wrongExample: SHOP(', replicas: 3'),
      hints: ['Replicas lag, and that breaks read-your-writes unless writes wait for them.', 'A single database has no lag at all. How big must it be?'],
      explanation: 'Two designs pass. A **large** primary (8 cores) handles the whole load at about 55% with no replicas, so there’s no lag to break read-your-writes. Or keep **3 replicas with syncReplicas: 3**: every replica has each write before it is confirmed. Replicas alone break read-your-writes, and so does syncReplicas: 1 (the other replicas still lag). Sync replication’s price is availability: if a sync replica dies, writes wait for it.',
      sd: { target: 'design', run: { traffic: RYW_T, durationMs: 30_000, warmupMs: 5_000, requirements: ['p99 < 100ms', 'errors < 0.1%', 'rywViolations = 0', 'cost < $850'] } },
    },
    {
      id: 's05-p10',
      kind: 'readQuery',
      conceptIds: ['s05-choose'],
      prompt: 'A shopping cart service: carts are read and written **by user id only**, about **50,000 times a second** at peak, and must work in three regions. Which fits best?',
      choices: ['A key-value store partitioned by user id', 'One large relational database with many joins', 'A data warehouse', 'A message queue'],
      answer: 0,
      hints: ['What is the access pattern? How much traffic?'],
      explanation: 'The access is always “get/put the cart of user X”, the volume is beyond one machine, and it needs multi-region replication: exactly what key-value stores (DynamoDB, Cassandra) are built for.',
    },
  ],
  test: [
    {
      id: 's05-t1',
      kind: 'readQuery',
      conceptIds: ['s05-replicas'],
      prompt: 'Writes have grown to more than the primary can handle. Which change helps?',
      choices: ['Add more read replicas', 'Move the primary to a bigger machine (or partition the data)', 'Add a cache in front of reads', 'Lower the replication lag'],
      answer: 1,
      hints: [],
      explanation: 'Every write lands on the primary, and replicas and caches don’t take any of them. A bigger primary buys time; partitioning spreads writes over several primaries.',
    },
    {
      id: 's05-t2',
      kind: 'readQuery',
      conceptIds: ['s05-ryw', 's05-lag'],
      prompt: 'After posting a comment, a user refreshes and the comment is missing; a second later it appears. Reads go to replicas. What is this, and what fixes it?',
      choices: [
        'A lost write: retry the insert',
        'A read-your-writes violation: read the user’s own recent data from the primary (or wait for replicas on write)',
        'A cache stampede: add single-flight',
        'Too many connections: lower the pool size',
      ],
      answer: 1,
      hints: [],
      explanation: 'The write succeeded on the primary; the refresh hit a replica that hadn’t applied it yet. Route the user’s own recent reads to the primary, or make the write wait for the replicas.',
    },
    {
      id: 's05-t3',
      kind: 'write',
      conceptIds: ['s05-pool'],
      prompt: 'Each app server keeps a pool of **20** connections, and the database allows **200**. How many app servers can you run before the database may refuse connections?',
      solution: '10',
      wrongExample: '20',
      hints: ['servers × pool ≤ limit.'],
      explanation: '200 ÷ 20 = **10** servers. Beyond that, a busy moment can open more connections than the database allows.',
      sd: { target: 'estimate', unit: 'servers', tolerance: 0.1 },
    },
    {
      id: 's05-t4',
      kind: 'fixBug',
      conceptIds: ['s05-replicas'],
      prompt: 'Half the traffic is writes and the database is failing. Change settings so that **p99 < 100 ms**, **errors < 0.1%**, for **under $700 a month**.',
      starterSql: SHOP(''),
      solution: SHOP(', size: large'),
      wrongExample: SHOP(', replicas: 3'),
      hints: ['Where do writes go?', '500 writes/s × 6 ms = 3 cores, plus the reads.'],
      explanation: 'Replicas can’t take writes. A **large** primary (8 cores) does the 4 cores of work at about 50% busy. Medium (4 cores) would be at 100%.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: WRITES_T, durationMs: 30_000, warmupMs: 5_000, requirements: ['p99 < 100ms', 'errors < 0.1%', 'cost < $700'] } },
    },
    {
      id: 's05-t5',
      kind: 'readQuery',
      conceptIds: ['s05-pool'],
      prompt: 'During a traffic spike, some requests fail, yet the database never looks fully busy on average. The simulator ran it. **Why do they fail?**',
      sql: POOL('') + POOL_RUN,
      choices: ['The app servers are out of CPU', 'The database refuses new connections: 30 servers × 10 is more than its limit', 'Replication lag', 'The load balancer drops requests'],
      answer: 1,
      verify: ['errors > 1%', 'util(app) < 30%'],
      hints: [],
      explanation: 'The errors are “too many connections” at the database. In the spike, slow queries hold connections and the servers try to open more than the database allows. Smaller pools or a pooler fix it.',
    },
    {
      id: 's05-t6',
      kind: 'readQuery',
      conceptIds: ['s05-choose'],
      prompt: 'A ledger moves money between accounts: each transfer debits one account and credits another, and must never half-happen. About 300 transfers/s. Which fits best?',
      choices: ['A relational database with transactions', 'An eventually consistent key-value store', 'A cache with write-back', 'A queue with at-least-once delivery'],
      answer: 0,
      hints: [],
      explanation: 'Two rows must change together or not at all: a multi-row ACID transaction. 300/s is easy for one relational primary. Eventual consistency and write-back can lose or split the update.',
    },
  ],
};
