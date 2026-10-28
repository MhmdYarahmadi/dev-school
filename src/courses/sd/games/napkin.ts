/**
 * Napkin Math: estimation questions generated from templates with random but round inputs,
 * so every play is different. tests/sd-games.test.ts checks each template's answer
 * against its worked steps.
 */
import { Rng } from '../engine/rng';

export interface NapkinQuestion {
  topic: string;
  prompt: string;
  answer: number;
  unit: string;
  /** The worked steps, shown after answering. */
  steps: string;
}

const pick = <T>(r: Rng, xs: T[]): T => xs[r.int(xs.length)];
const n = (x: number) => x.toLocaleString('en');
const M = (x: number) => (x >= 1e6 ? `${x / 1e6} million` : n(x));

/** One template per kind of estimate; each returns a fresh question. */
export const TEMPLATES: Record<string, (r: Rng) => NapkinQuestion> = {
  avgRps: (r) => {
    const dau = pick(r, [1e6, 2e6, 5e6, 10e6, 20e6, 50e6]);
    const per = pick(r, [5, 10, 20, 30, 50]);
    const day = dau * per;
    return {
      topic: 'Traffic',
      prompt: `**${M(dau)}** daily active users make **${per}** requests each per day. What is the **average** rate?`,
      answer: day / 86_400,
      unit: 'requests/s',
      steps: `${M(dau)} × ${per} = ${M(day)} a day; ÷ 86,400 ≈ **${n(Math.round(day / 86_400))}/s**.`,
    };
  },
  peakRps: (r) => {
    const day = pick(r, [50e6, 100e6, 200e6, 500e6, 1000e6]);
    const peak = pick(r, [2, 2.5, 3]);
    const avg = day / 86_400;
    return {
      topic: 'Traffic',
      prompt: `A service gets **${M(day)}** requests a day, and the peak is **${peak}×** the average. What is the **peak** rate?`,
      answer: avg * peak,
      unit: 'requests/s',
      steps: `${M(day)} ÷ 86,400 ≈ ${n(Math.round(avg))}/s on average; × ${peak} ≈ **${n(Math.round(avg * peak))}/s**.`,
    };
  },
  storageYear: (r) => {
    const items = pick(r, [100_000, 500_000, 1e6, 2e6, 10e6]);
    const kb = pick(r, [1, 2, 5, 10, 200, 500]);
    const gbDay = (items * kb) / 1e6;
    return {
      topic: 'Storage',
      prompt: `**${M(items)}** new items a day, **${kb} KB** each. How much storage per **year** (one copy)?`,
      answer: (gbDay * 365) / 1000,
      unit: 'TB',
      steps: `${M(items)} × ${kb} KB = ${gbDay} GB a day; × 365 ≈ **${+((gbDay * 365) / 1000).toFixed(2)} TB**.`,
    };
  },
  storageCopies: (r) => {
    const gbDay = pick(r, [10, 50, 100, 200, 500]);
    const years = pick(r, [1, 2, 3, 5]);
    const copies = pick(r, [2, 3]);
    const tb = (gbDay * 365 * years * copies) / 1000;
    return {
      topic: 'Storage',
      prompt: `A database grows by **${gbDay} GB a day**, keeps everything for **${years} year${years > 1 ? 's' : ''}**, with **${copies} copies**. How much storage in total?`,
      answer: tb,
      unit: 'TB',
      steps: `${gbDay} GB × ${365 * years} days × ${copies} = ${n(gbDay * 365 * years * copies)} GB ≈ **${+tb.toFixed(1)} TB**.`,
    };
  },
  bandwidth: (r) => {
    const rps = pick(r, [500, 1000, 2000, 5000, 10_000]);
    const kb = pick(r, [10, 50, 100, 200, 500]);
    const mbs = (rps * kb) / 1000;
    return {
      topic: 'Bandwidth',
      prompt: `**${n(rps)}** responses a second, **${kb} KB** each. How much outgoing bandwidth, in **MB/s**?`,
      answer: mbs,
      unit: 'MB/s',
      steps: `${n(rps)} × ${kb} KB = ${n(rps * kb)} KB/s = **${n(mbs)} MB/s** (${n((mbs * 8) / 1000)} Gbit/s).`,
    };
  },
  bandwidthBits: (r) => {
    const viewers = pick(r, [1000, 5000, 10_000, 50_000]);
    const mbit = pick(r, [2, 3, 5, 8]);
    const gbit = (viewers * mbit) / 1000;
    return {
      topic: 'Bandwidth',
      prompt: `**${n(viewers)}** people stream video at once, at **${mbit} Mbit/s** each. Total bandwidth, in **Gbit/s**?`,
      answer: gbit,
      unit: 'Gbit/s',
      steps: `${n(viewers)} × ${mbit} Mbit/s = ${n(viewers * mbit)} Mbit/s = **${n(gbit)} Gbit/s**.`,
    };
  },
  egressBill: (r) => {
    const mbs = pick(r, [10, 20, 50, 100]);
    const tb = (mbs * 2_592_000) / 1e6;
    return {
      topic: 'Cost',
      prompt: `You send **${mbs} MB/s** to users, all month, at **$0.09 per GB**. What is the monthly bandwidth bill, in **$**?`,
      answer: tb * 1000 * 0.09,
      unit: '$',
      steps: `${mbs} MB/s × 2.59 M seconds ≈ ${n(Math.round(tb))} TB = ${n(Math.round(tb * 1000))} GB; × $0.09 ≈ **$${n(Math.round(tb * 1000 * 0.09))}**.`,
    };
  },
  cacheMemory: (r) => {
    const items = pick(r, [10e6, 20e6, 50e6, 100e6]);
    const kb = pick(r, [1, 2, 5]);
    const share = pick(r, [10, 20]);
    const gb = ((items * kb) / 1e6) * (share / 100);
    return {
      topic: 'Memory',
      prompt: `**${M(items)}** items of **${kb} KB**. You cache the hottest **${share}%**. How much memory, in **GB**?`,
      answer: gb,
      unit: 'GB',
      steps: `${M(items)} × ${kb} KB = ${n((items * kb) / 1e6)} GB; ${share}% of that = **${n(gb)} GB**.`,
    };
  },
  servers: (r) => {
    const peak = pick(r, [2000, 5000, 8000, 12_000, 20_000]);
    const per = pick(r, [500, 1000, 1500, 2000]);
    const target = pick(r, [0.6, 0.65, 0.7]);
    const need = Math.ceil(peak / (per * target));
    return {
      topic: 'Servers',
      prompt: `Peak traffic is **${n(peak)}/s**. One server handles **${n(per)}/s** at full CPU, and you target **${Math.round(target * 100)}%** utilisation. How many servers (no spare)?`,
      answer: need,
      unit: 'servers',
      steps: `${n(per)} × ${target} = ${n(per * target)}/s per server; ${n(peak)} ÷ ${n(per * target)} ≈ ${(peak / (per * target)).toFixed(1)} → **${need}**.`,
    };
  },
  capacity: (r) => {
    const cores = pick(r, [2, 4, 8]);
    const ms = pick(r, [5, 10, 20, 25, 40]);
    return {
      topic: 'Servers',
      prompt: `A server has **${cores} cores**, and each request needs **${ms} ms** of CPU. How many requests a second can it complete at most?`,
      answer: (cores * 1000) / ms,
      unit: 'requests/s',
      steps: `${cores} × 1000 ÷ ${ms} = **${n((cores * 1000) / ms)}/s**.`,
    };
  },
  little: (r) => {
    const rps = pick(r, [200, 500, 1000, 2000, 5000]);
    const ms = pick(r, [10, 20, 50, 100, 200]);
    return {
      topic: "Little's law",
      prompt: `**${n(rps)}** requests/s, each taking **${ms} ms**. How many are in progress at once, on average?`,
      answer: (rps * ms) / 1000,
      unit: 'requests',
      steps: `${n(rps)} × ${ms / 1000} s = **${n((rps * ms) / 1000)}**.`,
    };
  },
  sequential: (r) => {
    const calls = pick(r, [5, 10, 20, 30]);
    const ms = pick(r, [1, 2, 3, 5]);
    const rtt = pick(r, [0.5, 1]);
    return {
      topic: 'Latency',
      prompt: `A handler makes **${calls}** database calls one after another. Each takes **${ms} ms** plus a **${rtt} ms** round trip. Total time waiting, in **ms**?`,
      answer: calls * (ms + rtt),
      unit: 'ms',
      steps: `${calls} × (${ms} + ${rtt}) = **${n(calls * (ms + rtt))} ms**.`,
    };
  },
};

export const ROUNDS = 10;
export const SECONDS = 45;
export const ROUND_MAX = 100;

/** A play's questions: every template once (shuffled), topped up at random to ROUNDS. */
export function makeQuestions(seed: number): NapkinQuestion[] {
  const r = new Rng(seed);
  const keys = Object.keys(TEMPLATES);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys.slice(0, ROUNDS).map((k) => TEMPLATES[k](r));
}

/** Accuracy points (within 10%: 100, 25%: 70, 50%: 35). Full marks in the first 15 s, then down to half at the buzzer. */
export function napkinScore(answer: number, truth: number, secondsLeft: number): { points: number; error: number } {
  const error = Math.abs(answer - truth) / Math.abs(truth);
  const acc = error <= 0.1 ? 100 : error <= 0.25 ? 70 : error <= 0.5 ? 35 : 0;
  const speed = 0.5 + 0.5 * Math.max(0, Math.min(1, secondsLeft / (SECONDS - 15)));
  return { points: Math.round(acc * speed), error };
}
