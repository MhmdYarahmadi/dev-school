/**
 * Course content is plain data. Every SQL answer here is verified by
 * tests/solutions.test.ts: the solution must pass, the wrongExample must fail.
 */
import type { SdRun } from '../courses/sd/engine/scenario';

export interface PredictPrompt {
  sql: string;
  question?: string;
  choices: string[];
  answer: number;
  /** Shown after answering. Why the real result is what it is. */
  why: string;
  /** The query is meant to fail (the lesson is the error). Tests assert it errors. */
  expectError?: boolean;
  /** System Design course: requirement-style facts about the real run that prove `answer` (checked by tests), e.g. "p99 > 500ms". */
  verify?: string[];
}

/** Starting point for running examples/exercises in a simulated environment (Docker course). */
export interface SandboxEnv {
  /** Project files, relative to the project folder (e.g. 'Dockerfile', 'site/index.html'). */
  files?: Record<string, string>;
  /** Commands run before the learner's (not shown), e.g. to pull images or start containers. */
  setup?: string[];
}

/** Docker-course specifics of an exercise. */
export interface DockerSpec extends SandboxEnv {
  /** What the learner writes: shell commands, a Dockerfile or a compose.yaml. */
  target: 'commands' | 'dockerfile' | 'compose';
  /** Commands run after building/starting (both for the learner and the reference), whose output is compared. */
  after?: string[];
  /**
   * What must match the reference. Defaults depend on the target.
   * 'output' compares what the `after` commands print; 'stdout' compares what the answer itself prints.
   */
  compare?: ('containers' | 'images' | 'volumes' | 'networks' | 'config' | 'output' | 'stdout')[];
  /** Tag used when building a Dockerfile answer (default 'app'). */
  tag?: string;
  /** Upper limit for the built image size in MB (Dockerfile answers). */
  maxSizeMb?: number;
  /** Dockerfile answers: after the build, change `edit` and rebuild; the `cached` steps (instruction prefixes) must come from the cache. */
  rebuild?: { edit: string; cached: string[] };
  /** Dockerfile answers: the built image must run as this user (not root). */
  user?: string;
}

/**
 * System Design course specifics of an exercise. The answer is a design (YAML, edited on the
 * canvas) or, for estimates, a number. `solution`/`wrongExample` hold the same kind of answer.
 */
export interface SdSpec {
  target: 'design' | 'estimate';
  /** Designs: the traffic, failures and requirements the answer is run against. */
  run?: SdRun;
  /** Designs: only settings may change, no components or connections added or removed ("tune it"). */
  tuneOnly?: boolean;
  /** Estimates: the unit shown next to the answer, e.g. "requests/s". */
  unit?: string;
  /** Estimates: accepted relative error (default 0.25: within 25% of the solution). */
  tolerance?: number;
}

/**
 * Git course specifics of an exercise. The machine starts in the learner's home folder:
 * `files` are written there, then `setup` runs (it may `cd` into a repository, use `@sam …`
 * for the teammate and `@hub …` for the hub).
 */
export interface GitSpec extends SandboxEnv {
  /** What the learner writes: commands (the default), or the content of `file` (e.g. a resolved conflict, a .gitignore). */
  target?: 'commands' | 'file';
  /** target 'file': the file the answer is saved to (relative to the folder setup ended in). */
  file?: string;
  /** Run after the answer, for the learner and the reference alike (e.g. `git add` + `git commit` after a file answer). */
  after?: string[];
  /**
   * What must match the reference: 'repo' (branches, HEAD and every commit's files and parents;
   * messages don't matter), 'messages' (commit subjects too), 'staging' (the index),
   * 'files' (the working folder), 'hub' (the hub's branches and pull requests),
   * 'stdout' (what the answer prints must include what the reference prints).
   * Default: repo, staging, files, hub.
   */
  compare?: ('repo' | 'messages' | 'staging' | 'files' | 'hub' | 'stdout')[];
  /** With 'stdout': the output must be exactly the reference's (for "only…" tasks), not just contain it. */
  exactOutput?: boolean;
}

export interface Concept {
  id: string;
  title: string;
  /** Docker and Git courses: files/setup for the example and the prediction. */
  env?: SandboxEnv;
  /** Short markdown explanation: one idea, under 2 minutes. */
  card: string;
  /** Asked *before* the learner runs the example. */
  predict?: PredictPrompt;
  /** A fully worked example the learner can run. */
  example: { sql: string; note: string };
  /** Added to the personal cheat sheet once the concept is practised. */
  cheat: { syntax: string; note: string };
}

