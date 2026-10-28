import { useSyncExternalStore } from 'react';
import { newCard, quality, schedule, type Confidence, type ReviewCard } from '../pedagogy/review';
import { mark, t } from '../shared/i18n';

export interface ExerciseProgress {
  done: boolean;
  attempts: number;
  hintsUsed: number;
  sawSolution: boolean;
  lastSql?: string;
  completedAt?: number;
}

export interface Progress {
  version: 1;
  exercises: Record<string, ExerciseProgress>;
  conceptsSeen: Record<string, boolean>;
  predictions: Record<string, boolean>;
  tests: Record<string, { best: number; passed: boolean; attempts: number; testedOut?: boolean }>;
  games: Record<string, { stars: number; bestScore: number; plays: number }>;
  projects: Record<string, boolean>;
  review: Record<string, ReviewCard>;
  /** Variant exercise ids (`<exerciseId>~<n>`) queued after viewing a solution. */
  variantQueue: string[];
  xp: number;
  badges: Record<string, number>;
  streak: { lastDay: string; count: number };
  noHintStreak: number;
  playgroundHistory: string[];
  last?: { path: string; label: string };
  /** The answers given in the most recent attempt at each module test. */
  testAnswers?: Record<string, { at: number; score: number; items: { id: string; correct: boolean; answer?: string }[] }>;
  /** The latest checked answer to each project task (shown on the admin dashboard). */
  projectAnswers?: Record<string, { at: number; answer: string; ok: boolean; checks: number }>;
}

/** localStorage key; each course sets its own via configureProgress(). */
let KEY = 'pgschool-progress-v1';

export function emptyProgress(): Progress {
  return {
    version: 1,
    exercises: {},
    conceptsSeen: {},
    predictions: {},
    tests: {},
    games: {},
    projects: {},
    review: {},
    variantQueue: [],
    xp: 0,
    badges: {},
    streak: { lastDay: '', count: 0 },
    noHintStreak: 0,
    playgroundHistory: [],
  };
}

function load(): Progress {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) return { ...emptyProgress(), ...JSON.parse(raw) };
  } catch {
    /* private mode or corrupt data: start fresh */
  }
  return emptyProgress();
}

let state: Progress = load();

/** Point the store at a course's own saved progress (call before rendering). */
export function configureProgress(storageKey: string) {
  KEY = storageKey;
  state = load();
}
const listeners = new Set<() => void>();
type BadgeChecker = (p: Progress) => string[];
let badgeChecker: BadgeChecker = () => [];
const toastListeners = new Set<(msg: string) => void>();

export function setBadgeChecker(fn: BadgeChecker) {
  badgeChecker = fn;
}

export function onToast(fn: (msg: string) => void): () => void {
  toastListeners.add(fn);
  return () => toastListeners.delete(fn);
}

export function toast(msg: string) {
  toastListeners.forEach((fn) => fn(msg));
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function update(fn: (draft: Progress) => void) {
  const next: Progress = structuredClone(state);
  fn(next);
  // Daily streak: any activity counts.
  const d = today();
  if (next.streak.lastDay !== d) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    next.streak = { lastDay: d, count: next.streak.lastDay === yesterday ? next.streak.count + 1 : 1 };
  }
  for (const id of badgeChecker(next)) {
    if (!next.badges[id]) {
      next.badges[id] = Date.now();
      next.xp += 25;
      toast(t('🏅 Badge unlocked: {name}', { name: t(id) }));
    }
  }
  state = next;
  save();
  listeners.forEach((l) => l());
}

export function getProgress(): Progress {
  return state;
}

