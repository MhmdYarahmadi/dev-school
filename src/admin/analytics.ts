import type { Exercise, Module } from '../content/types';
import { emptyProgress, levelFor, type Progress } from '../progress/store';
import { makeHelpers, type CourseContent } from '../shared/course';

export interface AdminUser {
  id: number;
  username: string;
  password: string;
  createdAt: number;
  lastActive: number;
  /** Progress per course id ('pg', 'docker', …). Missing = never started. */
  courses: Record<string, Progress | null>;
}

export interface LearnerSummary {
  user: AdminUser;
  started: boolean;
  xp: number;
  level: number;
  levelTitle: string;
  currentModule: Module | null;
  modulesPassed: number;
  solved: number;
  totalPractice: number;
  streak: number;
  stars: number;
  /** Failed attempts + revealed solutions, across all exercises. */
  struggles: number;
}

export const progressOf = (u: AdminUser, courseId: string): Progress => ({ ...emptyProgress(), ...(u.courses?.[courseId] ?? {}) });

const helperCache = new Map<string, ReturnType<typeof makeHelpers>>();
function helpersFor(c: CourseContent) {
  let hs = helperCache.get(c.id);
  if (!hs) {
    hs = makeHelpers(c.modules);
    helperCache.set(c.id, hs);
  }
  return hs;
}

export function summarize(u: AdminUser, c: CourseContent): LearnerSummary {
  const p = progressOf(u, c.id);
  const lvl = levelFor(p.xp, c.levels);
  const ex = Object.values(p.exercises);
  return {
    user: u,
    started: !!u.courses?.[c.id],
    xp: p.xp,
    level: lvl.level,
    levelTitle: lvl.title,
    currentModule: c.modules.find((m) => !p.tests[m.id]?.passed) ?? null,
    modulesPassed: c.modules.filter((m) => p.tests[m.id]?.passed).length,
    solved: c.modules.reduce((s, m) => s + m.practice.filter((e) => p.exercises[e.id]?.done).length, 0),
    totalPractice: c.modules.reduce((s, m) => s + m.practice.length, 0),
    streak: p.streak.count,
    stars: Object.values(p.games).reduce((s, g) => s + g.stars, 0),
    struggles: ex.reduce((s, e) => s + Math.max(0, e.attempts - (e.done ? 1 : 0)) + (e.sawSolution ? 1 : 0), 0),
  };
}

export interface StruggleRow {
  id: string;
  item: Exercise;
  module: Module;
  learners: number;
  solved: number;
  failedAttempts: number;
  sawSolution: number;
  avgHints: number;
  testMisses: number;
  /** Higher = harder. */
  score: number;
}

/** Which exercises cause the most trouble across all learners of one course. */
export function struggleSpots(users: AdminUser[], c: CourseContent): StruggleRow[] {
  const rows: StruggleRow[] = [];
  for (const { id, item, module } of helpersFor(c).allItems()) {
    let learners = 0, solved = 0, failed = 0, saw = 0, hints = 0, testMisses = 0;
    for (const u of users) {
      const p = progressOf(u, c.id);
      const e = p.exercises[id];
      if (e && e.attempts > 0) {
        learners++;
        if (e.done) solved++;
        failed += Math.max(0, e.attempts - (e.done ? 1 : 0));
        if (e.sawSolution) saw++;
        hints += e.hintsUsed;
      }
      const t = Object.values(p.testAnswers ?? {}).flatMap((x) => x.items).find((x) => x.id === id);
      if (t && !t.correct) testMisses++;
    }
    if (!learners && !testMisses) continue;
    rows.push({
      id, item, module, learners, solved,
      failedAttempts: failed,
      sawSolution: saw,
      avgHints: learners ? hints / learners : 0,
      testMisses,
      score: failed + 3 * saw + 2 * testMisses + hints,
    });
  }
  return rows.sort((a, b) => b.score - a.score);
}

/** Every answer a learner has given in one course: practice (latest) and the latest test per module. */
export function answersOf(u: AdminUser, c: CourseContent) {
  const p = progressOf(u, c.id);
  const hs = helpersFor(c);
  const practice = hs
    .allItems()
    .filter(({ id }) => p.exercises[id])
    .map(({ id, item, module }) => ({ id, item, module, ...p.exercises[id] }));
  const tests = Object.entries(p.testAnswers ?? {}).map(([moduleId, t]) => ({
    module: c.modules.find((m) => m.id === moduleId),
    ...t,
    items: t.items.map((x) => ({ ...x, item: hs.findItem(x.id)?.item })),
  }));
  const projects = c.modules.flatMap((m) =>
    (m.project?.tasks ?? []).map((task, i) => ({ module: m, project: m.project!, task, n: i + 1, done: !!p.projects[task.id], ...p.projectAnswers?.[task.id] })),
  );
  return { practice, tests, projects };
}

export function plainPrompt(md: string): string {
  return md.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
