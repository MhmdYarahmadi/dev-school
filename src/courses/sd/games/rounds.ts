/**
 * Scenario levels for the System Design games: a starting design, the traffic and failures
 * it must survive, requirements, and a par cost an expert reaches. tests/sd-games.test.ts
 * proves that each starter fails and each reference solution passes at or under par.
 */
import { designToYaml } from '../engine';
import { scenarioFromYaml, type SdRun } from '../engine/scenario';

export interface SdLevel {
  title: string;
  /** Markdown: the situation and what to watch. */
  story: string;
  /** The starting design plus traffic, run, events, phases and requirements, as one scenario YAML. */
  scenario: string;
  /** Only settings may change (no new components or connections). */
  tuneOnly?: boolean;
  /** Monthly cost of a good answer: full cost points at or under it. */
  parCost: number;
  /** A design that passes at or under par. */
  solution: string;
  hint: string;
}

export const LEVEL_MAX = 100;

/** Passing scores 70; up to 30 more for cost (all of it at par, none at 1.5 × par); the hint costs 20. */
export function levelScore(passed: boolean, cost: number, par: number, hinted: boolean): number {
  if (!passed) return 0;
  const over = Math.max(0, cost / par - 1);
  const costPts = Math.round(30 * Math.max(0, 1 - over / 0.5));
  return Math.max(10, 70 + costPts - (hinted ? 20 : 0));
}

/** The starting design (as tidy YAML) and the run of a level. */
export function prepareLevel(level: SdLevel): { starter: string; run: SdRun } {
  const p = scenarioFromYaml(level.scenario);
  if (!p.scenario) throw new Error(`Level "${level.title}": ${p.errors.join('; ')}`);
  const { design, ...run } = p.scenario;
  return { starter: designToYaml(design), run };
}