/** Called on every saved change (used by the server sync). */
export function subscribeProgress(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Replace all progress (e.g. with the copy stored on the server) without XP toasts. */
export function replaceProgress(p: Progress | null) {
  state = p && p.version === 1 ? { ...emptyProgress(), ...p } : emptyProgress();
  save();
  listeners.forEach((l) => l());
}

/** Each key from either side; `pick` decides when both have one. */
function mergeRecord<T>(a: Record<string, T> | undefined, b: Record<string, T> | undefined, pick: (x: T, y: T) => T): Record<string, T> {
  const out: Record<string, T> = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = k in out ? pick(out[k], v) : v;
  return out;
}

const later = <T extends { at: number }>(x: T, y: T) => (y.at > x.at ? y : x);

/**
 * Combine this device's progress with the server's (one may have been made offline) without
 * losing either: anything solved on one side stays solved, best scores win, the newest answer is kept.
 * `local` wins ties, so unsent drafts survive. `syncedXp` is the XP the server had when this
 * device last synced: XP earned here since then is added to the server's (which may include
 * XP from another device); without it, the larger total is kept.
 */
export function mergeProgress(local: Progress, server: Progress, syncedXp?: number): Progress {
  const a = { ...emptyProgress(), ...local };
  const b = { ...emptyProgress(), ...server };
  return {
    ...b,
    ...a,
    exercises: mergeRecord(a.exercises, b.exercises, (x, y) => ({
      done: x.done || y.done,
      attempts: Math.max(x.attempts, y.attempts),
      hintsUsed: Math.max(x.hintsUsed, y.hintsUsed),
      sawSolution: x.sawSolution || y.sawSolution,
      lastSql: x.lastSql ?? y.lastSql,
      completedAt: x.completedAt && y.completedAt ? Math.min(x.completedAt, y.completedAt) : x.completedAt ?? y.completedAt,
    })),
    conceptsSeen: { ...b.conceptsSeen, ...a.conceptsSeen },
    predictions: { ...b.predictions, ...a.predictions },
    tests: mergeRecord(a.tests, b.tests, (x, y) => ({
      best: Math.max(x.best, y.best),
      passed: x.passed || y.passed,
      attempts: Math.max(x.attempts, y.attempts),
      ...(x.testedOut || y.testedOut ? { testedOut: true } : {}),
    })),
    games: mergeRecord(a.games, b.games, (x, y) => ({
      stars: Math.max(x.stars, y.stars),
      bestScore: Math.max(x.bestScore, y.bestScore),
      plays: Math.max(x.plays, y.plays),
    })),
    projects: mergeRecord(a.projects, b.projects, (x, y) => x || y),
    review: mergeRecord(a.review, b.review, (x, y) => (y.reps > x.reps || (y.reps === x.reps && y.due > x.due) ? y : x)),
    variantQueue: [...new Set([...a.variantQueue, ...b.variantQueue])],
    xp: syncedXp === undefined ? Math.max(a.xp, b.xp) : b.xp + Math.max(0, a.xp - syncedXp),
    badges: mergeRecord(a.badges, b.badges, (x, y) => Math.min(x, y)),
    streak: b.streak.lastDay > a.streak.lastDay ? b.streak : a.streak,
    noHintStreak: a.noHintStreak,
    playgroundHistory: [...new Set([...a.playgroundHistory, ...b.playgroundHistory])].slice(0, 50),
    last: a.last ?? b.last,
    testAnswers: mergeRecord(a.testAnswers, b.testAnswers, later),
    projectAnswers: mergeRecord(a.projectAnswers, b.projectAnswers, (x, y) => ({ ...later(x, y), checks: Math.max(x.checks, y.checks) })),
  };
}

export function useProgress(): Progress {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

function addXp(p: Progress, n: number, why: string) {
  p.xp += n;
  if (n > 0) toast(`+${n} XP · ${t(why)}`);
}

export interface AttemptResult {
  correct: boolean;
  sql?: string;
  hintsUsed: number;
  sawSolution: boolean;
  confidence?: Confidence;
}

export function recordAttempt(itemId: string, r: AttemptResult) {
  update((p) => {
    const ex = p.exercises[itemId] ?? { done: false, attempts: 0, hintsUsed: 0, sawSolution: false };
    ex.attempts += 1;
    ex.hintsUsed = Math.max(ex.hintsUsed, r.hintsUsed);
    ex.sawSolution ||= r.sawSolution;
    if (r.sql !== undefined) ex.lastSql = r.sql;
    if (r.correct && !ex.done) {
      ex.done = true;
      ex.completedAt = Date.now();
      const bonus = r.hintsUsed === 0 && !r.sawSolution ? 5 : 0;
      addXp(p, (r.sawSolution ? 2 : 10) + bonus, bonus ? mark('solved with no hints') : mark('exercise solved'));
    }
    if (r.correct) p.noHintStreak = r.hintsUsed === 0 && !r.sawSolution ? p.noHintStreak + 1 : 0;
    else if (r.sawSolution) p.noHintStreak = 0;
    p.exercises[itemId] = ex;
    // Everything you answer joins the spaced-review deck.
    if (r.confidence) {
      const card = p.review[itemId] ?? newCard(itemId);
      p.review[itemId] = schedule(card, quality(r.correct, r.confidence));
    }
  });
}

const draftListeners = new Set<() => void>();
export function onDraft(fn: () => void): () => void {
  draftListeners.add(fn);
  return () => draftListeners.delete(fn);
}

export function saveDraft(itemId: string, sql: string) {
  // Drafts don't notify React listeners (no re-render on every keystroke), only the sync.
  const ex = state.exercises[itemId] ?? { done: false, attempts: 0, hintsUsed: 0, sawSolution: false };
  state = { ...state, exercises: { ...state.exercises, [itemId]: { ...ex, lastSql: sql } } };
  save();
  draftListeners.forEach((l) => l());
}

export function recordReview(itemId: string, correct: boolean, confidence: Confidence) {
  update((p) => {
    const card = p.review[itemId] ?? newCard(itemId);
    p.review[itemId] = schedule(card, quality(correct, confidence));
    if (correct) addXp(p, 3, mark('review'));
  });
}

export function queueVariant(variantId: string) {
  update((p) => {
    if (!p.variantQueue.includes(variantId)) p.variantQueue.push(variantId);
  });
}

export function completeVariant(variantId: string) {
  update((p) => {
    p.variantQueue = p.variantQueue.filter((v) => v !== variantId);
  });
}

export function markConceptSeen(conceptId: string) {
  if (state.conceptsSeen[conceptId]) return;
  update((p) => {
    p.conceptsSeen[conceptId] = true;
    addXp(p, 2, mark('concept learned'));
  });
}

export function recordPrediction(conceptId: string, correct: boolean) {
  if (conceptId in state.predictions) return;
  update((p) => {
    p.predictions[conceptId] = correct;
    if (correct) addXp(p, 3, mark('good prediction'));
  });
}

export function recordTest(moduleId: string, score: number, passMark: number, testedOut = false) {
  update((p) => {
    const t = p.tests[moduleId] ?? { best: 0, passed: false, attempts: 0 };
    t.attempts += 1;
    const passedNow = score >= passMark;
    if (passedNow && !t.passed) addXp(p, testedOut ? 80 : 50, testedOut ? mark('tested out!') : mark('module test passed'));
    t.best = Math.max(t.best, score);
    t.passed ||= passedNow;
    if (passedNow && testedOut) t.testedOut = true;
    p.tests[moduleId] = t;
  });
}

export function recordTestAnswers(moduleId: string, score: number, items: { id: string; correct: boolean; answer?: string }[]) {
  update((p) => {
    p.testAnswers = { ...(p.testAnswers ?? {}), [moduleId]: { at: Date.now(), score, items } };
  });
}

export function recordGame(gameId: string, stars: number, score: number) {
  update((p) => {
    const g = p.games[gameId] ?? { stars: 0, bestScore: 0, plays: 0 };
    g.plays += 1;
    if (stars > g.stars) addXp(p, (stars - g.stars) * 20, t('{n}★ in a game', { n: stars }));
    g.stars = Math.max(g.stars, stars);
    g.bestScore = Math.max(g.bestScore, score);
    p.games[gameId] = g;
  });
}

/** A project task was checked: keep the answer, and complete the task when every requirement passed. */
export function recordProjectCheck(taskId: string, answer: string, ok: boolean) {
  update((p) => {
    const prev = p.projectAnswers?.[taskId];
    p.projectAnswers = { ...p.projectAnswers, [taskId]: { at: Date.now(), answer: answer.slice(0, 20000), ok, checks: (prev?.checks ?? 0) + 1 } };
    if (ok && !p.projects[taskId]) {
      p.projects[taskId] = true;
      addXp(p, 30, mark('project task complete'));
    }
  });
}

export function addPlaygroundHistory(sql: string) {
  update((p) => {
    p.playgroundHistory = [sql, ...p.playgroundHistory.filter((s) => s !== sql)].slice(0, 50);
  });
}

export function setLast(path: string, label: string) {
  if (state.last?.path === path) return;
  state = { ...state, last: { path, label } };
  save();
}

export function exportProgress(): string {
  return JSON.stringify(state, null, 2);
}

export function importProgress(json: string) {
  const parsed = JSON.parse(json);
  if (parsed?.version !== 1) throw new Error('This file is not a pgschool progress export.');
  update((p) => Object.assign(p, emptyProgress(), parsed));
}

export function resetProgress() {
  update((p) => Object.assign(p, emptyProgress()));
}

export const LEVELS = [
  { xp: 0, title: 'Intern' },
  { xp: 100, title: 'Junior Analyst' },
  { xp: 300, title: 'Query Apprentice' },
  { xp: 600, title: 'Data Detective' },
  { xp: 1000, title: 'Join Journeyman' },
  { xp: 1600, title: 'Aggregation Ace' },
  { xp: 2400, title: 'Database Architect' },
  { xp: 3400, title: 'Postgres Pro' },
  { xp: 4800, title: 'Query Wizard' },
];

export function levelFor(xp: number, levels: { xp: number; title: string }[] = LEVELS) {
  let i = 0;
  while (i + 1 < levels.length && xp >= levels[i + 1].xp) i++;
  const next = levels[i + 1];
  return { level: i + 1, title: levels[i].title, next, progress: next ? (xp - levels[i].xp) / (next.xp - levels[i].xp) : 1 };
}
