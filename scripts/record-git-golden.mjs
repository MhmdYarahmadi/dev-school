#!/usr/bin/env node
/**
 * Records real Git output for the Git course's golden test.
 *   node scripts/record-git-golden.mjs tests/git-golden-sessions.txt > tests/fixtures-git.txt
 *
 * Each session in the input starts with "### SESSION name". Lines:
 *   $ command            run as the learner (cwd starts at /home/learner)
 *   @sam command         run as the teammate Sam (cwd starts at /home/sam)
 *   @hub init team/repo  create an empty repository on the hub (main as default branch)
 * Every command runs in bash with a fixed clock that advances 60 s per line, exactly
 * like the simulator, so commit hashes match. The hub is a folder of bare repositories:
 * Git reaches it under its real https://hub.zilber.tech/ URL through a stand-in for Git's
 * https helper (git-remote-https → git-remote-ext → local upload-pack/receive-pack), so
 * URLs in output and in merge messages are the real ones. Paths are rewritten back to
 * /home/... in the output. stdout and stderr are kept apart: through a
 * pipe Git buffers stdout, so their interleaving wouldn't match a terminal anyway.
 * Lines starting with "> " after a command are its here-document body.
 *
 * Run it with TMPDIR on a normal disk (not a tmpfs mount), otherwise Git's "not a git
 * repository" message mentions the mount point.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const START = 1767603600; // Mon Jan 5 2026 09:00:00 UTC
export const HUB = 'https://hub.zilber.tech/';
const NAMES = { learner: ['Alex Learner', 'alex@example.com'], sam: ['Sam Rivera', 'sam@example.com'] };

function setup(T) {
  for (const [user, [name, email]] of Object.entries(NAMES)) {
    mkdirSync(join(T, 'home', user), { recursive: true });
    writeFileSync(
      join(T, 'home', user, '.gitconfig'),
      `[user]\n\tname = ${name}\n\temail = ${email}\n[init]\n\tdefaultBranch = main\n[pull]\n\trebase = false\n[log]\n\tdecorate = short\n[protocol "ext"]\n\tallow = always\n`,
    );
  }
  mkdirSync(join(T, 'hub'), { recursive: true });
  // Git's own programs, with the https helper replaced by one that serves the local hub.
  const real = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim();
  const exec = join(T, 'exec');
  mkdirSync(exec);
  for (const f of readdirSync(real)) if (f !== 'git-remote-https') symlinkSync(join(real, f), join(exec, f));
  const helper = join(exec, 'git-remote-https');
  writeFileSync(helper, `#!/bin/sh\np=$(echo "$2" | sed -e 's|^${HUB}||' -e 's|\\.git$||')\nexec "${real}/git-remote-ext" "$1" "git-%s ${T}/hub/$p.git"\n`);
  chmodSync(helper, 0o755);
  return exec;
}

function run(input) {
  const sessions = [];
  let cur = null;
  for (const raw of input.split('\n')) {
    if (raw.startsWith('### SESSION ')) sessions.push((cur = { name: raw.slice(12).trim(), lines: [] }));
    else if (cur && /^(\$ |@\w+ )/.test(raw)) cur.lines.push(raw);
    else if (cur && /^>( |$)/.test(raw) && cur.lines.length) cur.lines[cur.lines.length - 1] += '\n' + raw.slice(2); // heredoc bodies
  }
  const out = [];
  for (const s of sessions) {
    const T = mkdtempSync(join(tmpdir(), 'zs-gitrec-'));
    const exec = setup(T);
    const cwd = { learner: join(T, 'home/learner'), sam: join(T, 'home/sam') };
    out.push(`### SESSION ${s.name}`);
    s.lines.forEach((line, i) => {
      const time = START + 60 * (i + 1);
      const m = /^(\$|@(\w+)) ([\s\S]*)$/.exec(line);
      const user = m[2] && m[2] !== 'hub' ? m[2] : 'learner';
      let cmd = m[3];
      if (m[2] === 'hub') {
        const [verb, repo] = cmd.split(/\s+/);
        if (verb !== 'init') throw new Error(`unknown hub command: ${cmd}`);
        cmd = `git init -q --bare -b main ${T}/hub/${repo}.git`;
      }
      const script = `cd "${cwd[user]}" && { ${cmd}\n}; rc=$?; pwd > "${T}/.cwd"; exit $rc`;
      const res = spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, GIT_EXEC_PATH: exec, HOME: join(T, 'home', user), LANG: 'C', LC_ALL: 'C', TERM: 'dumb', GIT_PAGER: 'cat', PAGER: 'cat', GIT_EDITOR: 'true', GIT_AUTHOR_DATE: `@${time} +0000`, GIT_COMMITTER_DATE: `@${time} +0000`, GIT_CONFIG_NOSYSTEM: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      cwd[user] = readFileSync(join(T, '.cwd'), 'utf8').trim();
      const norm = (t) => t.split(T).join('');
      const [head, ...body] = line.slice(m[1].length + 1).split('\n');
      out.push(`### ${m[2] ? '@' + m[2] : '$'} ${head}`, ...body.map((b) => `### > ${b}`));
      const stdout = norm(res.stdout);
      const stderr = norm(res.stderr);
      if (stdout) out.push(stdout.replace(/\n$/, ''));
      if (stderr) out.push('### STDERR', stderr.replace(/\n$/, ''));
      out.push(`### EXIT ${res.status}`);
    });
    rmSync(T, { recursive: true, force: true });
  }
  return out.join('\n') + '\n';
}

process.stdout.write(run(readFileSync(process.argv[2], 'utf8')));
