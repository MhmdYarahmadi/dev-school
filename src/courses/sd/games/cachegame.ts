import type { SdLevel } from './rounds';

const shop = (rps: number, extra = '') => `traffic: { rps: ${rps}, mix: { read: 0.95, write: 0.05 }, keys: 100000, skew: 0.9${extra} }
run: { duration: 30s, warmup: 5s, warmCache: true }`;

/** Cache Me If You Can (after module 4): latency targets on a memory budget, then stale data, a stampede and a restart. */
export const CACHE_LEVELS: SdLevel[] = [
  {
    title: 'A cache too small',
    story: 'Someone added a cache, but the database is still struggling. The data is about **100 MB**. Give the cache just enough memory to bring the database **under 40% busy**.',
    scenario: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, size: medium }
  cache: { type: cache, memoryMb: 4 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
${shop(1200)}
requirements:
  - util(db) < 40%
  - p99 < 100ms
`,
    tuneOnly: true,
    parCost: 810,
    solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, size: medium }
  cache: { type: cache, memoryMb: 50 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
`,
    hint: 'Hit ratio grows fast and then slowly: 15% of the data gives about 70% hits, half of it about 88%. Try 20, 50 and 100 MB and watch the database.',
  },
  {
    title: 'Bigger database or a cache?',
    story: 'Traffic doubled to **2,400 requests/s** and the database is drowning. You could buy a much bigger database… or something cheaper. Meet the targets for the lowest bill.',
    scenario: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 6, size: medium }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> db
${shop(2400, ', readKb: 0.5')}
requirements:
  - p99 < 100ms
  - errors < 0.1%
`,
    parCost: 780,
    solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 6, size: medium }
  cache: { type: cache, memoryMb: 128 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
`,
    hint: 'An xlarge database costs $560 a month. A cache costs $12 per GB of memory, and 128 MB covers most of the hot data.',
  },
  {
    title: 'Old prices',
    story: 'A sale started an hour ago, but customers still see the **old prices** on popular products. Fix it so nobody ever sees a stale price, without losing the cache’s speed.',
    scenario: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, size: medium, cacheOnWrite: none }
  cache: { type: cache, memoryMb: 128, ttlMs: 60000 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
${shop(1200)}
requirements:
  - staleReads = 0
  - p99 < 100ms
`,
    tuneOnly: true,
    parCost: 810,
    solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, size: medium, cacheOnWrite: invalidate }
  cache: { type: cache, memoryMb: 128, ttlMs: 60000 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
`,
    hint: 'A shorter TTL only shortens how long prices stay wrong. Change what the app does to the cache when it writes (cacheOnWrite).',
  },
  {
    title: 'The home page herd',
    story: 'Nine out of ten visitors load the **home page**, whose query takes **50 ms**. Every 10 seconds its cache entry expires and latency spikes. Smooth it out.',
    scenario: `components:
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
traffic: { rps: 2000, mix: { read: 1 }, keys: 50, skew: 0.5, hotKey: { share: 0.9 }, readKb: 0.5 }
run: { duration: 30s, warmup: 3s, warmCache: true }
requirements:
  - p99 < 120ms
  - errors < 0.1%
`,
    tuneOnly: true,
    parCost: 650,
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
    hint: 'At each expiry, ~100 requests miss the same key together and all query the database. Let one request per server load it while the others wait: singleFlight on the app.',
  },
  {
    title: 'Cache restart',
    story: 'At **20 s** the cache server restarts for a security patch and comes back **empty**. The database can’t take the flood of misses. Rearrange the cache memory (the same total) so a restart hurts much less.',
    scenario: `components:
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
traffic: { rps: 3000, mix: { read: 0.97, write: 0.03 }, keys: 200000, skew: 0.9, readKb: 1 }
run: { duration: 40s, warmup: 5s, warmCache: true }
events:
  - { at: 20s, action: kill, node: cache, instance: 0 }
  - { at: 22s, action: restore, node: cache, instance: 0 }
phases:
  - { name: restart, from: 20s, to: 30s }
requirements:
  - "restart: errors < 0.5%"
  - p99 < 200ms
`,
    tuneOnly: true,
    parCost: 1100,
    solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, size: medium }
  cache: { type: cache, memoryMb: 128, instances: 2 }
  db: { type: db, size: medium }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> db
`,
    hint: 'Keys are spread over cache nodes by hash. With several smaller nodes, one restart empties only part of the cache.',
  },
  {
    title: 'Images everywhere',
    story: 'A photo site: **70%** of requests are images from object storage, and the app servers spend their time copying bytes. Get the **median under 30 ms** and the bill **under $5,000** a month (it is about $6,000 now, mostly bandwidth).',
    scenario: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 6 }
  files: { type: objectstore }
connections:
  - users -> lb
  - lb -> app
  - app -> files
traffic: { rps: 1500, mix: { static: 0.7, read: 0.3 }, keys: 2000, staticKb: 20, readKb: 1 }
run: { duration: 30s, warmup: 3s }
requirements:
  - p50 < 30ms
  - errors < 0.1%
  - cost < $5000
`,
    parCost: 4600,
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
    hint: 'Put a CDN in front (users → cdn → lb). It answers repeated images from its edge cache, so only misses and API calls reach the app servers: you need fewer of them.',
  },
];
