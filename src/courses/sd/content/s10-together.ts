import type { Module } from '../../../content/types';
import type { Phase, ScenarioEvent, Traffic } from '../engine/types';
import { projectC } from './projectC';

/** An API: app servers, an optional cache, one database. */
const API = (n: number, app: string, db: string, cache = '') => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: ${n}${app} }
${cache ? `  cache: { type: cache, memoryMb: ${cache} }\n` : ''}  db: { type: db${db} }
connections:
  - users -> lb
  - lb -> app
${cache ? '  - app -> cache\n' : ''}  - app -> db
`;

/** 1,500 requests/s, mostly reads, a skewed catalogue of 100,000 items. */
const BUSY_T: Traffic = { rps: 1500, mix: { read: 0.9, write: 0.1 }, keys: 100_000, skew: 0.6, readKb: 0.5 };
const BUSY_RUN = `traffic: { rps: 1500, mix: { read: 0.9, write: 0.1 }, keys: 100000, skew: 0.6, readKb: 0.5 }
run: { duration: 30s, warmup: 5s, warmCache: true }
`;

/** 750 requests/s on small app servers; one of them dies at 10 s. */
const LOSE_T: Traffic = { rps: 750, mix: { read: 0.9, write: 0.1 }, keys: 100_000, readKb: 0.5 };
const LOSE_EVENTS: ScenarioEvent[] = [{ atMs: 10_000, action: 'kill', node: 'app', instance: 0 }];
const AFTER: Phase[] = [{ name: 'after', fromMs: 20_000, toMs: 30_000 }];
const LOSE_RUN = `traffic: { rps: 750, mix: { read: 0.9, write: 0.1 }, keys: 100000, readKb: 0.5 }
run: { duration: 30s, warmup: 5s }
events:
  - { at: 10s, action: kill, node: app, instance: 0 }
phases:
  - { name: after, from: 20s, to: 30s }
`;

/** 500 requests/s: a small service. */
const SMALL_T: Traffic = { rps: 500, mix: { read: 0.9, write: 0.1 }, keys: 100_000, readKb: 0.5 };
const SMALL_RUN = `traffic: { rps: 500, mix: { read: 0.9, write: 0.1 }, keys: 100000, readKb: 0.5 }
run: { duration: 30s, warmup: 5s }
`;
const OVERSIZED = API(8, ', size: large', ', size: xlarge');

/** Open designs: a read-heavy API that must also survive losing an app server. */
const OPEN_T: Traffic = { rps: 1500, mix: { read: 0.95, write: 0.05 }, keys: 100_000, skew: 0.9, readKb: 0.5 };
const CATALOG_T: Traffic = { rps: 2000, mix: { read: 0.9, write: 0.1 }, keys: 100_000, skew: 0.9, readKb: 0.5 };
const START = API(1, '', '');

/** Module 10: putting it together. Checked by tests/sd-content.test.ts. */
export const s10: Module = {
  id: 's10',
  number: 10,
  title: 'Putting it together',
  tagline: 'Observability, capacity planning with headroom, cost, and a method for reviewing a design from requirements to failure modes.',
  games: ['launch'],
  project: projectC,
  concepts: [
    {
      id: 's10-observe',
      title: 'Observability: find the bottleneck',
      card: `You can't fix what you can't see. Three kinds of telemetry:

- **Metrics**: numbers over time, cheap to keep. For each **service**, watch **RED**: **R**ate (requests/s), **E**rrors, **D**uration (latency percentiles). For each **resource** (CPU, connections, disk, queues), watch **USE**: **U**tilisation, **S**aturation (work waiting), **E**rrors.
- **Logs**: what happened to one request, in detail. Structured (JSON), with a request id.
- **Traces**: one request's path through every service, with the time spent in each. The fastest way to answer “which of these 12 services added the 400 ms?”

