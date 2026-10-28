import type { Project } from '../../../content/types';
import type { Traffic } from '../engine/types';

/** Version 1: every timeline open is a query gathering recent posts from everyone the user follows. */
const ON_READ: Traffic = { rps: 600, mix: { query: 0.9, write: 0.1 }, keys: 100_000, readKb: 1 };

/** Version 2: timelines are precomputed; opening one is a single (cacheable) read. 2% of requests are new posts. */
const ON_WRITE: Traffic = { rps: 2000, mix: { read: 0.98, write: 0.02 }, keys: 100_000, skew: 0.9, readKb: 1 };

const V1 = (db: string) => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 2, size: medium }
  db: { type: db${db} }
connections:
  - users -> lb
  - lb -> app
  - app -> db
`;

const V2_START = `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, size: medium, writeVia: queue }
  queue: { type: queue }
  worker: { type: worker, fanout: 10 }
  db: { type: db }
connections:
  - users -> lb
  - lb -> app
  - app -> queue
  - app -> db
  - queue -> worker
  - worker -> db
`;

const V2 = (worker: string, db: string) => `components:
  users: { type: client }
  lb: { type: lb }
  app: { type: app, instances: 3, size: medium, writeVia: queue }
  cache: { type: cache, memoryMb: 256 }
  queue: { type: queue }
  worker: { type: worker, fanout: 10${worker} }
  db: { type: db${db} }
connections:
  - users -> lb
  - lb -> app
  - app -> cache
  - app -> queue
  - app -> db
  - queue -> worker
  - worker -> cache
  - worker -> db
`;

/** Project B (after module 7): a news feed, from fan-out on read to fan-out on write and a celebrity. */
export const projectB: Project = {
  id: 'sd-project-b',
  title: 'Project B: a news feed',
  story: `You are building the home timeline of **Chirp**, a small social network: open the app, see the latest posts from the people you follow, newest first.

Two classic designs:

- **Fan-out on read** (pull): when you open your timeline, gather the latest posts of everyone you follow, merge and sort them. Posting is cheap; reading is expensive.
- **Fan-out on write** (push): when someone posts, a background job copies the post into the timeline of each follower. Reading is one quick lookup; posting is expensive, and the work happens later, through a queue.

