import type { Module } from '../../../content/types';

/** Module 3: scaling compute. Checked by tests/sd-content.test.ts. */
export const s03: Module = {
  id: 's03',
  number: 3,
  title: 'Scaling compute',
  tagline: 'Bigger machines or more of them, stateless servers, load balancing, health checks and autoscaling.',
  games: ['surge'],
  concepts: [
    {
      id: 's03-up-out',
      title: 'Scale up or scale out',
      card: `When one server isn't enough, you have two options:

- **Scale up** (vertical): a bigger machine with more cores and memory. Nothing in the code changes. But sizes run out, and **one machine is one point of failure**: when it dies, everything is down.
- **Scale out** (horizontal): more machines of the same size behind a **load balancer**. Capacity grows with each server, and losing one only loses a share.

In the cloud, cores cost about the same per core whatever the size, so the choice is mostly about **failure** and **limits**. Web and app servers are scaled out; databases are often scaled up first (module 5 shows why).`,
      predict: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, size: xlarge, cpuMs: 20 }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: 500 }
run: { duration: 40s, warmup: 2s }
events:
  - { at: 20s, action: kill, node: app }
phases:
  - { name: after, from: 20s, to: 40s }
`,
        question: 'One big 16-core server handles all 500 requests/s easily. At 20 s it crashes. What share of requests fail afterwards?',
        choices: ['None: the load balancer reroutes them', 'About half', 'All of them'],
        answer: 2,
        why: 'There is nowhere to reroute to. The load balancer can only choose between the servers it has, and it has one. Eight small servers would cost the same, and a crash would take out only an eighth of the capacity.',
        verify: ['after: errors > 95%'],
      },
      example: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, size: xlarge, cpuMs: 20 }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: 500 }
run: { duration: 40s, warmup: 2s }
events:
  - { at: 20s, action: kill, node: app }
phases:
  - { name: after, from: 20s, to: 40s }
`,
        note: 'Now try size: small with instances: 8 (the same 16 cores, the same price) and run again. The crash takes out one server.',
      },
      cheat: { syntax: 'scale up = bigger box · scale out = more boxes + LB', note: 'Out survives failures and has no size limit; up is simpler.' },
    },
    {
      id: 's03-stateless',
      title: 'Stateless servers',
      card: `To spread requests over many servers, **any server must be able to handle any request**. That only works if the servers are **stateless**: they keep nothing between requests that another server would need.

The classic trap is **sessions in memory**: the user logs in on server A, which remembers it. The next request goes to server B, which has never heard of them: logged out.

Fixes:
- **Shared session store**: keep sessions in Redis or the database, so every server can read them (\`sessions: shared\`). The standard answer.
- **Sticky sessions**: the load balancer always sends a user to the same server (\`algorithm: sticky\`). Simple, but load spreads unevenly, and when that server dies, its users are logged out anyway.`,
      predict: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, sessions: local }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: 200 }
run: { duration: 20s, warmup: 2s }
`,
        question: 'Three servers each keep their own users’ sessions in memory. The load balancer uses round robin. What happens?',
        choices: ['Everything works: each server has its sessions', 'Many requests fail: users land on servers that don’t know them', 'Only the first request of each user fails'],
        answer: 1,
        why: 'Round robin sends each request to the next server in turn, so a user’s requests hop between servers. Each hop to a server without their session is a "please log in again" error.',
        verify: ['errors > 5%'],
      },
      example: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, sessions: local }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: 200 }
run: { duration: 20s, warmup: 2s }
`,
        note: 'Fix it two ways: sessions: shared on the app, or algorithm: sticky on the load balancer. Both pass; the shared store also survives a server crash.',
      },
      cheat: { syntax: 'sessions: shared (Redis/DB)', note: 'Stateless servers: any request on any server. Sticky sessions are a workaround.' },
    },
    {
      id: 's03-lb',
      title: 'Load-balancing algorithms',
      card: `The load balancer decides which server gets each request:

- **Round robin**: next server in turn. Fair when requests are alike.
- **Least connections**: the server with the fewest requests in progress. Better when request times **vary**: a server stuck on slow requests gets fewer new ones.
- **Random**: surprisingly decent, and needs no shared counter.
- **Sticky** (hash of the user): the same user always reaches the same server. Needed for in-memory state, at the cost of uneven load.

Round robin is the default almost everywhere. Switch to least connections when some requests take 10× longer than others: uploads, reports, long-polling.`,
      example: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, cpuMs: 15, dist: lognormal, threads: 64 }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: 420 }
