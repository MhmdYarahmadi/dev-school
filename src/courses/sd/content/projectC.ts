import type { Project } from '../../../content/types';
import type { Traffic } from '../engine/types';

/** Sale day: 60 requests/s, then 3,000/s (50×) for 10 seconds; 10% of requests are purchases. */
const SALE: Traffic = {
  rps: [
    [0, 60],
    [10_000, 60],
    [11_000, 3000],
    [20_000, 3000],
    [21_000, 60],
    [60_000, 60],
  ],
  mix: { read: 0.9, write: 0.1 },
  keys: 50_000,
  skew: 0.9,
  readKb: 0.5,
};

/** Steady sale traffic: seat maps and reservations (20% writes) on 5,000 seats. */
const SEATS: Traffic = { rps: 1500, mix: { read: 0.8, write: 0.2 }, keys: 5000, readKb: 0.5 };

const DIRECT = `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 6, size: medium, externalRatio: 0.1 }
  cache: { type: cache, memoryMb: 128 }
  pay: { type: external, latencyMs: 300, rateLimit: 100 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> pay
  - app -> db
`;

const LINE = `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 6, size: medium, writeVia: queue }
  cache: { type: cache, memoryMb: 128 }
  orders: { type: queue }
  worker: { type: worker, instances: 1, concurrency: 30 }
  pay: { type: external, latencyMs: 300, rateLimit: 100 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> orders
  - app -> db
  - orders -> worker
  - worker -> pay
  - worker -> cache
  - worker -> db
`;

const SEAT_DB = (db: string, app = '', az = '') => `components:
  users: { type: client }
  lb: { type: lb${az} }
  app: { type: app, instances: 4, size: medium${app}${az} }
  db: { type: db${db} }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`;
const ZONES = ', azs: [a, b, c]';

