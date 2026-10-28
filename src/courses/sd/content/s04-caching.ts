import type { Module } from '../../../content/types';

/** The read-heavy shop used across the module: 1,200 requests/s, 95% reads, 100k products. */
const SHOP = (cache: string, app = '', run = 'run: { duration: 30s, warmup: 5s, warmCache: true }\n') => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, size: medium${app} }
${cache ? `  cache: { type: cache${cache} }\n` : ''}  db: { type: db }
connections:
  - users -> lb
  - lb -> app
${cache ? '  - app -> cache\n' : ''}  - app -> db
traffic: { rps: 1200, mix: { read: 0.95, write: 0.05 }, keys: 100000, skew: 0.9 }
${run}`;

const design = (scenario: string) => scenario.slice(0, scenario.indexOf('traffic:'));

/** Module 4: caching. Checked by tests/sd-content.test.ts. */
export const s04: Module = {
  id: 's04',
  number: 4,
  title: 'Caching',
  tagline: 'Keep hot data in memory: cache-aside, invalidation, eviction, write strategies, stampedes and CDNs.',
  games: ['cachegame'],
  concepts: [
    {
      id: 's04-aside',
      title: 'Cache-aside',
      card: `Databases do real work for every read: parse, plan, read pages, maybe hit the disk. A **cache** (Redis, Memcached) keeps answers in memory and returns them in a fraction of a millisecond.

The most common pattern is **cache-aside** (lazy loading):

1. The app asks the cache for the key.
2. **Hit**: return it. The database is never touched.
3. **Miss**: read from the database, **store the result in the cache**, return it.

Reads are usually far more common than writes, and popular items are read again and again, so a cache often answers **90%+** of reads. The database then only sees the misses and the writes.`,
      predict: {
        sql: SHOP(''),
        question: 'A shop: 1,200 requests a second, 95% of them reads, all going to one small database. What happens?',
        choices: ['Fine: databases are fast', 'The database is saturated: latency climbs and requests are rejected', 'Only writes are slow'],
        answer: 1,
        why: 'A small database does about 1,000 indexed reads a second, and it gets more than that, plus writes. It runs at 100%, requests queue, and the app servers start rejecting them.',
        verify: ['util(db) > 95%', 'errors > 5%'],
      },
      example: {
        sql: SHOP(''),
        note: 'Add a cache: drag one from the palette and connect app → cache. Run again and compare the database’s utilisation and the p99.',
      },
      cheat: { syntax: 'get → miss → read DB → set → return', note: 'Cache-aside: the app fills the cache on misses.' },
    },
    {
      id: 's04-invalidate',
      title: 'Invalidation and TTL',
      card: `A cache holds **copies**. When the data changes in the database, the copy is **stale** until something fixes it. Options:

- **Invalidate on write**: after writing to the database, delete the key from the cache. The next read misses and loads the new value. The usual choice.
- **TTL** (time to live): every entry expires after N seconds. Staleness is bounded by the TTL, but not zero, and short TTLs mean more misses.
- **Do nothing**: the copy stays wrong until it is evicted. Users see old prices, old names, deleted posts.

> There are only two hard things in computer science: cache invalidation and naming things. (Phil Karlton)

Many systems combine both: invalidate on write, plus a TTL as a safety net.`,
      predict: {
        sql: SHOP(', memoryMb: 512', ', cacheOnWrite: none'),
        question: 'This app updates the database on writes but **never touches the cache**. Products are updated 60 times a second. Will users see stale data?',
        choices: ['No: reads go to the cache, which is fast', 'Rarely: only during the write itself', 'Yes, thousands of times: popular items stay cached with old values'],
        answer: 2,
        why: 'Popular products are both updated and read the most. Their cached copies never expire, so after an update every read of them returns the old version.',
        verify: ['staleReads > 1000'],
      },
      example: {
        sql: SHOP(', memoryMb: 512', ', cacheOnWrite: none'),
        note: 'Count the stale reads. Then try ttlMs: 2000 on the cache (fewer, but not zero, and the hit ratio drops), and finally cacheOnWrite: invalidate on the app.',
      },
      cheat: { syntax: 'cacheOnWrite: invalidate · ttlMs', note: 'Delete the key on write; a TTL bounds the damage if you miss one.' },
    },
    {
      id: 's04-evict',
      title: 'Memory and eviction',
      card: `Cache memory is limited (and costs money). When it is full, the cache must **evict** something to make room. The usual policy is **LRU**: throw out the least recently used entry.

