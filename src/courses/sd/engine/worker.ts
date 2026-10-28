/// <reference lib="webworker" />
/**
 * Runs simulations off the main thread so the canvas stays responsive.
 * Messages: { id, spec, windows? } → { id, result } (or { id, error }).
 */
import { simulate } from './simulate';
import { toData } from './run';
import type { RunSpec } from './types';

self.onmessage = (e: MessageEvent<{ id: number; spec: RunSpec; windows?: [number, number][] }>) => {
  const { id, spec, windows } = e.data;
  try {
    const result = toData(simulate(spec), windows);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
