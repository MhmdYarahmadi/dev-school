/* Pyodide runner worker for the Python course (classic worker so importScripts works).
 *
 * Loads Pyodide once from this site (/pyodide/<version>/), then runs snippets on demand. Each run
 * executes in a FRESH namespace so exercises never leak state into each other, and
 * stdout/stderr are captured per run. input() is fed from an optional `stdin` string.
 *
 * Messages in:  { type:'init' } | { type:'run', id, code, stdin }
 * Messages out: { type:'ready' } | { type:'initError', error }
 *               { type:'result', id, stdout, stderr, error }   // error = short message if it raised
 */
/* global importScripts, loadPyodide */
const PYODIDE_VERSION = '0.26.4';
// Served by this site (offline/pyodide.ts), so the course works offline; keep in step with the pyodide package.
const PYODIDE_URL = `/pyodide/${PYODIDE_VERSION}/`;

let pyodide = null;
let loading = null;
let outBuf = '';
let errBuf = '';

function load() {
  if (loading) return loading;
  loading = (async () => {
    importScripts(PYODIDE_URL + 'pyodide.js');
    pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
    pyodide.setStdout({ batched: (s) => { outBuf += s + '\n'; } });
    pyodide.setStderr({ batched: (s) => { errBuf += s + '\n'; } });
    return pyodide;
  })();
  return loading;
}

// Turn a raw stdin string into a line-by-line reader for Python's input().
function makeStdin(stdinText) {
  const lines = (stdinText ?? '').split('\n');
  let i = 0;
  return { stdin: () => (i >= lines.length ? null : lines[i++]) };
}

async function run(code, stdinText) {
  outBuf = '';
  errBuf = '';
  let error = '';
  try {
    pyodide.setStdin(makeStdin(stdinText));
    const ns = pyodide.globals.get('dict')(); // fresh namespace per run
    try {
      await pyodide.runPythonAsync(code, { globals: ns });
    } finally {
      ns.destroy();
    }
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    error = tidyTraceback(msg);
    errBuf += msg;
  } finally {
    try { pyodide.setStdin({ stdin: () => null }); } catch { /* ignore */ }
  }
  return { stdout: outBuf, stderr: errBuf, error };
}

// Pull the final "ErrorType: message" line out of a Python traceback for a friendly summary.
function tidyTraceback(msg) {
  const lines = msg.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[A-Za-z_][A-Za-z0-9_.]*(Error|Exception|Warning|Interrupt)\b/.test(lines[i].trim())) return lines[i].trim();
  }
  return lines[lines.length - 1] || 'خطا';
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'init') {
    try { await load(); self.postMessage({ type: 'ready' }); }
    catch (e) { self.postMessage({ type: 'initError', error: String((e && e.message) || e) }); }
    return;
  }
  if (msg.type === 'run') {
    try {
      await load();
      const r = await run(msg.code, msg.stdin);
      self.postMessage({ type: 'result', id: msg.id, ...r });
    } catch (e) {
      self.postMessage({ type: 'result', id: msg.id, stdout: '', stderr: String(e), error: String(e) });
    }
  }
};