How much memory do you need? Because popularity is skewed, the **hit ratio** grows quickly at first, then slowly:

| Memory (of 100 MB of data) | Typical hit ratio |
|---|---|
| 15% | ~70% |
| 50% | ~88% |
| 100% | ~97% (the rest are writes invalidating keys) |

Each doubling buys less. Size the cache for the hit ratio the database needs, not "everything".`,
      example: {
        sql: SHOP(', memoryMb: 16'),
        note: 'The data is about 100 MB (100,000 items of 1 KB). Try memoryMb 16, 50 and 200, and watch the hit ratio and the database’s utilisation.',
      },
      cheat: { syntax: 'memoryMb · LRU eviction', note: 'Hit ratio grows fast, then slowly. Size for what the DB needs.' },
    },
    {
      id: 's04-write',
      title: 'Write-through and write-back',
      card: `What should a **write** do to the cache?

- **Invalidate** (cache-aside): write the database, delete the key. Simple and safe.
- **Write-through**: write the database, then put the new value in the cache. The next read is a hit, not a miss.
- **Write-back** (write-behind): write **only the cache**, and flush to the database later. Writes are very fast, and many writes to the same key become one database write…
  …but if the cache dies before flushing, those writes are **lost**, even though the user was told "saved".

Write-back suits data you can afford to lose (view counters, metrics). Never use it for orders or payments.`,
      predict: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, size: medium, cacheOnWrite: write_back }
  cache: { type: cache, memoryMb: 512 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
traffic: { rps: 1200, mix: { read: 0.95, write: 0.05 }, keys: 100000, skew: 0.9 }
run: { duration: 30s, warmup: 5s, warmCache: true }
events:
  - { at: 20s, action: kill, node: cache }
`,
        question: 'Writes go to the cache first and are flushed to the database within a second. At 20 s, the cache server crashes. What happens to the writes it was holding?',
        choices: ['They are retried from the cache when it comes back', 'They are lost: users were told "saved", but the database never got them', 'The database already had them'],
        answer: 1,
        why: 'A cache keeps data in memory. Everything written to it in the last second and not flushed yet disappears with the process. Check "lost writes" in the results.',
        verify: ['lostWrites > 10'],
      },
      example: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, size: medium, cacheOnWrite: write_back }
  cache: { type: cache, memoryMb: 512 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
traffic: { rps: 1200, mix: { read: 0.95, write: 0.05 }, keys: 100000, skew: 0.9 }
run: { duration: 30s, warmup: 5s, warmCache: true }
events:
  - { at: 20s, action: kill, node: cache }
`,
        note: 'Change cacheOnWrite to write_through and run again: no lost writes, still a high hit ratio.',
      },
      cheat: { syntax: 'invalidate · write_through · write_back', note: 'Write-back is fast but loses writes when the cache dies.' },
    },
    {
      id: 's04-stampede',
      title: 'Hot keys and stampedes',
      card: `Some keys are **hot**: the home page, a viral post, today's deal. When a hot key expires (or the cache restarts), every request for it misses **at the same moment**, and they all run the same expensive query: a **cache stampede** (thundering herd).

Defences:
- **Request coalescing** (single flight): only one request per server loads the key; the others wait for its result (\`singleFlight: true\`).
- **Refresh ahead**: reload hot keys shortly before they expire.
- **Spread keys over several cache nodes**: a node restart then empties only part of the cache.
- Add **jitter** to TTLs so keys don't all expire together.`,
      predict: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, size: medium }
  cache: { type: cache, ttlMs: 10000 }
  db: { type: db, readMs: 50 }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
traffic: { rps: 2000, mix: { read: 1 }, keys: 50, skew: 0.5, hotKey: { share: 0.9 } }
run: { duration: 30s, warmup: 3s, warmCache: true }
`,
        question: '90% of requests read one hot key whose query takes 50 ms. It is cached with a 10 s TTL, so the cache answers 99% of reads. How is p99?',
        choices: ['Excellent: 99% hits', 'Spikes every 10 s: each expiry sends ~100 identical queries to the database at once'],
        answer: 1,
        why: 'During the 50 ms the first miss takes, another ~100 requests for the same key miss too and each starts its own query. The database queues them, and every 10 seconds latency spikes.',
        verify: ['hitRatio > 98%', 'p99 > 300ms'],
      },
      example: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, size: medium }
  cache: { type: cache, ttlMs: 10000 }
  db: { type: db, readMs: 50 }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
traffic: { rps: 2000, mix: { read: 1 }, keys: 50, skew: 0.5, hotKey: { share: 0.9 } }
run: { duration: 30s, warmup: 3s, warmCache: true }
`,
        note: 'Set singleFlight: true on the app and run again: one query per server per expiry, and the spikes are gone.',
      },
      cheat: { syntax: 'singleFlight: true', note: 'Coalesce misses for the same key; spread keys over nodes; jitter TTLs.' },
    },
    {
      id: 's04-cdn',
      title: 'CDNs',
      card: `A **CDN** (content delivery network) is a cache run by someone else, with servers ("edges") in hundreds of cities. Users connect to the nearest edge, often **5–20 ms** away instead of 50–150 ms.

- **Static files** (images, scripts, styles, video) are the classic use: they rarely change and are big.
- The edge serves repeats from its cache; only misses go back to your **origin** (your servers or object storage).
- CDN bandwidth is cheaper than serving from your own servers, and the load on them drops.
- Some CDNs also cache API responses that are the same for everyone (a product page, not a shopping cart).

Change a cached file? Give it a new name (\`app.3f9c.js\`) instead of waiting for the TTL.`,
      example: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2 }
  files: { type: objectstore }
