/**
 * Seeded randomness. Every simulation run is reproducible: the same design,
 * traffic and seed always give the same numbers (tests and feedback rely on it).
 */

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform in [0, 1). mulberry32. */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A child generator with its own stream (so adding a node doesn't shift every other stream). */
  fork(salt: number): Rng {
    return new Rng(hash32((this.s ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0));
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Exponential with the given mean. */
  exp(mean: number): number {
    if (mean <= 0) return 0;
    return -mean * Math.log(1 - this.next());
  }

  normal(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Log-normal with the given mean and coefficient of variation (sd / mean). */
  lognormal(mean: number, cv: number): number {
    if (mean <= 0) return 0;
    const sigma2 = Math.log(1 + cv * cv);
    const mu = Math.log(mean) - sigma2 / 2;
    return Math.exp(mu + Math.sqrt(sigma2) * this.normal());
  }
}

/** A good 32-bit integer hash (murmur3 finaliser). Used for keys → shards, users → servers. */
export function hash32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Zipf-distributed ranks 0..n-1 (rank 0 = most popular), P(k) ∝ 1/(k+1)^s.
 * s = 0 is uniform; web workloads are typically around 0.8–1.0.
 */
export class Zipf {
  readonly n: number;
  readonly s: number;
  private cdf: Float64Array;
  constructor(n: number, s: number) {
    this.n = n;
    this.s = s;
    this.cdf = new Float64Array(n);
    let sum = 0;
    for (let k = 0; k < n; k++) {
      sum += 1 / Math.pow(k + 1, s);
      this.cdf[k] = sum;
    }
    for (let k = 0; k < n; k++) this.cdf[k] /= sum;
  }

  /** Probability of rank k. */
  p(k: number): number {
    return k === 0 ? this.cdf[0] : this.cdf[k] - this.cdf[k - 1];
  }

  sample(rng: Rng): number {
    const u = rng.next();
    let lo = 0;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.cdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

const zipfCache = new Map<string, Zipf>();
/** Zipf tables are reused between runs (building one for 1M keys takes a few ms). */
export function zipf(n: number, s: number): Zipf {
  const k = `${n}:${s}`;
  let z = zipfCache.get(k);
  if (!z) {
    z = new Zipf(n, s);
    if (zipfCache.size > 16) zipfCache.clear();
    zipfCache.set(k, z);
  }
  return z;
}