Real systems (Twitter/X, Instagram, Facebook) use push for most accounts and pull for celebrities. You'll build both and meet the celebrity.`,
  tasks: [
    {
      id: 'sdb-1',
      prompt: 'Chirp gets **1 million posts a day**, and each poster has **200 followers** on average. With fan-out on write, how many **timeline inserts per second** is that, on average?',
      requirements: [{ label: 'Within 25% of the estimate', sql: 'estimate' }],
      referenceSolution: '2315',
      discussion: `1 M posts × 200 followers = 200 M timeline inserts a day; ÷ 86,400 s ≈ **2,300 inserts/s**, against only about 12 posts/s. One post becomes 200 writes, which is why the fan-out goes through a queue and workers rather than happening while the poster waits.`,
      hints: ['Inserts a day: posts × followers.', 'A day has 86,400 seconds.'],
      sd: { target: 'estimate', unit: 'inserts/s' },
    },
    {
      id: 'sdb-2',
      prompt: `**Version 1: fan-out on read.** Every timeline open is a query that gathers recent posts from everyone the user follows: **540 timeline queries/s** plus 60 new posts/s. The single small database can't keep up.

Make it work: **p99 < 150 ms**, **errors < 0.1%**, for **under $400 a month**.`,
      requirements: [
        { label: 'p99 under 150 ms', sql: 'p99 < 150ms' },
        { label: 'Errors under 0.1%', sql: 'errors < 0.1%' },
        { label: 'Under $400 a month', sql: 'cost < $400' },
      ],
      referenceSolution: V1(', replicas: 2'),
      discussion: `A timeline query reads posts from many people, so it costs about twice a simple read (4 ms here). 540 of them a second is over 2 cores of work. **Read replicas** spread them (2 replicas run at about half busy), or a medium primary handles them alone.

Don't shard by post id here: every timeline query would then ask every shard. Fan-out on read gets more expensive as people follow more accounts, which is why big networks move to version 2.`,
      hints: ['Timeline queries are reads. What scales reads?', '540 queries × 4 ms ≈ 2.2 cores of work. A small database has 2.'],
      sd: { target: 'design', starter: V1(''), run: { traffic: ON_READ, durationMs: 30_000, warmupMs: 5_000 } },
    },
    {
      id: 'sdb-3',
      prompt: `**Version 2: fan-out on write.** Timelines are now precomputed: opening one is a single read of the user's timeline (**1,960 reads/s**, popular timelines read most). Each new post (**40/s**) is put on a queue, and a worker writes it into **10 timelines** (\`fanout: 10\`, scaled down from 200).

The starter has the queue and one worker, but no cache, and the database is drowning. Make it meet: **p99 < 100 ms**, **errors < 0.1%**, posts in followers' timelines within **2 s** (p99 message delay), for **under $1,100 a month**.`,
      requirements: [
        { label: 'p99 under 100 ms', sql: 'p99 < 100ms' },
        { label: 'Errors under 0.1%', sql: 'errors < 0.1%' },
        { label: 'Posts delivered within 2 s', sql: 'messageP99 < 2s' },
        { label: 'Under $1,100 a month', sql: 'cost < $1100' },
      ],
      referenceSolution: V2(', instances: 2, concurrency: 8', ', size: medium'),
      discussion: `Count the database's work:

- **Fan-out:** 40 posts × 10 timelines × 6 ms is 2.4 cores. Workers need enough of them to keep up: 400 inserts/s.
- **Reads:** precomputed timelines are perfect for a **cache**. Over 95% are hits, so only a few dozen reads a second reach the database.
- **Database size:** a medium database (4 cores) is then about two-thirds busy.
- **Invalidation:** the workers must reach the cache too (\`worker → cache\`). Each insert then deletes that timeline's cached copy, so the next read shows the new post.

At real scale (200 followers per post), the fan-out writes dominate everything, and the timeline store is usually a sharded key-value store or Redis lists, not the main database.`,
      hints: ['Opening a timeline is a read of one key, again and again: cache it.', 'Each post means 10 database writes from the workers. Is the database big enough for those plus the cache misses?', 'Connect the worker to the cache, so new posts invalidate cached timelines.'],
      sd: { target: 'design', starter: V2_START, run: { traffic: ON_WRITE, durationMs: 30_000, warmupMs: 5_000, warmCache: true } },
    },
    {
      id: 'sdb-4',
      prompt: `**The celebrity.** A pop star with 20,000 followers posts. That's **2,000 fan-out jobs** (of 10 timelines each) arriving at once, on top of normal traffic.

Get all of them delivered within **30 seconds**, while timeline reads stay fast (**p99 < 100 ms**, **errors < 0.1%**), for **under $1,300 a month**. You start from version 2.`,
      requirements: [
        { label: 'The celebrity’s backlog is delivered within 30 s', sql: 'drain < 30s' },
        { label: 'Timelines stay fast: p99 under 100 ms', sql: 'p99 < 100ms' },
        { label: 'Errors under 0.1%', sql: 'errors < 0.1%' },
        { label: 'Under $1,300 a month', sql: 'cost < $1300' },
      ],
      referenceSolution: V2(', instances: 2, concurrency: 8', ', size: large'),
      discussion: `The 2,000 jobs are 20,000 timeline inserts: 120 seconds of database work on one core. At normal load the medium database has only about 1.4 cores spare, so the backlog takes over a minute.

- **More workers alone don't help.** They just push the database to 100%, and then **timeline reads** slow down too. The queue protects the database only if the workers don't overwhelm it.
- **What works:** more database capacity, either a large database or 2 medium shards.

The real-world answer is different again: **don't fan out celebrities at all.** Store their posts once and merge them into followers' timelines **at read time** (a hybrid of push and pull). Their posts are then hot keys, which a cache handles well.`,
      hints: ['Watch the database while the backlog drains. What limits the drain rate?', 'Workers can only go as fast as the database lets them, and normal reads need the database too.'],
      sd: {
        target: 'design',
        starter: V2(', instances: 2, concurrency: 8', ', size: medium'),
        run: { traffic: ON_WRITE, durationMs: 40_000, warmupMs: 5_000, warmCache: true, backlog: { queue: 2000 } },
      },
    },
  ],
};