connections:
  - users -> lb
  - lb -> app
  - app -> files
traffic: { rps: 600, mix: { static: 0.7, read: 0.3 }, keys: 2000, staticKb: 50 }
run: { duration: 30s, warmup: 3s }
`,
        note: '70% of requests are images. Add a CDN between the users and the load balancer (users → cdn → lb) and compare the median latency, the app’s load and the bill.',
      },
      cheat: { syntax: 'users → cdn → origin', note: 'Static files at the edge: closer, cheaper, less load on you.' },
    },
  ],
  practice: [
    {
      id: 's04-p1',
      kind: 'parsons',
      conceptIds: ['s04-aside'],
      prompt: 'Put the steps of a **cache-aside read** in order (for a miss).',
      blocks: ['The app asks the cache for the key', 'The cache says it doesn’t have it (a miss)', 'The app reads the row from the database', 'The app stores the result in the cache', 'The app returns the result'],
      wrongOrder: ['The app reads the row from the database', 'The app asks the cache for the key', 'The cache says it doesn’t have it (a miss)', 'The app stores the result in the cache', 'The app returns the result'],
      hints: ['The cache is always asked first.'],
      explanation: 'Cache first; on a miss, the database, then fill the cache so that the next read is a hit.',
    },
    {
      id: 's04-p2',
      kind: 'write',
      conceptIds: ['s04-aside'],
      prompt: 'The database is overwhelmed by reads. Add what is needed so that **p99 < 100 ms**, **errors < 0.1%**, and the database stays **under 60% busy**.',
      starterSql: design(SHOP('')),
      solution: design(SHOP(', memoryMb: 512')),
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 6, size: medium }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`,
      hints: ['More app servers send the database just as many queries.', 'Add a cache and connect the app to it.'],
      explanation: 'With a cache, ~95% of reads never reach the database; it only sees misses and writes, around 20% busy. More app servers don’t help: the database is the bottleneck.',
      sd: { target: 'design', run: { traffic: { rps: 1200, mix: { read: 0.95, write: 0.05 }, keys: 100_000, skew: 0.9 }, durationMs: 30_000, warmupMs: 5_000, warmCache: true, requirements: ['p99 < 100ms', 'errors < 0.1%', 'util(db) < 60%'] } },
    },
    {
      id: 's04-p3',
      kind: 'fixBug',
      conceptIds: ['s04-invalidate'],
      prompt: 'Customers see old prices after an update. Fix it so there are **no stale reads**, keeping the cache.',
      starterSql: design(SHOP(', memoryMb: 512', ', cacheOnWrite: none')),
      solution: design(SHOP(', memoryMb: 512', ', cacheOnWrite: invalidate')),
      wrongExample: design(SHOP(', memoryMb: 512, ttlMs: 5000', ', cacheOnWrite: none')),
      hints: ['A TTL makes stale data expire, but until then it is still stale.', 'What should the app do to the cached copy when it writes?'],
      explanation: '**Invalidate on write**: delete the key after updating the database, so the next read loads the new value. A TTL only limits how long stale data lives. (Write-through also passes.)',
      sd: { target: 'design', tuneOnly: true, run: { traffic: { rps: 1200, mix: { read: 0.95, write: 0.05 }, keys: 100_000, skew: 0.9 }, durationMs: 30_000, warmupMs: 5_000, warmCache: true, requirements: ['staleReads = 0', 'p99 < 100ms'] } },
    },
    {
      id: 's04-p4',
      kind: 'write',
      conceptIds: ['s04-aside', 's04-evict'],
      prompt: 'Users make **5,000 reads/s**. The database can handle **400 reads/s** comfortably. What **hit ratio** (in %) must the cache reach, at least?',
      solution: '92',
      wrongExample: '8',
      hints: ['Misses go to the database: 5,000 × (1 − hit ratio) ≤ 400.'],
      explanation: 'At most 400 of 5,000 reads may miss: 8%. So the hit ratio must be at least **92%**.',
      sd: { target: 'estimate', unit: '%', tolerance: 0.03 },
    },
    {
      id: 's04-p5',
      kind: 'fillBlank',
      conceptIds: ['s04-evict'],
      prompt: 'The data is about **100 MB**. Fill in the cache memory (MB) to reach a **hit ratio above 85%** without caching everything: **under 64 MB**.',
      starterSql: design(SHOP(', memoryMb: ___')),
      solution: design(SHOP(', memoryMb: 50')),
      wrongExample: design(SHOP(', memoryMb: 16')),
      hints: ['Popularity is skewed: half the memory gives much more than half the hits.'],
      explanation: 'About **50 MB** (half the data) gives ~88%. 16 MB gives ~71%. Anything from about 40 MB up passes; the exercise caps it below 64 MB to show you don’t need it all.',
      sd: {
        target: 'design',
        run: { traffic: { rps: 1200, mix: { read: 0.95, write: 0.05 }, keys: 100_000, skew: 0.9 }, durationMs: 30_000, warmupMs: 5_000, warmCache: true, requirements: ['hitRatio > 85%', 'p99 < 100ms'] },
      },
    },
    {
      id: 's04-p6',
      kind: 'readQuery',
      conceptIds: ['s04-evict'],
      prompt: 'The cache is in place, but the database is still busy. The simulator ran it. **What is the problem?**',
      sql: SHOP(', memoryMb: 4'),
      choices: ['The cache is too small: it can hold only a few % of the data, so many reads miss', 'The cache is too slow', 'Writes are invalidating everything', 'The app servers are overloaded'],
      answer: 0,
      verify: ['hitRatio < 60%', 'util(db) > 60%'],
      hints: [],
      explanation: '4 MB holds 4% of the items. Even with skewed popularity, half the reads miss. Writes are only 5% of traffic and invalidate one key each.',
    },
    {
      id: 's04-p7',
      kind: 'fixBug',
      conceptIds: ['s04-write'],
      prompt: 'Orders are written **write-back** for speed, and a cache restart just lost some. Fix it: **no lost writes** when the cache crashes (it restarts a second later).',
      starterSql: design(SHOP(', memoryMb: 512', ', cacheOnWrite: write_back')),
      solution: design(SHOP(', memoryMb: 512', ', cacheOnWrite: write_through')),
      wrongExample: design(SHOP(', memoryMb: 512, flushMs: 200', ', cacheOnWrite: write_back')),
      hints: ['Flushing more often shrinks the window, but doesn’t close it.'],
      explanation: 'Write-through (or invalidate) writes the database **first**, so a cache crash loses only copies. A shorter flush interval still loses whatever is in flight.',
      sd: {
        target: 'design',
        tuneOnly: true,
        run: {
          traffic: { rps: 1200, mix: { read: 0.95, write: 0.05 }, keys: 100_000, skew: 0.9 },
          durationMs: 30_000,
          warmupMs: 5_000,
          warmCache: true,
          events: [
            { atMs: 20_000, action: 'kill', node: 'cache' },
            { atMs: 21_000, action: 'restore', node: 'cache' },
          ],
          requirements: ['lostWrites = 0'],
        },
      },
    },
    {
      id: 's04-p8',
      kind: 'fixBug',
      conceptIds: ['s04-stampede'],
      prompt: 'Every 10 seconds, when the home page’s cache entry expires, latency spikes. Tune the design: **p99 < 150 ms**, no errors.',
      starterSql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, size: medium }
  cache: { type: cache, ttlMs: 10000 }
  db: { type: db, readMs: 50 }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
