import type { Module } from '../../../content/types';

/**
 * Module 1. Every design answer here is run by tests/sd-content.test.ts: solutions must meet
 * their requirements, wrong examples and starters must not, and predictions are checked
 * against real runs (`verify`).
 */
export const s01: Module = {
  id: 's01',
  number: 1,
  title: 'Foundations',
  tagline: 'Requests, latency and throughput: the words every design discussion uses, measured on a live simulator.',
  games: [],
  concepts: [
    {
      id: 's01-request',
      title: 'A request’s journey',
      card: `Every design in this course is a set of **components** that call each other. A user's request travels through them and back:

- the **users** send requests over the internet (a round trip of about 40 ms to your region),
- an **app server** does some work (a few ms of CPU),
- and asks the **database** for data (a couple of ms).

The time from sending a request to getting the answer is its **latency**. Here, most of it is the network. Your servers' work is only a small part.

The canvas below is a live design. Press **Run** to send it real traffic: the simulator models every request, every thread and every database connection.`,
      predict: {
        sql: `components:
  users: { type: client }
  app: { type: app }
  db: { type: db }
connections:
  - users -> app
  - app -> db
traffic: { rps: 50 }
run: { duration: 20s, warmup: 2s }
`,
        question: 'At a gentle 50 requests per second, what is the typical (median) latency a user sees?',
        choices: ['About 5 ms: the app’s CPU time', 'About 50 ms: mostly the network round trip', 'About 500 ms', 'About 5 seconds'],
        answer: 1,
        why: 'The app needs ~5 ms of CPU and the database ~2 ms, but the round trip between the users and your servers is ~40 ms. Network distance dominates at low load.',
        verify: ['p50 > 40ms', 'p50 < 60ms'],
      },
      example: {
        sql: `components:
  users: { type: client }
  app: { type: app }
  db: { type: db }
connections:
  - users -> app
  - app -> db
traffic: { rps: 50 }
run: { duration: 20s, warmup: 2s }
`,
        note: 'Run it, then click the app server: change cpuMs to 30 and run again.',
      },
      cheat: { syntax: 'latency = network + queueing + work', note: 'At low load, network round trips usually dominate.' },
    },
    {
      id: 's01-percentiles',
      title: 'Percentiles: p50, p99',
      card: `Latency isn't one number: every request takes a slightly different time. We describe the spread with **percentiles**:

- **p50** (the median): half the requests are faster than this.
- **p99**: 99% are faster, 1% slower. With 100 requests per page view or per user session, *most* users meet the p99 regularly.

The **average** hides the slow tail. A few very slow requests barely move it, but they are exactly what users notice.

Requirements are therefore written as percentiles: "**p99 < 200 ms**".`,
      predict: {
        sql: `components:
  users: { type: client }
  app: { type: app, cpuMs: 20 }
connections:
  - users -> app
traffic: { rps: 85 }
run: { duration: 60s, warmup: 5s }
`,
        question: 'This app server is about 85% busy. How does p99 compare with the median (p50)?',
        choices: ['About the same', 'A little higher (10–20%)', 'Several times higher'],
        answer: 2,
        why: 'Near full capacity, requests often arrive while others are being served and have to share the CPU or wait. Most are quick, but the unlucky ones wait several times longer: the tail grows much faster than the median.',
        verify: ['p50 < 100ms', 'p99 > 250ms'],
      },
      example: {
        sql: `components:
  users: { type: client }
  app: { type: app, cpuMs: 20 }
connections:
  - users -> app
traffic: { rps: 85 }
run: { duration: 60s, warmup: 5s }
requirements:
  - p99 < 200ms
`,
        note: 'p99 fails. Add a second instance (instances: 2) and run again: what happens to p99?',
      },
      cheat: { syntax: 'p50 · p95 · p99', note: 'The latency X% of requests beat. Requirements use p99, not the average.' },
    },
    {
      id: 's01-throughput',
      title: 'Throughput and capacity',
      card: `**Throughput** is how many requests per second a system completes. **Capacity** is the most it can complete.

One instance with 2 CPU cores and 20 ms of CPU per request can complete at most 2 × (1000 / 20) = **100 requests/s**. Past that:

- requests wait in a line (the queue grows, latency explodes),
- then the line fills up and new requests are rejected (**503 errors**).

Latency and throughput are linked: as you approach capacity, latency climbs steeply. Plan to run at **60–70%** of capacity, not 100%.`,
      example: {
        sql: `components:
  users: { type: client }
  app: { type: app, cpuMs: 20 }
connections:
  - users -> app
traffic: { rps: [[0, 20], [30s, 140]] }
run: { duration: 30s }
`,
        note: 'Traffic ramps from 20 to 140 requests/s. Watch latency, then the errors, once it passes 100.',
      },
      cheat: { syntax: 'capacity = cores × 1000 / cpuMs', note: 'Per instance. Aim for 60–70% utilisation at peak.' },
    },
    {
      id: 's01-little',
      title: "Little's law",
      card: `How many requests are **in progress** at once? **Little's law** answers it for any stable system:

> in progress = arrival rate × time in the system

2,000 requests/s that each take 50 ms → 2,000 × 0.05 = **100** in flight at any moment.

It sizes everything that holds requests: threads, connection pools, queues. If each request holds a database connection for 10 ms at 3,000 req/s, you need about 3,000 × 0.01 = 30 connections busy on average, so a pool of 10 can't keep up.`,
      example: {
        sql: `components:
  users: { type: client }
  app: { type: app, instances: 2, cpuMs: 10, dbPool: 4 }
  db: { type: db, readMs: 20, size: large }
connections:
  - users -> app
  - app -> db
traffic: { rps: 300, mix: { read: 1 } }
run: { duration: 20s, warmup: 2s }
`,
        note: 'Each read holds a connection for about 20 ms: 300/s × 0.02 s = 6 connections busy on average, out of 2 instances × 4. Try dbPool: 2 and run again.',
      },
      cheat: { syntax: 'L = λ × W', note: 'In flight = rate × time each. Sizes pools, threads and queues.' },
    },
    {
      id: 's01-latency-numbers',
      title: 'Latency numbers to know',
      card: `Good designs start from rough timings. These are worth remembering (orders of magnitude, not exact):

| Operation | Time |
|---|---|
| Read from memory | ~100 ns |
| Redis GET, same data centre | ~0.2–0.5 ms |
| Network round trip inside a zone | ~0.5 ms |
| Indexed database read | ~1–5 ms |
| Database write (made durable) | ~5–10 ms |
| User to a nearby region | ~20–50 ms |
| Across an ocean | ~100–150 ms |

Two lessons follow. **Distance is expensive**: no server tuning beats a round trip across the world. And **calls add up**: a page that makes 20 database calls one after another pays 20 × (network + query).`,
      predict: {
        sql: `components:
  users: { type: client }
  app: { type: app }
  db: { type: db }
connections:
  - users -> app
  - app -> db
traffic: { rps: 50, rttMs: 150 }
run: { duration: 20s, warmup: 2s }
`,
        question: 'Same design as before, but now the users are on another continent: a 150 ms round trip. What is the median latency?',
        choices: ['Still about 50 ms: the servers didn’t change', 'About 160 ms', 'About 1.5 seconds'],
        answer: 1,
        why: 'The servers still need about 10 ms, but every request crosses the ocean and back first. That is why global products run servers (or at least a CDN) close to their users.',
        verify: ['p50 > 150ms', 'p50 < 175ms'],
      },
      example: {
        sql: `components:
  users: { type: client }
  app: { type: app }
  db: { type: db }
connections:
  - users -> app
  - app -> db
traffic: { rps: 50, rttMs: 150 }
run: { duration: 20s, warmup: 2s }
`,
        note: 'Change rttMs to 20 (users nearby) and run again. Then try readMs: 50 on the database: a slow query costs as much as an ocean.',
      },
      cheat: { syntax: 'memory 100ns · Redis 0.5ms · DB 1–5ms · ocean 150ms', note: 'Distance and sequential calls dominate latency.' },
    },
  ],
  practice: [
    {
      id: 's01-p1',
      kind: 'readQuery',
      conceptIds: ['s01-percentiles'],
      prompt: 'A service reports **p99 = 200 ms**. What does that mean?',
      choices: ['Every request takes 200 ms', 'The average request takes 200 ms', '99% of requests take 200 ms or less; 1% take longer', '99 requests per second take 200 ms'],
      answer: 2,
      hints: [],
      explanation: 'A percentile is a cut-off: p99 is the time 99% of requests beat. The slowest 1% take longer, sometimes much longer.',
    },
    {
      id: 's01-p2',
      kind: 'write',
      conceptIds: ['s01-throughput'],
      prompt: 'A product gets **1 million requests per day**, spread evenly. How many requests per second is that on average?',
      solution: '11.6',
      wrongExample: '1000',
      hints: ['A day has 24 × 60 × 60 seconds.', '86,400 seconds in a day: divide 1,000,000 by 86,400.'],
      explanation: '1,000,000 ÷ 86,400 ≈ **11.6 requests/s**. A handy shortcut: 1 million per day ≈ 12 per second (and 100k per day ≈ 1 per second).',
      sd: { target: 'estimate', unit: 'requests/s' },
    },
    {
      id: 's01-p3',
      kind: 'fixBug',
      conceptIds: ['s01-throughput'],
      prompt: 'Each request needs **20 ms of CPU**, and one small instance has 2 cores. Traffic is **250 requests/s**. Tune the design so that **p99 stays under 300 ms** with no errors. Don’t pay for more than you need: **cost < $300/month**.',
      starterSql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 1, cpuMs: 20 }
connections:
  - users -> lb
  - lb -> app
`,
      solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, cpuMs: 20 }
connections:
  - users -> lb
  - lb -> app
`,
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, cpuMs: 20 }
connections:
  - users -> lb
  - lb -> app
`,
      hints: ['One instance completes at most 2 × 1000 / 20 = 100 requests/s.', '250 requests/s needs at least 3 instances, and at 83% busy the tail is long. Aim for about 60–70%.'],
      explanation: 'Capacity per instance is 100/s, so 250/s needs more than 2.5 instances. 3 runs at 83% busy (long p99); **4** runs at ~63% with headroom for bursts. The bill is 4 × $35 + $20 for the load balancer, plus about $100 of bandwidth for the responses.',
      sd: {
        target: 'design',
        tuneOnly: true,
        run: { traffic: { rps: 250 }, durationMs: 30_000, warmupMs: 3_000, requirements: ['p99 < 300ms', 'errors < 0.1%', 'cost < $300'] },
      },
    },
    {
      id: 's01-p4',
      kind: 'write',
      conceptIds: ['s01-little'],
      prompt: 'A service handles **2,000 requests/s**, and each spends **50 ms** in the service. On average, how many requests are in progress at any moment?',
      solution: '100',
      wrongExample: '40',
      hints: ["Little's law: in progress = rate × time.", '50 ms = 0.05 s.'],
      explanation: '2,000 × 0.05 s = **100** requests in flight. That is how many threads (or async slots) the service needs, at the very least.',
      sd: { target: 'estimate', unit: 'requests', tolerance: 0.1 },
    },
    {
      id: 's01-p5',
      kind: 'readQuery',
      conceptIds: ['s01-throughput', 's01-request'],
      prompt: 'Users complain that the site is slow. The simulator ran the current design with today\'s traffic. **What is the bottleneck?**',
      sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, cpuMs: 8 }
  db: { type: db, readMs: 6 }
connections:
  - users -> lb
  - lb -> app
  - app -> db
traffic: { rps: 300, mix: { read: 0.9, write: 0.1 } }
run: { duration: 20s, warmup: 3s }
`,
      choices: ['The network round trip', 'The app servers', 'The database', 'The load balancer'],
      answer: 2,
      verify: ['util(db) > 85%', 'util(app) < 70%'],
      hints: [],
      explanation: 'Look at how busy each component is: the database is close to 100% while the app servers have room to spare. Adding app servers wouldn’t help; the database needs to do less work (a cache) or get faster (a bigger machine).',
    },
    {
      id: 's01-p6',
      kind: 'parsons',
      conceptIds: ['s01-request'],
      prompt: 'Put the steps of one request in order, from the user clicking to the page updating.',
      blocks: ['The browser sends the request over the internet', 'The load balancer picks an app server', 'The app server runs the code', 'The app server queries the database', 'The response travels back to the browser'],
      wrongOrder: ['The load balancer picks an app server', 'The browser sends the request over the internet', 'The app server runs the code', 'The app server queries the database', 'The response travels back to the browser'],
      hints: ['The load balancer sits in front of the app servers.'],
      explanation: 'Browser → (internet) → load balancer → app server → database, then the answer flows back the same way.',
    },
    {
      id: 's01-p7',
      kind: 'fillBlank',
      conceptIds: ['s01-throughput'],
      prompt: 'Fill in the number of instances: each needs **10 ms of CPU** per request on a **medium** machine (4 cores), and traffic is **1,000 requests/s**. Keep **p99 < 100 ms** and **cost < $800/month**.',
      starterSql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, size: medium, cpuMs: 10, instances: ___ }
