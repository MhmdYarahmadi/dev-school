/**
 * Runs Python off the main thread, in a classic Web Worker that loads Pyodide
 * (real CPython in WASM). Lazy: the worker and Pyodide's multi-MB download only
 * start on the first run. Safe: every run has a timeout; on timeout the worker is
 * terminated and respawned, so a `while True:` kills the worker, never the tab.
 *
 * In Node (tests, SSR) there is no Worker, so it falls back to loading `pyodide`
 * directly — the same pattern the System Design engine uses.
 */

export interface PyResult {
  stdout: string;
  stderr: string;
  /** Short, friendly message if the code raised; '' on success. */
  error: string;
  /** True when the run was killed by the timeout. */
  timedOut?: boolean;
  ms: number;
}

const RUN_TIMEOUT_MS = 10000;

type StatusListener = (status: 'loading' | 'ready' | 'error', detail?: string) => void;
const listeners = new Set<StatusListener>();
export function onStatus(fn: StatusListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(status: 'loading' | 'ready' | 'error', detail?: string) {
  for (const fn of listeners) try { fn(status, detail); } catch { /* noop */ }
}

// ------------------------------------------------------------------ browser (worker)

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let resolveReady: () => void;
let rejectReady: (e: Error) => void;
let seq = 0;
const pending = new Map<number, { resolve: (r: PyResult) => void; timer: ReturnType<typeof setTimeout>; started: number }>();

function spawn() {
  worker = new Worker('/py-worker.js'); // classic worker, served from public/
  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data || {};
    if (msg.type === 'ready') { emit('ready'); resolveReady(); return; }
    if (msg.type === 'initError') { emit('error', msg.error); rejectReady(new Error(msg.error)); return; }
    if (msg.type === 'result') {
      const p = pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(msg.id);
      p.resolve({ stdout: msg.stdout || '', stderr: msg.stderr || '', error: msg.error || '', ms: Date.now() - p.started });
    }
  };
  worker.onerror = (e) => emit('error', e.message);
}

/** Start Pyodide loading (idempotent). Resolves when it's ready. */
export function warmUp(): Promise<void> {
  if (!worker) {
    ready = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej; });
    spawn();
    emit('loading');
    worker!.postMessage({ type: 'init' });
  }
  return ready!;
}

function respawn() {
  try { worker?.terminate(); } catch { /* noop */ }
  worker = null;
  for (const [, p] of pending) { clearTimeout(p.timer); p.resolve({ stdout: '', stderr: '', error: 'اجرا متوقف شد.', ms: 0 }); }
  pending.clear();
}

function runInWorker(code: string, stdin: string, timeout: number): Promise<PyResult> {
  return warmUp().then(
    () =>
      new Promise<PyResult>((resolve) => {
        const id = ++seq;
        const started = Date.now();
        const timer = setTimeout(() => {
          pending.delete(id);
          respawn();
          warmUp(); // ready a fresh worker for the next attempt
          resolve({ stdout: '', stderr: '', error: 'اجرا بیش از حد طول کشید و متوقف شد (شاید یک حلقهٔ بی‌پایان؟).', timedOut: true, ms: Date.now() - started });
        }, timeout);
        pending.set(id, { resolve, timer, started });
        worker!.postMessage({ type: 'run', id, code, stdin });
      }),
    () => ({ stdout: '', stderr: '', error: 'بارگذاری پایتون ناموفق بود.', ms: 0 }),
  );
}

// ------------------------------------------------------------------ node (direct)

type PyodideAPI = Awaited<ReturnType<(typeof import('pyodide'))['loadPyodide']>>;
let nodePy: Promise<PyodideAPI> | null = null;

function loadNode(): Promise<PyodideAPI> {
  if (!nodePy) nodePy = import('pyodide').then((m) => m.loadPyodide());
  return nodePy;
}

function tidyTraceback(msg: string): string {
  const lines = msg.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[A-Za-z_][A-Za-z0-9_.]*(Error|Exception|Warning|Interrupt)\b/.test(lines[i].trim())) return lines[i].trim();
  }
  return lines[lines.length - 1] || 'error';
}

async function runInNode(code: string, stdin: string): Promise<PyResult> {
  const started = Date.now();
  const py = await loadNode();
  let out = '';
  let err = '';
  let error = '';
  py.setStdout({ batched: (s) => { out += s + '\n'; } });
  py.setStderr({ batched: (s) => { err += s + '\n'; } });
  const lines = (stdin ?? '').split('\n');
  let i = 0;
  py.setStdin({ stdin: () => (i >= lines.length ? null : lines[i++]) });
  const ns = py.globals.get('dict')();
  try {
    await py.runPythonAsync(code, { globals: ns });
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    error = tidyTraceback(m);
    err += m;
  } finally {
    ns.destroy();
  }
  return { stdout: out, stderr: err, error, ms: Date.now() - started };
}

// ------------------------------------------------------------------ public API

/** Run Python code; resolves with { stdout, stderr, error, ms }. Never rejects into the UI. */
export function runPython(code: string, stdin = '', timeout = RUN_TIMEOUT_MS): Promise<PyResult> {
  if (typeof Worker === 'undefined') return runInNode(code, stdin);
  return runInWorker(code, stdin, timeout);
}
