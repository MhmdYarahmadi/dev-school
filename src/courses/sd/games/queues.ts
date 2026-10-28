import type { SdLevel } from './rounds';

/** The sign-up pipeline: the API enqueues writes, workers process them (optionally calling a 300 ms email API). */
const pipeline = (queue: string, worker: string, mail = false, db = '') => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, size: medium, writeVia: queue }
  queue: { type: queue${queue} }
  worker: { type: worker${worker} }
${mail ? '  mail: { type: external, latencyMs: 300 }\n' : ''}  db: { type: db${db} }
connections:
  - users -> lb
  - lb -> app
  - app -> queue
  - app -> db
  - queue -> worker
${mail ? '  - worker -> mail\n' : ''}  - worker -> db
`;

/** Queue Pressure (after module 7): keep backlogs and message delays under control, with no lost or duplicated effects. */
export const QUEUE_LEVELS: SdLevel[] = [
  {
    title: 'Number crunching',
    story: 'Each message needs **10 ms of CPU** (image thumbnails), and **200 arrive every second**. One worker can’t keep up, and the backlog grows all day. Get every message done within **1 second**, as cheaply as possible.',
    scenario: `${pipeline('', ', instances: 1', false, ', size: medium')}traffic: { rps: 400, mix: { read: 0.5, write: 0.5 } }
run: { duration: 60s, warmup: 5s }
requirements:
  - messageP99 < 1s
  - backlog < 50
`,
    tuneOnly: true,
    parCost: 1100,
    solution: pipeline('', ', instances: 2', false, ', size: medium'),
    hint: 'This work is CPU: a worker has 2 cores, so at 10 ms a message it tops out at 200/s, whatever its concurrency. That’s exactly the arrival rate. Add a worker.',
  },
  {
    title: 'Waiting on the mail server',
    story: 'Welcome emails go through an email API that takes **300 ms**. **100 sign-ups a second**, and the emails are hours behind, yet the worker’s CPU is idle. Get every email out within **2 seconds**, without paying for servers you don’t need.',
    scenario: `${pipeline('', ', instances: 1, concurrency: 4', true)}traffic: { rps: 200, mix: { read: 0.5, write: 0.5 } }
run: { duration: 60s, warmup: 5s }
requirements:
  - messageP99 < 2s
  - backlog < 100
`,
    tuneOnly: true,
    parCost: 1900,
    solution: pipeline('', ', instances: 1, concurrency: 40', true),
    hint: 'Messages in progress = rate × time = 100/s × 0.3 s = 30. The worker isn’t short of CPU; it’s waiting. Raise its concurrency instead of adding workers. (The email API bills per email, so the bill rises as more emails go out.)',
  },
  {
    title: 'Flash sale',
    story: 'At **20 s**, a flash sale: **1,000 orders/s for 10 seconds**. The queue holds only 2,000 messages, so a third of the orders fail with “queue full”. Lose **no orders**, and process every one within **30 s**.',
    scenario: `${pipeline(', maxBacklog: 2000', ', instances: 2')}traffic: { rps: [[0, 100], [20s, 100], [21s, 1000], [30s, 1000], [31s, 100], [60s, 100]], mix: { write: 1 } }
run: { duration: 60s, warmup: 5s }
requirements:
  - errors < 0.1%
  - messageP99 < 30s
`,
    tuneOnly: true,
    parCost: 1100,
    solution: pipeline(', maxBacklog: 20000', ', instances: 2'),
    hint: 'The workers don’t need to keep up with the peak, only with the average. Let the queue hold the burst: raise maxBacklog well above the ~6,000 messages that pile up.',
  },
  {
    title: 'The poison pill',
    story: '**2%** of messages are malformed and fail every time. They come back again and again, and the queue never empties. Keep fewer than **50** messages waiting at the end, and keep the bad ones for inspection.',
    scenario: `${pipeline(', visibilityTimeoutMs: 2000', ', instances: 1')}traffic: { rps: 200, mix: { read: 0.5, write: 0.5 }, poisonRate: 0.02 }
run: { duration: 60s, warmup: 5s }
requirements:
  - backlog < 50
`,
    tuneOnly: true,
    parCost: 640,
    solution: pipeline(', visibilityTimeoutMs: 2000, maxReceives: 3, dlq: true', ', instances: 1'),
    hint: 'Give the queue a limit on attempts (maxReceives) and somewhere to put messages that hit it (dlq: true).',
  },
  {
    title: 'Charged twice',
    story: 'Each message sends a receipt email. Customers get receipts **two or three times**, and at **20 s** a worker crashes mid-batch. Make sure **no message is processed twice**, with every email out within **2 s**.',
    scenario: `${pipeline(', visibilityTimeoutMs: 200', ', instances: 2, concurrency: 50', true)}traffic: { rps: 100, mix: { write: 1 } }
run: { duration: 60s, warmup: 5s }
events:
  - { at: 20s, action: kill, node: worker, instance: 0 }
  - { at: 25s, action: restore, node: worker, instance: 0 }
requirements:
  - duplicates = 0
  - messageP99 < 2s
`,
    tuneOnly: true,
    parCost: 1900,
    solution: pipeline(', visibilityTimeoutMs: 2000', ', instances: 2, concurrency: 50, idempotent: true', true),
    hint: 'Two problems. A message takes over 300 ms but is handed out again after 200 ms: give the work time to finish. And a crash will always cause redeliveries: make the worker idempotent.',
  },
];
