/**
 * The multi-course layer. Each course (PostgreSQL, Docker, …) supplies its
 * content and UI pieces; the shared pages (course home, module tabs, tests,
 * review, cheat sheet, games, admin) work for any course.
 */
import type { ComponentType, LazyExoticComponent } from 'react';
import type { Concept, Exercise, Module, Project, SandboxEnv } from '../content/types';
import type { Confidence } from '../pedagogy/review';
import { setBadgeChecker, type Progress } from '../progress/store';

export interface GameMeta {
  id: string;
  title: string;
  icon: string;
  moduleId: string;
  pitch: string;
  skills: string;
}

export interface LevelDef {
  xp: number;
  title: string;
}

export interface Badge {
  id: string;
  icon: string;
  name: string;
  how: string;
  earned: (p: Progress) => boolean;
}

/** Pure data about a course: safe to import from the admin dashboard and tests. */
export interface CourseContent {
  id: string;
  title: string;
  /** Brand shown top-left, e.g. ['pg', 'school']. */
  brand: [string, string];
  icon: string;
  /** Where the course is served, e.g. '/pg/'. */
  path: string;
  heroTitle: string;
  heroText: string;
  modules: Module[];
  games: Record<string, GameMeta>;
  levels: LevelDef[];
  badges: Badge[];
  /** Short names for exercise kinds in lists, e.g. { write: 'Write a query' }. */
  kindLabels?: Partial<Record<Exercise['kind'], string>>;
  /** A per-item short name in lists, when the kind alone isn't enough (overrides kindLabels). */
  itemLabel?: (e: Exercise) => string | undefined;
}

export type ExerciseMode = 'practice' | 'test' | 'review';

export interface ExerciseCardProps {
  exercise: Exercise;
  mode?: ExerciseMode;
  progressId?: string;
  onDone?: (correct: boolean, confidence?: Confidence, answer?: string) => void;
  onAttempt?: (correct: boolean) => void;
  record?: boolean;
  variantCount?: number;
}

/** UI pieces a course plugs into the shared pages. */
export interface CourseUI {
  ExerciseCard: ComponentType<ExerciseCardProps>;
  /** The runnable worked example on a concept card (Learn tab). */
  ExampleRunner: ComponentType<{ code: string; disabled?: boolean; env?: SandboxEnv }>;
  /** What actually happens, shown after the learner makes a prediction. */
  PredictResult: ComponentType<{ code: string; env?: SandboxEnv }>;
  /** What the learner sees before predicting (default: the code as text). */
  PredictSetup?: ComponentType<{ code: string; env?: SandboxEnv }>;
  ProjectView: ComponentType<{ project: Project }>;
  games: Record<string, LazyExoticComponent<ComponentType>>;
  /** Extra top-level pages, e.g. the SQL playground. */
  extraPages?: { path: string; label: string; Component: ComponentType }[];
}

export interface Course extends CourseContent {
  ui: CourseUI;
}

// ---------------------------------------------------------------- helpers

export const PASS_MARK = 0.8;

type Item = { item: Exercise; module: Module };

/** Lookups and test composition over one course's modules. */
export function makeHelpers(modules: Module[]) {
  const index = new Map<string, Item>();
  for (const m of modules) {
    for (const e of [...m.practice, ...m.test]) {
      index.set(e.id, { item: e, module: m });
      const variants = (e as { variants?: object[] }).variants;
      variants?.forEach((v, n) => {
        index.set(`${e.id}~${n}`, { item: { ...v, kind: e.kind, conceptIds: e.conceptIds } as Exercise, module: m });
      });
    }
  }

  const rng = (seed: number) => {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  };

  const helpers = {
    modules,
    getModule: (id: string) => modules.find((m) => m.id === id),
    findItem: (id: string) => index.get(id),
    allItems: () => [...index.entries()].map(([id, v]) => ({ id, ...v })),
    allConcepts: (): { concept: Concept; module: Module }[] => modules.flatMap((m) => m.concepts.map((concept) => ({ concept, module: m }))),
    /** A module is unlocked when it's the first, or the previous module's test is passed. */
    isUnlocked(m: Module, tests: Record<string, { passed: boolean }>): boolean {
      if (m.number === 1) return true;
      const prev = modules.find((x) => x.number === m.number - 1);
      return !prev || !!tests[prev.id]?.passed;
    },
    /** Own questions plus ~30% from earlier modules (cumulative), shuffled reproducibly. */
    composeTest(m: Module, seed: number): Exercise[] {
      const rand = rng(seed);
      const own = [...m.test];
      const pool = modules.filter((x) => x.number < m.number).flatMap((x) => x.test);
      const nEarlier = Math.min(pool.length, Math.round(own.length * 0.43));
      const picked: Exercise[] = [];
      for (let i = 0; i < nEarlier; i++) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
      const all = [...own, ...picked];
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
      }
      return all;
    },
    /** Concepts count as mastered once a practice item using them is solved. */
    masteredConcepts(exercises: Record<string, { done: boolean }>): Set<string> {
      const out = new Set<string>();
      for (const [id, { item }] of index) if (exercises[id]?.done) item.conceptIds.forEach((c) => out.add(c));
      return out;
    },
  };
  return helpers;
}

