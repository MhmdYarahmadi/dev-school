/** Offline mode: the service worker's file list, merging offline progress, and syncing it safely. */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { offline, precacheList, sitePaths } from '../offline/plugin';
import { PYODIDE_FILES, PYODIDE_VERSION } from '../offline/pyodide';
import { emptyProgress, mergeProgress, type Progress } from '../src/progress/store';

const prog = (patch: Partial<Progress>): Progress => ({ ...emptyProgress(), ...patch });
const ex = (done: boolean, attempts: number, lastSql?: string) => ({ done, attempts, hintsUsed: 0, sawSolution: false, ...(lastSql ? { lastSql } : {}) });

describe('service worker file list', () => {
  const dist = mkdtempSync(join(tmpdir(), 'zs-dist-'));
  for (const f of ['index.html', 'pg/index.html', 'docker/index.html', 'design/index.html', 'admin/index.html', 'manifest.webmanifest', 'icons/icon-192.png']) {
    mkdirSync(join(dist, f, '..'), { recursive: true });
    writeFileSync(join(dist, f), f);
  }
  mkdirSync(join(dist, 'assets'));
  for (const f of ['App-a1.js', 'pg-b2.js', 'pglite-c3.wasm', 'pglite-d4.data', 'initdb-e5.wasm', 'worker-f6.js', 'admin-g7.js', 'nodefs-h8.js', 'opfs-ahp-i9.js', 'styles-j0.css']) writeFileSync(join(dist, 'assets', f), f);

  it('saves every page and file a course needs, but not the admin dashboard', () => {
    const files = precacheList(sitePaths(dist));
    expect(files).toEqual(expect.arrayContaining(['/', '/pg/', '/docker/', '/design/', '/manifest.webmanifest', '/icons/icon-192.png']));
    expect(files).toEqual(expect.arrayContaining(['/assets/pglite-c3.wasm', '/assets/pglite-d4.data', '/assets/initdb-e5.wasm', '/assets/worker-f6.js', '/assets/styles-j0.css']));
    expect(files.filter((f) => /admin|nodefs|opfs/.test(f))).toEqual([]);
  });

  it('leaves Pyodide (13 MB) out of the install list: it is saved when the Python course first uses it', () => {
    mkdirSync(join(dist, 'pyodide', PYODIDE_VERSION), { recursive: true });
    for (const f of PYODIDE_FILES) writeFileSync(join(dist, 'pyodide', PYODIDE_VERSION, f), f);
    expect(precacheList(sitePaths(dist)).filter((f) => f.startsWith('/pyodide/'))).toEqual([]);
  });

  it('writes sw.js with the list and a version that changes when a page changes', () => {
    const build = () => {
      const p = offline(resolve('offline/sw.js'));
      (p.configResolved as (c: unknown) => void)({ build: { outDir: dist } });
      (p.closeBundle as () => void)();
      const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
      return { version: /const VERSION = "(\w+)"/.exec(sw)?.[1], files: JSON.parse(/const FILES = (\[.*\]);/.exec(sw)![1]) as string[] };
    };
    const a = build();
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
    expect(a.files).not.toContain('/sw.js');
    expect(a.files).toContain('/pg/');
    expect(readFileSync(join(dist, 'sw.js'), 'utf8')).toContain('const PYODIDE = `pyodide-v${' + JSON.stringify(PYODIDE_VERSION) + '}`;');
    expect(build().version).toBe(a.version);
    writeFileSync(join(dist, 'pg/index.html'), 'a new version');
    expect(build().version).not.toBe(a.version);
    rmSync(dist, { recursive: true, force: true });
  });
});

describe('Pyodide served by the site', () => {
  it('the worker loads the same version as the pyodide package, from this site', () => {
    const worker = readFileSync(resolve('public/py-worker.js'), 'utf8');
    expect(/const PYODIDE_VERSION = '([\d.]+)'/.exec(worker)?.[1]).toBe(PYODIDE_VERSION);
    expect(worker).toContain('const PYODIDE_URL = `/pyodide/${PYODIDE_VERSION}/`;');
    expect(worker).not.toMatch(/cdn\.|https?:/);
  });
});

describe('merging offline progress with the server copy', () => {
  it('keeps work from both sides and never lowers a score', () => {
    const local = prog({
      xp: 60,
      exercises: { a: ex(true, 2, 'SELECT 1'), b: ex(false, 3, 'draft') },
      tests: { m01: { best: 0.9, passed: true, attempts: 2 } },
      games: { g: { stars: 1, bestScore: 50, plays: 4 } },
      projects: { t1: true },
      badges: { first: 200 },
    });
    const server = prog({
      xp: 40,
      exercises: { b: ex(true, 1, 'SELECT 2'), c: ex(true, 1) },
      tests: { m01: { best: 0.6, passed: false, attempts: 3 }, m02: { best: 1, passed: true, attempts: 1 } },
      games: { g: { stars: 3, bestScore: 20, plays: 1 } },
      projects: { t2: true },
      badges: { first: 100, other: 5 },
    });
    const m = mergeProgress(local, server);
    expect(Object.keys(m.exercises).sort()).toEqual(['a', 'b', 'c']);
    expect(m.exercises.b).toMatchObject({ done: true, attempts: 3, lastSql: 'draft' }); // solved on the server; this device's draft kept
    expect(m.tests.m01).toEqual({ best: 0.9, passed: true, attempts: 3 });
    expect(m.tests.m02.passed).toBe(true);
    expect(m.games.g).toEqual({ stars: 3, bestScore: 50, plays: 4 });
    expect(m.projects).toEqual({ t1: true, t2: true });
    expect(m.badges).toEqual({ first: 100, other: 5 });
    expect(m.xp).toBe(60);
    // Same facts whichever side is "local" (apart from drafts).
    const r = mergeProgress(server, local);
    expect(r.tests).toEqual(m.tests);
    expect(r.games).toEqual(m.games);
    expect(Object.keys(r.exercises).sort()).toEqual(['a', 'b', 'c']);
  });

  it('adds XP earned offline to XP earned meanwhile on another device', () => {
    // Last sync at 100 XP; +30 offline here (130); the server reached 150 from another device.
    expect(mergeProgress(prog({ xp: 130 }), prog({ xp: 150 }), 100).xp).toBe(180);
  });

  it('keeps the newest test and project answers', () => {
    const local = prog({ testAnswers: { m01: { at: 5, score: 1, items: [] } }, projectAnswers: { t: { at: 1, answer: 'old', ok: false, checks: 1 } } });
    const server = prog({ testAnswers: { m01: { at: 3, score: 0.5, items: [] } }, projectAnswers: { t: { at: 9, answer: 'new', ok: true, checks: 2 } } });
    const m = mergeProgress(local, server);
    expect(m.testAnswers!.m01.score).toBe(1);
    expect(m.projectAnswers!.t).toMatchObject({ answer: 'new', ok: true, checks: 2 });
  });
});

