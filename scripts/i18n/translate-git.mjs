#!/usr/bin/env node
/**
 * Translates the Git course into Farsi with Gemini, through the Antigravity CLI (`agy -p`).
 * Claude wrote this script but none of the Farsi: Gemini returns every translation, this script
 * only checks it (code, placeholders and Markdown unchanged) and sends failures back to Gemini.
 *
 *   node scripts/i18n/translate-git.mjs glossary   # step A: Gemini picks the Farsi terms
 *   node scripts/i18n/translate-git.mjs translate  # step B: everything missing, in chunks
 *   node scripts/i18n/translate-git.mjs check      # report what fails validation
 *
 * Reads src/i18n/ui.en.json and git.en.json; writes ui.fa.json, git.fa.json and git.glossary.fa.json.
 * agy runs in an empty scratch folder (AGY_DIR) so it never sees or edits the repository.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isProse, problem } from './validate.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const I18N = join(ROOT, 'src', 'i18n');
const AGY_DIR = process.env.AGY_DIR ?? join(ROOT, '..', '.agy-scratch');
const MODEL = 'gemini-3.8-flash-high';
const PARALLEL = Number(process.env.PARALLEL ?? 4);
const CHUNK_CHARS = 3500;
const ROUNDS = 3;

const read = (f, fallback) => (existsSync(join(I18N, f)) ? JSON.parse(readFileSync(join(I18N, f), 'utf8')) : fallback);
const write = (f, v) => writeFileSync(join(I18N, f), JSON.stringify(sortKeys(v), null, 1) + '\n');
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

// ---------------------------------------------------------------- Gemini through agy

function agy(prompt, worker = 0) {
  // Each parallel worker gets its own folder: concurrent sessions in one folder came back empty.
  const cwd = join(AGY_DIR, `w${worker}`);
  mkdirSync(cwd, { recursive: true });
  return new Promise((resolve, reject) => {
    // stdin closed: with an open pipe agy waits for input.
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

/** The JSON object in a reply (Gemini sometimes wraps it in a code fence). */
function jsonIn(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error(`no JSON in reply: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(s, e + 1));
}

const RULES = `You are translating an interactive Git course for Iranian learners from English into Farsi (Persian).
Rules:
- Write natural, friendly, clear Farsi for beginners, like a good teacher. Use Persian punctuation (the Persian comma, semicolon and question mark) and the zero-width non-joiner (ZWNJ, U+200C) where Persian spelling needs it (e.g. before plural and verb suffixes).
- Keep EVERYTHING inside backticks exactly as it is, byte for byte (commands, file names, branch names, Git output). Keep the same backtick spans, in the same order.
- Keep placeholders like {n}, {file}, {branch} exactly as they are (they are filled in later). Keep Markdown exactly: **bold**, list items, line breaks.
- Keep emoji. Keep quoted Git output, commit messages and file contents in English.
- Git command names (git add, commit, push…) stay in English when they are commands. Use the glossary for Git terms.
- Product names stay in English: Git, GitHub, Dev School, Sam (a teammate), Alex.
- "Sam" is the learner's teammate. Address the learner politely (the plural/formal 'you').`;

async function glossary() {
  const terms = ['repository', 'commit (noun)', 'commit (verb)', 'branch', 'merge', 'merge commit', 'fast-forward', 'conflict', 'conflict markers', 'staging area', 'stage (verb)', 'working folder', 'working tree', 'untracked', 'tracked', 'HEAD', 'detached HEAD', 'remote', 'remote-tracking branch', 'upstream', 'clone', 'fetch', 'pull', 'push', 'pull request', 'review', 'approve', 'protected branch', 'hub (the shared server, like GitHub)', 'history', 'log', 'diff', 'revert', 'restore', 'hash', 'teammate', 'terminal', 'command', 'playground', 'hint', 'par (target number of commands in a game)', 'mission', 'module', 'practice', 'test', 'cheat sheet', 'review deck (spaced repetition)', 'badge', 'XP', 'streak', 'level'];
  const reply = await agy(`${RULES}

First, decide the Farsi terminology for this course. For each English term, give the Farsi you will use consistently (keep a term in English if Iranian developers normally say it in English; then write it in Latin letters). Reply with ONLY a JSON object {"term": "Farsi"}.
Terms: ${JSON.stringify(terms)}`);
  const g = jsonIn(reply);
  write('git.glossary.fa.json', g);
  console.log(`glossary: ${Object.keys(g).length} terms`);
}

/** Items still to translate: [{ table, key, en }]. */
function todo(tables) {
  const items = [];
  for (const [table, en] of Object.entries(tables)) {
    const fa = read(table.replace('.en.', '.fa.'), {});
    const pairs = Array.isArray(en) ? en.map((s) => [s, s]) : Object.entries(en);
    for (const [key, text] of pairs) if (!fa[key] || problem(text, fa[key])) items.push({ table, key, en: text, last: fa[key], why: fa[key] ? problem(text, fa[key]) : null });
  }
  return items;
}

function chunks(items) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const it of items) {
    if (cur.length && (size + it.en.length > CHUNK_CHARS || cur.length >= 30)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += it.en.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function translateChunk(chunk, gloss, worker) {
  const input = Object.fromEntries(chunk.map((it, i) => [`s${i}`, it.en]));
  const fixes = chunk.filter((it) => it.why).map((it) => `- ${`s${chunk.indexOf(it)}`}: your earlier translation was rejected (${it.why}): ${JSON.stringify(it.last)}`);
  const prompt = `${RULES}

Glossary (use these terms): ${JSON.stringify(gloss)}

Translate each value of this JSON object into Farsi. Reply with ONLY a JSON object with the same keys.${fixes.length ? `\n\nFix these:\n${fixes.join('\n')}` : ''}
${JSON.stringify(input, null, 1)}`;
  let reply = '';
  // An empty reply happens now and then: ask again.
  for (let tries = 0; tries < 3 && !reply.includes('{'); tries++) reply = await agy(prompt, worker);
  const out = jsonIn(reply);
  return chunk.map((it, i) => ({ ...it, fa: out[`s${i}`] }));
}

async function translate() {
  const tables = { 'ui.en.json': read('ui.en.json'), 'git.en.json': read('git.en.json') };
  const gloss = read('git.glossary.fa.json', null);
  if (!gloss) throw new Error('run the glossary step first');
  for (let round = 1; round <= ROUNDS; round++) {
    const items = todo(tables);
    if (!items.length) break;
    const cs = chunks(items);
    console.log(`round ${round}: ${items.length} strings in ${cs.length} chunks`);
    let next = 0;
    let done = 0;
    const worker = async (_, w) => {
      while (next < cs.length) {
        const c = cs[next++];
        let res;
        try {
          res = await translateChunk(c, gloss, w);
        } catch (e) {
          console.log(`  chunk failed (${e.message.slice(0, 160)}); retried next round`);
          continue;
        }
        // Save as we go (the tables are re-read, so parallel workers don't lose each other's work).
        for (const table of new Set(res.map((r) => r.table))) {
          const f = table.replace('.en.', '.fa.');
          const fa = read(f, {});
          for (const r of res) if (r.table === table && typeof r.fa === 'string') fa[r.key] = r.fa;
          write(f, fa);
        }
        done++;
        const bad = res.filter((r) => problem(r.en, r.fa)).length;
        console.log(`  ${done}/${cs.length} chunks${bad ? ` (${bad} to redo)` : ''}`);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, (_, w) => worker(null, w)));
  }
  check();
}

function check() {
  const items = todo({ 'ui.en.json': read('ui.en.json'), 'git.en.json': read('git.en.json') });
  for (const it of items) console.log(`✗ ${it.table} ${JSON.stringify(it.key).slice(0, 80)}: ${it.why ?? 'missing'}`);
  console.log(items.length ? `${items.length} strings still fail; they stay English.` : 'All strings translated and valid.');
}

const step = process.argv[2];
if (step === 'glossary') await glossary();
else if (step === 'translate') await translate();
else if (step === 'check') check();
else console.log('usage: translate-git.mjs glossary | translate | check');
