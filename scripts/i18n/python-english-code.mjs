#!/usr/bin/env node
/**
 * Python course: makes every piece of text INSIDE CODE English (strings, comments, printed output,
 * input prompts, stdin, test asserts), as the course owner asked, while lessons stay in Persian.
 * Gemini (through the Antigravity CLI, `agy -p`) does the rewrite, one concept or exercise at a time,
 * and also updates the Persian sentences that quote the changed code, so they still match. Claude
 * wrote this script but no Persian: it only sends the units, checks the replies and writes them back.
 *
 *   node scripts/i18n/python-english-code.mjs          # rewrite, check, write src/courses/python/content/*.ts
 *   node scripts/i18n/python-english-code.mjs check    # list units that still have Persian in code
 *
 * A reply is accepted only if: same structure (ids, kinds, answers, numbers, list lengths), no
 * Persian left in any code, and every Persian prose field is still Persian. Rejected replies go back
 * to Gemini with the reason (3 rounds). Then run the tests: every reference solution runs in CPython.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const DIR = join(ROOT, 'src', 'courses', 'python', 'content');
const AGY_DIR = process.env.AGY_DIR ?? join(ROOT, '..', '.agy-scratch');
const MODEL = 'gemini-3.8-flash-high';
const PARALLEL = Number(process.env.PARALLEL ?? 4);
const ROUNDS = 3;

const FA = /[\u0600-\u06FF]/;
/** Persian/Arabic letters (not digits or punctuation). */
const LETTERS = /[\u0621-\u064A\u066E-\u06D3\u06FA-\u06FF]/;
/** Fields that are Python code (or its input). */
const CODE = new Set(['sql', 'solution', 'starterSql', 'syntax', 'blocks', 'distractors', 'tests', 'stdin', 'wrongOrder']);
/** Fields that are text (Persian prose, or output shown as a choice) and may change. */
const TEXT = new Set(['title', 'card', 'question', 'choices', 'why', 'note', 'prompt', 'hints', 'explanation', ...CODE]);

// ---------------------------------------------------------------- module files (JSON inside a .ts)

function readModule(file) {
  const s = readFileSync(join(DIR, file), 'utf8');
  const i = s.indexOf('= {') + 2;
  const j = s.lastIndexOf('};') + 1;
  return { head: s.slice(0, i), tail: s.slice(j), data: JSON.parse(s.slice(i, j)) };
}
const writeModule = (file, m) => writeFileSync(join(DIR, file), m.head + JSON.stringify(m.data, null, 2) + m.tail);

/** Persian found inside code: code fields, ```fenced``` blocks and `inline` code in prose. */
function persianInCode(o, key = '') {
  const out = [];
  const walk = (v, k, path) => {
    if (typeof v === 'string') {
      if (CODE.has(k) && FA.test(v)) out.push(`${path} (code)`);
      for (const m of v.match(/```[\s\S]*?```/g) ?? []) if (FA.test(m)) out.push(`${path} (code block)`);
      for (const m of v.replace(/```[\s\S]*?```/g, '').match(/`[^`]+`/g) ?? []) if (FA.test(m)) out.push(`${path} (inline code ${m})`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, k, `${path}/${i}`));
    else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, kk, path ? `${path}/${kk}` : kk);
  };
  walk(o, key, '');
  return out;
}

/** Why a reply can't be used, or null. */
function problem(before, after) {
  const errs = [];
  const cmp = (a, b, k, path) => {
    if (typeof a === 'string') {
      if (typeof b !== 'string') return errs.push(`${path}: must stay a string`);
      if (a !== b && !TEXT.has(k)) errs.push(`${path}: must not change`);
      // Persian prose stays Persian (a choice may be program output, which becomes English).
      const prose = (x) => x.replace(/```[\s\S]*?```|`[^`]*`/g, '');
      if (k !== 'choices' && !CODE.has(k) && LETTERS.test(prose(a)) && !LETTERS.test(prose(b))) errs.push(`${path}: the Persian explanation must stay Persian`);
      return;
    }
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return errs.push(`${path}: must keep ${a.length} items`);
      return a.forEach((x, i) => cmp(x, b[i], k, `${path}/${i}`));
    }
    if (a && typeof a === 'object') {
      if (!b || typeof b !== 'object') return errs.push(`${path}: must stay an object`);
      const ka = Object.keys(a).sort().join();
      if (ka !== Object.keys(b).sort().join()) return errs.push(`${path}: keys must stay ${ka}`);
      for (const kk of Object.keys(a)) cmp(a[kk], b[kk], kk, path ? `${path}/${kk}` : kk);
      return;
    }
    if (a !== b) errs.push(`${path}: must stay ${JSON.stringify(a)}`);
  };
  cmp(before, after, '', '');
  for (const p of persianInCode(after)) errs.push(`${p}: still has Persian inside code`);
  return errs.length ? errs.slice(0, 8).join('; ') : null;
}

