/**
 * Golden test: replays a session recorded on REAL Docker 29.7.2 (tests/fixtures-docker-29.txt,
 * captured on the VPS by scratchpad zscal.sh) through the simulator and compares every command's
 * output and exit code. Only run-to-run noise is normalised (ids, digests, times, IPs, column widths).
 * Any remaining difference must be listed in KNOWN_DIFFERENCES with a reason.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DockerEngine } from '../src/courses/docker/engine';

interface Rec {
  cmd: string;
  out: string[];
  exit: number;
}

function loadFixture(): Rec[] {
  const lines = readFileSync(new URL('./fixtures-docker-29.txt', import.meta.url), 'utf8').split('\n');
  const recs: Rec[] = [];
  let cur: Rec | null = null;
  for (const l of lines) {
    if (l.startsWith('### CMD: ')) {
      cur = { cmd: l.slice(9), out: [], exit: 0 };
      continue;
    }
    if (l.startsWith('### EXIT: ') && cur) {
      cur.exit = Number(l.slice(10));
      recs.push(cur);
      cur = null;
      continue;
    }
    if (cur) cur.out.push(l);
  }
  return recs;
}

/** Remove run-to-run noise so real and simulated output can be compared. */
export function norm(lines: string[]): string[] {
  const out: string[] = [];
  for (let l of lines) {
    if (/^[0-9a-f]{12}: (Pulling fs layer|Download complete|Pull complete|Already exists)$/.test(l)) continue; // layer progress
    l = l
      .replace(/sha256:[0-9a-f]{64}/g, '<DIGEST>')
      .replace(/\b[0-9a-z]{25}::[0-9a-z]{25}\b/g, '<REF>')
      .replace(/\b[0-9a-f]{64}\b/g, '<ID>')
      .replace(/\b[0-9a-f]{12}\b/g, '<SHORTID>')
      .replace(/(Less than a second|About a minute|About an hour|\d+ (seconds?|minutes?|hours?|days?|months?)) ago/g, '<AGO>')
      .replace(/Up (Less than a second|About a minute|About an hour|\d+ (seconds?|minutes?|hours?))/g, 'Up <DUR>')
      .replace(/\b172\.\d+\.0\.\d+\b/g, '<IP>')
      .replace(/time=[\d.]+ ms/g, 'time=<T> ms')
      .replace(/= [\d.]+\/[\d.]+\/[\d.]+ ms/g, '= <T> ms')
      .replace(/\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d/g, '<TS>')
      .replace(/\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?Z?/g, '<TS>')
      .replace(/\[\d\d\/\w{3}\/\d{4}:\d\d:\d\d:\d\d \+0000\]/g, '[<TS>]')
      .replace(/" 200 \d+ "/g, '" 200 <N> "')
      .replace(/(DONE|done) \d+\.\d+s/g, '$1 <T>')
      .replace(/ \d+\.\d+s done/g, ' <T> done')
      .replace(/worker process \d+/g, 'worker process <PID>') // process ids
      // YAML errors come from a different parser (Go vs JS): compare prefix + file, not the parser's wording.
      .replace(/^(failed to parse \S+): .*/, '$1: <YAML ERROR>')
      .replace(/\s{2,}/g, '\t') // table column widths depend on the lengths of normalised values
      .replace(/\s+$/, '');
    out.push(l);
  }
  // Compose v5 prints some progress lines twice; drop consecutive duplicates.
  return out.filter((l, i) => i === 0 || l !== out[i - 1] || !l.startsWith(' Network') && !l.startsWith('\tNetwork') && !/^\s?(Network|Volume) /.test(l));
}

/** Deliberate, documented simplifications. Key: the recorded command. */
const KNOWN_DIFFERENCES: Record<string, string> = {};

function setupEngine(): DockerEngine {
  const e = new DockerEngine({ seed: 7, cwd: '/root' });
  // Images that already existed on the VPS before the recording.
  for (const ref of ['postgres:16-alpine', 'nginx:1.27-alpine']) e.pullQuiet(ref);
  return e;
}

/** Files the calibration script created between recorded commands. */
function beforeCommand(e: DockerEngine, cmd: string, seen: Map<string, number>) {
  const n = (seen.get(cmd) ?? 0) + 1;
  seen.set(cmd, n);
  if (cmd.startsWith('cd /tmp/zscal-build && docker build') && !e.files['/tmp/zscal-build/Dockerfile']) {
    e.files['/tmp/zscal-build/hello.txt'] = 'hello from the image\n';
    e.files['/tmp/zscal-build/notes.log'] = 'secret\n';
    e.files['/tmp/zscal-build/.dockerignore'] = '*.log\n';
    e.files['/tmp/zscal-build/Dockerfile'] = 'FROM alpine:3.20\nWORKDIR /app\nCOPY hello.txt .\nRUN echo built > built.txt\nCMD ["cat", "hello.txt"]\n';
  }
  if (cmd.startsWith('cd /tmp/zscal-broken')) {
    e.files['/tmp/zscal-broken/Dockerfile'] = n === 1 ? 'FROM alpine:3.20\nCOPY missing.txt /\n' : 'FROM alpine:3.20\nRUN exit 4\n';
  }
  if (cmd.startsWith('cd /tmp/zscal-compose')) {
    const k = [...seen.entries()].filter(([c]) => c.startsWith('cd /tmp/zscal-compose')).reduce((s, [, v]) => s + v, 0);
    if (k === 1)
      e.files['/tmp/zscal-compose/compose.yaml'] = `services:
  web:
    image: nginx
    ports:
      - "127.0.0.1:18082:80"
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - dbdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 2s
      retries: 10
volumes:
  dbdata:
`;
    if (cmd.includes('config') && n === 1) e.files['/tmp/zscal-compose/compose.yaml'] = 'services:\n  web:\n    image: nginx\n    ports:\n      - 80:80\n   bad_indent: x\n';
    if (cmd.includes('config') && n === 2) e.files['/tmp/zscal-compose/compose.yaml'] = 'services:\n  web:\n    image: nginx\n    depends_on:\n      - api\n';
  }
}

describe('golden replay against real Docker 29.7.2', () => {
  const recs = loadFixture();
  const e = setupEngine();
  const seen = new Map<string, number>();
  const results = recs.map((r) => {
    beforeCommand(e, r.cmd, seen);
    const res = e.exec(r.cmd);
    return { rec: r, got: res.lines.map((l) => l.text), exit: res.exitCode };
  });

  it('recorded every command', () => expect(recs.length).toBeGreaterThan(100));

  for (const [i, { rec, got, exit }] of results.entries()) {
    it(`#${i + 1} ${rec.cmd}`, () => {
      const want = norm(rec.out);
      const have = norm(got);
      const same = JSON.stringify(want) === JSON.stringify(have) && exit === rec.exit;
      if (!same && KNOWN_DIFFERENCES[rec.cmd]) return; // documented simplification
      if (!same && process.env.GOLDEN_DIFF) console.log(`\n=== ${rec.cmd}\n--- real (exit ${rec.exit})\n${want.join('\n')}\n+++ sim (exit ${exit})\n${have.join('\n')}`);
      expect({ out: have, exit }, `simulator output differs from real Docker for: ${rec.cmd}`).toEqual({ out: want, exit: rec.exit });
    });
  }
});