export type Helpers = ReturnType<typeof makeHelpers>;

// ---------------------------------------------------------------- current course

let current: Course | null = null;
let currentHelpers: Helpers | null = null;

/** Called once by each course's entry point, before rendering. */
export function setCourse(c: Course) {
  current = c;
  currentHelpers = makeHelpers(c.modules);
  setBadgeChecker((p) => c.badges.filter((b) => b.earned(p)).map((b) => b.id));
}

export function course(): Course {
  if (!current) throw new Error('No course selected (setCourse was not called)');
  return current;
}

export function h(): Helpers {
  if (!currentHelpers) throw new Error('No course selected (setCourse was not called)');
  return currentHelpers;
}

/** Badges every course shares; courses add their own on top. */
export function commonBadges(modules: Module[]): Badge[] {
  const doneCount = (p: Progress) => Object.values(p.exercises).filter((e) => e.done).length;
  const totalStars = (p: Progress) => Object.values(p.games).reduce((s, g) => s + g.stars, 0);
  // a course with few games can't offer 30 stars: then every star is needed
  const master = Math.min(30, modules.reduce((s, m) => s + m.games.length * 3, 0));
  return [
    { id: 'First Step', icon: '🌱', name: 'First Step', how: 'Solve your first exercise', earned: (p) => doneCount(p) >= 1 },
    { id: 'Fifty Solved', icon: '📚', name: 'Fifty Solved', how: 'Solve 50 exercises', earned: (p) => doneCount(p) >= 50 },
    { id: 'Hint-free ×5', icon: '🧘', name: 'Hint-free ×5', how: 'Solve 5 in a row without hints', earned: (p) => p.noHintStreak >= 5 },
    { id: 'Fortune Teller', icon: '🔮', name: 'Fortune Teller', how: 'Make 10 correct predictions', earned: (p) => Object.values(p.predictions).filter(Boolean).length >= 10 },
    { id: 'Perfect Test', icon: '💯', name: 'Perfect Test', how: 'Score 100% on a module test', earned: (p) => Object.values(p.tests).some((t) => t.best >= 1) },
    { id: 'Skipper', icon: '⏭️', name: 'Skipper', how: 'Test out of a module', earned: (p) => Object.values(p.tests).some((t) => t.testedOut) },
    { id: 'Star Collector', icon: '⭐', name: 'Star Collector', how: 'Earn 10 game stars', earned: (p) => totalStars(p) >= 10 },
    { id: 'Game Master', icon: '🎮', name: 'Game Master', how: master < 30 ? `Earn all ${master} game stars` : 'Earn 30 game stars', earned: (p) => master > 0 && totalStars(p) >= master },
    { id: 'On Fire', icon: '🔥', name: 'On Fire', how: 'Practise 7 days in a row', earned: (p) => p.streak.count >= 7 },
    { id: 'Memory Palace', icon: '🧠', name: 'Memory Palace', how: 'Get 25 review cards to a 6+ day interval', earned: (p) => Object.values(p.review).filter((c) => c.intervalDays >= 6).length >= 25 },
    { id: 'Graduate', icon: '🎓', name: 'Graduate', how: 'Pass every module test', earned: (p) => modules.every((m) => p.tests[m.id]?.passed) },
  ];
}
