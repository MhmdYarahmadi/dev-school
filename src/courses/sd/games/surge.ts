import type { SdLevel } from './rounds';

/** Traffic Surge (after module 3): waves of traffic; keep p99 and errors in bounds at the lowest cost. */
export const SURGE: SdLevel[] = [
  {
    title: 'Morning rush',
    story: 'The office opens and traffic climbs from **100 to 600 requests/s**. Each request needs **20 ms** of CPU. Two servers won’t do. Find the cheapest setup that keeps up.',
    scenario: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, cpuMs: 20 }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: [[0, 100], [20s, 600], [60s, 600]], readKb: 0.5 }
run: { duration: 60s, warmup: 3s }
requirements:
  - p99 < 200ms
  - errors < 0.1%
`,
    tuneOnly: true,
    parCost: 360,
    solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, size: large, cpuMs: 20 }
connections:
  - users -> lb
  - lb -> app
`,
    hint: '600 requests/s × 20 ms = 12 cores busy all the time. At about 75% busy that is 16 cores: 8 small, 4 medium or 2 large (the price is per core, whatever the size).',
  },
  {
    title: 'Logged out again',
    story: 'Users keep getting logged out, and support is swamped. The app keeps each user’s **session in the server’s memory**. Fix it without changing how many servers there are.',
    scenario: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, sessions: local }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: 300 }
run: { duration: 30s, warmup: 2s }
requirements:
  - errors < 0.1%
  - p99 < 100ms
`,
    tuneOnly: true,
    parCost: 250,
    solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, sessions: shared }
connections:
  - users -> lb
  - lb -> app
`,
    hint: 'Round robin sends each request to the next server, which doesn’t have the session. Either move sessions to a shared store (sessions: shared) or make the load balancer sticky.',
  },
  {
    title: 'The unlucky queue',
    story: 'Most requests are quick, but a few take much longer (a long tail of **slow requests**). With **round robin**, quick requests get stuck behind slow ones. Get p99 under 140 ms without adding servers.',
    scenario: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, cpuMs: 15, dist: lognormal, threads: 64 }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: 420 }
run: { duration: 60s, warmup: 5s }
requirements:
  - p99 < 140ms
  - errors < 0.1%
`,
    tuneOnly: true,
    parCost: 330,
    solution: `components:
  users: { type: client }
  lb: { type: lb, algorithm: least_conn }
  app: { type: app, instances: 4, cpuMs: 15, dist: lognormal, threads: 64 }
connections:
  - users -> lb
  - lb -> app
`,
    hint: 'Change the load balancer’s algorithm: least_conn sends each request to the server with the fewest in progress, so it avoids the one stuck with slow requests.',
  },
  {
    title: 'Crash at the peak',
    story: 'At **20 s**, in the middle of the peak, one server crashes. Right now users see errors for 10 seconds until the load balancer notices. Nobody should see an error.',
    scenario: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, cpuMs: 10 }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: 500 }
run: { duration: 45s, warmup: 3s }
events:
  - { at: 20s, action: kill, node: app, instance: 0 }
requirements:
  - errors < 0.05%
  - p99 < 250ms
`,
    tuneOnly: true,
    parCost: 360,
    solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, cpuMs: 10 }
connections:
  - users -> lb
  - lb -> app: { retries: 1 }
`,
    hint: 'Health checks only notice after a few seconds. Click the connection from the load balancer to the app and give it a retry: a failed request is retried on another server.',
  },
  {
    title: 'Three waves',
    story: 'A TV ad runs twice tonight: each time, traffic climbs from **100 to 800 requests/s** over a minute, stays there for a minute, then falls back. Servers sized for the peak sit idle most of the night. Keep p99 under 250 ms and errors under 0.5%, for under **$220 a month**.',
    scenario: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, cpuMs: 10 }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: [[0, 100], [60s, 100], [120s, 800], [180s, 800], [210s, 100], [360s, 100], [420s, 800], [480s, 800], [510s, 100], [600s, 100]], readKb: 0.5 }
run: { duration: 600s, warmup: 5s }
requirements:
  - p99 < 250ms
  - errors < 0.5%
  - cost < $220
`,
    tuneOnly: true,
    parCost: 210,
    solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, cpuMs: 10, autoscale: { min: 1, max: 8, targetCpu: 0.5, bootMs: 10000, intervalMs: 5000, cooldownMs: 30000 } }
connections:
  - users -> lb
  - lb -> app
`,
    hint: 'Turn on autoscaling for the app (min, max, targetCpu). With the defaults, a new server takes 60 s to boot and the scaler checks every 15 s: too slow for this ramp. A fast-booting image (bootMs: 10000), a check every 5 s and targetCpu 0.5 (headroom while servers boot) keep up.',
  },
];
