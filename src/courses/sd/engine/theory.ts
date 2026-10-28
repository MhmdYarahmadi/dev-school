/**
 * Closed-form results from queueing theory and probability. The course uses them in
 * lessons (calculators, worked examples), and tests/sd-theory.test.ts checks that the
 * simulator reproduces them.
 */
import type { Zipf } from './rng';

/** Erlang C: the chance an arriving request has to wait, with c servers and offered load a = λ/μ. */
export function erlangC(c: number, a: number): number {
  if (a >= c) return 1;
  // Erlang B by the stable recursion, then convert
  let b = 1;
  for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b);
  const rho = a / c;
  return b / (1 - rho + rho * b);
}

/**
 * M/M/c: Poisson arrivals at `lambda` per second, `c` servers each serving `mu` per second.
 * Returns utilisation, the mean wait in the queue and the mean time in the system (seconds),
 * and the mean number in the system (Little's law: L = λW).
 */
export function mmc(lambda: number, mu: number, c: number) {
  const a = lambda / mu;
  const rho = a / c;
  if (rho >= 1) return { rho, pWait: 1, wq: Infinity, w: Infinity, l: Infinity, stable: false };
  const pWait = erlangC(c, a);
  const wq = pWait / (c * mu - lambda);
  const w = wq + 1 / mu;
  return { rho, pWait, wq, w, l: lambda * w, stable: true };
}

/** Waiting-time percentile in M/M/c: P(Wq > t) = C·e^{-(cμ-λ)t}. Returns the p-quantile of the time in queue (s). */
export function mmcWaitQuantile(lambda: number, mu: number, c: number, p: number): number {
  const C = erlangC(c, lambda / mu);
  if (1 - p >= C) return 0;
  return Math.log(C / (1 - p)) / (c * mu - lambda);
}

/**
 * Che's approximation for an LRU cache of `capacity` items under independent requests
 * with popularity `zipf`: hit ratio = Σ pᵢ(1 − e^{−pᵢ·T}), where T solves Σ(1 − e^{−pᵢ·T}) = capacity.
 */
export function cheHitRatio(z: Zipf, capacity: number): number {
  if (capacity >= z.n) return 1;
  const occ = (T: number) => {
    let s = 0;
    for (let k = 0; k < z.n; k++) s += 1 - Math.exp(-z.p(k) * T);
    return s;
  };
  let lo = 0;
  let hi = 1;
  while (occ(hi) < capacity) hi *= 2;
  for (let it = 0; it < 100; it++) {
    const mid = (lo + hi) / 2;
    if (occ(mid) < capacity) lo = mid;
    else hi = mid;
  }
  const T = (lo + hi) / 2;
  let h = 0;
  for (let k = 0; k < z.n; k++) {
    const p = z.p(k);
    h += p * (1 - Math.exp(-p * T));
  }
  return h;
}

/** Availability of one instance that fails every `mtbf` on average and takes `mttr` to repair. */
export function availability(mtbf: number, mttr: number): number {
  return mtbf / (mtbf + mttr);
}

/** At least one of n independent copies up. */
export function parallelAvailability(a: number, n: number): number {
  return 1 - Math.pow(1 - a, n);
}

/** All of n components in a chain up. */
export function serialAvailability(...as: number[]): number {
  return as.reduce((x, y) => x * y, 1);
}

/** Expected attempts per call when each attempt fails with probability f and up to r retries are made. */
export function retryAttempts(f: number, r: number): number {
  if (f >= 1) return r + 1;
  return (1 - Math.pow(f, r + 1)) / (1 - f);
}

/** Time to drain a backlog of `b` messages with consumers at `mu`/s total while `lambda`/s keep arriving (s). */
export function drainTime(b: number, mu: number, lambda: number): number {
  return mu > lambda ? b / (mu - lambda) : Infinity;
}

/** Share of keys that move when going from n to n+1 shards: hash mod n vs consistent hashing. */
export function movedShare(n: number, scheme: 'mod' | 'consistent'): number {
  return scheme === 'mod' ? n / (n + 1) : 1 / (n + 1);
}

/** Nines: 0.999 → "99.9%", and the yearly downtime it allows. */
export function downtimePerYear(a: number): { minutes: number; text: string } {
  const minutes = (1 - a) * 365 * 24 * 60;
  const text = minutes >= 60 * 24 ? `${(minutes / 60 / 24).toFixed(1)} days` : minutes >= 60 ? `${(minutes / 60).toFixed(1)} hours` : `${minutes.toFixed(1)} minutes`;
  return { minutes, text };
}