The usual hunt: a **symptom** (p99 up, errors up) → the component that is **saturated** (busy near 100%, a growing queue) → why. The slow component is often not the one that reports errors: here the app servers return the 503s, but they are almost idle.

In the simulator, the run's results show each component's utilisation and errors, the colours on the canvas show which one is hot, and the charts show when it started.`,
      predict: {
        sql: API(4, ', size: medium', '') + BUSY_RUN,
        question: 'p99 is over a second and many requests fail with “overloaded” at the **app**. The app servers are **26% busy**. Where is the bottleneck?',
        choices: ['The app servers: they return the errors', 'The database: it is saturated, and app threads pile up waiting for it', 'The load balancer', 'The network'],
        answer: 1,
        why: 'Every app thread is waiting for a database that is 100% busy, so the apps’ request queues fill and they reject new requests. The error appears at the app; the cause is one hop further.',
        verify: ['util(db) > 95%', 'util(app) < 40%', 'p99 > 500ms'],
      },
      example: {
        sql: API(4, ', size: medium', '', '128') + BUSY_RUN,
        note: 'A 128 MB cache in front of the database: over 95% of reads never reach it. Compare each component’s utilisation with the run before.',
      },
      cheat: { syntax: 'RED per service · USE per resource · traces', note: 'Symptom → saturated component → cause. Errors often show up one hop before the cause.' },
    },
    {
      id: 's10-capacity',
      title: 'Capacity planning and headroom',
      card: `Plan capacity for the **worst normal day**, not the average one:

1. **Peak**, not average: daily peaks are often 2–3× the average, launches and sales more.
2. **Growth** until the next time you'll revisit the plan.
3. **Failures**: with N servers you need to survive losing one (**N + 1**), and with zones, losing a zone (with 3 zones, each must handle half the load).
4. A **target utilisation** of 50–70%, not 100%: queueing delay explodes as utilisation approaches 100% (module 1), and you need room for retries and bursts.

So: servers = peak ÷ (capacity per server × target utilisation), plus spares. Then **load test** to check the assumption about capacity per server, because it is usually the weakest number in the plan.

