import type { Module } from '../../../content/types';
import type { Traffic } from '../engine/types';
import { projectB } from './projectB';

/**
 * A sign-up API: writes go onto a queue (the API answers 202 Accepted) and workers do the work later,
 * optionally calling an email API that takes 300 ms.
 */
const JOBS = (queue: string, worker: string, mail = false) => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, size: medium, writeVia: queue }
  queue: { type: queue${queue} }
  worker: { type: worker${worker} }
${mail ? '  mail: { type: external, latencyMs: 300 }\n' : ''}  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> queue
  - app -> db
  - queue -> worker
${mail ? '  - worker -> mail\n' : ''}  - worker -> db
`;

/** The same API doing the email call itself, before answering. */
const SYNC = `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, size: medium }
  mail: { type: external, latencyMs: 300 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> mail
  - app -> db
`;

const run = (traffic: string, extra = '', duration = '60s') => `traffic: ${traffic}\nrun: { duration: ${duration}, warmup: 5s }\n${extra}`;

/** 200 requests/s, half of them sign-ups (100 messages/s). */
const SIGNUPS_T: Traffic = { rps: 200, mix: { read: 0.5, write: 0.5 } };
const SIGNUPS = '{ rps: 200, mix: { read: 0.5, write: 0.5 } }';

/** 100 sign-ups/s, each sending an email. */
const MAIL_T: Traffic = { rps: 100, mix: { write: 1 } };
const MAIL = '{ rps: 100, mix: { write: 1 } }';

/** A burst: 1,000 messages/s for 10 seconds. */
const BURST_T: Traffic = {
  rps: [
    [0, 100],
    [20_000, 100],
    [21_000, 1000],
    [30_000, 1000],
    [31_000, 100],
    [60_000, 100],
  ],
  mix: { write: 1 },
};
const BURST = '{ rps: [[0, 100], [20s, 100], [21s, 1000], [30s, 1000], [31s, 100], [60s, 100]], mix: { write: 1 } }';

/** 2% of messages can never be processed (malformed). */
const POISON_T: Traffic = { ...SIGNUPS_T, poisonRate: 0.02 };
const POISON = '{ rps: 200, mix: { read: 0.5, write: 0.5 }, poisonRate: 0.02 }';

const CRASH = `events:
  - { at: 20s, action: kill, node: worker, instance: 0 }
  - { at: 25s, action: restore, node: worker, instance: 0 }
`;
const CRASH_EVENTS = [
  { atMs: 20_000, action: 'kill' as const, node: 'worker', instance: 0 },
  { atMs: 25_000, action: 'restore' as const, node: 'worker', instance: 0 },
];

/** Order events: two subscribers (emails and statistics). */
const EVENTS = (mode: string) => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, size: medium, writeVia: queue }
  events: { type: queue, mode: ${mode} }
  email: { type: worker }
  stats: { type: worker }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> events
  - app -> db
  - events -> email
  - events -> stats
  - email -> db
  - stats -> db
`;

/** Module 7: async work and messaging. Checked by tests/sd-content.test.ts. */
export const s07: Module = {
  id: 's07',
  number: 7,
  title: 'Async & messaging',
  tagline: 'Move slow work onto queues: workers and backlogs, backpressure, pub/sub, retries and dead letters, and idempotent consumers.',
  games: ['queues'],
  project: projectB,
  concepts: [
    {
      id: 's07-async',
      title: 'Do it later: queues',
      card: `Some work doesn't need to happen **before** you answer the user: sending the welcome email, resizing the photo, updating search, notifying followers. Doing it inline makes every request as slow as the slowest of those steps, and as fragile as the least reliable one.

With a **message queue** (SQS, RabbitMQ, Kafka, Redis streams):

1. The API puts a **message** on the queue (“send welcome email to user 42”) and answers right away (\`202 Accepted\`).
2. **Workers** (consumers) take messages off the queue and do the work, at their own pace.
3. If the email service is down, messages wait in the queue instead of failing user requests.

The trade-off: the work is **eventually** done, not done when the user gets the response. Design the UI for that (“We’ve sent you an email”).

In the simulator: \`writeVia: queue\` on the app sends its writes to the queue it's connected to; connect the queue to \`worker\`s, and the workers to the database or an external API.`,
      predict: {
        sql: SYNC + run(MAIL),
        question: 'Each sign-up sends a welcome email through an email API that takes **300 ms**. The API does it before answering. What is the median response time?',
        choices: ['About 50 ms: emails are quick', 'Over 300 ms: every sign-up waits for the email API', 'About 100 ms'],
        answer: 1,
        why: 'The user’s request includes the network round trip, the database write and the 300 ms email call. The median is close to 400 ms, for work the user doesn’t need to wait for.',
        verify: ['p50 > 300ms'],
      },
      example: {
        sql: JOBS('', ', instances: 2, concurrency: 40', true) + run(MAIL),
        note: 'The API puts the email on a queue and answers at once: the median is the network round trip again. The workers send the emails in the background. Compare the “p99 message delay”.',
      },
      cheat: { syntax: 'writeVia: queue → queue → worker', note: 'Answer now, do slow work later. The work becomes eventual.' },
    },
    {
      id: 's07-backlog',
      title: 'Backlogs and backpressure',
      card: `A queue absorbs **bursts**: producers can briefly add messages faster than workers take them, and the **backlog** grows, then drains. The workers must be faster than the **average** rate, not the peak.

How many workers? Little's law again: messages in progress = rate × time per message.
- 100 messages/s × 0.3 s each (mostly waiting on an API) = **30** messages in progress, so concurrency of 30+ across workers.
- If the time is **CPU**, concurrency doesn't help: each worker has only its cores. Add workers.

If workers are slower than the average rate, the backlog grows **forever**: messages get older and older. Watch the **age of the oldest message** (message delay), not just the count.

A queue can't be infinite either. A **bounded** queue rejects new messages when full (the API returns 503 or 429): that's **backpressure**, pushing the problem back to the producers before memory or disk runs out.`,
      predict: {
        sql: JOBS('', ', instances: 2') + run(BURST),
        question: 'For 10 seconds, sign-ups jump to **1,000/s**. Two workers can process about 400/s. What happens?',
        choices: ['Requests fail during the burst', 'Users see no errors; a backlog of thousands builds up and drains later', 'The workers speed up'],
        answer: 1,
        why: 'The API only adds messages to the queue, which is quick. The backlog grows by about 600 messages a second during the burst (over 6,000 in all), then the workers catch up after it.',
        verify: ['errors < 0.1%', 'maxBacklog > 5000'],
      },
      example: {
        sql: JOBS(', maxBacklog: 2000', ', instances: 2') + run(BURST),
        note: 'Now the queue holds at most 2,000 messages: during the burst it rejects the rest, and those requests fail (backpressure). Raise maxBacklog, or add workers, and compare.',
      },
      cheat: { syntax: 'workers ≥ average rate · maxBacklog', note: 'Queues absorb bursts; a bounded queue pushes back when full.' },
    },
    {
      id: 's07-pubsub',
      title: 'Queues and pub/sub',
      card: `Two ways to deliver a message:

- **Queue** (point to point): each message goes to **one** consumer. Several workers on the same queue **share** the work (competing consumers). Use it for jobs: “send this email”, “resize this photo”.
- **Topic** (publish/subscribe): each message goes to **every subscriber**. Each subscriber group then shares its copy among its own workers. Use it for events: “order placed” → email, stats, inventory, each doing its own thing.

With pub/sub, the producer doesn't know who listens. You can add a new subscriber (fraud checks, say) without touching the code that publishes the event. Kafka, SNS + SQS and Google Pub/Sub all work this way.

In the simulator: \`mode: topic\` on a queue sends every message to each connected worker group; \`mode: queue\` (the default) shares the messages between them.`,
      predict: {
        sql: EVENTS('queue') + run(SIGNUPS, '', '30s'),
        question: 'Order events go onto a **queue** (not a topic) that both the **email** workers and the **stats** workers read. Does every order get both an email and a stats update?',
        choices: ['Yes: both groups read the queue', 'No: they compete for messages, so each order goes to only one of them', 'Only if the workers are fast enough'],
        answer: 1,
        why: 'On a queue, each message is delivered to one consumer. Email and stats share the messages: each handles about half of them, and is about half as busy as with a topic.',
        verify: ['util(email) < 35%', 'util(stats) < 35%'],
      },
      example: {
        sql: EVENTS('topic') + run(SIGNUPS, '', '30s'),
        note: 'With mode: topic, each group gets every event: look at how busy email and stats are now, compared with mode: queue.',
      },
      cheat: { syntax: 'mode: queue | topic', note: 'Queue: one consumer per message. Topic: every subscriber gets it.' },
    },
    {
      id: 's07-retries',
      title: 'Retries and dead letters',
      card: `A worker takes a message, and the message becomes **invisible** to other workers. Then:

- The worker **acknowledges** (deletes) it when done.
- If the worker fails, or doesn't finish within the **visibility timeout**, the message reappears and is retried.

That's what makes queues reliable, but it has a dark side: a **poison message** (malformed, or one that triggers a bug) fails **every** time. It's retried forever, wasting workers and clogging the queue.

The fix is a **dead-letter queue (DLQ)**: after N failed attempts (\`maxReceives\`), the message moves aside, where a human or a tool can look at it. Alert on the DLQ's size.

In the simulator: \`maxReceives\`, \`dlq: true\` and \`visibilityTimeoutMs\` on the queue; \`poisonRate\` in the traffic adds messages that always fail.`,
      predict: {
        sql: JOBS(', visibilityTimeoutMs: 2000', ', instances: 1') + run(POISON),
        question: '2% of messages are malformed and fail every time. There is no dead-letter queue. After a minute, what does the queue look like?',
        choices: ['Empty: failed messages are dropped', 'Over a hundred messages stuck, retried again and again, and growing', 'Exactly as many as arrived in the last second'],
        answer: 1,
        why: 'Each poison message fails, reappears after the visibility timeout and fails again, forever. Every second adds two more, and the workers spend time on each one, over and over.',
        verify: ['backlog > 100'],
      },
      example: {
        sql: JOBS(', visibilityTimeoutMs: 2000, maxReceives: 3, dlq: true', ', instances: 1') + run(POISON),
        note: 'After 3 failed attempts a message moves to the dead-letter queue: the backlog stays small, and the bad messages are kept for inspection (“dead-lettered”).',
      },
      cheat: { syntax: 'maxReceives: 3 · dlq: true', note: 'Retry a few times, then park the message in a dead-letter queue.' },
    },
    {
      id: 's07-idempotency',
      title: 'At-least-once and idempotency',
      card: `Queues deliver **at least once**. A worker can finish the work and crash **before** it acknowledges the message. The message reappears, and another worker does the work **again**: two emails, two charges, a follower count off by one.

“Exactly once” delivery isn't something a queue can promise end to end. You get exactly-once **effects** by making consumers **idempotent**: doing the same message twice has the same effect as doing it once.

- Store each processed **message id** (or a business key like the order id), and skip messages already done.
- Prefer operations that are naturally idempotent: “set status = paid” instead of “add 1”.
- Payment APIs take an **idempotency key** for exactly this reason.

Also give the visibility timeout plenty of room: if it's shorter than the work, every slow message is handed to a second worker while the first is still on it.

In the simulator: \`idempotent: true\` on a worker checks the message id before doing the work; the results count “processed twice”.`,
      predict: {
        sql: JOBS('', ', instances: 2, concurrency: 50', true) + run(MAIL, CRASH),
        question: 'A worker crashes at 20 s while it is working on messages, and comes back 5 s later. Each message sends an email. What happens to the messages it was working on?',
        choices: ['They are lost', 'They are delivered again, and some emails go out twice', 'Nothing: the queue knows which ones finished'],
        answer: 1,
        why: 'Some had been sent but not yet acknowledged. After the visibility timeout they are delivered again, and sent again. Look for “processed twice”.',
        verify: ['duplicates > 5'],
      },
      example: {
        sql: JOBS('', ', instances: 2, concurrency: 50, idempotent: true', true) + run(MAIL, CRASH),
        note: 'With idempotent: true, a redelivered message is recognised by its id and skipped: no message is processed twice.',
      },
      cheat: { syntax: 'idempotent: true · visibility timeout > work time', note: 'Delivery is at-least-once; make effects happen once.' },
    },
  ],
  practice: [
    {
      id: 's07-p1',
      kind: 'readQuery',
      conceptIds: ['s07-async'],
      prompt: 'Which step of a sign-up is the **best** candidate for a queue?',
      choices: ['Checking the email isn’t already taken', 'Saving the new user', 'Sending the welcome email', 'Returning the session cookie'],
      answer: 2,
      hints: ['What does the user need before they can continue?'],
      explanation: 'The user needs the check, the saved account and the session now. The email can arrive a few seconds later, and should be retried if the email service is down.',
    },
    {
      id: 's07-p2',
      kind: 'write',
      conceptIds: ['s07-async'],
      prompt: 'Sign-ups wait **300 ms** for the email API. Redesign so that **p99 < 100 ms**, with no errors, and every email is sent within **2 seconds** (p99 message delay).',
      starterSql: SYNC,
      solution: JOBS('', ', instances: 2, concurrency: 40', true),
      wrongExample: SYNC.replace('instances: 2', 'instances: 6'),
      hints: ['More app servers don’t make the email API faster.', 'Answer first; send the email from a worker. Set writeVia: queue on the app.', 'Workers wait on the email API most of the time: give them plenty of concurrency.'],
      explanation: 'With `writeVia: queue`, the API only enqueues and answers in about 50 ms. Workers call the email API: 100 emails/s × 0.3 s means about 30 in progress at once, so 2 workers × 40 is plenty, and each email goes out within a second.',
      sd: { target: 'design', run: { traffic: MAIL_T, durationMs: 60_000, warmupMs: 5_000, requirements: ['p99 < 100ms', 'errors < 0.1%', 'messageP99 < 2s'] } },
    },
    {
      id: 's07-p3',
      kind: 'write',
      conceptIds: ['s07-backlog'],
      prompt: 'Workers process **100 messages/s**. Each one spends **0.3 s** waiting on an API. How many messages must be **in progress at once**?',
      solution: '30',
      wrongExample: '100',
      hints: ['Little’s law: rate × time.'],
      explanation: '100/s × 0.3 s = **30** in progress. Fewer than that, and the workers fall behind even though their CPUs are idle.',
      sd: { target: 'estimate', unit: 'messages', tolerance: 0.1 },
    },
    {
      id: 's07-p4',
      kind: 'fixBug',
      conceptIds: ['s07-backlog'],
      prompt: 'The backlog grows all day. Change the worker settings so messages are processed within **1 second** (p99) and fewer than **50** are left waiting at the end.',
      starterSql: JOBS('', ', instances: 1, concurrency: 1'),
      solution: JOBS('', ', instances: 1, concurrency: 2'),
      wrongExample: JOBS(', maxBacklog: 100000', ', instances: 1, concurrency: 1'),
      hints: ['A message takes about 16 ms (10 ms CPU, then a database write). How many per second can one at a time do?', 'A bigger queue only holds more waiting messages.'],
      explanation: 'One at a time, a worker handles about 60 messages/s, and 100 arrive: the backlog grows by 40 every second. With **concurrency 2**, one message can use the CPU while another waits on the database: about 120/s. (A second worker also works, for $35 more.)',
      sd: { target: 'design', tuneOnly: true, run: { traffic: SIGNUPS_T, durationMs: 60_000, warmupMs: 5_000, requirements: ['messageP99 < 1s', 'backlog < 50'] } },
    },
    {
      id: 's07-p5',
      kind: 'readQuery',
      conceptIds: ['s07-backlog'],
      prompt: 'Emails are piling up in the queue, but the worker’s CPU is almost idle. The simulator ran it. **What should you change?**',
      sql: JOBS('', ', instances: 1, concurrency: 4', true) + run(MAIL),
      choices: ['Add more worker instances: they’re overloaded', 'Raise the worker’s concurrency: each message mostly waits on the email API', 'Make the queue bigger', 'Use a topic instead of a queue'],
      answer: 1,
      verify: ['backlog > 1000', 'util(worker) < 15%'],
      hints: [],
      explanation: 'With 4 messages in progress and 0.3 s each, one worker sends about 13 emails/s, against 100 arriving. Its CPU is idle; it is waiting. Concurrency of 30–40 fixes it without paying for more instances.',
    },
    {
      id: 's07-p6',
      kind: 'fillBlank',
      conceptIds: ['s07-retries'],
      prompt: 'Malformed messages clog the queue. Fill in the setting so messages that fail 3 times are set aside, and fewer than **50** messages are left at the end.',
      starterSql: JOBS(', visibilityTimeoutMs: 2000, maxReceives: 3, dlq: ___', ', instances: 1'),
      solution: JOBS(', visibilityTimeoutMs: 2000, maxReceives: 3, dlq: true', ', instances: 1'),
      wrongExample: JOBS(', visibilityTimeoutMs: 2000, maxReceives: 3, dlq: false', ', instances: 1'),
      hints: ['Where does a message go after maxReceives failed attempts?'],
      explanation: 'With **dlq: true**, a message that failed 3 times moves to the dead-letter queue instead of being retried forever. The main queue stays clear; the dead letters wait for a human.',
      sd: { target: 'design', run: { traffic: POISON_T, durationMs: 60_000, warmupMs: 5_000, requirements: ['backlog < 50'] } },
    },
    {
      id: 's07-p7',
      kind: 'fixBug',
      conceptIds: ['s07-idempotency', 's07-retries'],
      prompt: 'Customers get the same email several times, and the queue keeps growing. Fix the settings: **no message processed twice**, and every email sent within **2 s**.',
      starterSql: JOBS(', visibilityTimeoutMs: 200', ', instances: 2, concurrency: 50', true),
      solution: JOBS(', visibilityTimeoutMs: 2000', ', instances: 2, concurrency: 50', true),
      wrongExample: JOBS(', visibilityTimeoutMs: 200', ', instances: 2, concurrency: 50, idempotent: true', true),
      hints: ['How long does one message take? Compare it with the visibility timeout.', 'Idempotency only helps if the first attempt finished before the second starts.'],
      explanation: 'Each message takes over 300 ms (the email API), but becomes visible again after **200 ms**, so a second worker picks it up while the first is still sending. Every message is sent at least twice, and the extra work snowballs. A visibility timeout of a few seconds fixes it. `idempotent` alone doesn’t: both attempts are in progress at the same time.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: MAIL_T, durationMs: 60_000, warmupMs: 5_000, requirements: ['duplicates = 0', 'messageP99 < 2s'] } },
    },
    {
      id: 's07-p8',
      kind: 'parsons',
      conceptIds: ['s07-retries'],
      prompt: 'Put the life of a message in order (with a worker that succeeds on the second try).',
      blocks: ['The API sends the message to the queue', 'A worker receives it; it becomes invisible to others', 'The worker fails; nothing is acknowledged', 'The visibility timeout expires and the message reappears', 'Another worker receives it and succeeds', 'The worker acknowledges (deletes) the message'],
      wrongOrder: ['The API sends the message to the queue', 'A worker receives it; it becomes invisible to others', 'The worker acknowledges (deletes) the message', 'The worker fails; nothing is acknowledged', 'The visibility timeout expires and the message reappears', 'Another worker receives it and succeeds'],
      hints: ['A message is only deleted after the work succeeds.'],
      explanation: 'Acknowledging only after success is what makes the queue at-least-once: a crash before the acknowledgement means another try.',
    },
    {
      id: 's07-p9',
      kind: 'fixBug',
      conceptIds: ['s07-idempotency'],
      prompt: 'A worker crashes at 20 s and some customers get their email twice. Make sure **no message is processed twice**, keeping emails within **2 s**.',
      starterSql: JOBS('', ', instances: 2, concurrency: 50', true),
      solution: JOBS('', ', instances: 2, concurrency: 50, idempotent: true', true),
      wrongExample: JOBS('', ', instances: 3, concurrency: 50', true),
      hints: ['Crashes will happen; the redelivery is the queue doing its job.', 'Make the second delivery harmless.'],
      explanation: '**idempotent: true**: the worker records each message id it completes, and skips one it has seen. More workers don’t help: whichever worker gets the redelivered message sends the email again.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: MAIL_T, durationMs: 60_000, warmupMs: 5_000, events: CRASH_EVENTS, requirements: ['duplicates = 0', 'messageP99 < 2s'] } },
    },
    {
      id: 's07-p10',
      kind: 'readQuery',
      conceptIds: ['s07-pubsub'],
      prompt: 'When an order is placed, you must send an email, update stock, and record statistics: three independent services. How should the order service tell them?',
      choices: ['Call the three services one after another', 'Put one message on a queue that all three read', 'Publish an “order placed” event to a topic each service subscribes to', 'Write to a shared database table they poll'],
      answer: 2,
      hints: ['Each service needs every order.'],
      explanation: 'A topic gives each subscriber its own copy of every event, and new subscribers can be added without changing the order service. On one shared queue, each order would reach only one of the three.',
    },
  ],
  test: [
    {
      id: 's07-t1',
      kind: 'readQuery',
      conceptIds: ['s07-pubsub'],
      prompt: 'Thousands of photos are uploaded each minute; each must be resized **once**. Ten identical resizer workers. Queue or topic?',
      choices: ['A queue: the workers share the photos', 'A topic: each worker gets every photo', 'Either; it makes no difference', 'Neither: resize during the upload'],
      answer: 0,
      hints: [],
      explanation: 'Each photo needs one resize, by any worker: competing consumers on a queue. With a topic, all ten would resize every photo.',
    },
    {
      id: 's07-t2',
      kind: 'write',
      conceptIds: ['s07-backlog'],
      prompt: 'Messages arrive at **500/s**, and the workers handle **300/s**. How many messages are waiting after **10 minutes**?',
      solution: '120000',
      wrongExample: '3000',
      hints: ['The backlog grows by (arrivals − processing) every second.'],
      explanation: '200 more per second × 600 s = **120,000** messages, and the newest waits 400 s (120,000 ÷ 300/s). Add workers until they’re faster than the average arrival rate.',
      sd: { target: 'estimate', unit: 'messages', tolerance: 0.1 },
    },
    {
      id: 's07-t3',
      kind: 'readQuery',
      conceptIds: ['s07-retries'],
      prompt: 'A queue’s backlog never reaches zero, even at night. Workers log the same few message ids failing over and over. What is missing?',
      choices: ['More workers', 'A dead-letter queue with a maximum number of attempts', 'A shorter visibility timeout', 'Idempotent workers'],
      answer: 1,
      hints: [],
      explanation: 'Poison messages: they fail every time and are retried forever. A maximum number of receives plus a DLQ moves them aside.',
    },
    {
      id: 's07-t4',
      kind: 'fixBug',
      conceptIds: ['s07-backlog'],
      prompt: 'During a 10-second burst of sign-ups, a third of them fail with “queue full”. Change the settings so **errors < 0.1%** and every message is processed within **30 s**.',
      starterSql: JOBS(', maxBacklog: 2000', ', instances: 2'),
      solution: JOBS(', maxBacklog: 20000', ', instances: 2'),
      wrongExample: JOBS(', maxBacklog: 2000', ', instances: 4'),
      hints: ['How many messages pile up during the burst?', 'Twice the workers still can’t keep up with 1,000/s.'],
      explanation: 'The burst adds about 6,000 messages that the workers can’t handle immediately. A queue that can hold them (**maxBacklog 20,000**) lets them wait a few seconds instead of failing. Four workers still fall behind 1,000/s, so the small queue still overflows.',
      sd: { target: 'design', tuneOnly: true, run: { traffic: BURST_T, durationMs: 60_000, warmupMs: 5_000, requirements: ['errors < 0.1%', 'messageP99 < 30s'] } },
    },
    {
      id: 's07-t5',
      kind: 'readQuery',
      conceptIds: ['s07-idempotency', 's07-retries'],
      prompt: 'Every email is sent two or three times, and the backlog keeps growing. The simulator ran it. **What is wrong?**',
      sql: JOBS(', visibilityTimeoutMs: 200', ', instances: 2, concurrency: 50', true) + run(MAIL),
      choices: ['The email API is failing', 'The visibility timeout is shorter than the work, so messages are redelivered while still in progress', 'Poison messages', 'Too few workers'],
      answer: 1,
      verify: ['duplicates > 1000', 'errors < 0.1%'],
      hints: [],
      explanation: 'A message takes over 300 ms but reappears after 200 ms. A second worker takes it while the first is still working, so the work is done several times, and the extra load makes the backlog grow.',
    },
    {
      id: 's07-t6',
      kind: 'readQuery',
      conceptIds: ['s07-idempotency'],
      prompt: 'A worker charges a card for each “order placed” message. How do you make sure a redelivered message doesn’t charge twice?',
      choices: [
        'Use a queue that guarantees exactly-once delivery',
        'Pass the order id as the payment API’s idempotency key, and record which orders are paid',
        'Lower the number of retries to zero',
        'Process the messages in a single worker',
      ],
      answer: 1,
      hints: [],
      explanation: 'Redeliveries will happen. With the order id as the idempotency key, the payment provider recognises a repeat and returns the first result instead of charging again.',
    },
  ],
};