run: { duration: 60s, warmup: 5s }
`,
        note: 'Request times vary a lot here (dist: lognormal). Note the p99, then set the load balancer’s algorithm to least_conn and compare.',
      },
      cheat: { syntax: 'round_robin · least_conn · random · sticky', note: 'least_conn when request times vary a lot.' },
    },
    {
      id: 's03-health',
      title: 'Health checks and retries',
      card: `Servers die. The load balancer must stop sending them traffic:

- **Health checks**: every few seconds the load balancer asks each server "are you OK?" (an HTTP \`/health\` endpoint). After a few failed checks in a row, the server is taken out; when it answers again, it is put back.
- Until the checks notice, requests still go to the dead server and fail. Checking every 5 s with 2 failures to remove takes **up to ~10 s**.
- **Retries** close that gap: if a request fails on one server, the load balancer sends it to another. Safe for reads; for writes, only when they are **idempotent** (module 7).

Health checks keep the error window short; retries hide it from users.`,
      predict: {
        sql: `components:
  users: { type: client }
  lb: { type: lb, healthCheck: false }
  app: { type: app, instances: 3 }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: 300 }
run: { duration: 40s, warmup: 2s }
events:
  - { at: 10s, action: kill, node: app, instance: 0 }
phases:
  - { name: after, from: 20s, to: 40s }
`,
        question: 'Health checks are turned off. One of three servers dies at 10 s. Ten seconds later, what share of requests is failing?',
        choices: ['None: the other two take over', 'About a third: it still gets its turn', 'All of them'],
        answer: 1,
        why: 'Without health checks, the load balancer never learns that the server is dead. Round robin keeps giving it every third request, and every one of those fails, forever.',
        verify: ['after: errors > 30%', 'after: errors < 37%'],
      },
      example: {
        sql: `components:
  users: { type: client }
  lb: { type: lb, healthCheck: false }
  app: { type: app, instances: 3 }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: 300 }
run: { duration: 40s, warmup: 2s }
events:
  - { at: 10s, action: kill, node: app, instance: 0 }
phases:
  - { name: after, from: 20s, to: 40s }
`,
        note: 'Turn health checks on (healthCheck: { intervalMs: 2000 }) and run again: errors stop after a few seconds. Then click the lb → app connection and add retries: 1: no errors at all.',
      },
      cheat: { syntax: 'healthCheck: { intervalMs, unhealthy } · lb → app: { retries: 1 }', note: 'Checks remove dead servers in seconds; retries hide the gap.' },
    },
    {
      id: 's03-autoscale',
      title: 'Autoscaling',
      card: `Traffic changes over the day; paying for the peak all day is wasteful. **Autoscaling** adds servers when they get busy and removes them when they're idle:

- a **target** (e.g. keep CPU around 60%),
- a **min** (never fewer, for redundancy) and a **max** (a cost ceiling),
- a check every N seconds, and a **cooldown** so it doesn't flap.

The catch is **time**: a new server must boot, start the app and pass health checks, often **1–3 minutes**. Autoscaling handles gradual changes well, but a sudden spike arrives before the new servers do. Keep headroom (a lower target), boot fast (small images), or scale ahead of known events.`,
      example: {
        sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, cpuMs: 20, autoscale: { min: 2, max: 10 } }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: [[0, 100], [60s, 100], [120s, 500], [240s, 500]] }
