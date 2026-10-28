import { useEffect, useRef, useState } from 'react';
import type { GitMachine, Line } from '../engine';

const GIT = ['init', 'status', 'add', 'commit', 'log', 'diff', 'show', 'restore', 'rm', 'mv', 'branch', 'switch', 'checkout', 'merge', 'revert', 'clone', 'remote', 'fetch', 'pull', 'push', 'config', 'ls-files', 'help'];
const GH = ['pr create', 'pr list', 'pr view', 'pr diff', 'pr checkout', 'pr comment', 'pr review', 'pr merge', 'pr close', 'repo clone', 'repo view'];

export interface TermEntry {
  cmd: string;
  lines: Line[];
  code: number;
  /** Shown in the prompt before the command. */
  ps1?: string;
}

/** The prompt, like a shell with Git's prompt helper: `~/shop (main) $`. */
export function promptOf(m: GitMachine): string {
  const u = m.learner;
  const dir = u.cwd === u.home ? '~' : u.cwd.startsWith(u.home + '/') ? '~' + u.cwd.slice(u.home.length) : u.cwd;
  const r = m.repoAt(u);
  if (!r) return `${dir} $`;
  const where = r.branch ?? `(${r.headCommit()?.slice(0, 7) ?? 'HEAD'}...)`;
  const op = r.op ? `|${r.op.kind === 'merge' ? 'MERGING' : 'REVERTING'}` : '';
  return `${dir} (${r.branch ? where : where.slice(1, -1)}${op}) $`;
}

