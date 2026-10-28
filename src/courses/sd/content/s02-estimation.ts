import type { Module } from '../../../content/types';

/** Module 2: back-of-the-envelope estimates. Checked by tests/sd-content.test.ts. */
export const s02: Module = {
  id: 's02',
  number: 2,
  title: 'Back-of-the-envelope',
  tagline: 'Turn "10 million users" into requests per second, terabytes, gigabits and servers, in a minute, on a napkin.',
  games: ['napkin'],
  concepts: [
    {
      id: 's02-qps',
      title: 'From users to requests per second',
      card: `Every estimate starts with traffic. Go from what the business knows to what the servers see:

1. **Daily active users** (DAU) × **actions per user per day** = requests per day.
2. ÷ **86,400** seconds in a day (round it to **100,000**) = the **average** rate.
3. × a **peak factor** of 2–3: traffic isn't flat. Evenings, Mondays and launches are busier than the average.

> 10 M DAU × 20 requests = 200 M a day ≈ 2,300/s on average, ≈ **6,000/s at peak**.

Size for the **peak**, not the average. A system that handles the average is overloaded every evening.`,
      predict: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, cpuMs: 20 }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: [[0, 60], [15s, 120], [30s, 300], [35s, 300], [50s, 120], [60s, 60]] }
run: { duration: 60s, warmup: 2s }
`,
        question: 'These two servers can complete 200 requests/s, and the day’s **average** is about 130/s. The evening peak reaches 300/s for a few seconds. What happens?',
        choices: ['Fine: the average is well under capacity', 'A slight slowdown at the peak', 'Requests pile up and get rejected around the peak'],
        answer: 2,
        why: 'Capacity has to cover the peak, not the average. For the seconds above 200/s, requests queue faster than they are served, latency climbs into seconds, and then the queues overflow (503 errors).',
        verify: ['errors > 3%', 'p99 > 1s'],
      },
      example: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, cpuMs: 20 }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: [[0, 60], [15s, 120], [30s, 300], [35s, 300], [50s, 120], [60s, 60]] }
run: { duration: 60s, warmup: 2s }
`,
        note: 'A day squeezed into a minute. Watch the errors at the peak, then give the app 5 instances (300/s ÷ 100/s each, plus headroom) and run again.',
      },
      cheat: { syntax: 'rps = DAU × actions ÷ 86,400 × peak (2–3)', note: '1 M/day ≈ 12/s. Always size for the peak.' },
    },
    {
      id: 's02-storage',
      title: 'Storage',
      card: `How much disk will this need in a few years?

> storage = new items per day × size of each × days kept × copies

- Text is small: a tweet-sized post with its metadata ≈ **1 KB**.
- Media is big: a photo ≈ **200 KB–2 MB**, a minute of video ≈ **10–50 MB**.
- Databases keep **copies**: a primary and two replicas store everything 3 times. Add indexes (often +30–50%).

> 1 M posts a day × 1 KB = 1 GB/day ≈ **365 GB a year**, × 3 copies ≈ 1.1 TB.

Prefixes go up by 1,000: KB → MB → GB → **TB** → PB.`,
      example: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2 }
  db: { type: db, replicas: 2 }
connections:
  - users -> lb
  - lb -> app
  - app -> db
traffic: { rps: 200, mix: { read: 0.8, write: 0.2 } }
run: { duration: 20s, warmup: 2s }
`,
        note: 'This design writes 40 new rows a second. At 1 KB each that is 40 × 86,400 ≈ 3.5 GB a day, about 1.3 TB a year, and the primary plus 2 replicas store it 3 times.',
      },
      cheat: { syntax: 'items/day × size × days × copies', note: 'Text ~1 KB, photo ~500 KB. Replicas multiply storage.' },
    },
    {
      id: 's02-bandwidth',
      title: 'Bandwidth and its bill',
      card: `**Bandwidth** = requests per second × the size of each response.

> 2,000 req/s × 50 KB = 100 MB/s = **800 Mbit/s**. (× 8 for bits; network links are sold in bits.)

Bandwidth matters for two reasons:

