import type { GameMeta } from '../../../shared/course';

/** System Design course games: scenario challenges on the simulator. */
export const SD_GAMES: Record<string, GameMeta> = {
  napkin: { id: 'napkin', title: 'Napkin Math', icon: '🧮', moduleId: 's02', pitch: 'Rapid-fire estimates: requests per second, storage, bandwidth, cache memory and servers. Score for being close, and for being quick.', skills: 'QPS, peak, storage, bandwidth, servers' },
  surge: { id: 'surge', title: 'Traffic Surge', icon: '🌊', moduleId: 's03', pitch: 'Waves of traffic, crashes and logged-out users. Keep p99 and errors in bounds, at the lowest monthly bill.', skills: 'instances, sizes, LB algorithms, health checks, autoscaling' },
  cachegame: { id: 'cachegame', title: 'Cache Me If You Can', icon: '⚡', moduleId: 's04', pitch: 'Meet latency targets on a memory budget, then survive stale prices, a stampede and a cache restart.', skills: 'cache-aside, memory, invalidation, single flight, CDN' },
  shards: { id: 'shards', title: 'Shard Shuffle', icon: '🧩', moduleId: 's06', pitch: 'Split a growing orders database: pick shard counts and partitioning, tame a viral product, add a shard without moving everything.', skills: 'shards, hash vs range, hot keys, consistent hashing, partition keys' },
  queues: { id: 'queues', title: 'Queue Pressure', icon: '📬', moduleId: 's07', pitch: 'Bursts, slow consumers, poison messages and double charges. Keep backlogs under control, with nothing lost or done twice.', skills: 'workers, concurrency, backpressure, DLQ, idempotency' },
  chaos: { id: 'chaos', title: 'Chaos Day', icon: '🔥', moduleId: 's09', pitch: 'A day of injected failures: a stuck provider, a retry storm, a dead zone, a scraper. Spend your budget on the right safeguards and stay inside the error budget.', skills: 'timeouts, backoff, breakers, zones, failover, rate limits' },
  launch: { id: 'launch', title: 'Launch Night (finale)', icon: '🚀', moduleId: 's10', pitch: 'The finale: launch night of a new app, in five acts. A traffic spike, an empty cache, a dead primary, a failing dependency, then the whole night in one run.', skills: 'everything' },
};
