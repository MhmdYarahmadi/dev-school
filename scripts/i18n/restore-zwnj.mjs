#!/usr/bin/env node
/**
 * Gemini's rewrite of the Python course dropped the zero-width non-joiner (U+200C, the Persian
 * half-space). This puts it back without writing any Persian: for every prose word that equals a
 * word of the previous version (git REF) once half-spaces are ignored, the previous spelling is used.
 *   node scripts/i18n/restore-zwnj.mjs [REF]
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REF = process.argv[2] ?? 'HEAD';
const DIR = join(import.meta.dirname, '..', '..', 'src', 'courses', 'python', 'content');
const ZWNJ = '‌';
const split = (s) => { const i = s.indexOf('= {') + 2, j = s.lastIndexOf('};') + 1; return [s.slice(0, i), JSON.parse(s.slice(i, j)), s.slice(j)]; };

let fixed = 0;
for (const f of readdirSync(DIR).filter((f) => /^p\d\d-.*\.ts$/.test(f))) {
  const [, before] = split(execSync(`git show ${REF}:src/courses/python/content/${f}`, { encoding: 'utf8' }));
  const [head, after, tail] = split(readFileSync(join(DIR, f), 'utf8'));
  // every word with a half-space in the previous version, by its spelling without one
  const words = new Map();
  const collect = (o) => (typeof o === 'string' ? o.replace(/[^\s"`*«»()\[\]{}.,;:!?،؛؟\\]+/g, (w) => (w.includes(ZWNJ) && words.set(w.replaceAll(ZWNJ, ''), w), w)) : Object.values(o ?? {}).forEach(collect));
  collect(before);
  const W = /[^\s"`*«»()\[\]{}.,;:!?،؛؟\\]+/g;
  // Same field first: a word the old field already spelled without a half-space stays as it is.
  const fix = (s, old) => {
    const plain = new Set(typeof old === 'string' ? old.match(W) ?? [] : []);
    return s.replace(W, (w) => {
      const orig = !w.includes(ZWNJ) && !plain.has(w) && words.get(w);
      if (orig) fixed++;
      return orig || w;
    });
  };
  const walk = (o, old) =>
    typeof o === 'string' ? fix(o, old)
    : Array.isArray(o) ? o.map((v, i) => walk(v, old?.[i]))
    : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v, old?.[k])]))
    : o;
  writeFileSync(join(DIR, f), head + JSON.stringify(walk(after, before), null, 2) + tail);
}
console.log(`half-spaces restored in ${fixed} words`);