// ---------------------------------------------------------------- Gemini through agy

function agy(prompt, worker) {
  const cwd = join(AGY_DIR, `py${worker}`);
  mkdirSync(cwd, { recursive: true });
  return new Promise((resolve, reject) => {
    const p = spawn('agy', ['--model', MODEL, '--output-format', 'json', '--sandbox', '-p', prompt], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => p.kill(), 15 * 60_000);
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`agy exited ${code}: ${stderr.slice(0, 300)}`));
      try {
        const res = JSON.parse(stdout);
        if (res.status !== 'SUCCESS') return reject(new Error(`agy: ${res.status}`));
        resolve(res.response);
      } catch (e) {
        reject(new Error(`agy output: ${e.message}: ${stdout.slice(0, 300)}`));
      }
    });
  });
}

function jsonIn(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error(`no JSON in reply: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(s, e + 1));
}

const RULES = `You are editing one unit of an interactive Python course for Iranian beginners. The lessons are written in Persian (Farsi); the code is Python.
The course owner wants ALL text INSIDE CODE to be in English. Rewrite the unit below so that:
- Every string literal, comment, printed output, input() prompt, stdin line and test assert in the code is English. Persian digits in code become 0-9. Use simple, friendly English beginners understand (e.g. "Hello, world!"). People's names may stay Iranian names written in Latin letters (Ali, Sara, Reza).
- This applies to code fields (sql, solution, starterSql, syntax, blocks, distractors, wrongOrder, tests, stdin) and to code inside the Persian text: \`\`\`python fenced blocks\`\`\` and \`inline code\`.
- The Persian sentences that quote or show that code or its output (in title, card, question, choices, why, note, prompt, hints, explanation) are updated so they match the new English code and output EXACTLY. When a choice shows program output, it must be the new English output.
- Change NOTHING else: keep every Persian explanation as it is (same wording), keep all keys, ids, kinds, numbers, answer indexes, the order and number of choices, hints and blocks, and the Markdown.
- The code must stay correct Python: the solution must still produce exactly what the prompt asks for, a starter or wrong-order version must still be wrong, and the answer index must still point at the right choice.
- Variable and function names stay as they are.
Do not run commands or use any tools; answer directly from the text.
Reply with ONLY the edited JSON object, nothing else.`;

async function rewrite(unit, worker, lastTry) {
  const fix = lastTry ? `\n\nYour earlier reply was rejected (${lastTry.why}). Fix that.\n` : '\n';
  let reply = '';
  for (let tries = 0; tries < 3 && !reply.includes('{'); tries++) reply = await agy(`${RULES}${fix}\n${JSON.stringify(unit, null, 1)}`, worker);
  return jsonIn(reply);
}

// ---------------------------------------------------------------- run

/** Every concept and exercise with Persian in its code: { file, list, index }. */
function todo(mods) {
  const out = [];
  for (const [file, m] of Object.entries(mods)) {
    for (const list of ['concepts', 'practice', 'test']) m.data[list].forEach((u, index) => persianInCode(u).length && out.push({ file, list, index }));
  }
  return out;
}

const files = readdirSync(DIR).filter((f) => /^p\d\d-.*\.ts$/.test(f)).sort();
const mods = Object.fromEntries(files.map((f) => [f, readModule(f)]));

if (process.argv[2] === 'check') {
  for (const t of todo(mods)) console.log(`✗ ${t.file} ${t.list}/${mods[t.file].data[t.list][t.index].id}: ${persianInCode(mods[t.file].data[t.list][t.index]).join(', ')}`);
  console.log(`${todo(mods).length} units still have Persian in code.`);
} else {
  const rejected = new Map();
  for (let round = 1; round <= ROUNDS; round++) {
    const items = todo(mods);
    if (!items.length) break;
    console.log(`round ${round}: ${items.length} units`);
    let next = 0;
    let done = 0;
    const worker = async (w) => {
      while (next < items.length) {
        const it = items[next++];
        const before = mods[it.file].data[it.list][it.index];
        const key = `${it.file}/${it.list}/${before.id}`;
        try {
          const after = await rewrite(before, w, rejected.get(key));
          const why = problem(before, after);
          if (why) {
            rejected.set(key, { why });
            console.log(`  ✗ ${key}: ${why.slice(0, 200)}`);
          } else {
            mods[it.file].data[it.list][it.index] = after;
            writeModule(it.file, mods[it.file]);
            rejected.delete(key);
          }
        } catch (e) {
          console.log(`  ✗ ${key}: ${e.message.slice(0, 160)}`);
        }
        console.log(`  ${++done}/${items.length}`);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, (_, w) => worker(w)));
  }
  const left = todo(mods);
  console.log(left.length ? `${left.length} units still have Persian in code (run with "check").` : 'No Persian left in any code.');
}
