// pgschool backend: accounts, progress sync and the admin API.
// Zero dependencies: Node's built-in http + node:sqlite. Also serves the built site (dist/).
//
// Env: PORT (8787), DATA_DIR (./data), STATIC_DIR (./dist), ADMIN_PASSWORD (required for /api/admin).
//
// NOTE: passwords are stored in plain text, at the site owner's explicit request.
// Keep the database file and backups private.

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? './dist');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const MAX_BODY = 2 * 1024 * 1024;

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'pgschool.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_active INTEGER NOT NULL,
    progress TEXT,
    progress_updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  -- One row per learner per course (pg, docker, …).
  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, course)
  );
`);
// One-time migration: progress used to live in users.progress (PostgreSQL course only).
db.exec(`
  INSERT OR IGNORE INTO progress (user_id, course, data, updated_at)
    SELECT id, 'pg', progress, coalesce(progress_updated_at, last_active) FROM users WHERE progress IS NOT NULL;
  UPDATE users SET progress = NULL WHERE progress IS NOT NULL;
`);

const q = {
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (username, password, created_at, last_active) VALUES (?, ?, ?, ?)'),
  insertSession: db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)'),
  session: db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteSessionsOf: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  touch: db.prepare('UPDATE users SET last_active = ? WHERE id = ?'),
  saveProgress: db.prepare(`INSERT INTO progress (user_id, course, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, course) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
  progressOf: db.prepare('SELECT course, data FROM progress WHERE user_id = ?'),
  allProgress: db.prepare('SELECT user_id, course, data FROM progress'),
  allUsers: db.prepare('SELECT id, username, password, created_at, last_active FROM users ORDER BY last_active DESC'),
  setPassword: db.prepare('UPDATE users SET password = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  deleteProgressOf: db.prepare('DELETE FROM progress WHERE user_id = ?'),
};
db.exec('PRAGMA foreign_keys = ON');

const adminTokens = new Map(); // token -> expiry
const ADMIN_TTL = 12 * 60 * 60 * 1000;

