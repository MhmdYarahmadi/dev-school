/** Backend API tests: spawns the real server against a temporary database. */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answersOf, struggleSpots, summarize, type AdminUser } from '../src/admin/analytics';
import { pgContent } from '../src/courses/pg/content';
import { dockerContent } from '../src/courses/docker/content';
import { sdContent } from '../src/courses/sd/content';
import { gitContent } from '../src/courses/git/content';
import { emptyProgress } from '../src/progress/store';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const B = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess;
let dir: string;

async function call(path: string, init: { method?: string; body?: unknown; token?: string; admin?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.admin) headers['x-admin-token'] = init.admin;
  const r = await fetch(B + path, { method: init.method ?? 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined });
  return { status: r.status, body: await r.json() };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pgschool-'));
  proc = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ADMIN_PASSWORD: 'admin-secret' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${B}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

afterAll(() => {
  proc?.kill();
  rmSync(dir, { recursive: true, force: true });
});

describe('accounts and progress', () => {
  let token = '';
  it('signs up, rejects duplicates (case-insensitive) and bad input', async () => {
    const r = await call('/api/signup', { method: 'POST', body: { username: 'Sara', password: 'pass123' } });
    expect(r.status).toBe(201);
    token = r.body.token;
    expect((await call('/api/signup', { method: 'POST', body: { username: 'sara', password: 'pass123' } })).status).toBe(409);
    expect((await call('/api/signup', { method: 'POST', body: { username: 'x', password: 'pass123' } })).status).toBe(400);
    expect((await call('/api/signup', { method: 'POST', body: { username: 'bob', password: '123' } })).status).toBe(400);
  });
  it('logs in only with the right password', async () => {
    expect((await call('/api/login', { method: 'POST', body: { username: 'sara', password: 'wrong!' } })).status).toBe(401);
    expect((await call('/api/login', { method: 'POST', body: { username: 'sara', password: 'pass123' } })).status).toBe(200);
  });
  it('saves progress per course; rejects junk, bad course ids and missing auth', async () => {
    expect((await call('/api/progress/pg', { method: 'PUT', token, body: { progress: { ...emptyProgress(), xp: 77 } } })).status).toBe(200);
    expect((await call('/api/progress/docker', { method: 'PUT', token, body: { progress: { ...emptyProgress(), xp: 5 } } })).status).toBe(200);
    const me = (await call('/api/me', { token })).body.user;
    expect(me.courses.pg.xp).toBe(77);
    expect(me.courses.docker.xp).toBe(5);
    expect((await call('/api/progress/pg', { method: 'PUT', token, body: { progress: { hello: 1 } } })).status).toBe(400);
    expect((await call('/api/progress/Bad%20Id', { method: 'PUT', token, body: { progress: emptyProgress() } })).status).toBe(400);
    expect((await call('/api/me')).status).toBe(401);
  });
  it('keeps the old addresses working (/api/progress = pg, /pg/api/…)', async () => {
    expect((await call('/api/progress', { method: 'PUT', token, body: { progress: { ...emptyProgress(), xp: 78 } } })).status).toBe(200);
    expect((await call('/pg/api/me', { token })).body.user.courses.pg.xp).toBe(78);
    await call('/api/progress/pg', { method: 'PUT', token, body: { progress: { ...emptyProgress(), xp: 77 } } });
  });
  it('login returns every course\'s progress', async () => {
    const r = await call('/api/login', { method: 'POST', body: { username: 'sara', password: 'pass123' } });
    expect(Object.keys(r.body.user.courses).sort()).toEqual(['docker', 'pg']);
  });
  it('logout invalidates the token', async () => {
    await call('/api/logout', { method: 'POST', token });
    expect((await call('/api/me', { token })).status).toBe(401);
  });
});

describe('admin', () => {
  let admin = '';
  it('requires the admin password', async () => {
    expect((await call('/api/admin/users')).status).toBe(401);
    expect((await call('/api/admin/login', { method: 'POST', body: { password: 'nope' } })).status).toBe(401);
    admin = (await call('/api/admin/login', { method: 'POST', body: { password: 'admin-secret' } })).body.token;
    expect(admin).toBeTruthy();
  });
  it('lists learners with their progress and passwords', async () => {
    const r = await call('/api/admin/users', { admin });
    expect(r.body.users).toHaveLength(1);
    expect(r.body.users[0]).toMatchObject({ username: 'Sara', password: 'pass123' });
    expect(r.body.users[0].courses.pg.xp).toBe(77);
    expect(r.body.users[0].courses.docker.xp).toBe(5);
  });
  it('resets a password (old sessions end) and deletes accounts', async () => {
    const login = await call('/api/login', { method: 'POST', body: { username: 'sara', password: 'pass123' } });
    const id = login.body.user.id;
    expect((await call(`/api/admin/users/${id}/password`, { method: 'POST', admin, body: { password: 'newpass1' } })).status).toBe(200);
    expect((await call('/api/me', { token: login.body.token })).status).toBe(401);
    expect((await call('/api/login', { method: 'POST', body: { username: 'sara', password: 'newpass1' } })).status).toBe(200);
    expect((await call(`/api/admin/users/${id}`, { method: 'DELETE', admin })).status).toBe(200);
    expect((await call('/api/admin/users', { admin })).body.users).toHaveLength(0);
  });
});

describe('dashboard analytics', () => {
  const user = (id: number, patch: Partial<ReturnType<typeof emptyProgress>>): AdminUser => ({
    id, username: `u${id}`, password: 'x', createdAt: 0, lastActive: 0, courses: { pg: { ...emptyProgress(), ...patch } },
  });
  const a = user(1, {
    xp: 120,
    tests: { m01: { best: 1, passed: true, attempts: 1 } },
    exercises: {
      'm01-p1': { done: true, attempts: 1, hintsUsed: 0, sawSolution: false },
      'm01-p5': { done: true, attempts: 4, hintsUsed: 2, sawSolution: true, lastSql: 'SELECT DISTINCT country FROM customers' },
    },
    testAnswers: { m02: { at: 1, score: 0.5, items: [{ id: 'm02-t5', correct: false, answer: 'SELECT title FROM books WHERE pages = NULL' }] } },
  });
  const b = user(2, { exercises: { 'm01-p5': { done: false, attempts: 3, hintsUsed: 1, sawSolution: false } } });

  it('marks courses a learner never started', () => {
    expect(summarize(a, pgContent).started).toBe(true);
    expect(summarize({ ...a, courses: {} }, pgContent).started).toBe(false);
  });
  it('summarises a learner', () => {
    const s = summarize(a, pgContent);
    expect(s).toMatchObject({ xp: 120, modulesPassed: 1, solved: 2, level: 2 });
    expect(s.currentModule?.id).toBe('m02');
    expect(s.struggles).toBe(3 + 1);
  });
  it('ranks the hardest exercise first', () => {
    const rows = struggleSpots([a, b], pgContent);
    expect(rows[0].id).toBe('m01-p5');
    expect(rows[0]).toMatchObject({ learners: 2, solved: 1, failedAttempts: 6, sawSolution: 1 });
    expect(rows.find((r) => r.id === 'm02-t5')?.testMisses).toBe(1);
  });
  it('lists the learner\'s answers', () => {
    const { practice, tests } = answersOf(a, pgContent);
    expect(practice.find((p) => p.id === 'm01-p5')?.lastSql).toContain('DISTINCT');
    expect(tests[0].items[0].answer).toContain('= NULL');
  });
  it('covers the Docker course, including project answers', () => {
    const d: AdminUser = {
      id: 3, username: 'u3', password: 'x', createdAt: 0, lastActive: 0,
      courses: {
        docker: {
          ...emptyProgress(),
          tests: { d01: { best: 1, passed: true, attempts: 1 } },
          exercises: { 'd08-p1': { done: false, attempts: 2, hintsUsed: 1, sawSolution: false, lastSql: 'services:\n  web:\n    image: nginx' } },
          projects: { 'dpb-1': true },
          projectAnswers: { 'dpb-1': { at: 1, answer: 'FROM node:22-alpine', ok: true, checks: 3 }, 'dpb-2': { at: 2, answer: 'services: {}', ok: false, checks: 1 } },
        },
      },
    };
    expect(summarize(d, dockerContent)).toMatchObject({ started: true, modulesPassed: 1, struggles: 2 });
    expect(summarize(d, pgContent).started).toBe(false);
    expect(struggleSpots([d], dockerContent)[0].id).toBe('d08-p1');
    const { practice, projects } = answersOf(d, dockerContent);
    expect(practice[0].lastSql).toContain('services:');
    expect(projects.find((t) => t.task.id === 'dpb-1')).toMatchObject({ done: true, checks: 3, answer: 'FROM node:22-alpine', n: 1 });
    expect(projects.find((t) => t.task.id === 'dpb-2')).toMatchObject({ done: false, ok: false });
    expect(projects.find((t) => t.task.id === 'dpa-1')?.answer).toBeUndefined();
  });
  it('renders a Docker learner on the admin page, with project answers', async () => {
    const { renderToString } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { LearnerDetail } = await import('../src/pages/AdminPage');
    const d: AdminUser = {
      id: 4, username: 'u4', password: 'x', createdAt: 0, lastActive: Date.now(),
      courses: { docker: { ...emptyProgress(), projects: { 'dpb-1': true }, projectAnswers: { 'dpb-1': { at: Date.now(), answer: 'USER node', ok: true, checks: 2 } } } },
    };
    const html = renderToString(createElement(LearnerDetail, { user: d, course: dockerContent, token: 't', onChanged: () => {}, onClose: () => {} })).replace(/<!-- -->/g, '');
    expect(html).toContain('Projects (latest checked answer per task)');
    expect(html).toContain('USER node');
    expect(html).toContain('1/4 tasks');
    expect(html).toContain('checked 2×');
  });
});

describe('dashboard analytics: System Design', () => {
  const design = 'components:\n  users: { type: client }\n  app: { type: app, instances: 2 }\nconnections:\n  - users -> app\n';
  const s: AdminUser = {
    id: 5, username: 'u5', password: 'x', createdAt: 0, lastActive: Date.now(),
    courses: {
      sd: {
        ...emptyProgress(),
        xp: 40,
        tests: { s01: { best: 1, passed: true, attempts: 1 } },
        exercises: {
          's02-p1': { done: true, attempts: 2, hintsUsed: 1, sawSolution: false, lastSql: '1200' },
          's03-p1': { done: true, attempts: 1, hintsUsed: 0, sawSolution: false },
        },
        testAnswers: { s02: { at: 1, score: 0.5, items: [{ id: 's02-p2', correct: false, answer: '90' }] } },
        projects: { 'sda-1': true },
        projectAnswers: { 'sdc-2': { at: Date.now(), answer: design, ok: false, checks: 3 } },
      },
    },
  };

  it('summarises an sd learner and lists their answers', () => {
    expect(summarize(s, sdContent)).toMatchObject({ started: true, xp: 40, modulesPassed: 1 });
    expect(summarize(s, pgContent).started).toBe(false);
    const { practice, projects } = answersOf(s, sdContent);
    expect(practice.find((p) => p.id === 's02-p1')).toMatchObject({ lastSql: '1200', done: true });
    expect(projects.find((t) => t.task.id === 'sdc-2')).toMatchObject({ answer: design, ok: false, checks: 3, n: 2 });
    expect(projects.find((t) => t.task.id === 'sda-1')?.done).toBe(true);
  });
  it('renders an sd learner on the admin page: designs as YAML, estimates with their unit', async () => {
    const { renderToString } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { LearnerDetail } = await import('../src/pages/AdminPage');
    const html = renderToString(createElement(LearnerDetail, { user: s, course: sdContent, token: 't', onChanged: () => {}, onClose: () => {} }))
      .replace(/<!-- -->/g, '')
      .replace(/&gt;/g, '>');
    expect(html).toContain('1200 requests/s');
    expect(html).toContain('(multiple choice, nothing written)');
    expect(html).toContain('Projects (latest checked answer per task)');
    expect(html).toContain('users -> app');
    expect(html).toContain('checked 3×');
    expect(html).toContain('90 pages/s');
  });
});

describe('dashboard analytics: Git', () => {
  const g: AdminUser = {
    id: 6, username: 'u6', password: 'x', createdAt: 0, lastActive: Date.now(),
    courses: {
      git: {
        ...emptyProgress(),
        xp: 60,
        tests: { g01: { best: 1, passed: true, attempts: 1 } },
        exercises: {
          'g04-p10': { done: false, attempts: 3, hintsUsed: 2, sawSolution: false, lastSql: 'git merge hours\ngit add index.html\ngit commit -m "Merge"' },
          'g04-p2': { done: true, attempts: 1, hintsUsed: 0, sawSolution: false, lastSql: '<h1>Shop</h1>\n<p>Welcome!</p>\n<p>Open 8-6</p>\n' },
        },
        testAnswers: { g05: { at: 1, score: 0.5, items: [{ id: 'g05-t4', correct: false, answer: 'git push --force' }] } },
        projects: { 'g06-proj-1': true },
        projectAnswers: { 'g06-proj-3': { at: Date.now(), answer: 'git push -u origin contact\ngh pr create --fill', ok: false, checks: 2 } },
      },
    },
  };
  it('summarises a git learner: commands and file answers as written', () => {
    expect(summarize(g, gitContent)).toMatchObject({ started: true, xp: 60, modulesPassed: 1, struggles: 3 });
    expect(struggleSpots([g], gitContent)[0].id).toBe('g04-p10');
    const { practice, projects } = answersOf(g, gitContent);
    expect(practice.find((p) => p.id === 'g04-p10')?.lastSql).toContain('git merge hours');
    expect(projects.find((t) => t.task.id === 'g06-proj-3')).toMatchObject({ ok: false, checks: 2, n: 3 });
    expect(projects.find((t) => t.task.id === 'g06-proj-1')?.done).toBe(true);
  });
  it('renders a git learner on the admin page', async () => {
    const { renderToString } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { LearnerDetail } = await import('../src/pages/AdminPage');
    const html = renderToString(createElement(LearnerDetail, { user: g, course: gitContent, token: 't', onChanged: () => {}, onClose: () => {} }))
      .replace(/<!-- -->/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    expect(html).toContain('git commit -m "Merge"');
    expect(html).toContain('<p>Open 8-6</p>');
    expect(html).toContain('git push --force');
    expect(html).toContain('gh pr create --fill');
    expect(html).toContain('1/5 tasks');
  });
});

describe('migration from the single-course database', () => {
  it('moves users.progress into the progress table as the pg course', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const old = mkdtempSync(join(tmpdir(), 'pgschool-old-'));
    const db = new DatabaseSync(join(old, 'pgschool.db'));
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_active INTEGER NOT NULL, progress TEXT, progress_updated_at INTEGER);
      CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL);`);
    db.prepare('INSERT INTO users VALUES (1, ?, ?, 1, 1, ?, 1)').run('olduser', 'oldpass1', JSON.stringify({ ...emptyProgress(), xp: 321 }));
    db.close();
    const port = PORT + 500;
    const p2 = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), DATA_DIR: old, ADMIN_PASSWORD: 'a' }, stdio: 'ignore' });
    try {
      let login: Response | null = null;
      for (let i = 0; i < 50 && !login; i++) {
        try {
          login = await fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'olduser', password: 'oldpass1' }) });
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      const body = await login!.json();
      expect(body.user.courses.pg.xp).toBe(321);
    } finally {
      p2.kill();
      rmSync(old, { recursive: true, force: true });
    }
  });
});
