import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Serves Pyodide (real CPython in WebAssembly, for the Python course) from this site instead of a
 * CDN, so the course works offline. The files come from the `pyodide` npm package and are served at
 * /pyodide/<version>/ (the version in the path keeps an upgrade from mixing old and new files).
 * They are not precached for every learner (13 MB): the service worker saves them the first time
 * the Python course loads them, in a cache of their own that survives site updates (offline/sw.js).
 */
const DIR = join(__dirname, '..', 'node_modules', 'pyodide');
export const PYODIDE_VERSION: string = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8')).version;
export const PYODIDE_FILES = ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
const BASE = `/pyodide/${PYODIDE_VERSION}/`;
const TYPES: Record<string, string> = { js: 'text/javascript', wasm: 'application/wasm', zip: 'application/zip', json: 'application/json' };

export function pyodideFiles(): Plugin {
  return {
    name: 'zs-pyodide',
    // npm run dev: straight from node_modules
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0].startsWith(BASE) ? req.url.split('?')[0].slice(BASE.length) : '';
        if (!PYODIDE_FILES.includes(name)) return next();
        res.setHeader('Content-Type', TYPES[name.split('.').pop()!]);
        res.end(readFileSync(join(DIR, name)));
      });
    },
    // npm run build: copied into dist/pyodide/<version>/
    generateBundle() {
      for (const name of PYODIDE_FILES) this.emitFile({ type: 'asset', fileName: `pyodide/${PYODIDE_VERSION}/${name}`, source: readFileSync(join(DIR, name)) });
    },
  };
}