describe('syncing after working offline', () => {
  /** Loads a fresh copy of the store and sync modules, signed in as user 1, with a fake server. */
  async function setup(opts: { local: Progress; meta?: object; server: Progress; offline?: boolean }) {
    const { vi } = await import('vitest');
    vi.resetModules();
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() {
        return data.size;
      },
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { addEventListener: () => undefined, confirm: () => false });
    data.set('pgschool-token', 't');
    data.set('pgschool-user', JSON.stringify({ id: 1, username: 'u' }));
    data.set('zs-progress-sd-v1', JSON.stringify(opts.local));
    if (opts.meta) data.set('zs-sync-sd', JSON.stringify(opts.meta));
    const puts: Progress[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (opts.offline) throw new TypeError('Failed to fetch');
      if (url === '/api/me') return new Response(JSON.stringify({ user: { id: 1, username: 'u', courses: { sd: opts.server } } }));
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)).progress);
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response('{}', { status: 404 });
    });
    const store = await import('../src/progress/store');
    store.configureProgress('zs-progress-sd-v1');
    const api = await import('../src/account/api');
    api.configureSync('sd');
    return { store, api, puts, meta: () => JSON.parse(data.get('zs-sync-sd') ?? 'null'), cleanup: () => vi.unstubAllGlobals() };
  }

  it('merges unsynced work instead of letting the server copy overwrite it, then uploads it', async () => {
    const t = await setup({
      local: prog({ xp: 30, exercises: { a: ex(true, 1) } }),
      meta: { unsynced: true, syncedXp: 10, userId: 1 },
      server: prog({ xp: 25, exercises: { b: ex(true, 1) } }),
    });
    await t.api.refreshFromServer();
    await new Promise((r) => setTimeout(r, 10));
    expect(Object.keys(t.store.getProgress().exercises).sort()).toEqual(['a', 'b']);
    expect(t.store.getProgress().xp).toBe(45);
    expect(t.puts.at(-1)?.exercises.a.done).toBe(true);
    expect(t.meta()).toMatchObject({ unsynced: false, syncedXp: 45 });
    t.cleanup();
  });

  it('takes the server copy when everything here was already synced', async () => {
    const t = await setup({ local: prog({ xp: 30, exercises: { a: ex(true, 1) } }), meta: { unsynced: false, userId: 1 }, server: prog({ xp: 50 }) });
    await t.api.refreshFromServer();
    expect(t.store.getProgress().xp).toBe(50);
    expect(t.store.getProgress().exercises).toEqual({});
    expect(t.meta()).toMatchObject({ unsynced: false, syncedXp: 50 });
    t.cleanup();
  });

  it('offline: keeps local work and marks new work as unsynced', async () => {
    const t = await setup({ local: prog({ xp: 30 }), server: prog({}), offline: true });
    await expect(t.api.refreshFromServer()).rejects.toThrow(/Cannot reach/);
    t.store.markConceptSeen('c1');
    expect(t.store.getProgress().xp).toBe(32);
    expect(t.meta()).toMatchObject({ unsynced: true, userId: 1 });
    expect(t.api.hasUnsyncedProgress()).toBe(true);
    // Logging out offline asks first; declining keeps the progress.
    expect(await t.api.logout()).toBe(false);
    expect(t.store.getProgress().conceptsSeen.c1).toBe(true);
    t.cleanup();
  });
});

describe('server: app files', () => {
  it('serves the manifest as a web manifest and never lets browsers cache sw.js', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zs-static-'));
    const data = mkdtempSync(join(tmpdir(), 'zs-data-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    writeFileSync(join(dir, 'manifest.webmanifest'), '{}');
    writeFileSync(join(dir, 'sw.js'), '//');
    const port = 19500 + Math.floor(Math.random() * 400);
    const p = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), DATA_DIR: data, STATIC_DIR: dir, ADMIN_PASSWORD: 'a' }, stdio: 'ignore' });
    try {
      let m: Response | null = null;
      for (let i = 0; i < 50 && !m; i++) {
        m = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`).catch(() => null);
        if (!m) await new Promise((r) => setTimeout(r, 100));
      }
      expect(m!.headers.get('content-type')).toBe('application/manifest+json');
      const sw = await fetch(`http://127.0.0.1:${port}/sw.js`);
      expect(sw.headers.get('content-type')).toContain('javascript');
      expect(sw.headers.get('cache-control')).toBe('no-cache');
    } finally {
      p.kill();
      rmSync(dir, { recursive: true, force: true });
      rmSync(data, { recursive: true, force: true });
    }
  });
});
