/**
 * Checking System Design answers. Designs are judged by running them, never by comparing
 * them with one "correct" diagram: any design that meets the requirements passes.
 * Estimates pass within a tolerance of the worked solution.
 */
import type { Exercise, SdSpec } from '../../content/types';
import { checkRequirements, diagnose, runSimulation, simulate, toData, yamlToDesign, type Check, type Design, type SimData } from './engine';
import { toRunSpec, type SdRun } from './engine/scenario';

export interface SdOutcome {
  status: 'correct' | 'wrong' | 'error';
  /** Plain-language feedback; the first line sums it up. */
  feedback: string[];
  design?: Design;
  checks?: Check[];
  result?: SimData;
  /** Why the run went wrong, from the simulator (most important first). */
  diagnosis?: string[];
}

// ------------------------------------------------------------------ estimates

const MULT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 };

/** "1,200", "1.2k", "3.5 million", "2e6", "~86 400 req/s" → a number (null if there is none). */
export function parseEstimate(text: string): number | null {
  const m = /^\s*[~≈]?\s*([0-9][0-9,\s_]*(?:\.[0-9]+)?|\.[0-9]+)(?:e([+-]?[0-9]+))?\s*(k|thousand|mn|million|m|bn|billion|b|trillion|t)?(?![a-z])/i.exec(text);
  if (!m) return null;
  const base = Number(m[1].replace(/[,\s_]/g, ''));
  if (!Number.isFinite(base)) return null;
  const exp = m[2] ? Math.pow(10, Number(m[2])) : 1;
  return base * exp * (m[3] ? MULT[m[3].toLowerCase()] : 1);
}

/** Readable big numbers: 86400 → "86,400", 2500000 → "2.5 million". */
export function fmtNumber(n: number): string {
  const abs = Math.abs(n);
  const tidy = (x: number) => (x >= 100 ? Math.round(x).toString() : x >= 10 ? x.toFixed(1).replace(/\.0$/, '') : x.toFixed(2).replace(/\.?0+$/, ''));
  if (abs >= 1e12) return `${tidy(n / 1e12)} trillion`;
  if (abs >= 1e9) return `${tidy(n / 1e9)} billion`;
  if (abs >= 1e6) return `${tidy(n / 1e6)} million`;
  if (abs >= 1e4) return Math.round(n).toLocaleString('en');
  return tidy(n);
}

export function checkEstimate(spec: Pick<SdSpec, 'tolerance' | 'unit'>, solution: string, answer: string): SdOutcome {
  const want = parseEstimate(solution);
  const got = parseEstimate(answer);
  if (want === null) throw new Error(`Unreadable estimate solution "${solution}"`);
  if (got === null) return { status: 'error', feedback: ['Write a number, like 1200, 1.2k or 3 million.'] };
  const tol = spec.tolerance ?? 0.25;
  const unit = spec.unit ? ` ${spec.unit}` : '';
  if (Math.abs(got - want) <= tol * Math.abs(want)) return { status: 'correct', feedback: [`${fmtNumber(got)}${unit} is within ${Math.round(tol * 100)}% of ${fmtNumber(want)}${unit}.`] };
  const ratio = got > want ? got / want : want / got;
  const how = ratio >= 1.9 ? `about ${ratio >= 9.5 ? `${Math.round(Math.log10(ratio))} order${Math.round(Math.log10(ratio)) === 1 ? '' : 's'} of magnitude` : `${ratio.toFixed(1)}×`} too ${got > want ? 'high' : 'low'}` : `too ${got > want ? 'high' : 'low'}`;
  return { status: 'wrong', feedback: [`${fmtNumber(got)}${unit} is ${how}. Check each step: units (per second vs per day) and the multipliers are where estimates usually slip.`] };
}

// ------------------------------------------------------------------ designs

const sameTopology = (a: Design, b: Design): string | null => {
  const nodes = (d: Design) => d.nodes.map((n) => `${n.id}:${n.kind}`).sort().join(',');
  const edges = (d: Design) => d.edges.map((e) => `${e.from}->${e.to}`).sort().join(',');
  if (nodes(a) !== nodes(b)) return 'In this exercise you only change settings: keep the same components (same names and types).';
  if (edges(a) !== edges(b)) return 'In this exercise you only change settings: keep the same connections.';
  return null;
};

/** Everything that can be decided without running: the design parses, blanks are filled, the topology is kept when tuning. */
export function prepareDesign(answer: string, opts: { tuneOnly?: boolean; starter?: string } = {}): { design?: Design; outcome?: SdOutcome } {
  if (/___/.test(answer)) return { outcome: { status: 'error', feedback: ['Fill in every blank (___) first.'] } };
  const parsed = yamlToDesign(answer);
  if (!parsed.design) return { outcome: { status: 'error', feedback: ['The design has problems:', ...parsed.errors] } };
  if (opts.tuneOnly && opts.starter) {
    const start = yamlToDesign(opts.starter).design;
    const msg = start && sameTopology(start, parsed.design);
    if (msg) return { design: parsed.design, outcome: { status: 'error', feedback: [msg], design: parsed.design } };
  }
  return { design: parsed.design };
}

/** Judges a finished run against the requirements. */
export function judgeDesign(design: Design, result: SimData, requirements: string[]): SdOutcome {
  if (result.invalid?.length) return { status: 'error', feedback: ["The design can't run yet:", ...result.invalid], design, result };
  const checks = checkRequirements(result, requirements);
  const failed = checks.filter((c) => !c.ok);
  const diagnosis = diagnose(result);
  if (!failed.length) return { status: 'correct', feedback: ['Every requirement is met.'], design, checks, result, diagnosis };
  return {
    status: 'wrong',
    feedback: [`${failed.length} of ${checks.length} requirement${checks.length === 1 ? '' : 's'} not met.`, ...failed.map((c) => c.line)],
    design,
    checks,
    result,
    diagnosis,
  };
}

/** Runs a design under a run (in the worker) and judges it. */
export async function runDesign(design: Design, run: SdRun): Promise<SdOutcome> {
  const result = await runSimulation(toRunSpec(design, run));
  return judgeDesign(design, result, run.requirements ?? []);
}

/** The same, on the spot (tests and content checks). */
export function runDesignSync(design: Design, run: SdRun): SdOutcome {
  return judgeDesign(design, toData(simulate(toRunSpec(design, run))), run.requirements ?? []);
}

// ------------------------------------------------------------------ exercises

export function isEstimate(ex: Exercise): boolean {
  return ex.sd?.target === 'estimate';
}

/** Checks an answer to a design or estimate exercise. `sync` runs the simulation on the spot (tests). */
export async function evaluateSd(ex: Exercise, answer: string, sync = false): Promise<SdOutcome> {
  const spec = ex.sd;
  if (!spec || ex.kind === 'readQuery' || ex.kind === 'parsons') throw new Error(`${ex.id} is not a design or estimate exercise`);
  if (spec.target === 'estimate') return checkEstimate(spec, ex.solution, answer);
  const prep = prepareDesign(answer, { tuneOnly: spec.tuneOnly, starter: ex.starterSql });
  if (prep.outcome) return prep.outcome;
  const run = spec.run!;
  return sync ? runDesignSync(prep.design!, run) : runDesign(prep.design!, run);
}

/** Parsons for this course: blocks are steps or lines whose order matters. */
export function checkParsons(blocks: string[], given: string[]): boolean {
  return given.length === blocks.length && given.every((b, i) => b === blocks[i]);
}