run: { duration: 240s, warmup: 5s }
requirements:
  - p99 < 300ms
  - errors < 1%
`,
        note: 'With the defaults (60 s boot, a check every 15 s), new servers arrive too late. Try bootMs: 10000 and intervalMs: 5000 in the autoscale settings, and watch the instances chart.',
      },
      cheat: { syntax: 'autoscale: { min, max, targetCpu, bootMs }', note: 'Great for gradual change. Boot time decides how fast a spike it can follow.' },
    },
  ],
  practice: [
    {
      id: 's03-p1',
      kind: 'readQuery',
      conceptIds: ['s03-up-out'],
      prompt: 'Which is a real advantage of **scaling out** (more servers) over **scaling up** (a bigger one)?',
      choices: ['It is always cheaper per core', 'A single server failing only removes part of the capacity', 'The application code needs no changes'],
      answer: 1,
      hints: [],
      explanation: 'Per-core prices are about the same, and it is scaling *up* that needs no code changes. Scaling out wins on failures (and on having no upper size limit), as long as the servers are stateless.',
    },
    {
      id: 's03-p2',
      kind: 'fixBug',
      conceptIds: ['s03-stateless'],
      prompt: 'Users are logged out every few clicks. Fix the design without adding components: **errors < 0.1%**.',
      starterSql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, sessions: local }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`,
      solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 4, sessions: shared }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`,
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb, algorithm: least_conn }
  app: { type: app, instances: 4, sessions: local }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`,
      hints: ['Each server remembers its own users. Where else could sessions live?', 'Set the app’s sessions to shared (or make the load balancer sticky).'],
      explanation: 'Keeping sessions in a shared store (Redis or the database) makes the app servers stateless: any server can serve any user. A sticky load balancer also passes here, but its users are logged out when their server dies.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: { rps: 300 }, durationMs: 20_000, warmupMs: 2_000, requirements: ['errors < 0.1%'] } },
    },
    {
      id: 's03-p3',
      kind: 'readQuery',
      conceptIds: ['s03-health'],
      prompt: 'One server died at 10 s, but errors never stop. The simulator ran the design. **What is wrong?**',
      sql: `components:
  users: { type: client }
  lb: { type: lb, algorithm: round_robin, healthCheck: false }
  app: { type: app, instances: 4 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> db
traffic: { rps: 400 }
run: { duration: 40s, warmup: 2s }
events:
  - { at: 10s, action: kill, node: app, instance: 2 }
phases:
  - { name: after, from: 20s, to: 40s }
`,
      choices: ['The remaining servers are overloaded', 'The load balancer has no health checks, so it keeps sending a quarter of requests to the dead server', 'The database is down', 'Round robin can’t handle failures; it must be least connections'],
      answer: 1,
      verify: ['after: errors > 20%', 'util(app) < 50%'],
      hints: [],
      explanation: 'The survivors are far from busy, and the errors are "connection refused" from the dead server. Without health checks, the load balancer never takes it out of rotation. Any algorithm has this problem.',
    },
    {
      id: 's03-p4',
      kind: 'fixBug',
      conceptIds: ['s03-lb'],
      prompt: 'Some requests (reports) take much longer than others. With round robin, quick requests wait behind them. Get **p99 < 150 ms** without adding servers.',
      starterSql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, cpuMs: 15, dist: lognormal, threads: 64 }
connections:
  - users -> lb
  - lb -> app
`,
      solution: `components:
  users: { type: client }
  lb: { type: lb, algorithm: least_conn }
  app: { type: app, instances: 3, cpuMs: 15, dist: lognormal, threads: 64 }
connections:
  - users -> lb
  - lb -> app