/** Colours Git would use in a terminal: diff lines, status sections, hashes. */
function tone(cmd: string, lines: Line[]): string[] {
  let section = '';
  let combined = false;
  const isDiff = /^git (diff|show|log)\b|^gh pr diff/.test(cmd);
  const isStatus = /^git (status|commit)\b/.test(cmd);
  return lines.map((l) => {
    const t = l.text;
    if (/^(CONFLICT|error:|fatal:|Automatic merge failed| ! \[)/.test(t)) return 'term-err';
    if (/^hint:/.test(t)) return 'term-dim';
    if (isStatus) {
      if (/^Changes to be committed:/.test(t)) section = 'term-ok';
      else if (/^(Changes not staged for commit|Untracked files|Unmerged paths):/.test(t)) section = 'term-err';
      if (t.startsWith('\t') && section) return section;
    }
    if (isDiff && l.kind === 'out') {
      if (/^diff --cc/.test(t)) combined = true;
      else if (/^diff --git/.test(t)) combined = false;
      if (/^(diff --|index |--- |\+\+\+ |new file|deleted file|similarity|rename (from|to))/.test(t)) return 'term-bold';
      if (/^@@/.test(t)) return 'term-info';
      const mark = combined ? t.slice(0, 2) : t.slice(0, 1);
      if (mark.includes('+')) return 'term-ok';
      if (mark.includes('-')) return 'term-err';
    }
    if (/^git (log|show)/.test(cmd) && /^[*|\\/ _]*(commit )?[0-9a-f]{7,40}\b/.test(t)) return 'term-sha';
    // Git writes ordinary progress ("Switched to branch…", "To https://…") to stderr too: only real problems are red.
    if (/^✓ /.test(t)) return 'term-ok';
    if (l.kind === 'err') return /^(warning:|Warning:)/.test(t) ? 'term-warn' : /^(remote: error|bash: |[\w-]+: .*(No such file|command not found|Is a directory|cannot|not a git|unknown))|Aborting|rejected|^\s*X |not mergeable|failed/.test(t) ? 'term-err' : 'term-line';
    return `term-${l.kind}`;
  });
}

interface Props {
  machine: GitMachine;
  entries: TermEntry[];
  onRun: (cmd: string) => void;
  onClear: () => void;
  height?: number | string;
  placeholder?: string;
  suggestions?: string[];
  disabled?: boolean;
}

/** An interactive terminal on the simulated machine (controlled: the workspace runs the commands). */
export function Terminal({ machine, entries, onRun, onClear, height = 340, placeholder, suggestions, disabled }: Props) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState<number | null>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight });
  }, [entries]);

  const run = (raw: string) => {
    const cmd = raw.trim();
    setInput('');
    setHIdx(null);
    if (!cmd) return;
    if (cmd === 'clear') {
      onClear();
      return;
    }
    setHistory((h) => [...h.filter((x) => x !== cmd), cmd]);
    onRun(cmd);
  };

  const complete = () => {
    const words = input.split(' ');
    const last = words[words.length - 1];
    let pool: string[];
    const r = machine.repoAt(machine.learner);
    const files = machine.learner.fs.list(machine.learner.cwd);
    if (words.length === 1) pool = ['git', 'gh', 'ls', 'cat', 'cd', 'echo', 'mkdir', 'touch', 'rm', 'clear'];
    else if (words[0] === 'git' && words.length === 2) pool = GIT;
    else if (words[0] === 'gh' && words.length === 2) pool = [...new Set(GH.map((g) => g.split(' ')[0]))];
    else if (words[0] === 'gh' && words.length === 3) pool = GH.filter((g) => g.startsWith(words[1] + ' ')).map((g) => g.split(' ')[1]);
    else if (words[0] === 'git' && /^(switch|checkout|merge|branch|push|pull|log|diff|rebase)$/.test(words[1])) pool = [...(r?.branches() ?? []), ...(r ? [...r.refs.keys()].filter((k) => k.startsWith('refs/remotes/')).map((k) => k.slice(13)) : []), ...(r?.remotes() ?? []), ...files];
    else pool = files;
    const hits = [...new Set(pool)].filter((p) => p.startsWith(last));
    if (hits.length === 1) setInput([...words.slice(0, -1), hits[0]].join(' ') + ' ');
    else if (hits.length > 1) {
      let pre = hits[0];
      for (const h of hits) while (!h.startsWith(pre)) pre = pre.slice(0, -1);
      if (pre.length > last.length) setInput([...words.slice(0, -1), pre].join(' '));
    }
  };

  const ps1 = promptOf(machine);
  return (
    <div className="term" style={{ height }} onClick={() => !window.getSelection()?.toString() && inRef.current?.focus()}>
      <div className="term-screen" ref={outRef} aria-live="polite">
        {entries.length === 0 && <div className="term-dim">{placeholder ?? 'Type a command and press Enter. Try: git status · Tab completes · ↑ recalls'}</div>}
        {entries.map((e, i) => {
          const tones = tone(e.cmd, e.lines);
          return (
            <div key={i}>
              <div className="term-cmd">
                <span className="term-ps1">{e.ps1 ?? '$'}</span> {e.cmd.includes('\n') ? e.cmd.split('\n')[0] + ' …' : e.cmd}
              </div>
              {e.lines.map((l, j) => (
                <div key={j} className={`term-line ${tones[j]}`}>
                  {l.text || ' '}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <form
        className="term-in"
        onSubmit={(ev) => {
          ev.preventDefault();
          run(input);
        }}
      >
        <span className="term-ps1">{ps1}</span>
        <input
          ref={inRef}
          value={input}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              complete();
            } else if (e.key === 'ArrowUp' && history.length) {
              e.preventDefault();
              const i = hIdx === null ? history.length - 1 : Math.max(0, hIdx - 1);
              setHIdx(i);
              setInput(history[i]);
            } else if (e.key === 'ArrowDown' && hIdx !== null) {
              e.preventDefault();
              const i = hIdx + 1;
              if (i >= history.length) {
                setHIdx(null);
                setInput('');
              } else {
                setHIdx(i);
                setInput(history[i]);
              }
            } else if (e.key === 'l' && e.ctrlKey) {
              e.preventDefault();
              onClear();
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Terminal input"
          placeholder={disabled ? '' : 'git …'}
        />
      </form>
      {suggestions && suggestions.length > 0 && (
        <div className="term-chips">
          {suggestions.map((s) => (
            <button key={s} type="button" className="chip-btn" onClick={() => run(s)} disabled={disabled}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Read-only terminal output. */
export function TranscriptView({ entries, maxHeight = 320 }: { entries: TermEntry[]; maxHeight?: number }) {
  if (!entries.length) return null;
  return (
    <div className="term static" style={{ maxHeight }}>
      <div className="term-screen">
        {entries.map((e, i) => {
          const tones = tone(e.cmd, e.lines);
          return (
            <div key={i}>
              <div className="term-cmd">
                <span className="term-ps1">{e.ps1 ?? '$'}</span> {e.cmd.includes('\n') ? e.cmd.split('\n')[0] + ' …' : e.cmd}
              </div>
              {e.lines.map((l, j) => (
                <div key={j} className={`term-line ${tones[j]}`}>
                  {l.text || ' '}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
