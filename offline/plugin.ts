import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';
import { PYODIDE_VERSION } from './pyodide';

/** Not downloaded on install: the admin dashboard, PGlite's unused file systems, and Pyodide (13 MB,
 * saved the first time the Python course uses it, see offline/sw.js), and lesson voiceovers (saved
 * when first played). */
const SKIP = [/^\/admin\//, /^\/pyodide\//, /^\/assets\/admin-/, /^\/assets\/(nodefs|opfs-ahp)-/, /^\/sw\.js$/, /\.map$/, /\.m4a$/];

/** Every file under `dir`, as site paths ('/assets/x.js'); index.html files become their folder ('/pg/'). */
export function sitePaths(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push('/' + relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.map((p) => p.replace(/(^|\/)index\.html$/, '$1')).sort();
}

/** The files the service worker downloads on install. */
export function precacheList(paths: string[]): string[] {
  return paths.filter((p) => !SKIP.some((re) => re.test(p)));
}

/** After the build, writes dist/sw.js with this build's file list and a version that changes when any file does. */
export function offline(template: string): Plugin {
  let outDir = 'dist';
  return {
    name: 'zs-offline',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files = precacheList(sitePaths(outDir));
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(f.startsWith('/assets/') ? '' : readFileSync(join(outDir, f.endsWith('/') ? `${f}index.html` : f)));
      const sw = readFileSync(template, 'utf8')
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__FILES__', JSON.stringify(files))
        .replace("'__PYODIDE__'", JSON.stringify(PYODIDE_VERSION))
        .replace('__AUDIO__', JSON.stringify(sitePaths(outDir).filter((p) => p.endsWith('.m4a'))));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}