`,
      solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, size: medium, singleFlight: true }
  cache: { type: cache, ttlMs: 10000 }
  db: { type: db, readMs: 50 }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
`,
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 8, size: medium }
  cache: { type: cache, ttlMs: 10000 }
  db: { type: db, readMs: 50 }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
`,
      hints: ['The problem is many identical queries at the same moment.', 'Look at the app’s singleFlight setting.'],
      explanation: '**Request coalescing**: with singleFlight, only one request per server reloads the expired key; the others wait for it. Without it, ~100 identical 50 ms queries pile onto the database at every expiry. More app servers make the herd bigger.',
      sd: {
        target: 'design',
        tuneOnly: true,
        run: { traffic: { rps: 2000, mix: { read: 1 }, keys: 50, skew: 0.5, hotKey: { share: 0.9 } }, durationMs: 30_000, warmupMs: 3_000, warmCache: true, requirements: ['p99 < 150ms', 'errors < 0.1%'] },
      },
    },
    {
      id: 's04-p9',
      kind: 'write',
      conceptIds: ['s04-cdn'],
      prompt: '70% of requests are **images**, served by the app from object storage. Users are 40 ms away. Get the **median latency under 30 ms**.',
      starterSql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2 }
  files: { type: objectstore }
connections:
  - users -> lb
  - lb -> app
  - app -> files
`,
      solution: `components:
  users: { type: client }
  cdn: { type: cdn }
  lb: { type: lb }
  app: { type: app, instances: 2 }
  files: { type: objectstore }
connections:
  - users -> cdn
  - cdn -> lb
  - lb -> app
  - app -> files
`,
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 6, size: large }
  files: { type: objectstore }