/** Project C (after module 10): flash-sale ticketing, from the spike to consistency and a zone outage. */
export const projectC: Project = {
  id: 'sd-project-c',
  title: 'Project C: a flash sale',
  story: `**Gigz** sells concert tickets. Most days are quiet, but when a big tour goes on sale, everyone arrives at the same minute: traffic jumps **50×**, every fan wants the same few thousand seats, and nobody may get a seat that someone else already bought.

Everything from the course comes together here:

- **Estimate** the spike.
- **Absorb** it with a waiting line instead of falling over.
- **Never oversell**: the seat a fan sees as free must really be free.
- **Survive** losing a whole zone at the peak, without losing a single sale.

Real ticketing systems (Ticketmaster's queue, airline inventory) use exactly these ideas: a virtual waiting room, strongly consistent inventory, and redundancy across zones.`,
  tasks: [
    {
      id: 'sdc-1',
      prompt: 'Tickets go on sale at 10:00. **1 million fans** arrive in the **first 2 minutes**, and each makes about **5 requests** (load the page, pick seats, check out). What is the average **requests per second** during those 2 minutes?',
      requirements: [{ label: 'Within 25% of the estimate', sql: 'estimate' }],
      referenceSolution: '41667',
      discussion: `5 million requests ÷ 120 seconds ≈ **42,000 requests/s**, and the first seconds are worse than the average. A normal day might be 200 requests/s: that's 200× more, for a few minutes.

You can't keep 200× capacity idle all year, and autoscaling takes minutes. So flash sales are designed around **admission**: let people in at the rate the system can handle and make the rest wait in line, honestly.`,
      hints: ['Total requests: fans × requests each.', 'Two minutes is 120 seconds.'],
      sd: { target: 'estimate', unit: 'requests/s' },
    },
    {
      id: 'sdc-2',
      prompt: `**The waiting line.** At 10 s, traffic jumps from 60 to **3,000 requests/s** (50×) for 10 seconds; 10% are purchases, and each purchase charges a card through the payment provider, which accepts at most **100 calls a second** (more get 429).

Right now the app charges cards while the fan waits: a third of the purchases fail. Accept **every** purchase (**errors < 0.1%**, **p99 < 200 ms**), charge each one within **40 s** (p99 message delay), with no purchase ending up in a dead-letter queue.`,
      requirements: [
        { label: 'Errors under 0.1%', sql: 'errors < 0.1%' },
        { label: 'p99 under 200 ms', sql: 'p99 < 200ms' },
        { label: 'Every purchase charged within 40 s', sql: 'messageP99 < 40s' },
        { label: 'No purchase dead-lettered', sql: 'dlq = 0' },
      ],
      referenceSolution: LINE,
      discussion: `No amount of servers fixes this: the bottleneck is the payment provider's **100 calls/s**. 300 purchases a second for 10 seconds is 3,000 charges, which take at least 30 seconds at that rate.

- **Queue the purchases** (\`writeVia: queue\`): the fan gets “you're in line, we'll confirm by email” at once, and nothing is lost.
- **Workers charge at the provider's pace**: 100 calls/s × 0.3 s = 30 in progress, so one worker with \`concurrency: 30\`. More concurrency gets 429s, and those messages wait for the visibility timeout to be retried.

That queue **is** the waiting room. Real sites also put it at the front door: a page that admits fans in order, so even browsing load stays bounded.`,
      hints: ['What limits you: the servers, the database, or the provider?', 'Put purchases on a queue and let workers call the payment provider.', 'Little’s law: 100 calls/s × 0.3 s each.'],
      sd: { target: 'design', starter: DIRECT, run: { traffic: SALE, durationMs: 60_000, warmupMs: 5_000, warmCache: true } },
    },
    {
      id: 'sdc-3',
      prompt: `**Never oversell.** During the sale, **1,500 requests/s**: fans load the seat map and reserve seats (20% of requests) among **5,000 seats**. Reads go to two read replicas, and fans see seats as free that were just taken: they pick them, and the purchase fails or, worse, both get the seat.

Make every seat read **up to date** (**stale reads = 0**), with **p99 < 200 ms**, **errors < 0.1%**, **under $750 a month**.`,
      requirements: [
        { label: 'No stale seat reads', sql: 'staleReads = 0' },
        { label: 'p99 under 200 ms', sql: 'p99 < 200ms' },
        { label: 'Errors under 0.1%', sql: 'errors < 0.1%' },
        { label: 'Under $750 a month', sql: 'cost < $750' },
      ],
      referenceSolution: SEAT_DB(', replicas: 2, syncReplicas: 2'),
      discussion: `Async replicas lag, so a seat sold a moment ago still shows as free there. Two ways to fix it:

- **Synchronous replicas** (\`syncReplicas: 2\`): a reservation is confirmed only when every replica has it, so reads anywhere are current. The cost: if a replica dies, reservations wait for it.
- **One bigger primary** that takes all reads (a large database, 8 cores): no lag at all, about $70 more.

Reading from the primary only (\`readFrom: primary\`) with the small database overloads it.

Up-to-date reads aren't the whole story. Two fans can still pick the same free seat at the same moment, so the reservation itself must be **atomic**: \`UPDATE seats SET holder = ? WHERE id = ? AND holder IS NULL\`, and only one of them succeeds. Consistency in the database, not in the app.`,
      hints: ['Where do the stale reads come from?', 'Either make the replicas current before confirming, or don’t read from replicas.'],
      sd: { target: 'design', starter: SEAT_DB(', replicas: 2'), run: { traffic: SEATS, durationMs: 30_000, warmupMs: 5_000 } },
    },
    {
      id: 'sdc-4',
      prompt: `**A zone goes down at the peak.** At 10 s, availability zone **a** loses power, mid-sale. Today everything runs in zone a: one large database, read from the primary so seats are never stale.

From 15 s on: **errors < 0.1%** and **p99 < 200 ms**. **No sold seat may be forgotten** (lost writes = 0, or the seat is sold twice), seats are still never stale, and it costs **under $1,400 a month**.`,
      requirements: [
        { label: 'No errors after the zone fails', sql: 'outage: errors < 0.1%' },
        { label: 'p99 under 200 ms after it fails', sql: 'outage: p99 < 200ms' },
        { label: 'No sold seat forgotten', sql: 'lostWrites = 0' },
        { label: 'No stale seat reads', sql: 'staleReads = 0' },
        { label: 'Under $1,400 a month', sql: 'cost < $1400' },
      ],
      referenceSolution: SEAT_DB(`, size: large, replicas: 2, syncReplicas: 1, failoverMs: 3000${ZONES}`, ', readFrom: primary', ZONES),
      discussion: `Every layer needs a copy outside zone a:

- **Load balancer and app servers** in several zones (\`azs\`).
- **Database replicas** in other zones, promoted automatically (\`failoverMs\`).
- **One synchronous replica**: an async replica can be promoted without the last sales, and those seats get sold again.

Why **three** zones? With two, the primary and one replica, the surviving replica is promoted and then has **no one left to sync to**: with \`syncReplicas: 1\`, every write waits. With three zones and two replicas, one remains to confirm writes after the promotion (PostgreSQL's “FIRST 1” picks the next available one). Majority-based systems (Raft, Spanner) need three for the same reason.

Each zone also needs capacity for the load when another zone is gone: here four app servers over three zones still leave enough after zone a's go.`,
      hints: ['Which components are only in zone a?', 'Which replica becomes the primary, and does it have every sold seat?', 'After the promotion, is there still a replica that can confirm writes? Try three zones.'],
      sd: {
        target: 'design',
        starter: SEAT_DB(', size: large', ', readFrom: primary'),
        run: { traffic: SEATS, durationMs: 30_000, warmupMs: 5_000, events: [{ atMs: 10_000, action: 'azDown', az: 'a' }], phases: [{ name: 'outage', fromMs: 15_000, toMs: 30_000 }] },
      },
    },
  ],
};
