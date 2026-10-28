/**
 * Defaults and prices. The numbers are deliberately round and typical rather than tied
 * to one provider; the course says so on its "What this simulator simplifies" card.
 *
 * Latency reference points used (widely published "numbers every engineer should know",
 * and typical cloud measurements):
 *  - same-AZ network round trip ≈ 0.5 ms, cross-AZ ≈ 1–2 ms
 *  - Redis GET/SET ≈ 0.02 ms of server time (one thread does ~50k ops/s)
 *  - an indexed PostgreSQL/MySQL point read ≈ 1–5 ms, a write with fsync ≈ 5–10 ms
 *  - users to a region ≈ 20–80 ms round trip; to a nearby CDN edge ≈ 5–20 ms
 */
import type { Size } from './types';

export const NET = {
  /** One-way latency between instances in the same AZ / different AZs (ms). */
  sameAz: 0.25,
  crossAz: 0.75,
  /** Users ↔ your region, round trip (ms). */
  rtt: 40,
  /** Users ↔ the nearest CDN edge, round trip (ms). */
  edgeRtt: 10,
};

/** Instance sizes: CPU cores, and (for databases) work speed and connection limits. */
export const SIZES: Record<Size, { cores: number; memGb: number; dbSpeed: number; dbConns: number }> = {
  small: { cores: 2, memGb: 4, dbSpeed: 1, dbConns: 50 },
  medium: { cores: 4, memGb: 16, dbSpeed: 2, dbConns: 100 },
  large: { cores: 8, memGb: 32, dbSpeed: 4, dbConns: 200 },
  xlarge: { cores: 16, memGb: 64, dbSpeed: 8, dbConns: 400 },
};

export const DEFAULTS = {
  app: { size: 'small' as Size, cpuMs: 5, threadsPerCore: 8, maxQueue: 200, dbPool: 10 },
  db: {
    size: 'small' as Size,
    /** Work for one indexed read / one durable write on a small instance (ms); bigger sizes are faster per core. */
    readMs: 2,
    writeMs: 6,
    replicationLagMs: 50,
    replicaApplyRate: 5000,
    maxQueue: 1000,
  },
  cache: { memoryMb: 1024, opMs: 0.02, itemKb: 1, flushMs: 1000 },
  cdn: { capacity: 10000, ttlMs: 3_600_000 },
  lb: { healthInterval: 5000, unhealthy: 2 },
  queue: { maxBacklog: 1_000_000, visibilityTimeoutMs: 30_000, maxReceives: 5, opMs: 2 },
  worker: { cpuMs: 10, concurrency: 4 },
  objectstore: { latencyMs: 20 },
  external: { latencyMs: 100 },
  traffic: { keys: 10000, skew: 0.9, users: 10000, readKb: 2, staticKb: 100, clientTimeoutMs: 30_000 },
  autoscale: { targetCpu: 0.6, bootMs: 60_000, intervalMs: 15_000, cooldownMs: 60_000 },
};

/**
 * Monthly prices in US$ (rounded on-demand list prices of the big clouds, 2025–26).
 * Fixed prices are per instance; usage prices are scaled from the simulated rate to a 30-day month.
 */
export const PRICES = {
  app: { small: 35, medium: 70, large: 140, xlarge: 280 } as Record<Size, number>,
  db: { small: 70, medium: 140, large: 280, xlarge: 560 } as Record<Size, number>,
  /** Per GB of cache memory per month. */
  cacheGb: 12,
  lb: 20,
  /** Per GB transferred from a CDN. */
  cdnGb: 0.08,
  /** Per million queue operations. */
  queuePerMillion: 0.4,
  /** Per GB-month stored (not modelled per request) + per million GETs. */
  objectGetPerMillion: 0.4,
  /** Per million calls to an external API (a paid service). */
  externalPerMillion: 5,
  /** A rate limiter in your own proxy or gateway (Nginx limit_req, Envoy), like a load balancer. */
  rateLimiter: 20,
  /** Internet egress per GB from your servers (CDN traffic is billed separately). */
  egressGb: 0.09,
};

export const MONTH_MS = 30 * 24 * 3600 * 1000;