// Very small per-IP rate limit for login attempts.
const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  a.push(now);
  attempts.set(ip, a);
  return a.length > 30;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(json);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function bearer(req) {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

function requireUser(req) {
  const token = bearer(req);
  const user = token && q.session.get(token);
  if (!user) throw new HttpError(401, 'Please log in again.');
  return { user, token };
}

function requireAdmin(req) {
  const t = req.headers['x-admin-token'];
  const exp = typeof t === 'string' && adminTokens.get(t);
  if (!exp || exp < Date.now()) throw new HttpError(401, 'Admin login required.');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function validCredentials(body) {
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, 'Username: 3–32 letters, digits, dot, dash or underscore.');
  if (password.length < 6 || password.length > 200) throw new HttpError(400, 'Password must be at least 6 characters.');
  return { username, password };
}

function newSession(userId) {
  const token = randomBytes(32).toString('hex');
  q.insertSession.run(token, userId, Date.now());
  return token;
}

const VALID_COURSE = /^[a-z0-9_-]{1,32}$/;

function coursesOf(userId) {
  const out = {};
  for (const r of q.progressOf.all(userId)) out[r.course] = JSON.parse(r.data);
  return out;
}

const publicUser = (u) => ({ id: u.id, username: u.username, courses: coursesOf(u.id) });

async function api(req, res, path) {
  const m = req.method;
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || '';

  if (m === 'GET' && path === '/api/health') return send(res, 200, { ok: true });

  if (m === 'POST' && path === '/api/signup') {
    if (rateLimited(ip)) throw new HttpError(429, 'Too many attempts. Wait a few minutes.');
    const { username, password } = validCredentials(await readJson(req));
    if (q.userByName.get(username)) throw new HttpError(409, 'That username is taken.');
    const now = Date.now();
    const r = q.insertUser.run(username, password, now, now);
    const id = Number(r.lastInsertRowid);
    return send(res, 201, { token: newSession(id), user: publicUser(q.userById.get(id)) });
  }

  if (m === 'POST' && path === '/api/login') {
    if (rateLimited(ip)) throw new HttpError(429, 'Too many attempts. Wait a few minutes.');
    const body = await readJson(req);
    const u = q.userByName.get(String(body.username ?? '').trim());
    if (!u || !safeEqual(u.password, body.password ?? '')) throw new HttpError(401, 'Wrong username or password.');
    q.touch.run(Date.now(), u.id);
    return send(res, 200, { token: newSession(u.id), user: publicUser(u) });
  }

  if (m === 'POST' && path === '/api/logout') {
    q.deleteSession.run(bearer(req));
    return send(res, 200, { ok: true });
  }

  if (m === 'GET' && path === '/api/me') {
    const { user } = requireUser(req);
    q.touch.run(Date.now(), user.id);
    return send(res, 200, { user: publicUser(user) });
  }

  // PUT /api/progress/:course  (plain /api/progress = the PostgreSQL course, for older clients)
  const prog = /^\/api\/progress(?:\/([^/]+))?$/.exec(path);
  if (m === 'PUT' && prog) {
    const { user } = requireUser(req);
    const course = prog[1] ?? 'pg';
    if (!VALID_COURSE.test(course)) throw new HttpError(400, 'Unknown course.');
    const body = await readJson(req);
    if (body?.progress?.version !== 1) throw new HttpError(400, 'Unexpected progress format.');
    const now = Date.now();
    q.saveProgress.run(user.id, course, JSON.stringify(body.progress), now);
    q.touch.run(now, user.id);
    return send(res, 200, { ok: true, savedAt: now });
  }

  // ---- admin ----
  if (m === 'POST' && path === '/api/admin/login') {
    if (rateLimited(ip)) throw new HttpError(429, 'Too many attempts. Wait a few minutes.');
    if (!ADMIN_PASSWORD) throw new HttpError(503, 'ADMIN_PASSWORD is not configured on the server.');
    const body = await readJson(req);
    if (!safeEqual(body.password ?? '', ADMIN_PASSWORD)) throw new HttpError(401, 'Wrong admin password.');
    const token = randomBytes(32).toString('hex');
    adminTokens.set(token, Date.now() + ADMIN_TTL);
    return send(res, 200, { token });
  }

  if (path.startsWith('/api/admin/')) {
    requireAdmin(req);
    if (m === 'GET' && path === '/api/admin/users') {
      const byUser = new Map();
      for (const r of q.allProgress.all()) {
        const m = byUser.get(r.user_id) ?? {};
        m[r.course] = JSON.parse(r.data);
        byUser.set(r.user_id, m);
      }
      const users = q.allUsers.all().map((u) => ({
        id: u.id,
        username: u.username,
        password: u.password,
        createdAt: u.created_at,
        lastActive: u.last_active,
        courses: byUser.get(u.id) ?? {},
      }));
      return send(res, 200, { users });
    }
    const pw = /^\/api\/admin\/users\/(\d+)\/password$/.exec(path);
    if (m === 'POST' && pw) {
      const { password } = await readJson(req);
      if (String(password ?? '').length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
      q.setPassword.run(String(password), Number(pw[1]));
      q.deleteSessionsOf.run(Number(pw[1]));
      return send(res, 200, { ok: true });
    }
    const del = /^\/api\/admin\/users\/(\d+)$/.exec(path);
    if (m === 'DELETE' && del) {
      q.deleteSessionsOf.run(Number(del[1]));
      q.deleteProgressOf.run(Number(del[1]));
      q.deleteUser.run(Number(del[1]));
      return send(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, 'Not found');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
};

function serveStatic(req, res, urlPath) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  let file = join(STATIC_DIR, rel);
  if (!file.startsWith(STATIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  if (!existsSync(file) && rel.startsWith('/assets/')) return send(res, 404, { error: 'Not found' });
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // Each section (/pg/, /docker/, /admin/) has its own index.html; otherwise the home page.
    const section = rel.split('/').filter(Boolean)[0];
    const sectionIndex = section ? join(STATIC_DIR, section, 'index.html') : '';
    file = section && existsSync(sectionIndex) ? sectionIndex : join(STATIC_DIR, 'index.html');
  }
  if (!existsSync(file)) return send(res, 404, { error: 'Site not built. Run npm run build.' });
  const hashed = file.includes(`${STATIC_DIR}/assets/`);
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // /pg/api/… was the API address before the multi-course layout; keep it working.
  const pathname = url.pathname.startsWith('/pg/api/') ? url.pathname.slice(3) : url.pathname;
  try {
    if (pathname.startsWith('/api/')) return await api(req, res, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    return serveStatic(req, res, pathname);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return send(res, status, { error: status === 500 ? 'Server error' : e.message });
  }
});

server.listen(PORT, () => console.log(`pgschool server on :${PORT} (data: ${DATA_DIR}, static: ${STATIC_DIR})`));

// Shut down cleanly on `docker stop` (SIGTERM). As PID 1, Node would otherwise ignore
// the signal and Docker would kill it after 10 s (exit 137).
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref(); // don't wait on keep-alive connections
  });
}