connections:
  - users -> lb
  - lb -> app
`,
      solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, size: medium, cpuMs: 10, instances: 4 }
connections:
  - users -> lb
  - lb -> app
`,
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, size: medium, cpuMs: 10, instances: 2 }
connections:
  - users -> lb
  - lb -> app
`,
      hints: ['One medium instance: 4 × 1000 / 10 = 400 requests/s at most.', '1,000/s needs at least 3; aim for around 60–70% busy.'],
      explanation: 'Each medium instance completes up to 400/s, so 1,000/s needs 2.5 instances at 100% busy. **4** run at ~63%. They cost 4 × $70 + $20 for the load balancer; the rest of the bill is bandwidth: 1,000 responses/s of 2 KB is about 5 TB a month.',
      sd: { target: 'design', run: { traffic: { rps: 1000 }, durationMs: 20_000, warmupMs: 3_000, requirements: ['p99 < 100ms', 'errors < 0.1%', 'cost < $800'] } },
    },
    {
      id: 's01-p8',
      kind: 'readQuery',
      conceptIds: ['s01-latency-numbers'],
      prompt: 'Which of these takes the **longest**?',
      choices: ['10 Redis GETs in the same data centre, one after another', 'One indexed database read', 'One round trip from Europe to the US'],
      answer: 2,
      hints: [],
      explanation: '10 Redis GETs ≈ 10 × 0.5 ms = 5 ms; an indexed read ≈ 1–5 ms; crossing the Atlantic and back ≈ 80–100 ms. Distance beats everything inside the data centre.',
    },
    {
      id: 's01-p9',
      kind: 'write',
      conceptIds: ['s01-latency-numbers'],
      prompt: 'A page handler makes **12 database queries one after another**. Each takes **3 ms** on the database plus a **0.5 ms** network round trip. How long does the handler spend waiting for the database, in ms?',
      solution: '42',
      wrongExample: '3.5',
      hints: ['Each query costs the query time plus the round trip.', '12 × (3 + 0.5)'],
      explanation: '12 × 3.5 ms = **42 ms**, before any CPU work. Sending the queries in parallel, or combining them into one, would cut this to a few ms. This "N+1 queries" pattern is a classic cause of slow pages.',
      sd: { target: 'estimate', unit: 'ms', tolerance: 0.15 },
    },
    {
      id: 's01-p10',
      kind: 'write',
      conceptIds: ['s01-request', 's01-throughput'],
      prompt: 'Build the classic web design from scratch: **users → load balancer → app servers → database**. Traffic is **400 requests/s** (90% reads). Each request needs the default 5 ms of CPU. Meet **p99 < 100 ms**, no errors, and keep working when one app server crashes: once the load balancer has noticed, **errors < 0.5%** again.',
      starterSql: `components:
  users: { type: client }