`,
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb, algorithm: random }
  app: { type: app, instances: 3, cpuMs: 15, dist: lognormal, threads: 64 }
connections:
  - users -> lb
  - lb -> app
`,
      hints: ['Which algorithm looks at how busy each server is right now?'],
      explanation: 'Least connections sends each request to the server with the fewest in progress, steering around one that is stuck on a slow request. Random and round robin ignore how busy servers are.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: { rps: 330 }, durationMs: 60_000, warmupMs: 5_000, requirements: ['p99 < 150ms', 'errors < 0.1%'] } },
    },
    {
      id: 's03-p5',
      kind: 'write',
      conceptIds: ['s03-up-out', 's03-health'],
      prompt: 'This app runs on **one** medium server, and at 10 s it crashes. Redesign it so that, once the failure has been noticed, **errors < 0.5%**. Traffic: 400 requests/s.',
      starterSql: `components:
  users: { type: client }
  app: { type: app, size: medium }
  db: { type: db }
connections:
  - users -> app
  - app -> db
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
  app: { type: app, size: xlarge }
  db: { type: db }
connections:
  - users -> app
  - app -> db
`,
      hints: ['A bigger server still crashes. You need more than one.', 'Put a load balancer between the users and the app, and give the app several instances.'],
      explanation: 'A load balancer in front of 3 small servers: when one dies, health checks remove it within ~10 s, and the other two carry the 400 requests/s at 50% busy. A bigger single server is just a bigger single point of failure.',
      sd: {
        target: 'design',
        run: {
          traffic: { rps: 400 },
          durationMs: 40_000,
          warmupMs: 2_000,
          events: [{ atMs: 10_000, action: 'kill', node: 'app', instance: 0 }],
          phases: [{ name: 'recovered', fromMs: 25_000, toMs: 40_000 }],
          requirements: ['recovered: errors < 0.5%', 'p99 < 150ms'],
        },
      },
    },
    {
      id: 's03-p6',
      kind: 'fillBlank',
      conceptIds: ['s03-health'],
      prompt: 'One of three servers dies at 10 s. Fill in how often the load balancer checks health (in ms), so that errors from the crash stay **under 2%** over the next 50 seconds.',
      starterSql: `components:
  users: { type: client }
  lb: { type: lb, healthCheck: { intervalMs: ___, unhealthy: 2 } }
  app: { type: app, instances: 3 }
connections:
  - users -> lb
  - lb -> app
`,
      solution: `components:
  users: { type: client }
  lb: { type: lb, healthCheck: { intervalMs: 1000, unhealthy: 2 } }
  app: { type: app, instances: 3 }
connections:
  - users -> lb
  - lb -> app
`,
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb, healthCheck: { intervalMs: 5000, unhealthy: 2 } }
  app: { type: app, instances: 3 }
connections:
  - users -> lb
  - lb -> app
