#!/usr/bin/env node
/**
 * Turns raw lesson recordings into the course's voiceover files.
 *
 *   node scripts/audio/prepare.mjs <folder of recordings>
 *   node scripts/audio/prepare.mjs list                      # the lesson ids and titles to name files by
 *
 * Each recording is named after its lesson id (m01-print.m4a, m03-fstring.mp3, any format ffmpeg reads).
 * It is trimmed of silence at both ends, cleaned of low rumble, brought to a steady speech loudness
 * (-16 LUFS, two-pass), made mono and saved as AAC 64 kbit/s in src/courses/python/audio/<id>.m4a.
 * Files whose name isn't a lesson id are listed and skipped. Needs ffmpeg.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const CONTENT = join(ROOT, 'src', 'courses', 'python', 'content');
const OUT = join(ROOT, 'src', 'courses', 'python', 'audio');

/** Every lesson (concept) of the course: [{ id, title, module }]. */
function lessons() {
  const out = [];
  for (const f of readdirSync(CONTENT).filter((f) => /^p\d\d-.*\.ts$/.test(f)).sort()) {
    const s = readFileSync(join(CONTENT, f), 'utf8');
    const m = JSON.parse(s.slice(s.indexOf('= {') + 2, s.lastIndexOf('};') + 1));
    for (const c of m.concepts) out.push({ id: c.id, title: c.title, module: m.title });
  }
  return out;
}

const run = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr.split('\n').slice(-4).join(' '));
  return r.stderr;
};

/** Silence trimmed at the start and the end (keeping a short breath), rumble below 80 Hz removed. */
const TRIM =
  'highpass=f=80,' +
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.25,areverse,' +
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.4,areverse';

/** Loudness of `input` after `filter` (pass 1 of loudnorm), or null when nothing is left. */
function measure(input, filter) {
  const log = run(['-i', input, '-af', `${filter},loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
  return Number.isFinite(Number(m.input_i)) ? m : null;
}

function prepare(input, id) {
  // Pass 1 measures the loudness, pass 2 applies it exactly (single-pass loudnorm pumps on speech).
  // A very quiet recording can fall entirely under the silence threshold: then it isn't trimmed.
  let CLEAN = TRIM;
  let m = measure(input, TRIM);
  if (!m) {
    CLEAN = 'highpass=f=80';
    m = measure(input, CLEAN);
    if (!m) throw new Error('the recording is silent');
    console.log(`  ! ${id}: very quiet recording, so the silence at the ends was kept`);
  }
  const norm = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const out = join(OUT, `${id}.m4a`);
  run(['-y', '-i', input, '-vn', '-map_metadata', '-1', '-af', `${CLEAN},${norm}`, '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out]);
  return out;
}

const seconds = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout);
const time = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const arg = process.argv[2];
const all = lessons();
if (!arg || arg === 'list') {
  let mod = '';
  for (const l of all) {
    if (l.module !== mod) console.log(`\n${(mod = l.module)}`);
    console.log(`  ${l.id.padEnd(16)} ${l.title}`);
  }
  if (!arg) console.log('\nUsage: node scripts/audio/prepare.mjs <folder of recordings>');
} else {
  const ids = new Set(all.map((l) => l.id));
  mkdirSync(OUT, { recursive: true });
  const files = readdirSync(arg).filter((f) => !f.startsWith('.') && statSync(join(arg, f)).isFile());
  let made = 0;
  for (const f of files) {
    const id = basename(f, extname(f)).trim().toLowerCase();
    if (!ids.has(id)) {
      console.log(`✗ ${f}: not a lesson id (run "list" to see them), skipped`);
      continue;
    }
    try {
      const out = prepare(join(arg, f), id);
      console.log(`✓ ${id}  ${time(seconds(join(arg, f)))} → ${time(seconds(out))}  ${Math.round(statSync(out).size / 1024)} KB`);
      made++;
    } catch (e) {
      console.log(`✗ ${f}: ffmpeg failed: ${e.message}`);
    }
  }
  console.log(`${made} of ${files.length} recordings saved in src/courses/python/audio/.`);
}
