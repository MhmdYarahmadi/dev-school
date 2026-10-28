import type { SdLevel } from './rounds';

interface Night {
  apps?: number;
  app?: string;
  recs?: string;
  db?: string;
}

/** The launch-night system: app servers, a cache, a recommendations service (30% of requests) and a database. */
const night = (o: Night = {}) => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: ${o.apps ?? 3}, size: medium, externalRatio: 0.3${o.app ?? ''} }
  cache: { type: cache, memoryMb: 256 }
  recs: { type: external, latencyMs: 30, pricePerMillion: 0 }
  db: { type: db, size: medium${o.db ?? ''} }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> recs${o.recs ? `: { ${o.recs} }` : ''}
  - app -> db
`;

/** Launch traffic: 300 requests/s, ramping to 2,400/s between 10 and 20 s. */
const RAMP = 'traffic: { rps: [[0, 300], [10s, 300], [20s, 2400], [40s, 2400]], mix: { read: 0.9, write: 0.1 }, keys: 100000, skew: 0.9, readKb: 0.5 }';
const STEADY = 'traffic: { rps: 2400, mix: { read: 0.9, write: 0.1 }, keys: 100000, skew: 0.9, readKb: 0.5 }';
const RUN = 'run: { duration: 40s, warmup: 5s, warmCache: true }';

const SAFE_DB = ', replicas: 2, syncReplicas: 1, failoverMs: 3000';
const SAFE_RECS = 'timeoutMs: 200, optional: true';

/** Launch Night (finale): one system, five acts, every skill from the course. */
export const LAUNCH_LEVELS: SdLevel[] = [
  {
    title: 'Act 1: Doors open',
    story: 'Launch night. At **10 s** the announcement goes out and traffic climbs from 300 to **2,400 requests/s** in ten seconds. Three app servers won’t do. Keep **p99 under 150 ms** with **no errors** at the peak, without paying for servers you don’t need.',
    scenario: `${night()}${RAMP}
${RUN}
phases:
  - { name: peak, from: 22s, to: 40s }
requirements:
  - "peak: p99 < 150ms"
  - errors < 0.1%
`,
    tuneOnly: true,
    parCost: 700,
    solution: night({ apps: 5 }),
    hint: '2,400 requests × 5 ms of CPU = 12 cores of work. A medium server has 4. Leave some headroom: queueing delay explodes near 100%.',
  },
  {
    title: 'Act 2: The cache restarts',
    story: 'At **15 s** the cache node restarts and comes back **empty**. Until it fills again, every read it used to answer hits the database, which was only coping thanks to the cache. Keep **errors under 0.1%** and **p99 under 300 ms** after the restart, as cheaply as you can.',
    scenario: `${night({ apps: 5 })}${STEADY}
${RUN}
events:
  - { at: 15s, action: flush, node: cache }
phases:
  - { name: cold, from: 15s, to: 40s }
requirements:
  - "cold: errors < 0.1%"
  - "cold: p99 < 300ms"
`,
    tuneOnly: true,
    parCost: 900,
    solution: night({ apps: 5, db: ', replicas: 1' }),
    hint: 'A cache is a crutch: when it is empty, the database takes the full read load. Look at the database’s utilisation after 15 s. Give reads somewhere else to go (a read replica), or more database. Single flight only helps when many requests miss the same key at once.',
  },
  {
    title: 'Act 3: The primary dies',
    story: 'At **10 s** the database primary dies. Writes must work again by **15 s**, and not one confirmed sign-up may be lost: tonight’s new users are the whole point of the launch.',
    scenario: `${night({ apps: 5 })}${STEADY}
${RUN}
events:
  - { at: 10s, action: kill, node: db, instance: 0 }
phases:
  - { name: after, from: 15s, to: 40s }
requirements:
  - "after: errors < 0.1%"
  - lostWrites = 0
`,
    tuneOnly: true,
    parCost: 1040,
    solution: night({ apps: 5, db: SAFE_DB }),
    hint: 'You need replicas, automatic failover (failoverMs), and at least one replica that has every confirmed write before it is confirmed (syncReplicas). With two replicas, one is left to confirm writes after the promotion.',
  },
  {
    title: 'Act 4: Recommendations go dark',
    story: 'A third of the pages show “you might also like”, from a recommendations service. At **10 s** it starts failing **every** call. Pages without recommendations are fine; error pages are not. **No errors** and **p99 under 150 ms** from 12 s on.',
    scenario: `${night({ apps: 5 })}${STEADY}
${RUN}
events:
  - { at: 10s, action: failRate, node: recs, rate: 1 }
phases:
  - { name: dark, from: 12s, to: 40s }
requirements:
  - "dark: errors < 0.1%"
  - "dark: p99 < 150ms"
`,
    tuneOnly: true,
    parCost: 760,
    solution: night({ apps: 5, recs: SAFE_RECS }),
    hint: 'Recommendations are nice to have. Mark the connection optional, so a failure degrades the page instead of failing it, and give it a timeout so a slow failure can’t hold threads.',
  },
  {
    title: 'Act 5: The whole night',
    story: 'All of it, in one run: the ramp from **10 s**, the cache restart at **25 s**, the primary dying at **30 s**, and recommendations failing from **35 s**. You start again from the system as it was before launch. The night’s **error budget is 1%** from 22 s, with **p99 under 300 ms** and **no lost sign-ups**.',
    scenario: `${night()}traffic: { rps: [[0, 300], [10s, 300], [20s, 2400], [50s, 2400]], mix: { read: 0.9, write: 0.1 }, keys: 100000, skew: 0.9, readKb: 0.5 }
run: { duration: 50s, warmup: 5s, warmCache: true }
events:
  - { at: 25s, action: flush, node: cache }
  - { at: 30s, action: kill, node: db, instance: 0 }
  - { at: 35s, action: failRate, node: recs, rate: 1 }
phases:
  - { name: night, from: 22s, to: 50s }
requirements:
  - "night: errors < 1%"
  - "night: p99 < 300ms"
  - lostWrites = 0
`,
    tuneOnly: true,
    parCost: 1000,
    solution: night({ apps: 5, recs: SAFE_RECS, db: ', replicas: 2, syncReplicas: 1, failoverMs: 1000' }),
    hint: 'Everything from acts 1 to 4 at once: enough servers for the peak, read capacity for a cold cache, replicas with automatic failover and one sync replica, and an optional recommendations connection with a timeout. Every second of failover spends error budget: a 3-second failover alone uses about 1%.',
  },
];
