import type { Module } from '../../../content/types';
import type { Phase, ScenarioEvent, Traffic } from '../engine/types';

/** A shop API: 800 requests/s; at 10 s availability zone a goes dark. */
const SHOP = (az: string, db: string) => `components:
  users: { type: client }
  lb: { type: lb${az} }
  app: { type: app, instances: 4, size: medium${az} }
  db: { type: db, size: medium${db} }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`;
const MULTI = ', azs: [a, b]';
const MULTI_DB = ', replicas: 1, failoverMs: 3000, azs: [a, b]';
const ZONE_T: Traffic = { rps: 800, mix: { read: 0.8, write: 0.2 }, keys: 10_000 };
const ZONE_EVENTS: ScenarioEvent[] = [{ atMs: 10_000, action: 'azDown', az: 'a' }];
const OUTAGE: Phase[] = [{ name: 'outage', fromMs: 15_000, toMs: 30_000 }];
const ZONE_RUN = `traffic: { rps: 800, mix: { read: 0.8, write: 0.2 }, keys: 10000 }
run: { duration: 30s, warmup: 5s }
events:
  - { at: 10s, action: azDown, az: a }
phases:
  - { name: outage, from: 15s, to: 30s }
`;

/** Checkout: 20% of requests call a payment provider (100 ms), which slows down 50× at 10 s. */
const CHECKOUT = (edge: string) => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, size: medium, externalRatio: 0.2 }
  pay: { type: external, latencyMs: 100 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> pay${edge ? `: { ${edge} }` : ''}
  - app -> db
`;
const SLOW_T: Traffic = { rps: 300, keys: 10_000 };
const SLOW_EVENTS: ScenarioEvent[] = [{ atMs: 10_000, action: 'slow', node: 'pay', factor: 50 }];
const SLOW: Phase[] = [{ name: 'slow', fromMs: 12_000, toMs: 30_000 }];
const SLOW_RUN = `traffic: { rps: 300, keys: 10000 }
run: { duration: 30s, warmup: 5s }
events:
  - { at: 10s, action: slow, node: pay, factor: 50 }
phases:
  - { name: slow, from: 12s, to: 30s }
`;

/** 1,200 reads/s; the database is 8× slower for 3 seconds (10–13 s). Retries at the app and in the clients. */
const BLIP = (dbEdge: string, app = '') => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4${app} }
  db: { type: db, size: medium }
connections:
  - users -> lb
  - lb -> app
  - app -> db: { timeoutMs: 100${dbEdge} }
`;
const blipRun = (client: string) => `traffic: { rps: 1200, mix: { read: 1 }, client: { timeoutMs: 2000${client} } }
run: { duration: 40s, warmup: 5s }
events:
  - { at: 10s, action: slow, node: db, factor: 8 }
  - { at: 13s, action: slow, node: db, factor: 1 }
phases:
  - { name: blip, from: 10s, to: 13s }
  - { name: later, from: 20s, to: 40s }
`;
const blipT = (client: Traffic['client']): Traffic => ({ rps: 1200, mix: { read: 1 }, client: { timeoutMs: 2000, ...client } });
const BLIP_EVENTS: ScenarioEvent[] = [
  { atMs: 10_000, action: 'slow', node: 'db', factor: 8 },
  { atMs: 13_000, action: 'slow', node: 'db', factor: 1 },
];
const BLIP_PHASES: Phase[] = [
  { name: 'blip', fromMs: 10_000, toMs: 13_000 },
  { name: 'later', fromMs: 20_000, toMs: 40_000 },
];
const STORM = ', retries: 3';
const CALM = ', retries: 3, backoffMs: 200, jitter: true';

/** 2,000 requests/s from 5,000 users; from 10 s one client (a scraper) sends 60% of all requests. */
const API = (gate: string) => `components:
  users: { type: client }
${gate ? `  gate: { type: ratelimiter, ${gate} }\n` : ''}  lb: { type: lb }
  app: { type: app, instances: 3, size: medium }
  db: { type: db, size: medium }
connections:
${gate ? '  - users -> gate\n  - gate -> lb\n' : '  - users -> lb\n'}  - lb -> app
  - app -> db
`;
const ATTACK_T: Traffic = { rps: 2000, mix: { read: 0.9, write: 0.1 }, keys: 10_000, users: 5000, abuser: { share: 0.6, fromMs: 10_000 } };
const ATTACK: Phase[] = [{ name: 'attack', fromMs: 12_000, toMs: 30_000 }];
const ATTACK_RUN = `traffic: { rps: 2000, mix: { read: 0.9, write: 0.1 }, keys: 10000, users: 5000, abuser: { share: 0.6, from: 10s } }
run: { duration: 30s, warmup: 5s }
phases:
  - { name: attack, from: 12s, to: 30s }
`;

/** A primary with async replicas that dies at 10 s; a replica takes over 3 s later. */
const FAILOVER = `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, size: medium }
  db: { type: db, size: medium, replicas: 2, failoverMs: 3000 }
connections:
  - users -> lb
  - lb -> app
  - app -> db
traffic: { rps: 400, mix: { read: 0.5, write: 0.5 }, keys: 1000 }
run: { duration: 30s, warmup: 5s }
events:
  - { at: 10s, action: kill, node: db, instance: 0 }
`;

/** Module 9: reliability. Checked by tests/sd-content.test.ts. */
export const s09: Module = {
  id: 's09',
  number: 9,
  title: 'Reliability',
  tagline: 'Redundancy and zones, timeouts, retries with backoff, circuit breakers, bulkheads, rate limits, and SLOs with error budgets.',
  games: ['chaos'],
  concepts: [
    {
      id: 's09-redundancy',
      title: 'No single point of failure',
      card: `Everything fails eventually: disks, servers, whole data centres. A **single point of failure** (SPOF) is any one thing whose failure takes the system down: one database, one load balancer, one zone.

The cure is **redundancy**, at every layer:

- Several app servers behind a load balancer (and health checks to skip dead ones).
- A database **replica** that is **promoted** automatically.
- Spread over **availability zones**: separate buildings with their own power and network, a millisecond apart. A zone outage is rare but real, and it takes everything in it.

The maths: parts in **series** (all needed) multiply: three 99.9% parts give 99.7%. Redundant parts in **parallel** (any one is enough) multiply their *failure* chances: two 99% servers are both down only 1% × 1% = 0.01% of the time, so 99.99%, if their failures are independent. Same zone, same power, same bug: not independent.

In the simulator: \`azs: [a, b]\` spreads a component's instances over zones; \`azDown\` takes a zone out.`,
      predict: {
        sql: SHOP('', '') + ZONE_RUN,
        question: 'Four app servers, one database, all in zone **a** (the default). At 10 s, zone a loses power. What happens?',
        choices: ['The four app servers keep it running', 'Everything fails until the zone is back', 'Only writes fail'],
        answer: 1,
        why: 'Four servers protect against one server dying, not against the building they share. Load balancer, apps and database are all gone.',
        verify: ['outage: errors > 99%'],
      },
      example: {
        sql: SHOP(MULTI, MULTI_DB) + ZONE_RUN,
        note: 'Load balancer, apps and database replica spread over zones a and b, with automatic failover: after a few seconds, zone b carries everything. Compare the cost with the single-zone design.',
      },
      cheat: { syntax: 'azs: [a, b] · replicas + failoverMs', note: 'Redundant at every layer, across zones. Series multiplies availability; parallel multiplies failure.' },
    },
    {
      id: 's09-timeouts',
      title: 'Timeouts and graceful degradation',
      card: `A dependency that is **down** fails fast. A dependency that is **slow** is worse: every request that calls it waits, holding a thread. Soon all threads are waiting, and requests that never needed the slow service fail too. One slow dependency takes everything down.

- Put a **timeout** on every network call, based on what the caller can afford (well under the user's own patience), not on the library default (often none, or 30–60 s).
- Decide what happens when it fires: fail that request, or **degrade gracefully**: show the page without recommendations, use a cached price, accept the order and charge later.

Not every dependency is equal. A checkout without payment can't work; a product page without “customers also bought” is fine.

In the simulator: \`timeoutMs\` on a connection; \`optional: true\` means a failure there degrades the response instead of failing it.`,
      predict: {
        sql: CHECKOUT('') + SLOW_RUN,
        question: '20% of requests call the payment provider. At 10 s it becomes **50× slower** (5 s per call). There is no timeout. What happens to the other 80% of requests?',
        choices: ['Nothing: they don’t call the provider', 'Most of them fail too: every thread ends up waiting on the provider', 'They get a little slower'],
        answer: 1,
        why: '60 payment calls/s × 5 s = 300 requests waiting at once, more than the 64 threads of both app servers. Every thread is stuck, the request queues fill up, and nearly all requests fail.',
        verify: ['slow: errors > 50%'],
      },
      example: {
        sql: CHECKOUT('timeoutMs: 300, optional: true') + SLOW_RUN,
        note: 'With a 300 ms timeout, a stuck call gives up quickly and frees its thread. optional: true then degrades the response instead of failing it (here: “payment pending”, retried later). No errors.',
      },
      cheat: { syntax: 'timeoutMs · optional: true', note: 'Time out every call; degrade instead of failing where you can.' },
    },
    {
      id: 's09-retries',
      title: 'Retries, backoff and jitter',
      card: `Retrying a failed call often works: the blip is over, another server answers. But retries **add load at the worst moment**: when a service is struggling, every failure comes back as several new requests.

- **Retry amplification**: 3 retries at each of 3 layers can turn one user request into 64 calls at the bottom.
- **Immediate** retries arrive while the service is still overloaded and keep it there.

The fixes:

- **Exponential backoff**: wait 100 ms, then 200, 400… so retries spread out.
- **Jitter**: randomise each wait, so thousands of clients don't retry in sync.
- A **retry budget**: retry only while retries are a small share of traffic, and retry at one layer, not every one.
- Only retry **idempotent** operations (or use idempotency keys).

In the simulator: \`retries\`, \`backoffMs\` and \`jitter\` on a connection, and in the traffic's \`client\` settings.`,
      predict: {
        sql: BLIP(STORM) + blipRun(', retries: 3'),
        question: 'The database is **8× slower for 3 seconds**. The app retries each timed-out query 3 times at once, and so do the clients. How bad is the blip?',
        choices: ['Barely visible: retries hide it', 'Most requests during the blip fail: the immediate retries pile even more work on the struggling database', 'Every request fails until the end of the run'],
        answer: 1,
        why: 'Each timed-out query comes straight back, up to 3 more times, while the database is still slow. The extra load keeps it overloaded for the whole blip: about three quarters of those requests fail.',
        verify: ['blip: errors > 50%', 'later: errors < 0.1%'],
      },
      example: {
        sql: BLIP(CALM) + blipRun(', retries: 3, backoffMs: 1000, jitter: true'),
        note: 'Exponential backoff with jitter: retries are spread out and land after the database has recovered. The blip’s error rate falls to about a fifth.',
      },
      cheat: { syntax: 'retries · backoffMs · jitter: true', note: 'Back off exponentially, randomise, retry at one layer, only idempotent calls.' },
    },
    {
      id: 's09-breakers',
      title: 'Circuit breakers and bulkheads',
      card: `When a dependency is clearly broken, even timed-out calls waste time: each one still waits the full timeout. A **circuit breaker** stops calling it:

- **Closed** (normal): calls go through; failures are counted.
- **Open**: after N failures in a row, calls fail **immediately** for a while, without touching the dependency, which gets room to recover.
- **Half-open**: after the wait, one trial call. Success closes the breaker; failure opens it again.

A **bulkhead** (named after a ship's watertight compartments) limits how many threads or connections one dependency may use, so a slow one can't take them all; the rest of the service keeps its share.

Together with timeouts and fallbacks these are the classic stability patterns (Hystrix, resilience4j, Envoy and service meshes have them built in).

In the simulator: \`breaker: { failures, resetMs }\` and \`maxConcurrent\` on a connection.`,
      predict: {
        sql: CHECKOUT('timeoutMs: 1000') + SLOW_RUN,
        question: 'The payment provider is stuck (5 s per call). Payment calls now time out after **1 second**. What is the p99 latency while it’s stuck?',
        choices: ['About 100 ms: the timeout protects everything', 'Over 400 ms: every payment request still waits a full second before failing, and it backs up the others', 'Over 5 seconds'],
        answer: 1,
        why: 'The timeout saves the threads from waiting 5 s, but each payment request still waits 1 s for nothing, again and again. 60 of them a second means 60 threads busy waiting.',
        verify: ['slow: p99 > 400ms'],
      },
      example: {
        sql: CHECKOUT('timeoutMs: 1000, breaker: { failures: 5, resetMs: 5000 }') + SLOW_RUN,
        note: 'After 5 failures the breaker opens: payment requests fail at once (“try again shortly”) instead of waiting a second, and every 5 s one trial call checks whether the provider is back. The p99 drops to near normal.',
      },
      cheat: { syntax: 'breaker: { failures, resetMs } · maxConcurrent', note: 'Stop calling what is broken; cap what one dependency can take.' },
    },
    {
      id: 's09-shedding',
      title: 'Rate limiting and load shedding',
      card: `Sometimes the problem isn't a failure but **too much traffic**: a scraper, a buggy script in a loop, a partner's batch job, a launch. Without limits, one client can slow everyone down.

- **Rate limiting per client** (per user, API key or IP): a token bucket lets each client make N requests per second, with some burst; the rest get **429 Too Many Requests**. The abuser is slowed down; everyone else doesn't notice.
- A **global** limit only protects the servers: when it kicks in, it rejects good and bad requests alike.
- **Load shedding**: when a server is overloaded, reject new work quickly (a **bounded** queue) instead of queueing it for longer than anyone will wait. A huge queue means the server spends its time on requests whose users already gave up: it can stay broken long after the cause is gone (a *metastable* failure).

In the simulator: a \`ratelimiter\` component (\`rate\`, \`burst\`, \`per: user\`), \`maxQueue\` on app servers, and \`abuser\` in the traffic.`,
      predict: {
        sql: API('') + ATTACK_RUN,
        question: 'From 10 s, one scraper sends **60%** of all requests. Three app servers handle the normal load easily. What do the **other** users notice?',
        choices: ['Nothing: the scraper only hurts itself', 'Their requests slow down and some fail: the servers are overloaded by the scraper', 'They are blocked as well as the scraper'],
        answer: 1,
        why: 'The scraper more than doubles the load. The app servers queue requests and reject some, for everyone. (The results count only real users; the scraper’s own requests aren’t in them.)',
        verify: ['attack: errors > 5%', 'attack: p99 > 300ms'],
      },
      example: {
        sql: API('rate: 10, per: user') + ATTACK_RUN,
        note: 'A per-user rate limit of 10 requests/s: the scraper gets 429s for almost everything, and real users are back to normal. Try a global limit (rate: 1000, no per) and see who pays for it.',
      },
      cheat: { syntax: 'ratelimiter: { rate, per: user } · maxQueue', note: 'Limit per client; shed load fast rather than queue it forever.' },
    },
    {
      id: 's09-slo',
      title: 'SLOs and error budgets',
      card: `“As reliable as possible” is not a goal: each extra nine costs more, and users can't tell 99.99% from 99.999% through their own flaky Wi-Fi. Decide how reliable is reliable enough:

- **SLI** (indicator): what you measure, e.g. the share of requests that succeed within 300 ms.
- **SLO** (objective): the target, e.g. 99.9% over 30 days.
- **SLA** (agreement): the promise to customers, with money back if broken; looser than the SLO.

The SLO gives an **error budget**: 99.9% over 30 days allows 0.1% failures, about **43 minutes** of full downtime. While there's budget left, ship features and take risks. When it's spent, slow down and work on reliability. Product and engineering agree on that policy in advance.

| SLO | Downtime per 30 days |
|---|---|
| 99% | 7.2 hours |
| 99.9% | 43 minutes |
| 99.99% | 4.3 minutes |
| 99.999% | 26 seconds |

Every failover, deploy and blip spends some of the budget.`,
      predict: {
        sql: FAILOVER,
        question: 'The primary dies at 10 s; a replica takes over 3 s later. Half the requests are writes. What is the **availability** over these 25 measured seconds?',
        choices: ['Over 99.9%: failover worked', 'About 94%: writes failed for about 3 seconds out of 25', 'About 50%'],
        answer: 1,
        why: 'About half of the requests in a 3-second window failed: roughly 6% of the 25 s measured. Over a whole month, the same incident costs only about 1.5 s of “full downtime”, a small part of a 43-minute budget.',
        verify: ['availability < 97%', 'availability > 90%'],
      },
      example: {
        sql: FAILOVER.replace('failoverMs: 3000', 'failoverMs: 1000'),
        note: 'A faster failover (1 s) spends a third as much of the error budget. Reliability work is often exactly this: making the unavoidable failures shorter and smaller.',
      },
      cheat: { syntax: 'SLI → SLO → error budget', note: '99.9% = 43 min/month. Budget left: ship. Budget spent: fix reliability.' },
    },
  ],
  practice: [
    {
      id: 's09-p1',
      kind: 'write',
      conceptIds: ['s09-slo'],
      prompt: 'Your SLO is **99.9%** availability over **30 days**. How many **minutes** of full downtime does the error budget allow?',
      solution: '43.2',
      wrongExample: '432',
      hints: ['30 days × 24 h × 60 min, times 0.1%.'],
      explanation: '43,200 minutes × 0.001 = **43.2 minutes**. Each extra nine divides it by ten: 99.99% leaves 4.3 minutes.',
      sd: { target: 'estimate', unit: 'minutes', tolerance: 0.05 },
    },
    {
      id: 's09-p2',
      kind: 'write',
      conceptIds: ['s09-redundancy'],
      prompt: 'Two servers each fail independently and are down **1%** of the time; either one can serve all users. How many **minutes per year** (525,600 minutes) are **both** down at once?',
      solution: '52.56',
      wrongExample: '5256',
      hints: ['Independent: multiply the chances. 1% × 1%.'],
      explanation: '0.01 × 0.01 = 0.0001 of the time: about **53 minutes a year**, against 87 hours for one server. Only if failures are independent: two servers on the same power supply fail together.',
      sd: { target: 'estimate', unit: 'minutes', tolerance: 0.1 },
    },
    {
      id: 's09-p3',
      kind: 'fixBug',
      conceptIds: ['s09-redundancy'],
      prompt: 'Everything runs in zone a, and at 10 s zone a goes down. Change the settings so the shop keeps working from **15 s** on (errors < 0.1%) with **p99 < 200 ms**.',
      starterSql: SHOP('', ''),
      solution: SHOP(MULTI, MULTI_DB),
      wrongExample: SHOP(MULTI, ''),
      hints: ['Every layer needs something in zone b.', 'The database too: a replica in zone b, promoted automatically.'],
      explanation: 'Spread the load balancer and the apps over **zones a and b**, and give the database a **replica in zone b** with **failoverMs**. Spreading only the apps leaves the database in zone a: every request still fails.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: ZONE_T, durationMs: 30_000, warmupMs: 5_000, events: ZONE_EVENTS, phases: OUTAGE, requirements: ['outage: errors < 0.1%', 'p99 < 200ms'] } },
    },
    {
      id: 's09-p4',
      kind: 'readQuery',
      conceptIds: ['s09-timeouts'],
      prompt: 'At 10 s the payment provider gets slow. Within seconds, almost **every** request fails, including pages that never take payments. The simulator ran it. **Why?**',
      sql: CHECKOUT('') + SLOW_RUN,
      choices: ['The payment provider is rate-limiting you', 'There is no timeout: every thread ends up waiting on the provider, and nothing is left for other requests', 'The database is overloaded', 'The load balancer’s health checks removed the app servers'],
      answer: 1,
      verify: ['slow: errors > 50%'],
      hints: [],
      explanation: 'Calls to a slow service without a timeout hold their thread for as long as it takes. Threads are shared, so the slow dependency starves everything. A timeout (plus a fallback) contains it.',
    },
    {
      id: 's09-p5',
      kind: 'fixBug',
      conceptIds: ['s09-timeouts'],
      prompt: 'The payment provider slows down at 10 s. Keep the damage to the payment requests: **errors under 25%** and **p99 under 1 s** while it’s slow.',
      starterSql: CHECKOUT(''),
      solution: CHECKOUT('timeoutMs: 300'),
      wrongExample: CHECKOUT('maxConcurrent: 10'),
      hints: ['How long may a payment call hold a thread?'],
      explanation: 'A **300 ms timeout** frees each thread quickly: payment requests fail, everything else keeps working. A bulkhead alone (maxConcurrent) protects the threads, but the 10 calls let through still take 5 s each, so p99 stays in the seconds.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: SLOW_T, durationMs: 30_000, warmupMs: 5_000, events: SLOW_EVENTS, phases: SLOW, requirements: ['slow: errors < 25%', 'slow: p99 < 1s'] } },
    },
    {
      id: 's09-p6',
      kind: 'fillBlank',
      conceptIds: ['s09-timeouts'],
      prompt: 'Orders can be accepted now and charged a minute later. Fill in the setting so a slow payment provider **fails no requests** at all.',
      starterSql: CHECKOUT('timeoutMs: 300, optional: ___'),
      solution: CHECKOUT('timeoutMs: 300, optional: true'),
      wrongExample: CHECKOUT('timeoutMs: 300, optional: false'),
      hints: ['A failure on an optional connection degrades the response.'],
      explanation: 'With **optional: true**, a timed-out payment call doesn’t fail the request: the order is accepted as “payment pending” and charged later. That is graceful degradation.',
      sd: { target: 'design', run: { traffic: SLOW_T, durationMs: 30_000, warmupMs: 5_000, events: SLOW_EVENTS, phases: SLOW, requirements: ['slow: errors < 0.1%'] } },
    },
    {
      id: 's09-p7',
      kind: 'readQuery',
      conceptIds: ['s09-retries'],
      prompt: 'The database is slow for 3 seconds, and three quarters of the requests in that window fail. The database receives far more queries than users sent. The simulator ran it. **What helps most?**',
      sql: BLIP(STORM) + blipRun(', retries: 3'),
      choices: ['More retries, so more requests eventually succeed', 'Exponential backoff with jitter, so retries spread out and arrive after the database has recovered', 'Removing the timeout on the database connection', 'A shorter client timeout'],
      answer: 1,
      verify: ['blip: errors > 50%', 'later: errors < 0.1%'],
      hints: [],
      explanation: 'Every timed-out query comes straight back while the database is still slow: the retries are extra load at the worst moment. With backoff and jitter they wait 0–1 s, 0–2 s, 0–4 s, and most land after the blip. Change the scenario’s client retries to `backoffMs: 1000, jitter: true` and compare.',
    },
    {
      id: 's09-p8',
      kind: 'parsons',
      conceptIds: ['s09-breakers'],
      prompt: 'Put the life of a circuit breaker in order, from a healthy dependency to its recovery.',
      blocks: [
        'Closed: calls go through, failures are counted',
        'Five calls in a row fail',
        'Open: calls fail immediately without reaching the dependency',
        'The reset time passes',
        'Half-open: one trial call is let through',
        'The trial call succeeds and the breaker closes',
      ],
      wrongOrder: [
        'Closed: calls go through, failures are counted',
        'Open: calls fail immediately without reaching the dependency',
        'Five calls in a row fail',
        'The reset time passes',
        'Half-open: one trial call is let through',
        'The trial call succeeds and the breaker closes',
      ],
      hints: ['The breaker opens because of failures.'],
      explanation: 'Count failures while closed, open after the threshold, wait, then test with one call. If the trial fails, it opens again for another reset period.',
    },
    {
      id: 's09-p9',
      kind: 'write',
      conceptIds: ['s09-shedding'],
      prompt: 'From 10 s, one scraper sends 60% of all requests and real users suffer. Protect them: **errors < 0.1%** and **p99 < 200 ms** for real users, without adding app servers.',
      starterSql: API(''),
      solution: API('rate: 10, per: user'),
      wrongExample: API('rate: 1000'),
      hints: ['Add a ratelimiter between the users and the load balancer.', 'Limit each client, not the total.'],
      explanation: 'A **per-user** limit of 10 requests/s blocks the scraper (it gets 429s) and never touches normal users. A global limit of 1,000/s protects the servers too, but rejects real users along with the scraper.',
      sd: { target: 'design', run: { traffic: ATTACK_T, durationMs: 30_000, warmupMs: 5_000, phases: ATTACK, requirements: ['attack: errors < 0.1%', 'attack: p99 < 200ms'] } },
    },
    {
      id: 's09-p10',
      kind: 'readQuery',
      conceptIds: ['s09-retries'],
      prompt: 'A call times out. Which one is safe for the client to **retry automatically**?',
      choices: ['POST /payments (charge a card), with no idempotency key', 'GET /orders/42', 'POST /emails/send', 'POST /orders (create an order), with no idempotency key'],
      answer: 1,
      hints: ['What if the first attempt actually succeeded?'],
      explanation: 'A timeout doesn’t mean the call failed: it may have worked. Reading is harmless to repeat; charging, sending and creating are not, unless the server deduplicates them with an idempotency key.',
    },
  ],
  test: [
    {
      id: 's09-t1',
      kind: 'write',
      conceptIds: ['s09-slo'],
      prompt: 'An SLO of **99.95%** over **30 days**. How many **minutes** of full downtime is the error budget?',
      solution: '21.6',
      wrongExample: '43.2',
      hints: ['43,200 minutes × 0.05%.'],
      explanation: '43,200 × 0.0005 = **21.6 minutes** a month.',
      sd: { target: 'estimate', unit: 'minutes', tolerance: 0.05 },
    },
    {
      id: 's09-t2',
      kind: 'readQuery',
      conceptIds: ['s09-redundancy'],
      prompt: 'A request needs the app, the database **and** a payment API, each **99.9%** available (independently). Roughly how available is the request?',
      choices: ['99.9%: the same as each part', 'About 99.7%: all three must work', 'About 99.9999%', '33.3%'],
      answer: 1,
      hints: ['In series, availabilities multiply.'],
      explanation: '0.999³ ≈ 0.997. Every dependency in the path lowers availability, which is why critical paths should have as few as possible, and optional ones should degrade gracefully.',
    },
    {
      id: 's09-t3',
      kind: 'fixBug',
      conceptIds: ['s09-shedding', 's09-retries'],
      prompt: 'After a 3-second database blip, the service **never recovers**: the app servers have huge request queues full of requests whose users gave up. Change one setting so there are **no errors from 20 s on**.',
      starterSql: BLIP(STORM, ', maxQueue: 2000'),
      solution: BLIP(STORM, ', maxQueue: 50'),
      wrongExample: BLIP(STORM, ', maxQueue: 5000'),
      hints: ['How long would a request wait at the back of a queue of 2,000?', 'Shed load quickly instead of queueing it.'],
      explanation: 'A queue of 2,000 takes longer to work through than the clients’ 2 s timeout, so the servers spend all their time on requests nobody is waiting for, and the clients’ retries refill it. A **short queue (50)** rejects the excess at once and the service recovers as soon as the database does.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: blipT({ retries: 3 }), durationMs: 40_000, warmupMs: 5_000, events: BLIP_EVENTS, phases: BLIP_PHASES, requirements: ['later: errors < 0.1%'] } },
    },
    {
      id: 's09-t4',
      kind: 'readQuery',
      conceptIds: ['s09-shedding'],
      prompt: 'A scraper attacks the API. The rate limiter you added keeps the servers healthy, but **half of all real users** get 429 errors. The simulator ran it. **What should change?**',
      sql: API('rate: 1000') + ATTACK_RUN,
      choices: ['Raise the global rate', 'Limit each user separately (per: user), so only the scraper is throttled', 'Remove the rate limiter', 'Add app servers'],
      answer: 1,
      verify: ['attack: errors > 30%'],
      hints: [],
      explanation: 'A global limit can’t tell who is sending what: it drops requests at random, and most of the requests are the scraper’s, so it crowds out real users too. A per-user bucket throttles only the client that exceeds its own rate.',
    },
    {
      id: 's09-t5',
      kind: 'fixBug',
      conceptIds: ['s09-breakers'],
      prompt: 'The payment provider is stuck from 10 s, and each payment request still waits a full second for its timeout. Keep the **p99 under 300 ms** and **errors under 25%** while it’s stuck, without changing the timeout.',
      starterSql: CHECKOUT('timeoutMs: 1000'),
      solution: CHECKOUT('timeoutMs: 1000, breaker: { failures: 5, resetMs: 5000 }'),
      wrongExample: CHECKOUT('timeoutMs: 1000, retries: 2'),
      hints: ['Stop calling a dependency that keeps failing.'],
      explanation: 'A **circuit breaker** opens after 5 failures: payment requests then fail instantly instead of after a second, and a trial call every 5 s notices when the provider is back. Retries make it worse: three seconds of waiting instead of one.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: SLOW_T, durationMs: 30_000, warmupMs: 5_000, events: SLOW_EVENTS, phases: SLOW, requirements: ['slow: p99 < 300ms', 'slow: errors < 25%'] } },
    },
    {
      id: 's09-t6',
      kind: 'readQuery',
      conceptIds: ['s09-slo'],
      prompt: 'Two weeks into the month, a team has used **90%** of its error budget. What does a typical error-budget policy say?',
      choices: ['Nothing: budgets reset monthly', 'Pause risky launches and spend the time on reliability until the budget recovers', 'Lower the SLO so the budget is bigger', 'Ship faster to make up for it'],
      answer: 1,
      hints: [],
      explanation: 'The budget is the agreed amount of unreliability. Spent early means the system is less reliable than promised: freeze risky changes and fix the causes. Unspent budget, in turn, is permission to move faster.',
    },
  ],
};