connections:
  - users -> lb
  - lb -> app
  - app -> files
`,
      hints: ['No server in your region is closer than 40 ms to the users.', 'Put a CDN in front: users → cdn → lb.'],
      explanation: 'The median request is an image, and a CDN edge ~10 ms away answers it from its cache. Faster servers can’t beat the 40 ms round trip to your region.',
      sd: { target: 'design', run: { traffic: { rps: 600, mix: { static: 0.7, read: 0.3 }, keys: 2000, staticKb: 50 }, durationMs: 30_000, warmupMs: 3_000, requirements: ['p50 < 30ms', 'errors < 0.1%'] } },
    },
    {
      id: 's04-p10',
      kind: 'readQuery',
      conceptIds: ['s04-cdn', 's04-aside'],
      prompt: 'Which of these is the **worst** candidate for a shared cache or CDN?',
      choices: ['A product’s description and photos', 'The site’s JavaScript bundle', 'A user’s shopping cart total during checkout', 'The list of countries for an address form'],
      answer: 2,
      hints: [],
      explanation: 'The cart is per user, changes constantly and must be exactly right at checkout. The others are read often, change rarely and are the same for everyone: ideal for caching.',
    },
  ],
  test: [
    {
      id: 's04-t1',
      kind: 'readQuery',
      conceptIds: ['s04-write'],
      prompt: 'When is **write-back** caching an acceptable choice?',
      choices: ['For payments: it makes them faster', 'For data where losing the last second of writes is acceptable, like view counters', 'Always: caches never crash'],
      answer: 1,
      hints: [],
      explanation: 'Write-back acknowledges writes before they are durable. Fine for counters and metrics; never for money, orders or anything users were promised was saved.',
    },
    {
      id: 's04-t2',
      kind: 'write',
      conceptIds: ['s04-evict'],
      prompt: 'A news site has **2 million articles** of **8 KB** each. You cache the most-read **5%**. How much memory, in **MB**?',
      solution: '800',
      wrongExample: '16000',
      hints: [],
      explanation: '2 M × 8 KB = 16 GB; 5% of that = 0.8 GB = **800 MB**.',
      sd: { target: 'estimate', unit: 'MB' },
    },
    {
      id: 's04-t3',
      kind: 'write',
      conceptIds: ['s04-aside', 's04-evict'],
      prompt: 'Traffic grew to **2,000 requests/s** (95% reads). Change the design so the database stays **under 50% busy** and **p99 < 100 ms**.',
      starterSql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, size: medium }
  db: { type: db, size: medium }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`,
      solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, size: medium }
  cache: { type: cache, memoryMb: 256 }
  db: { type: db, size: medium }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
