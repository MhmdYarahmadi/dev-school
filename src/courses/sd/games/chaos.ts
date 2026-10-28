import type { SdLevel } from './rounds';

/** Checkout: a share of requests call a payment provider (100 ms). */
const checkout = (edge: string, app = '', db = '', lb = '') => `components:
  users: { type: client }
  lb: { type: lb${lb} }
  app: { type: app, instances: 4, size: medium, externalRatio: 0.2${app} }
  pay: { type: external, latencyMs: 100 }
  db: { type: db, size: medium${db} }
connections:
  - users -> lb
  - lb -> app
  - app -> pay${edge ? `: { ${edge} }` : ''}
  - app -> db
`;

/** A shop API in front of one database. */
const shop = (n: number, az: string, db: string) => `components:
  users: { type: client }
  lb: { type: lb${az} }
  app: { type: app, instances: ${n}, size: medium${az} }
  db: { type: db, size: medium${db} }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`;

/** Four small app servers reading from a medium database, retrying timed-out queries at once. */
const reads = (app: string) => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4${app} }
  db: { type: db, size: medium }
connections:
  - users -> lb
  - lb -> app
  - app -> db: { timeoutMs: 100, retries: 3 }
`;

/** A public API; optionally a rate limiter in front. */
const api = (n: number, gate: string) => `components:
  users: { type: client }
${gate ? `  gate: { type: ratelimiter, ${gate} }\n` : ''}  lb: { type: lb }
  app: { type: app, instances: ${n}, size: medium }
  db: { type: db, size: medium }
connections:
${gate ? '  - users -> gate\n  - gate -> lb\n' : '  - users -> lb\n'}  - lb -> app
  - app -> db
`;

/** Chaos Day (after module 9): injected failures; spend the budget on the right safeguards. */
export const CHAOS_LEVELS: SdLevel[] = [
  {
    title: 'Stuck in checkout',
    story: 'At **10 s** the payment provider stalls: each call takes **5 seconds**. A fifth of requests pay; the rest just browse, yet the whole site goes down. Keep **p99 under 300 ms** and **errors under 25%** while it’s stuck. The provider bills **every call**, even the ones that time out.',
    scenario: `${checkout('')}traffic: { rps: 600, keys: 10000 }
run: { duration: 30s, warmup: 5s }
events:
  - { at: 10s, action: slow, node: pay, factor: 50 }
phases:
  - { name: stuck, from: 12s, to: 30s }
requirements:
  - "stuck: p99 < 300ms"
  - "stuck: errors < 25%"
`,
    tuneOnly: true,
    parCost: 1050,
    solution: checkout('timeoutMs: 300, breaker: { failures: 5, resetMs: 5000 }'),
    hint: 'Without a timeout, every thread ends up waiting 5 s on the provider: give the connection to pay a short timeout. To stop paying for calls that can’t succeed, add a circuit breaker: once open, it doesn’t call the provider at all.',
  },
  {
    title: 'Zone a goes dark',
    story: 'Six app servers and a database, all in zone **a**. At **10 s** the zone loses power. Survive it: **no errors from 15 s on**, **p99 under 200 ms**. Six servers in one building weren’t redundancy; maybe you need fewer, in the right places.',
    scenario: `${shop(6, '', '')}traffic: { rps: 800, mix: { read: 0.8, write: 0.2 }, keys: 10000 }
run: { duration: 30s, warmup: 5s }
events:
  - { at: 10s, action: azDown, az: a }
phases:
  - { name: outage, from: 15s, to: 30s }
requirements:
  - "outage: errors < 0.1%"
  - p99 < 200ms
`,
    tuneOnly: true,
    parCost: 860,
    solution: shop(4, ', azs: [a, b]', ', replicas: 1, failoverMs: 3000, azs: [a, b]'),
    hint: 'Spread the load balancer and apps over zones a and b (azs: [a, b]). The database needs a replica in zone b that is promoted automatically (replicas: 1, failoverMs, azs). Four apps are plenty for 800 requests/s.',
  },
  {
    title: 'The queue that never empties',
    story: 'The database is slow for just **3 seconds** (10–13 s). Ten seconds later the site is **still down**: the app servers’ request queues hold thousands of requests whose users have long given up, and the clients’ retries keep refilling them. Make sure there are **no errors from 20 s on**.',
    scenario: `${reads(', maxQueue: 2000')}traffic: { rps: 1200, mix: { read: 1 }, client: { timeoutMs: 2000, retries: 3 } }
run: { duration: 40s, warmup: 5s }
events:
  - { at: 10s, action: slow, node: db, factor: 8 }
  - { at: 13s, action: slow, node: db, factor: 1 }
phases:
  - { name: later, from: 20s, to: 40s }
requirements:
  - "later: errors < 0.1%"
`,
    tuneOnly: true,
    parCost: 800,
    solution: reads(', maxQueue: 50'),
    hint: 'A request at the back of a queue of 2,000 waits far longer than the client’s 2-second timeout. Shed load instead: a short queue (maxQueue) rejects the excess at once.',
  },
  {
    title: 'The scraper',
    story: 'From **10 s**, one scraper sends **60%** of all requests. Real users see errors and slow pages. Protect them (**errors < 0.1%**, **p99 < 200 ms** for real users), and don’t pay for servers just to feed the scraper.',
    scenario: `${api(3, '')}traffic: { rps: 2000, mix: { read: 0.9, write: 0.1 }, keys: 10000, users: 5000, abuser: { share: 0.6, from: 10s } }
run: { duration: 30s, warmup: 5s }
phases:
  - { name: attack, from: 12s, to: 30s }
requirements:
  - "attack: errors < 0.1%"
  - "attack: p99 < 200ms"
`,
    parCost: 790,
    solution: api(3, 'rate: 10, per: user'),
    hint: 'Add a ratelimiter between users and the load balancer, with a limit per user (per: user), so only the client sending far too much is throttled.',
  },
  {
    title: 'Chaos hour',
    story: 'Everything at once. At **10 s** the payment provider stalls (5 s per call); at **15 s** zone **a** goes dark. Orders may be charged later, so a failed payment call shouldn’t fail the order. From **20 s**: **no errors**, **p99 under 300 ms**.',
    scenario: `${checkout('')}traffic: { rps: 600, mix: { read: 0.8, write: 0.2 }, keys: 10000 }
run: { duration: 35s, warmup: 5s }
events:
  - { at: 10s, action: slow, node: pay, factor: 50 }
  - { at: 15s, action: azDown, az: a }
phases:
  - { name: chaos, from: 20s, to: 35s }
requirements:
  - "chaos: errors < 0.1%"
  - "chaos: p99 < 300ms"
`,
    tuneOnly: true,
    parCost: 1320,
    solution: checkout('timeoutMs: 300, optional: true', ', azs: [a, b]', ', replicas: 1, failoverMs: 3000, azs: [a, b]', ', azs: [a, b]'),
    hint: 'Two separate problems. The payment connection needs a timeout, and optional: true so a failed charge degrades the order instead of failing it. And every layer needs a second zone: lb and app azs: [a, b], and a database replica in zone b with failover.',
  },
];
