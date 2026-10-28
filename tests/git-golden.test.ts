/**
 * Golden test: replays sessions recorded on REAL Git 2.53 (tests/fixtures-git.txt, made by
 * scripts/record-git-golden.mjs from tests/git-golden-sessions.txt) through the simulator and
 * compares every command's stdout, stderr and exit code, including commit hashes.
 * Any remaining difference must be listed in KNOWN_DIFFERENCES with a reason.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GitMachine } from '../src/courses/git/engine';

interface Rec {
  cmd: string;
  out: string;
  err: string;
  exit: number;
}

function loadFixture(): { name: string; recs: Rec[] }[] {
  const sessions: { name: string; recs: Rec[] }[] = [];
  let cur: Rec | null = null;
  let target: 'out' | 'err' = 'out';
  const buf: Record<'out' | 'err', string[]> = { out: [], err: [] };
  for (const l of readFileSync(new URL('./fixtures-git.txt', import.meta.url), 'utf8').split('\n')) {
    if (l.startsWith('### SESSION ')) {
      sessions.push({ name: l.slice(12), recs: [] });
      continue;
    }
    const cmd = /^### (\$|@\w+) ([\s\S]*)$/.exec(l);
    if (cmd) {
      cur = { cmd: cmd[1] === '$' ? cmd[2] : `${cmd[1]} ${cmd[2]}`, out: '', err: '', exit: 0 };
      target = 'out';
      buf.out = [];
      buf.err = [];
      continue;
    }
    if (l.startsWith('### > ') || l === '### >') {
      cur!.cmd += '\n' + l.slice(6);
      continue;
    }
    if (l === '### STDERR') {
      target = 'err';
      continue;
    }
    if (l.startsWith('### EXIT ') && cur) {
      cur.out = buf.out.join('\n');
      cur.err = buf.err.join('\n');
      cur.exit = Number(l.slice(9));
      sessions[sessions.length - 1].recs.push(cur);
      cur = null;
      continue;
    }
    if (cur) buf[target].push(l);
  }
  return sessions;
}

/** "session:command index" → why the simulator differs. Keep this list short and justified. */
const KNOWN_DIFFERENCES: Record<string, string> = {};

describe('Git simulator vs real Git 2.53', () => {
  for (const s of loadFixture()) {
    it(`session ${s.name} (${s.recs.length} commands)`, () => {
      const m = new GitMachine();
      const problems: string[] = [];
      s.recs.forEach((rec, i) => {
        const res = m.exec(rec.cmd);
        const text = (kind: 'out' | 'err') =>
          res.lines
            .filter((l) => (kind === 'err') === (l.kind === 'err'))
            .map((l) => l.text)
            .join('\n');
        const got = { out: text('out'), err: text('err'), exit: res.exitCode };
        if (got.out === rec.out && got.err === rec.err && got.exit === rec.exit) return;
        if (KNOWN_DIFFERENCES[`${s.name}:${i}`]) return;
        problems.push(
          `#${i} ${rec.cmd}\n` +
            (got.out !== rec.out ? `  stdout expected:\n${rec.out}\n  stdout got:\n${got.out}\n` : '') +
            (got.err !== rec.err ? `  stderr expected:\n${rec.err}\n  stderr got:\n${got.err}\n` : '') +
            (got.exit !== rec.exit ? `  exit expected ${rec.exit}, got ${got.exit}\n` : ''),
        );
      });
      expect(problems.join('\n')).toBe('');
    });
  }
});
