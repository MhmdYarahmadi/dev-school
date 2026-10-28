import { useSyncExternalStore } from 'react';
import { getProgress, mergeProgress, onDraft, replaceProgress, subscribeProgress, type Progress } from '../progress/store';

/** API root (one backend for every course). */
const API = '/api';

/** Which course this page syncs progress for ('pg', 'docker', …). */
let COURSE = 'pg';
export function configureSync(courseId: string) {
  COURSE = courseId;
}
const TOKEN_KEY = 'pgschool-token';
const USER_KEY = 'pgschool-user';

export interface SessionUser {
  id: number;
  username: string;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

let token = read(TOKEN_KEY);
let user: SessionUser | null = (() => {
  try {
    return JSON.parse(read(USER_KEY) ?? 'null');
  } catch {
    return null;
  }
})();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useSession(): SessionUser | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => user,
    () => user,
  );
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { admin?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.admin) headers['x-admin-token'] = init.admin;
  let res: Response;
  try {
    res = await fetch(API + path.replace(/^\/api/, ''), { ...init, headers });
  } catch {
    throw new ApiError(0, 'Cannot reach the Zilber School server. Check your connection: logging in needs internet (after that, the courses also work offline on this device).');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !init.admin && token) clearSession();
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

function setSession(t: string, u: SessionUser) {
  token = t;
  user = { id: u.id, username: u.username };
  write(TOKEN_KEY, t);
  write(USER_KEY, JSON.stringify(user));
  emit();
}

function clearSession() {
  token = null;
  user = null;
  write(TOKEN_KEY, null);
  write(USER_KEY, null);
  emit();
}

interface AuthResponse {
  token: string;
  user: SessionUser & { courses: Record<string, Progress | null> };
}

// ---- offline safety ----
// Progress made on this device that the server hasn't confirmed yet (e.g. made offline) is marked
// in localStorage, so a reload or a later login merges it with the server copy instead of losing it.
interface SyncMeta {
  /** Local changes not yet confirmed by the server. */
  unsynced: boolean;
  /** The XP of the last copy the server confirmed (to add XP earned since then). */
  syncedXp?: number;
  /** Whose progress this is. */
  userId?: number;
}
const metaKey = () => `zs-sync-${COURSE}`;
function readMeta(): SyncMeta {
  try {
    return JSON.parse(read(metaKey()) ?? 'null') ?? { unsynced: false };
  } catch {
    return { unsynced: false };
  }
}
function writeMeta(m: SyncMeta) {
  write(metaKey(), JSON.stringify(m));
}
export function hasUnsyncedProgress(): boolean {
  return readMeta().unsynced;
}

/** While applying the server's copy, don't mark it as a local change. */
let applying = false;

/**
 * Take the server's copy of this course. If this device has unsynced work for the same learner,
 * merge the two (nothing solved on either side is lost) and send the result back.
 */
function applyServer(server: Progress | null | undefined) {
  const meta = readMeta();
  const mine = meta.unsynced && meta.userId === user?.id;
  if (!server) {
    void pushNow(); // nothing on the server for this course yet: this device's copy becomes it
    return;
  }
  applying = true;
  try {
    replaceProgress(mine ? mergeProgress(getProgress(), server, meta.syncedXp) : server);
  } finally {
    applying = false;
  }
  if (mine) void pushNow();
  else writeMeta({ unsynced: false, syncedXp: server.xp, userId: user?.id });
}

/** After login: the server copy wins, merged with this device's unsynced work; if the server has none yet, adopt this browser's progress. */
async function adopt(r: AuthResponse) {
  setSession(r.token, r.user);
  applyServer(r.user.courses?.[COURSE]);
}

export async function signup(username: string, password: string) {
  await adopt(await api<AuthResponse>('/api/signup', { method: 'POST', body: JSON.stringify({ username, password }) }));
}

export async function login(username: string, password: string) {
  await adopt(await api<AuthResponse>('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }));
}

/** Log out. Returns false if the learner chose to stay logged in to keep unsynced progress. */
export async function logout(): Promise<boolean> {
  await flush();
  if (hasUnsyncedProgress()) await pushNow();
  if (hasUnsyncedProgress() && !window.confirm('Some of your progress is only on this device: it could not be saved to the server (are you offline?).\n\nLog out anyway and lose it? Choose Cancel to stay logged in; it will be saved when you are back online.')) return false;
  await api('/api/logout', { method: 'POST' }).catch(() => undefined);
  clearSession();
  replaceProgress(null); // the next person on this browser starts clean…
  try {
    // …in every course, not only this one.
    for (const k of Object.keys(localStorage)) if (/^(pgschool-progress|zs-progress-|zs-sync-)/.test(k)) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
  return true;
}

/** Refresh progress from the server on app start (another device may have newer progress). */
export async function refreshFromServer() {
  if (!token) return;
  let r: { user: SessionUser & { courses: Record<string, Progress | null> } };
  try {
    r = await api('/api/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 0 && hasUnsyncedProgress()) setSync('offline');
    throw e;
  }
  applyServer(r.user.courses?.[COURSE]);
}

// ---- background sync ----
let timer: ReturnType<typeof setTimeout> | null = null;
let syncing = false;
let dirty = false;
export type SyncState = 'idle' | 'saving' | 'saved' | 'offline';
let syncState: SyncState = 'idle';
const syncListeners = new Set<() => void>();
function setSync(s: SyncState) {
  syncState = s;
  syncListeners.forEach((l) => l());
}
export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      syncListeners.add(l);
      return () => syncListeners.delete(l);
    },
    () => syncState,
    () => syncState,
  );
}

async function pushNow() {
  if (!token) return;
  if (syncing) {
    dirty = true;
    return;
  }
  syncing = true;
  dirty = false;
  setSync('saving');
  const sent = getProgress();
  try {
    await api(`/api/progress/${COURSE}`, { method: 'PUT', body: JSON.stringify({ progress: sent }) });
    // Changes made while this request was in flight are still unsynced.
    writeMeta({ unsynced: getProgress() !== sent, syncedXp: sent.xp, userId: user?.id });
    setSync('saved');
  } catch {
    setSync('offline');
    dirty = false; // the retry below sends everything, including changes made meanwhile
    schedule(15000); // retry later
  } finally {
    syncing = false;
    if (dirty) schedule(500);
  }
}

function schedule(ms = 2000) {
  if (!token) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void pushNow();
  }, ms);
}

async function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    await pushNow();
  }
}

function changed(ms: number) {
  if (applying || !token) return;
  const meta = readMeta();
  if (!meta.unsynced) writeMeta({ ...meta, unsynced: true, userId: user?.id });
  schedule(ms);
}
subscribeProgress(() => changed(2000));
onDraft(() => changed(5000));
if (typeof window !== 'undefined') {
  // Back online: send what was saved on this device right away.
  window.addEventListener('online', () => {
    if (hasUnsyncedProgress()) void pushNow();
  });
  window.addEventListener('pagehide', () => {
    if (timer && token) {
      // Best-effort final save when the tab closes.
      fetch(`${API}/progress/${COURSE}`, {
        method: 'PUT',
        keepalive: true,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ progress: getProgress() }),
      }).catch(() => undefined);
    }
  });
}