`,
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, size: medium }
  cache: { type: cache, memoryMb: 8 }
  db: { type: db, size: medium }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
`,
      hints: [],
      explanation: 'A cache big enough for most of the hot data answers the large majority of reads, and the database only sees the misses and the writes.',
      sd: { target: 'design', run: { traffic: { rps: 2000, mix: { read: 0.95, write: 0.05 }, keys: 100_000, skew: 0.9 }, durationMs: 30_000, warmupMs: 5_000, warmCache: true, requirements: ['util(db) < 50%', 'p99 < 100ms', 'errors < 0.1%'] } },
    },
    {
      id: 's04-t4',
      kind: 'readQuery',
      conceptIds: ['s04-stampede'],
      prompt: 'What is a **cache stampede**?',
      choices: ['Too many keys for the cache’s memory', 'Many requests miss the same key at the same moment and all hit the database with the same query', 'Writes arriving faster than the cache can store them'],
      answer: 1,
      hints: [],
      explanation: 'When a hot key expires or the cache restarts, everyone misses at once. Request coalescing, refresh-ahead and TTL jitter prevent it.',
    },
    {
      id: 's04-t5',
      kind: 'readQuery',
      conceptIds: ['s04-cdn'],
      prompt: 'You deploy a new version of `app.js`, but users keep getting the old one from the CDN for hours. What is the standard fix?',
      choices: ['Set the CDN TTL to 1 second', 'Give each version a new file name (a content hash) so the new one is a new key', 'Turn the CDN off during deployments'],
      answer: 1,
      hints: [],
      explanation: '`app.3f9c.js` → `app.81ab.js`: the HTML points at the new name, which the CDN has never seen. The old file can be cached forever, because it never changes.',
    },
    {
      id: 's04-t6',
      kind: 'readQuery',
      conceptIds: ['s04-invalidate'],
      prompt: 'Users report seeing **old product names** after edits. The simulator ran the design. **Why?**',
      sql: SHOP(', memoryMb: 512, ttlMs: 30000', ', cacheOnWrite: none'),
      choices: ['The database replicates slowly', 'Writes don’t invalidate the cache, so cached copies stay old until their 30 s TTL expires', 'The cache is too small', 'The load balancer caches responses'],
      answer: 1,
      verify: ['staleReads > 100', 'hitRatio > 90%'],
      hints: [],
      explanation: 'The app writes the database and leaves the cached copy alone. The TTL removes it eventually, but for up to 30 s every read of a just-edited product returns the old name. Invalidate on write.',
    },
  ],
};