Autoscaling helps with slow changes but takes minutes, so it doesn't replace headroom for sudden ones.`,
      predict: {
        sql: API(3, '', ', size: medium') + LOSE_RUN,
        question: 'Three small app servers, each about 60% busy. At 10 s one dies. After the load balancer notices, how does the p99 compare with before?',
        choices: ['The same: two servers are plenty', 'Clearly higher: the two survivors run at about 90%, and queueing delay grows fast near 100%', 'Everything fails'],
        answer: 1,
        why: 'The same work on two servers instead of three: each is at about 90%. Nothing fails, but requests wait longer for a thread, and the p99 passes 100 ms. At 60% each there was no N + 1 headroom.',
        verify: ['after: p99 > 100ms', 'after: errors < 0.1%'],
      },
      example: {
        sql: API(4, '', ', size: medium') + LOSE_RUN,
        note: 'Four servers (N + 1): after losing one, the other three run at about 65% and the p99 barely moves. The spare costs $35 a month.',
      },
      cheat: { syntax: 'peak ÷ (per-server × 60%) + 1', note: 'Plan for peak, growth and one failure, at a target utilisation well below 100%.' },
    },
    {
      id: 's10-cost',
      title: 'Cost: right-size, then optimise',
      card: `Cost is a requirement like latency: a design that meets every target for 10× the budget has failed. Where the money usually goes:

- **Over-provisioning**: servers sized for a launch two years ago, running at 5%. Look at utilisation first; it's the cheapest win.
- **Always-on peak capacity**: autoscaling or scheduled scaling for predictable peaks.
- **Data transfer**: egress to the internet and between zones, often a surprise on the bill. CDNs and compression help.
- **Per-request services**: managed APIs, queues and gateways bill every call; at scale a fixed-price alternative can be far cheaper.
- **Storage that only grows**: logs, old data, backups. Set retention.

The method: find the **biggest line item**, check whether it does useful work (utilisation), shrink it, and re-run the load test to make sure the targets still hold. Repeat.`,
      predict: {
        sql: OVERSIZED + SMALL_RUN,
        question: 'This service handles **500 requests/s** on eight large app servers and an xlarge database. Roughly how busy is the database?',
        choices: ['About 70%: a healthy target', 'Under 10%: it is many times bigger than it needs to be', 'Over 90%'],
        answer: 1,
        why: 'The database is at about 7% and the apps at 4%: almost $1,900 a month for a load that a few hundred dollars of servers handle at a healthy 60%.',
        verify: ['util(db) < 10%', 'util(app) < 10%', 'cost > $1500'],
      },
      example: {
        sql: API(2, '', '') + SMALL_RUN,
        note: 'Two small app servers and a small database: both around 60% busy, p99 still well under 100 ms, for a fifth of the cost. Find the cheapest design that still meets the targets.',
      },
      cheat: { syntax: 'biggest line item → utilisation → shrink → re-test', note: 'Right-size first. Watch egress and per-request prices.' },
    },
    {
      id: 's10-review',
      title: 'A design review, step by step',
      card: `Whether in an interview or a real review, the same steps work:

1. **Requirements**: what must it do (features), and how well (latency, availability, consistency, cost)? Ask; don't assume.
2. **Estimates**: requests per second at peak, reads vs writes, data size, bandwidth. They decide which problems are real.
3. **API and data model**: the main operations and what is stored, with the keys you'll look things up (and partition) by.
4. **High-level design**: the boxes and arrows, simplest first.
5. **Deep dives**: where the estimates say it will hurt: the hot path, the database, the hot keys.
6. **Failure modes**: what happens when each box dies, is slow or is cut off? Where are the single points of failure? What is retried, and is it idempotent?
7. **Cost and trade-offs**: what you chose, what you gave up, and what you'd change at 10× the load.

A good design is not the one with the most boxes; it is the simplest one that meets the requirements, with the trade-offs named.`,
      example: {
        sql: API(4, ', size: medium', '', '256') + `traffic: { rps: 1500, mix: { read: 0.95, write: 0.05 }, keys: 100000, skew: 0.9, readKb: 0.5 }
run: { duration: 30s, warmup: 5s, warmCache: true }
events:
  - { at: 10s, action: kill, node: app, instance: 0 }
`,
        note: 'A reviewed design for 1,500 requests/s, 95% reads: four app servers (one spare), a cache for the hot items, one small database. Step 6 in action: an app server dies at 10 s. Try killing the cache or the database instead: which of those is a single point of failure?',
      },
      cheat: { syntax: 'requirements → estimates → API/data → design → deep dives → failures → cost', note: 'The simplest design that meets the requirements, trade-offs named.' },
    },
  ],
  practice: [
    {
      id: 's10-p1',
      kind: 'readQuery',
      conceptIds: ['s10-observe'],
      prompt: 'Requests fail with “overloaded” at the app servers, but their CPUs are mostly idle. The simulator ran it. **What do you fix?**',
      sql: API(4, ', size: medium', '') + BUSY_RUN,
      choices: ['Add app servers: they are rejecting requests', 'Take load off the database (a cache, or a bigger database): it is saturated', 'Raise the app servers’ maxQueue', 'Add a second load balancer'],
      answer: 1,
      verify: ['util(db) > 95%', 'util(app) < 40%'],
      hints: [],
      explanation: 'USE on each resource: the database is at 100% utilisation, and app threads are stuck waiting for it. More app servers would send it even more work; a longer queue would only make requests wait longer.',
    },
    {
      id: 's10-p2',
      kind: 'write',
      conceptIds: ['s10-capacity'],
      prompt: 'Peak traffic is **6,000 requests/s**. Load tests show one server handles **500 requests/s** at your 60% target utilisation. How many servers do you run, with one spare (**N + 1**)?',
      solution: '13',
      wrongExample: '10',
      hints: ['Servers for the peak at the target utilisation, then one more.'],
      explanation: '6,000 ÷ 500 = 12 for the peak at 60% each, **plus one** spare so that losing a server doesn’t push the rest above the target: **13**.',
      sd: { target: 'estimate', unit: 'servers', tolerance: 0.05 },
    },
    {
      id: 's10-p3',
      kind: 'fixBug',
      conceptIds: ['s10-capacity'],
      prompt: 'An app server dies at 10 s, and the p99 climbs above 100 ms for the rest of the run. Change the settings so that from **20 s** the **p99 stays under 100 ms** with no errors.',
      starterSql: API(3, '', ', size: medium'),
      solution: API(4, '', ', size: medium'),
      wrongExample: API(3, '', ', size: medium').replace('lb: { type: lb }', 'lb: { type: lb, algorithm: least_conn }'),
      hints: ['How busy are the two survivors?', 'N + 1.'],
      explanation: 'With **4 servers**, losing one leaves three at about 65%. A smarter load balancing algorithm doesn’t create capacity: two servers at 90% are slow whichever way the requests are spread.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: LOSE_T, durationMs: 30_000, warmupMs: 5_000, events: LOSE_EVENTS, phases: AFTER, requirements: ['after: p99 < 100ms', 'after: errors < 0.1%'] } },
    },
    {
      id: 's10-p4',
      kind: 'fixBug',
      conceptIds: ['s10-cost'],
      prompt: 'This service costs almost **$1,900 a month** for 500 requests/s. Right-size it: keep **p99 < 150 ms** and **errors < 0.1%**, for **under $380 a month**.',
      starterSql: OVERSIZED,
      solution: API(2, '', ''),
      wrongExample: API(1, '', ''),
      hints: ['Look at the utilisation of each component.', 'A small app server handles about 400 requests/s at full load.'],
      explanation: '500 requests × 5 ms of CPU = 2.5 cores: **two small app servers** (4 cores) run at about 60%. The database does 450 reads × 2 ms + 50 writes × 6 ms = 1.2 cores: a **small** one (2 cores) is enough. One app server would be at over 100%.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: SMALL_T, durationMs: 30_000, warmupMs: 5_000, requirements: ['p99 < 150ms', 'errors < 0.1%', 'cost < $380'] } },
    },
    {
      id: 's10-p5',
      kind: 'parsons',
      conceptIds: ['s10-review'],
      prompt: 'Put the steps of a design review in order.',
      blocks: [
        'Clarify the requirements: features, latency, availability, consistency, cost',
        'Estimate peak requests per second, data size and bandwidth',
        'Define the main API calls and the data model',
        'Sketch the simplest high-level design',
        'Deep-dive into the parts the estimates say will hurt',
        'Walk through failure modes and single points of failure',
        'Summarise cost and trade-offs',
      ],
      wrongOrder: [
        'Sketch the simplest high-level design',
        'Clarify the requirements: features, latency, availability, consistency, cost',
        'Estimate peak requests per second, data size and bandwidth',
        'Define the main API calls and the data model',
        'Deep-dive into the parts the estimates say will hurt',
        'Walk through failure modes and single points of failure',
        'Summarise cost and trade-offs',
      ],
      hints: ['You can’t judge a design before you know what it must achieve.'],
      explanation: 'Requirements and numbers first: they decide what the design must handle. Boxes come after, then the deep dives, failures and trade-offs.',
    },
    {
      id: 's10-p6',
      kind: 'readQuery',
      conceptIds: ['s10-observe'],
      prompt: 'A request goes through 9 services, and its p99 went from 200 ms to 600 ms after a deploy. Which tool answers “**which service added the time?**” fastest?',
      choices: ['CPU graphs of every server', 'Distributed tracing: one request’s path with the time spent in each service', 'Grepping each service’s logs', 'The load balancer’s request count'],
      answer: 1,
      hints: [],
      explanation: 'A trace shows the whole call tree of one request with each span’s duration, so the slow hop stands out. Metrics tell you *that* it’s slow; traces tell you *where*.',
    },
    {
      id: 's10-p7',
      kind: 'readQuery',
      conceptIds: ['s10-observe', 's10-capacity'],
      prompt: 'Which alert should **page** the on-call engineer at 3 am?',
      choices: ['A server’s CPU is above 80%', 'Checkout is failing for 5% of users and the error budget is burning fast', 'Disk usage on a log server is at 60%', 'A deploy finished'],
      answer: 1,
      hints: ['What do users feel?'],
      explanation: 'Page on **symptoms** users feel (errors, latency, SLO burn rate). High CPU may be perfectly fine; it belongs on a dashboard or a ticket, not a 3 am page.',
    },
    {
      id: 's10-p8',
      kind: 'write',
      conceptIds: ['s10-cost', 's10-capacity'],
      prompt: 'Your app servers cost **$70/month** each. The daily peak needs **12**, but averaged over the day autoscaling would run **6**. How many **dollars a month** does autoscaling save compared with running 12 all the time?',
      solution: '420',
      wrongExample: '840',
      hints: ['You pay for the average number of servers running.'],
      explanation: '12 − 6 = 6 servers fewer on average, × $70 = **$420 a month**. Keep a floor for sudden spikes: autoscaling takes minutes.',
      sd: { target: 'estimate', unit: '$/month', tolerance: 0.1 },
    },
    {
      id: 's10-p9',
      kind: 'write',
      conceptIds: ['s10-review', 's10-capacity'],
      prompt: 'Design a read API from scratch: **1,500 requests/s**, 95% reads of a skewed catalogue of 100,000 items. It must meet **p99 < 100 ms**, **survive losing an app server** at 10 s (no errors from 20 s on), and cost **under $600 a month**.',
      starterSql: START,
      solution: API(4, ', size: medium', '', '256'),
      wrongExample: API(4, '', ''),
      hints: ['Estimate the CPU: 1,500 requests × 5 ms.', 'Hot reads and a small database: what takes the reads off it?', 'Leave room for one server to die.'],
      explanation: '1,500 × 5 ms = 7.5 cores of app work: **4 medium** servers (16 cores) leave room for one to die. A **cache** serves the popular items, so a small database handles the rest. Small app servers without a cache overload both tiers.',
      sd: {
        target: 'design',
        run: { traffic: OPEN_T, durationMs: 30_000, warmupMs: 5_000, warmCache: true, events: LOSE_EVENTS, phases: AFTER, requirements: ['p99 < 100ms', 'after: errors < 0.1%', 'cost < $600'] },
      },
    },
    {
      id: 's10-p10',
      kind: 'readQuery',
      conceptIds: ['s10-observe'],
      prompt: 'There is a cache in front of the database, yet the database is at 100% and requests fail. The simulator ran it. **What does the telemetry point to?**',
      sql: API(4, ', size: medium', '', '2') + BUSY_RUN,
      choices: ['The cache is down', 'The cache is far too small: almost every read misses and goes to the database', 'Too many writes', 'The load balancer'],
      answer: 1,
      verify: ['hitRatio < 0.2', 'util(db) > 95%'],
      hints: [],
      explanation: 'A 2 MB cache holds about 2,000 of 100,000 items: the hit ratio is under 10%. Size the cache for the hot set (module 4), and watch the hit ratio as a metric.',
    },
  ],
  test: [
    {
      id: 's10-t1',
      kind: 'readQuery',
      conceptIds: ['s10-observe'],
      prompt: 'Which of these is **not** one of the “four golden signals” for monitoring a service?',
      choices: ['Latency', 'Traffic', 'Errors', 'Number of deploys per day'],
      answer: 3,
      hints: [],
      explanation: 'The four golden signals (Google SRE book) are latency, traffic, errors and saturation. Deploy frequency is a useful engineering metric, but it doesn’t tell you whether users are being served.',
    },
    {
      id: 's10-t2',
      kind: 'write',
      conceptIds: ['s10-capacity'],
      prompt: 'Peak: **2,400 requests/s**. One server handles **300 requests/s** at the target utilisation. How many servers with **N + 1**?',
      solution: '9',
      wrongExample: '8',
      hints: [],
      explanation: '2,400 ÷ 300 = 8, plus one spare: **9**.',
      sd: { target: 'estimate', unit: 'servers', tolerance: 0.05 },
    },
    {
      id: 's10-t3',
      kind: 'readQuery',
      conceptIds: ['s10-cost'],
      prompt: 'The bill is too high. The simulator ran the service at its normal load. **What is the first thing to change?**',
      sql: OVERSIZED + SMALL_RUN,
      choices: ['Add a CDN', 'Shrink the servers and the database: they are under 10% busy', 'Shard the database', 'Remove the load balancer'],
      answer: 1,
      verify: ['util(db) < 10%', 'util(app) < 10%', 'cost > $1500'],
      hints: [],
      explanation: 'Biggest line items first: eight large app servers and an xlarge database doing almost nothing. Right-sizing them saves over 80% with the same latency.',
    },
    {
      id: 's10-t4',
      kind: 'fixBug',
      conceptIds: ['s10-observe', 's10-cost'],
      prompt: 'The database is saturated even though there’s a cache. Fix it for **p99 < 100 ms**, **errors < 0.1%**, **under $560 a month**.',
      starterSql: API(4, ', size: medium', '', '2'),
      solution: API(4, ', size: medium', '', '128'),
      wrongExample: API(4, ', size: medium', '', '8'),
      hints: ['What is the cache’s hit ratio?', 'How much memory do the popular items need?'],
      explanation: 'The cache was too small to hold the hot set. With **128 MB** it holds every item and the hit ratio passes 95%, for about $1.50 a month. A bigger database would also work, but costs far more.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: BUSY_T, durationMs: 30_000, warmupMs: 5_000, warmCache: true, requirements: ['p99 < 100ms', 'errors < 0.1%', 'cost < $560'] } },
    },
    {
      id: 's10-t5',
      kind: 'readQuery',
      conceptIds: ['s10-review'],
      prompt: 'In a design interview you’re asked to “design a URL shortener”. What do you do **first**?',
      choices: ['Draw the load balancer and app servers', 'Ask about the requirements and scale: how many links, how many redirects, how long they live', 'Pick a database', 'Explain consistent hashing'],
      answer: 1,
      hints: [],
      explanation: 'The design depends on the numbers and needs: 100 links a day and 100,000 redirects a second are different systems. Clarify, estimate, then design.',
    },
    {
      id: 's10-t6',
      kind: 'write',
      conceptIds: ['s10-review', 's10-cost'],
      prompt: 'Design a catalogue API from scratch: **2,000 requests/s**, 90% reads, popular items read far more than others. Meet **p99 < 100 ms** and **errors < 0.1%** for **under $600 a month**.',
      starterSql: START,
      solution: API(4, ', size: medium', '', '256'),
      wrongExample: API(4, ', size: medium', ''),
      hints: ['2,000 × 5 ms of CPU: how many cores?', 'How much database work do 1,800 reads/s make, and what can take most of it?'],
      explanation: '10 cores of app work: **4 medium** servers run at about 60%. 1,800 reads × 2 ms would need almost 4 database cores, but with a **cache** over 90% of reads are hits, and a **small** database is plenty. Without the cache, the small database is overloaded.',
      sd: { target: 'design', run: { traffic: CATALOG_T, durationMs: 30_000, warmupMs: 5_000, warmCache: true, requirements: ['p99 < 100ms', 'errors < 0.1%', 'cost < $600'] } },
    },
  ],
};