- **Links have limits**: a server's network card, a load balancer, the office uplink.
- **Clouds bill for data leaving them**, about **$0.09 per GB**. 100 MB/s for a month is about 260 TB: over **$20,000**.

That is why big files (images, video, downloads) go through a **CDN**, which is cheaper per GB and closer to the users.`,
      predict: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> db
traffic: { rps: 500, mix: { read: 1 }, readKb: 100 }
run: { duration: 20s, warmup: 2s }
`,
        question: 'Two small servers and a database cost about $160 a month. Each of the 500 responses a second is 100 KB. Roughly what is the total monthly bill?',
        choices: ['About $200: servers are the main cost', 'About $1,000', 'Over $10,000: the bandwidth dominates'],
        answer: 2,
        why: '500 × 100 KB = 50 MB/s, about 130 TB a month. At $0.09/GB that is about $11,000, nearly 70 times the servers. Check the cost breakdown after the run.',
        verify: ['cost > $10000'],
      },
      example: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> db
traffic: { rps: 500, mix: { read: 1 }, readKb: 100 }
run: { duration: 20s, warmup: 2s }
`,
        note: 'Run it and look at the monthly cost. Then change readKb to 5 (a compressed JSON response) and run again.',
      },
      cheat: { syntax: 'rps × size; MB/s × 8 = Mbit/s', note: 'Egress ≈ $0.09/GB. 1 MB/s ≈ 2.6 TB/month.' },
    },
    {
      id: 's02-memory',
      title: 'Sizing a cache',
      card: `You rarely need to cache everything. Popularity is **skewed**: a small share of items gets most of the reads (the **80/20 rule**: about 20% of the items get 80% of the traffic).

> cache memory ≈ items × size × the share you want to keep (often 20%)

> 50 M products × 2 KB = 100 GB in total. Caching the hottest 20% needs **20 GB**: one cache server.

