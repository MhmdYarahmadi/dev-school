/**
 * Running a simulation from the UI: in a Web Worker when the browser has one,
 * otherwise (tests, very old browsers) on the spot. Results come back as plain data.
 */
import { simulate, type SimResult, type WindowStats } from './simulate';
import type { RunSpec } from './types';

/** A result without the `window()` function (it can't cross to the page), plus any windows asked for. */
export type SimData = Omit<SimResult, 'window'> & { windows: WindowStats[] };

export function toData(r: SimResult, windows: [number, number][] = []): SimData {
  const { window, ...rest } = r;
  return { ...rest, windows: windows.map(([a, b]) => window(a, b)) };
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: SimData) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: SimData; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.result) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error ?? 'The simulation failed.'));
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('The simulation stopped unexpectedly.'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export function runSimulation(spec: RunSpec, windows?: [number, number][]): Promise<SimData> {
  const w = getWorker();
  if (!w) return Promise.resolve(toData(simulate(spec), windows));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, spec, windows });
  });
}