connections: []
`,
      solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`,
      wrongExample: `components:
  users: { type: client }
  app: { type: app, instances: 2 }
  db: { type: db }
connections:
  - users -> app
  - app -> db
`,
      hints: ['Drag a load balancer, an app server and a database from the palette, then connect them in order.', 'One small instance completes about 400 requests/s. After a crash, the survivors must still carry all 400.'],
      explanation: 'One small instance completes 2 × 1000 / 5 = 400 requests/s. With **3**, they run at 33% busy; after a crash, 2 survivors run at 50%. With only 2, the survivor would be at 100%: requests queue and get rejected. Requests sent to the dead server fail for a few seconds until the load balancer’s health checks notice (module 3 shows how to hide even that).',
      sd: {
        target: 'design',
        run: {
          traffic: { rps: 400, mix: { read: 0.9, write: 0.1 } },
          durationMs: 40_000,
          warmupMs: 3_000,
          events: [{ atMs: 10_000, action: 'kill', node: 'app', instance: 0 }],
          phases: [{ name: 'recovered', fromMs: 25_000, toMs: 40_000 }],
          requirements: ['p99 < 100ms', 'recovered: errors < 0.5%'],
        },
      },
    },
  ],
  test: [
    {
      id: 's01-t1',
      kind: 'readQuery',
      conceptIds: ['s01-percentiles'],
      prompt: 'Average latency is 40 ms but p99 is 900 ms. What is the best summary?',
      choices: ['The system is fast: the average is low', 'Most requests are fast, but 1 in 100 is very slow, and users hit those often', 'The measurement is wrong: p99 can’t be that far from the average'],
      answer: 1,
      hints: [],
      explanation: 'A long tail: most requests are quick, a few are very slow. A user who loads 100 resources will almost certainly hit one of the slow ones.',
    },
    {
      id: 's01-t2',
      kind: 'write',
      conceptIds: ['s01-throughput'],
      prompt: 'One small instance has 2 cores; each request needs **25 ms** of CPU. What is the most it can complete per second?',
      solution: '80',
      wrongExample: '40',
      hints: [],
      explanation: '2 cores × (1000 / 25) = **80 requests/s**.',
      sd: { target: 'estimate', unit: 'requests/s', tolerance: 0.1 },
    },
    {
      id: 's01-t3',
      kind: 'write',
      conceptIds: ['s01-little'],
      prompt: '500 requests/s, each holding a database connection for **20 ms**. On average, how many connections are in use?',
      solution: '10',
      wrongExample: '25',
      hints: [],
      explanation: "Little's law: 500 × 0.02 s = **10** connections busy on average (bursts need more).",
      sd: { target: 'estimate', unit: 'connections', tolerance: 0.1 },
    },
    {
      id: 's01-t4',
      kind: 'readQuery',
      conceptIds: ['s01-throughput'],
      prompt: 'An app server is at **95% CPU** and p99 has gone from 80 ms to 2 s, but average throughput looks fine. What is happening?',
      choices: ['Nothing: 95% means it is used efficiently', 'It is near capacity: requests queue up, so latency explodes before throughput drops', 'The database must be slow'],
      answer: 1,
      hints: [],
      explanation: 'Near 100% busy, every small burst forms a queue. Throughput is still fine (everything gets done eventually), but waiting time grows without limit. Run at 60–70% to leave room for bursts.',
    },
    {
      id: 's01-t5',
      kind: 'write',
      conceptIds: ['s01-little'],
      prompt: 'A service receives **800 requests/s** and wants at most **50 requests in progress** at once. What is the longest average time each request may take, in ms?',
      solution: '62.5',
      wrongExample: '16',
      hints: [],
      explanation: "Little's law turned around: time = in progress ÷ rate = 50 ÷ 800 s = 0.0625 s = **62.5 ms**.",
      sd: { target: 'estimate', unit: 'ms', tolerance: 0.1 },
    },
    {
      id: 's01-t6',
      kind: 'fixBug',
      conceptIds: ['s01-throughput', 's01-percentiles'],
      prompt: 'Each request needs **40 ms of CPU** and traffic is **150 requests/s**. Tune the app servers (instances or size) so that **p99 < 300 ms** with no errors, for **under $400/month**.',
      starterSql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, cpuMs: 40 }
connections:
  - users -> lb
  - lb -> app
`,
      solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 5, cpuMs: 40 }
connections:
  - users -> lb
  - lb -> app
`,
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, cpuMs: 40 }
connections:
  - users -> lb
  - lb -> app
`,
      hints: [],
      explanation: 'One small instance completes 2 × 1000 / 40 = 50 requests/s. 150/s needs 3 at 100% busy, which queues badly; **5** run at 60%. Two medium instances (4 cores each, 100/s) at 75% also work.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: { rps: 150 }, durationMs: 30_000, warmupMs: 3_000, requirements: ['p99 < 300ms', 'errors < 0.1%', 'cost < $400'] } },
    },
  ],
};