Then check the **hit ratio**, the share of reads the cache answers. Doubling the memory often adds only a few percent, because the items left out are the rarely read ones.`,
      predict: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, size: medium }
  cache: { type: cache, memoryMb: 20 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
traffic: { rps: 1000, mix: { read: 1 }, keys: 100000, skew: 0.9 }
run: { duration: 20s, warmup: 3s, warmCache: true }
`,
        question: 'There are 100,000 items of 1 KB (100 MB), and the cache has room for **20 MB**: a fifth of them. What share of reads will it answer?',
        choices: ['About 20%: it holds 20% of the items', 'About 50%', 'About 75–80%: the popular items get most reads'],
        answer: 2,
        why: 'The cache keeps the items read most often (LRU), and popularity is skewed, so a fifth of the items covers most of the reads. Item popularity in the real world follows this kind of curve (a Zipf distribution).',
        verify: ['hitRatio > 70%', 'hitRatio < 88%'],
      },
      example: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, size: medium }
  cache: { type: cache, memoryMb: 20 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
traffic: { rps: 1000, mix: { read: 1 }, keys: 100000, skew: 0.9 }
run: { duration: 20s, warmup: 3s, warmCache: true }
`,
        note: 'Note the hit ratio, then try memoryMb: 40 and memoryMb: 100 (everything fits). Each doubling buys less.',
      },
      cheat: { syntax: 'cache ≈ items × size × 20%', note: 'Skewed popularity: a small cache answers most reads.' },
    },
    {
      id: 's02-servers',
      title: 'How many servers?',
      card: `Finish the estimate by turning the peak rate into machines:

> servers = peak rps ÷ (what one server handles × target utilisation)

- **What one server handles**: cores × 1000 ÷ CPU ms per request, or a measured number from a load test.
- **Target utilisation**: 60–70%, which leaves room for bursts and for one server failing.
- Then add **one more** for redundancy, and round up.

> Peak 900/s, 200/s per server, 65% target: 900 ÷ 130 ≈ 7 servers.

Do the same for the database (reads and writes per second), the cache (memory) and the network (bandwidth). The tightest resource decides the design.`,
      example: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, cpuMs: 10, instances: 6 }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: [[0, 300], [20s, 900], [40s, 900], [60s, 300]] }
run: { duration: 60s, warmup: 3s }
requirements:
  - p99 < 120ms
  - errors < 0.1%
`,
        note: 'Each small server handles 2 × 1000 / 10 = 200 requests/s. Try 5 instances (90% busy at the peak) and compare the p99.',
      },
      cheat: { syntax: 'servers = peak ÷ (per-server × 0.65), +1', note: 'Check CPU, DB, memory and network; the tightest wins.' },
    },
  ],
  practice: [
    {
      id: 's02-p1',
      kind: 'write',
      conceptIds: ['s02-qps'],
      prompt: 'A chat app has **10 million daily active users**, and each sends **20 requests a day**. What is the **average** rate in requests per second?',
      solution: '2315',
      wrongExample: '200000000',
      hints: ['First requests per day: 10 M × 20.', '200 M ÷ 86,400 seconds.'],
      explanation: '10 M × 20 = 200 M requests a day; ÷ 86,400 ≈ **2,300/s**. Rounding 86,400 to 100,000 gives 2,000/s: close enough for an estimate.',
      sd: { target: 'estimate', unit: 'requests/s' },
    },
    {
      id: 's02-p2',
      kind: 'write',
      conceptIds: ['s02-qps'],
      prompt: 'A shop has **5 million DAU**, each loading **10 pages a day**. The evening peak is **2.5×** the average. What **peak** rate must it handle, in pages per second?',
      solution: '1447',
      wrongExample: '579',
      hints: ['Average: 5 M × 10 ÷ 86,400.', 'Then multiply the average by the peak factor.'],
      explanation: '50 M pages ÷ 86,400 ≈ 580/s on average; × 2.5 ≈ **1,450/s** at peak. (579 is the average: sizing for it would fail every evening.)',
      sd: { target: 'estimate', unit: 'pages/s' },
    },
    {
      id: 's02-p3',
      kind: 'write',
      conceptIds: ['s02-storage'],
      prompt: 'Users upload **2 million photos a day**, **500 KB** each. How much storage do the photos need **per year**, in TB (one copy)?',
      solution: '365',
      wrongExample: '1',
      hints: ['Per day: 2 M × 500 KB = 1,000,000 MB.', '1,000,000 MB = 1 TB a day.'],
      explanation: '2 M × 0.5 MB = 1 TB a day; × 365 ≈ **365 TB** a year. Object storage keeps several copies internally, but you pay per stored GB.',
      sd: { target: 'estimate', unit: 'TB' },
    },
    {
      id: 's02-p4',
      kind: 'write',
      conceptIds: ['s02-bandwidth'],
      prompt: 'An image service answers **3,000 requests/s**, each **200 KB**. How much outgoing bandwidth is that, in **MB/s**?',
      solution: '600',
      wrongExample: '4800',
      hints: ['3,000 × 200 KB = 600,000 KB per second.'],
      explanation: '3,000 × 200 KB = 600,000 KB/s = **600 MB/s**, which is 4.8 Gbit/s. (4,800 is the answer in megabits.) Over a month that is about 1.5 PB: a job for a CDN.',
      sd: { target: 'estimate', unit: 'MB/s' },
    },
    {
      id: 's02-p5',
      kind: 'write',
      conceptIds: ['s02-memory'],
      prompt: 'A catalogue has **50 million items** of **2 KB** each. You want to cache the hottest **20%**. How much cache memory is that, in **GB**?',
      solution: '20',
      wrongExample: '100',
      hints: ['All items: 50 M × 2 KB = 100 GB.', 'Then take 20%.'],
      explanation: '50 M × 2 KB = 100 GB; 20% of that = **20 GB**. It fits in one large cache server (or a few small ones).',
      sd: { target: 'estimate', unit: 'GB' },
    },
    {
      id: 's02-p6',
      kind: 'write',
      conceptIds: ['s02-servers'],
      prompt: 'Peak traffic is **12,000 requests/s**. A load test shows one server handles **1,500/s** at full CPU. You target **65%** utilisation. How many servers are needed (before adding a spare)?',
      solution: '13',
      wrongExample: '8',
      hints: ['At 65%, one server handles 1,500 × 0.65 ≈ 975/s.', '12,000 ÷ 975, rounded up.'],
      explanation: '1,500 × 0.65 = 975/s per server; 12,000 ÷ 975 ≈ 12.3 → **13** servers (14 with a spare). 8 would run them at 100%.',
      sd: { target: 'estimate', unit: 'servers', tolerance: 0.1 },
    },
    {
      id: 's02-p7',
      kind: 'readQuery',
      conceptIds: ['s02-qps'],
      prompt: 'Why do estimates multiply the average rate by a **peak factor**?',
      choices: ['To add a safety margin for bugs', 'Because traffic varies over the day and week, and the system must cope with the busiest time', 'Because averages are hard to measure'],
      answer: 1,
      hints: [],
      explanation: 'Users are not spread evenly over 24 hours. Evenings, weekdays, sales and launches can be 2–3× (or 10×) the daily average, and that is when the system must not fall over.',
    },
    {
      id: 's02-p8',
      kind: 'parsons',
      conceptIds: ['s02-qps', 's02-servers'],
      prompt: 'Put the steps of a capacity estimate in order.',
      blocks: ['Daily active users × actions per user = requests per day', 'Divide by 86,400 for the average rate', 'Multiply by the peak factor', 'Divide by what one server handles at the target utilisation', 'Add a spare server and round up'],
      wrongOrder: ['Daily active users × actions per user = requests per day', 'Multiply by the peak factor', 'Divide by what one server handles at the target utilisation', 'Divide by 86,400 for the average rate', 'Add a spare server and round up'],
      hints: ['Start from users, end with machines.'],
      explanation: 'Users → requests a day → average per second → peak per second → servers → plus redundancy.',
    },
    {
      id: 's02-p9',
      kind: 'fillBlank',
      conceptIds: ['s02-servers'],
      prompt: 'Traffic peaks at **900 requests/s**. Each request needs **10 ms** of CPU on a small server (2 cores). Fill in the number of instances so that **p99 < 120 ms** at the peak, with no errors, for **under $600/month**.',
      starterSql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, cpuMs: 10, instances: ___ }
connections:
  - users -> lb
  - lb -> app
`,
      solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, cpuMs: 10, instances: 6 }
connections:
  - users -> lb
  - lb -> app
`,
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, cpuMs: 10, instances: 5 }
connections:
  - users -> lb
  - lb -> app
