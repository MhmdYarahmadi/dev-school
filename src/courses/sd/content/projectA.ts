import type { Project } from '../../../content/types';
import type { Traffic } from '../engine/types';

/** Redirects: 99% reads of short links (popularity is very skewed), 1% new links, which are new keys. */
const LAUNCH: Traffic = { rps: 4000, mix: { read: 0.99, write: 0.01 }, keys: 1_000_000, skew: 1, readKb: 0.5, sequentialWrites: true };

const SOLO = `components:
  users: { type: client }
connections: []
`;

const LAUNCH_REF = `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 7, size: medium, cacheOnWrite: write_through }
  cache: { type: cache, memoryMb: 256 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
`;

const REPLICAS = (app: string) => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 7, size: medium, cacheOnWrite: ${app} }
  cache: { type: cache, memoryMb: 256 }
  db: { type: db, replicas: 2 }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
`;

/** Project A (after module 5): a URL shortener, from napkin math to a viral link. */
export const projectA: Project = {
  id: 'sd-project-a',
  title: 'Project A: a URL shortener',
  story: `You are building **zil.ink**, a URL shortener: paste a long URL, get a short link like \`zil.ink/x7Kp2\`. Opening the short link redirects to the long URL.

The product team expects:

- **100 million** new links a month
- **100 redirects** for every link created (people create once, click many times)
- a few links that go **viral**
- links that never change once created, and must work the moment they are created

It’s the classic interview design, done for real. Start with the numbers, then build it, then break it.`,
  tasks: [
    {
      id: 'sda-1',
      prompt: '**How many redirects per second** should you plan for, on average? (100 million new links a month, 100 redirects per link; a month has about 2.6 million seconds.)',
      requirements: [{ label: 'Within 25% of the estimate', sql: 'estimate' }],
      referenceSolution: '3900',
      discussion: `100 M × 100 = 10 billion redirects a month. 10¹⁰ ÷ 2.6 × 10⁶ s ≈ **3,900 redirects/s** on average, against about 40 new links/s. Peaks will be 2–3× higher, and it is overwhelmingly a **read** system: optimise the redirect path.`,
      hints: ['Redirects a month: 100 million × 100.', 'Divide by the seconds in a month.'],
      sd: { target: 'estimate', unit: 'redirects/s' },
    },
    {
      id: 'sda-2',
      prompt: 'Each link takes about **500 bytes** (the long URL, the short code, the owner, timestamps). **How many terabytes** after 5 years?',
      requirements: [{ label: 'Within 25% of the estimate', sql: 'estimate' }],
      referenceSolution: '3',
      discussion: `100 M links × 12 months × 5 years = 6 billion links; × 500 bytes = **3 TB**. That fits on one database server, with indexes and replicas. Data size alone doesn't force partitioning here; the request rate might.`,
      hints: ['Links in 5 years: 100 million × 60.', '× 500 bytes, then 10¹² bytes per TB.'],
      sd: { target: 'estimate', unit: 'TB' },
    },
    {
      id: 'sda-3',
      prompt: `Build the launch design for **4,000 requests/s** (99% redirects, 1% new links; popular links get most clicks). Meet:

- **p99 < 100 ms** and **errors < 0.1%**
- a bill **under $1,100 a month**

You start with just the users. Each app server request takes 5 ms of CPU; a small database does about 1,000 indexed reads a second.`,
      requirements: [
        { label: 'p99 under 100 ms', sql: 'p99 < 100ms' },
        { label: 'Errors under 0.1%', sql: 'errors < 0.1%' },
        { label: 'Under $1,100 a month', sql: 'cost < $1100' },
      ],
      referenceSolution: LAUNCH_REF,
      discussion: `- **App servers:** 4,000 requests × 5 ms is 20 cores of CPU. Seven medium servers (28 cores) run at about 70%.
- **Cache:** link popularity is very skewed, so a 256 MB cache (about a quarter of a million links) answers about 90% of redirects. The 400 misses a second plus the new links fit on one small database.
- **Write-through:** a new link goes straight into the cache, so its first click is a hit.
- **Without a cache** you'd need about four databases' worth of read capacity, plus the connections for all those app servers.

Bandwidth is about $230 of the bill. A CDN can serve the redirect responses too (task 5).`,
      hints: ['Count the CPU first: requests/s × 5 ms = cores needed. Keep them under about 75% busy.', 'Redirect targets are read again and again and never change: perfect for a cache.', 'One small database is enough if most reads are cache hits.'],
      sd: { target: 'design', starter: SOLO, run: { traffic: LAUNCH, durationMs: 20_000, warmupMs: 5_000, warmCache: true } },
    },
    {
      id: 'sda-4',
      prompt: `The database team adds **2 read replicas** for safety. Now support tickets arrive: “I created a link, clicked it to test it, and got **Link not found**”. About 30% of new links are opened by their creator within a second.

Change the settings so **nobody misses their own new link**, keeping **p99 < 100 ms** and **errors < 0.1%**. Keep the replicas.`,
      requirements: [
        { label: 'Every creator finds their new link', sql: 'rywViolations = 0' },
        { label: 'p99 under 100 ms', sql: 'p99 < 100ms' },
        { label: 'Errors under 0.1%', sql: 'errors < 0.1%' },
      ],
      referenceSolution: REPLICAS('write_through'),
      discussion: `With **invalidate**, creating a link deletes nothing useful, so the first click misses the cache, reads a replica, and the replica may not have the link yet.

With **write-through**, the new link goes into the cache as it is created, so the creator's click hits the cache.

Making writes wait for the replicas (\`syncReplicas: 2\`) also works: link creation waits a moment longer, and stalls if a replica is down. Many real shorteners do both.`,
      hints: ['Where does the creator’s first click read from?', 'Can the new link be somewhere fresh before anyone reads it?'],
      sd: { target: 'design', starter: REPLICAS('invalidate'), run: { traffic: { ...LAUNCH, readAfterWrite: 0.3 }, durationMs: 20_000, warmupMs: 5_000, warmCache: true } },
    },
    {
      id: 'sda-5',
      prompt: `A link goes **viral**. At 8 s, traffic triples from **2,000 to 6,000 requests/s**, and **70%** of all clicks are for that one link. Keep **p99 < 100 ms** and **errors < 0.1%**, for **under $1,300 a month**.

You start from a design that's fine at 2,000 requests/s.`,
      requirements: [
        { label: 'p99 under 100 ms', sql: 'p99 < 100ms' },
        { label: 'Errors under 0.1%', sql: 'errors < 0.1%' },
        { label: 'Under $1,300 a month', sql: 'cost < $1300' },
      ],
      referenceSolution: `components:
  users: { type: client }
  cdn: { type: cdn, cacheReads: true }
  lb: { type: lb }
  app: { type: app, instances: 3, size: medium, cacheOnWrite: write_through }
  cache: { type: cache, memoryMb: 256 }
  db: { type: db }
connections:
  - users -> cdn
  - cdn -> lb
  - lb -> app
  - app -> cache
  - app -> db
`,
      discussion: `**The hot key isn't the problem.** The viral link sits in the cache, so the database barely notices it. The **app servers** are: 6,000 requests × 5 ms is 30 cores.

There are two ways through:

- **More app servers** (about 9 medium) behind the same cache.
- **A CDN that caches redirects** (\`cacheReads: true\`). Links never change, so a redirect can be cached at the edge for hours. The viral link is then answered close to the users and never reaches your servers. Most real shorteners do this.

The catch with caching redirects is analytics: if you count clicks, an edge-cached redirect never reaches you. Shorteners either use short edge TTLs or count clicks from the CDN's logs.`,
      hints: ['Which component runs out first? Run it and look at the components table.', 'A redirect for a link that never changes can be cached anywhere, even at the edge.'],
      sd: {
        target: 'design',
        starter: LAUNCH_REF.replace('instances: 7', 'instances: 4'),
        run: {
          traffic: {
            ...LAUNCH,
            rps: [
              [0, 2000],
              [8000, 2000],
              [10_000, 6000],
              [20_000, 6000],
            ],
            hotKey: { share: 0.7, fromMs: 8000 },
          },
          durationMs: 20_000,
          warmupMs: 3000,
          warmCache: true,
        },
      },
    },
  ],
};