`,
      hints: ['A dead server is removed after 2 failed checks: about 2 × intervalMs.', 'Until then a third of requests fail. Over 50 s, 2% is 1 second of full failure, or 3 seconds of one-third failure.'],
      explanation: 'With 2 failed checks needed, a server is removed after about 2 × intervalMs. A third of the requests fail meanwhile, so the error share over 50 s is about (2 × interval ÷ 3) ÷ 50 s. **1000 ms** gives ~1.3%; the default 5000 ms gives ~7%. Checking much more often adds load and false alarms.',
      sd: {
        target: 'design',
        run: {
          traffic: { rps: 300 },
          durationMs: 60_000,
          warmupMs: 2_000,
          events: [{ atMs: 10_000, action: 'kill', node: 'app', instance: 0 }],
          phases: [{ name: 'crash', fromMs: 10_000, toMs: 60_000 }],
          requirements: ['crash: errors < 2%'],
        },
      },
    },
    {
      id: 's03-p7',
      kind: 'write',
      conceptIds: ['s03-autoscale'],
      prompt: 'Peak traffic is **3,000 requests/s**. One instance handles **250/s** at full CPU, and the autoscaler targets **60%** CPU. What should the autoscaler’s **max** be, at least?',
      solution: '20',
      wrongExample: '12',
      hints: ['At 60%, one instance handles 250 × 0.6 = 150/s.'],
      explanation: '3,000 ÷ 150 = **20** instances at peak. A max of 12 (3,000 ÷ 250) would pin them at 100% CPU: exactly the overload autoscaling is meant to avoid.',
      sd: { target: 'estimate', unit: 'instances', tolerance: 0.1 },
    },
    {
      id: 's03-p8',
      kind: 'parsons',
      conceptIds: ['s03-autoscale'],
      prompt: 'Traffic rises. Put the steps of a scale-out in order.',
      blocks: ['CPU on the servers climbs above the target', 'The autoscaler’s next check sees it and launches new servers', 'The new servers boot and start the app', 'They pass the load balancer’s health checks', 'The load balancer starts sending them traffic'],
      wrongOrder: ['CPU on the servers climbs above the target', 'The load balancer starts sending them traffic', 'The autoscaler’s next check sees it and launches new servers', 'The new servers boot and start the app', 'They pass the load balancer’s health checks'],
      hints: ['Nothing gets traffic before it is healthy.'],
      explanation: 'Every step takes time: the check interval, the boot, the health checks. Their sum is how far behind a spike autoscaling is.',
    },
    {
      id: 's03-p9',
      kind: 'fixBug',
      conceptIds: ['s03-autoscale'],
      prompt: 'Autoscaling is on, but at the evening peak (**1,200 requests/s**) errors still appear. Tune the autoscaler so that **p99 < 300 ms** and **errors < 0.5%**.',
      starterSql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, cpuMs: 10, autoscale: { min: 2, max: 4, bootMs: 10000, intervalMs: 5000 } }
connections:
  - users -> lb
  - lb -> app
`,
      solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, cpuMs: 10, autoscale: { min: 2, max: 12, bootMs: 10000, intervalMs: 5000 } }
connections:
  - users -> lb
  - lb -> app