`,
      hints: ['One server: 2 × 1000 / 10 = 200 requests/s.', 'At 65%, one server handles 130/s at the peak.'],
      explanation: '900 ÷ (200 × 0.65) ≈ 6.9, and **6** (75% busy) is the smallest number that meets p99. 5 would be 90% busy at the peak, where the tail gets long. 7 also works if the budget allows.',
      sd: {
        target: 'design',
        run: {
          traffic: { rps: [[0, 300], [20_000, 900], [40_000, 900], [60_000, 300]] },
          durationMs: 60_000,
          warmupMs: 3_000,
          requirements: ['p99 < 120ms', 'errors < 0.1%', 'cost < $600'],
        },
      },
    },
    {
      id: 's02-p10',
      kind: 'readQuery',
      conceptIds: ['s02-bandwidth'],
      prompt: 'Finance asks why this small service costs so much. The simulator ran it with production traffic. **What is the main cost?**',
      sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> db
traffic: { rps: 400, mix: { read: 0.9, static: 0.1 }, readKb: 20, staticKb: 1000 }
run: { duration: 20s, warmup: 2s }
`,
      choices: ['The app servers', 'The database', 'Data sent to users: the 1 MB static files', 'The load balancer'],
      answer: 2,
      verify: ['cost > $10000', 'util(app) < 50%'],
      hints: [],
      explanation: '40 files a second × 1 MB = 40 MB/s, about 100 TB a month, all billed as egress at $0.09/GB, about $9,000. Serving those files from object storage through a CDN costs less per GB and takes the load off the app servers.',
    },
  ],
  test: [
    {
      id: 's02-t1',
      kind: 'write',
      conceptIds: ['s02-qps'],
      prompt: 'An API receives **100 million requests a day**. What is the average rate, in requests per second?',
      solution: '1157',
      wrongExample: '100000',
      hints: [],
      explanation: '100 M ÷ 86,400 ≈ **1,160/s** (the quick version: 100 M ÷ 100 k = 1,000/s).',
      sd: { target: 'estimate', unit: 'requests/s' },
    },
    {
      id: 's02-t2',
      kind: 'write',
      conceptIds: ['s02-storage'],
      prompt: 'A logging system stores **500 GB a day** and keeps it for **3 years**, with **3 copies**. How much storage is that, in **TB**?',
      solution: '1642',
      wrongExample: '547',
      hints: [],
      explanation: '500 GB × 1,095 days ≈ 548 TB; × 3 copies ≈ **1,640 TB** (1.6 PB). Logs are often compressed 5–10× or moved to cheaper storage after a few weeks.',
      sd: { target: 'estimate', unit: 'TB' },
    },
    {
      id: 's02-t3',
      kind: 'write',
      conceptIds: ['s02-bandwidth'],
      prompt: 'A video service streams to **10,000** viewers at once, each at **5 Mbit/s**. How much bandwidth is that, in **Gbit/s**?',
      solution: '50',
      wrongExample: '6.25',
      hints: [],
      explanation: '10,000 × 5 Mbit/s = 50,000 Mbit/s = **50 Gbit/s**. (6.25 is GB/s.) Only CDNs serve this kind of volume economically.',
      sd: { target: 'estimate', unit: 'Gbit/s' },
    },
    {
      id: 's02-t4',
      kind: 'write',
      conceptIds: ['s02-memory'],
      prompt: '**20 million** user profiles of **5 KB** each. You cache the hottest **10%**. How much memory, in **GB**?',
      solution: '10',
      wrongExample: '100',
      hints: [],
      explanation: '20 M × 5 KB = 100 GB; 10% = **10 GB**.',
      sd: { target: 'estimate', unit: 'GB' },
    },
    {
      id: 's02-t5',
      kind: 'readQuery',
      conceptIds: ['s02-servers'],
      prompt: 'Your estimate says **8 servers** run at 100% CPU at peak. How many should you plan for?',
      choices: ['8: that is exactly enough', 'About 12–14: run at 60–70%, plus a spare for a failure', '80: ten times the estimate to be safe'],
      answer: 1,
      hints: [],
      explanation: '8 ÷ 0.65 ≈ 12.3, so 13, plus one so that a crash or a deployment doesn’t push the rest past their limit. Ten times is waste: estimates are rough, but not that rough.',
    },
    {
      id: 's02-t6',
      kind: 'fixBug',
      conceptIds: ['s02-servers', 's02-qps'],
      prompt: 'This service was sized for the **average** (about 400/s). Its evening peak reaches **1,000/s**, and each request needs **10 ms** of CPU. Tune it to survive the peak with **p99 < 120 ms**, no errors and **cost < $700/month**.',
      starterSql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, cpuMs: 10, instances: 3 }
connections:
  - users -> lb
  - lb -> app
`,
      solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, cpuMs: 10, instances: 7 }
connections:
  - users -> lb
  - lb -> app
`,
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, cpuMs: 10, instances: 5 }
connections:
  - users -> lb
  - lb -> app
`,
      hints: [],
      explanation: 'One small server handles 200/s. At the 1,000/s peak, 5 would be at 100%; **7** run at about 70%. Three medium servers (400/s each, 83%) are cheaper per core but cut it close.',
      sd: {
        target: 'design',
        tuneOnly: true,
        run: {
          traffic: { rps: [[0, 300], [20_000, 1000], [40_000, 1000], [60_000, 300]] },
          durationMs: 60_000,
          warmupMs: 3_000,
          requirements: ['p99 < 120ms', 'errors < 0.1%', 'cost < $700'],
        },
      },
    },
  ],
};