interface ItemBase {
  id: string;
  conceptIds: string[];
  prompt: string;
  explanation: string;
  hints: string[];
  /** Docker course only. */
  docker?: DockerSpec;
  /** System Design course only. */
  sd?: SdSpec;
  /** Git course only. */
  git?: GitSpec;
}

export interface SqlCheck {
  solution: string;
  /** A plausible wrong answer. Tests assert it does NOT pass. */
  wrongExample: string;
  orderMatters?: boolean;
  checkQuery?: string;
  setupSql?: string;
}

/** Write a query from scratch. */
export interface WriteExercise extends ItemBase, SqlCheck {
  kind: 'write';
  starterSql?: string;
  /** Same skill, different data. Queued after viewing the solution. */
  variants?: Omit<WriteExercise, 'variants' | 'kind' | 'conceptIds'>[];
}

/** Starter SQL contains ___ blanks to fill in. */
export interface FillBlankExercise extends ItemBase, SqlCheck {
  kind: 'fillBlank';
  starterSql: string;
}

/** A broken query to repair. */
export interface FixBugExercise extends ItemBase, SqlCheck {
  kind: 'fixBug';
  starterSql: string;
}

/** Drag blocks into order. The assembled SQL is checked by running it, so any valid order passes. */
export interface ParsonsExercise extends ItemBase {
  kind: 'parsons';
  /** In the correct order. */
  blocks: string[];
  /** Blocks that don't belong. */
  distractors?: string[];
  orderMatters?: boolean;
  setupSql?: string;
  /** Tests assert this arrangement fails. */
  wrongOrder: string[];
}

/** Multiple choice about a query: what does it do, which one is right, what will it return. */
export interface ChoiceExercise extends ItemBase {
  kind: 'readQuery';
  sql?: string;
  /** The shown query is meant to fail. Tests assert it errors. */
  expectError?: boolean;
  /** System Design course: `sql` is a scenario, and these requirement-style facts about its run prove the answer (checked by tests). */
  verify?: string[];
  choices: string[];
  answer: number;
}

export type Exercise = WriteExercise | FillBlankExercise | FixBugExercise | ParsonsExercise | ChoiceExercise;
export type SqlExercise = WriteExercise | FillBlankExercise | FixBugExercise;

export function isSqlExercise(e: Exercise): e is SqlExercise {
  return e.kind === 'write' || e.kind === 'fillBlank' || e.kind === 'fixBug';
}

/** Open-ended project: several valid answers, so we check properties of the result. */
export interface ProjectTask {
  id: string;
  prompt: string;
  /**
   * PostgreSQL: each requirement is a SQL query over the learner's result (temp table `answer`) returning one boolean.
   * Docker: each requirement is a command run after the learner's commands; it passes when it exits with `code`
   * (default 0) and its output matches the regex `expect` (if given).
   */
  requirements: { label: string; sql: string; expect?: string; code?: number }[];
  referenceSolution: string;
  discussion: string;
  hints: string[];
  /** Docker course: the machine the task starts from (project files, setup commands), and what the answer is (default: commands; a Dockerfile is built with `tag`). */
  docker?: SandboxEnv & { target?: DockerSpec['target']; tag?: string; starter?: string };
  /**
   * System Design course: the answer is a design run against `run` (each requirement's `sql` is a
   * requirement like "p99 < 200ms"), or an estimate (one requirement whose `sql` is "estimate").
   */
  sd?: Omit<SdSpec, 'tuneOnly'> & { starter?: string };
  /**
   * Git course: the machine the task starts from. Each requirement's `sql` is a command run on the
   * learner's machine afterwards; it passes when it exits with `code` (default 0) and its output
   * matches `expect` (if given), like Docker's.
   */
  git?: SandboxEnv;
}

export interface Project {
  id: string;
  title: string;
  story: string;
  tasks: ProjectTask[];
}

/** Game ids are course-specific strings (see each course's game registry). */
export type GameId = string;

export interface Module {
  id: string;
  number: number;
  title: string;
  tagline: string;
  concepts: Concept[];
  practice: Exercise[];
  /** This module's own test questions; earlier modules' questions are mixed in automatically. */
  test: Exercise[];
  games: GameId[];
  project?: Project;
  /** Parsons puzzles are only offered in the early modules (scaffolding fades). */
}