`,
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, cpuMs: 10, autoscale: { min: 2, max: 4, targetCpu: 0.4, bootMs: 10000, intervalMs: 5000 } }
connections:
  - users -> lb
  - lb -> app
`,
      hints: ['Look at the instances chart: does it stop growing?', 'One instance handles 200/s. How many does 1,200/s need at 60%?'],
      explanation: 'The autoscaler reached its **max** of 4 (800/s of capacity) and stopped. 1,200/s at a 60% target needs 10 instances; a max of 12 leaves room. Lowering the target can’t help when the ceiling is the limit.',
      sd: {
        target: 'design',
        tuneOnly: true,
        run: { traffic: { rps: [[0, 300], [90_000, 1200], [180_000, 1200]], readKb: 0.5 }, durationMs: 180_000, warmupMs: 5_000, requirements: ['p99 < 300ms', 'errors < 0.5%'] },
      },
    },
    {
      id: 's03-p10',
      kind: 'readQuery',
      conceptIds: ['s03-lb'],
      prompt: 'A chat service keeps **long-lived WebSocket connections**: some servers end up with thousands, others with few. Which load-balancing algorithm suits it best?',
      choices: ['Round robin', 'Least connections', 'Random'],
      answer: 1,
      hints: [],
      explanation: 'Connections last minutes or hours, so "the next server in turn" quickly becomes uneven. Least connections sends each new connection to the server holding the fewest.',
    },
  ],
  test: [
    {
      id: 's03-t1',
      kind: 'readQuery',
      conceptIds: ['s03-stateless'],
      prompt: 'What makes an app server **stateless**?',
      choices: ['It has no database', 'It keeps nothing between requests that another server would need; sessions and files live in shared stores', 'It never writes anything'],
      answer: 1,
      hints: [],
      explanation: 'A stateless server can be added, removed or replaced at any time, and any of them can serve any request. State still exists; it lives in a database, a cache or object storage.',
    },
    {
      id: 's03-t2',
      kind: 'readQuery',
      conceptIds: ['s03-health'],
      prompt: 'Health checks are on (every 5 s, 2 failures). A server crashes. Why do users still see errors for a few seconds, and what removes them?',
      choices: ['The checks haven’t failed twice yet; retries on the load balancer send failed requests to another server', 'The database needs to restart; nothing can be done', 'Health checks are too slow; turn them off'],
      answer: 0,
      hints: [],
      explanation: 'Until 2 checks have failed (up to ~10 s), the dead server still gets its share. A retry to another server hides those failures from users.',
    },
    {
      id: 's03-t3',
      kind: 'write',
      conceptIds: ['s03-up-out', 's03-autoscale'],
      prompt: 'Peak traffic is **1,200 requests/s**; one server handles **200/s** at full CPU. You run them at **65%**, plus **one spare** in case a server fails. How many servers?',
      solution: '11',
      wrongExample: '6',
      hints: [],
      explanation: '200 × 0.65 = 130/s each; 1,200 ÷ 130 ≈ 9.2 → 10, plus a spare = **11**.',
      sd: { target: 'estimate', unit: 'servers', tolerance: 0.1 },
    },
    {
      id: 's03-t4',
      kind: 'fixBug',
      conceptIds: ['s03-health'],
      prompt: 'At 15 s one of five servers crashes. Users must not see the crash: **errors < 0.05%** (without adding servers).',
      starterSql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 5, cpuMs: 10 }
connections:
  - users -> lb
  - lb -> app
`,
      solution: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 5, cpuMs: 10 }
connections:
  - users -> lb
  - lb -> app: { retries: 2 }
`,
      wrongExample: `components:
  users: { type: client }
  lb: { type: lb, algorithm: least_conn }
  app: { type: app, instances: 5, cpuMs: 10 }
connections:
  - users -> lb
  - lb -> app
`,
      hints: [],
      explanation: 'Retries on the load balancer’s connection send a failed request to another server, so the seconds before the health checks react are invisible to users.',
      sd: {
        target: 'design',
        tuneOnly: true,
        run: { traffic: { rps: 600 }, durationMs: 40_000, warmupMs: 3_000, events: [{ atMs: 15_000, action: 'kill', node: 'app', instance: 1 }], requirements: ['errors < 0.05%', 'p99 < 200ms'] },
      },
    },
    {
      id: 's03-t5',
      kind: 'readQuery',
      conceptIds: ['s03-autoscale'],
      prompt: 'A flash sale starts at exactly 12:00 and traffic jumps 10× within seconds. Servers take 2 minutes to boot. What should you do?',
      choices: ['Rely on autoscaling: it reacts to CPU', 'Scale out before 12:00 (scheduled scaling), then let autoscaling handle the rest', 'Set the CPU target to 99% so servers are used fully'],
      answer: 1,
      hints: [],
      explanation: 'Autoscaling follows load; it can’t lead it. For a known event, add capacity ahead of time. A 99% target leaves no headroom at all.',
    },
    {
      id: 's03-t6',
      kind: 'readQuery',
      conceptIds: ['s03-autoscale'],
      prompt: 'Autoscaling is on, yet at the peak requests are rejected. The simulator ran the design with tonight’s traffic. **Why?**',
      sql: `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, cpuMs: 10, autoscale: { min: 2, max: 3, bootMs: 10000, intervalMs: 5000 } }
connections:
  - users -> lb
  - lb -> app
traffic: { rps: [[0, 200], [60s, 900], [120s, 900]], readKb: 0.5 }
run: { duration: 120s, warmup: 5s }
`,
      choices: ['The servers boot too slowly', 'The autoscaler hit its max of 3 servers (600 requests/s), below the peak', 'The load balancer is overloaded', 'The CPU target is too low'],
      answer: 1,
      verify: ['errors > 5%', 'util(app) > 85%'],
      hints: [],
      explanation: 'The instances chart flattens at 3 while the servers sit near 100% CPU. Three servers handle 600/s; the peak is 900/s. Raise the max (and check the budget it implies).',
    },
  ],
};
