import { motion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DockerEngine } from '../engine';
import type { Line } from '../engine/types';

const SUBCOMMANDS = ['run', 'ps', 'images', 'pull', 'stop', 'start', 'restart', 'rm', 'rmi', 'logs', 'exec', 'inspect', 'port', 'build', 'history', 'tag', 'volume', 'network', 'compose', 'system', 'container', 'image', 'kill', 'create', 'version'];

export interface TermEntry {
  cmd: string;
  lines: Line[];
  code: number;
}

interface Props {
  engine: DockerEngine;
  /** Called after each command (e.g. to refresh an engine view or record the journal). */
  onCommand?: (cmd: string, code: number) => void;
  height?: number | string;
  placeholder?: string;
  initial?: TermEntry[];
  /** Commands shown as clickable chips under the prompt. */
  suggestions?: string[];
  disabled?: boolean;
  prompt?: string;
}

/** An interactive terminal driven by the simulated engine. */
export function Terminal({ engine, onCommand, height = 320, placeholder, initial = [], suggestions, disabled, prompt = '$' }: Props) {
  const [entries, setEntries] = useState<TermEntry[]>(initial);
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
    if (!cmd) return;
    if (cmd === 'clear') {
      setEntries([]);
      setInput('');
      return;
    }
    const r = engine.exec(cmd);
    setEntries((e) => [...e, { cmd, lines: r.lines, code: r.exitCode }]);
    setHistory((h) => [...h.filter((x) => x !== cmd), cmd]);
    setHIdx(null);
    setInput('');
    onCommand?.(cmd, r.exitCode);
  };

  const complete = () => {
    const words = input.split(' ');
    const last = words[words.length - 1];
    let pool: string[] = [];
    if (words.length === 1) pool = ['docker', 'ls', 'cat', 'curl', 'cd', 'sleep', 'clear', 'help'];
    else if (words[0] === 'docker' && words.length === 2) pool = SUBCOMMANDS;
    else if (words[0] === 'docker') {
      pool = [
        ...engine.state.containers.map((c) => c.name),
        ...engine.state.images.flatMap((i) => i.tags.map((t) => (t === 'latest' ? i.repo : `${i.repo}:${t}`))),
        ...engine.state.volumes.map((v) => v.name),
        ...engine.state.networks.filter((n) => !n.builtIn).map((n) => n.name),
      ];
    } else pool = Object.keys(engine.files).map((f) => f.replace(engine.cwd + '/', ''));
    const hits = [...new Set(pool)].filter((p) => p.startsWith(last));
    if (hits.length === 1) setInput([...words.slice(0, -1), hits[0]].join(' ') + ' ');
    else if (hits.length > 1) {
      // Longest common prefix.
      let pre = hits[0];
      for (const h of hits) while (!h.startsWith(pre)) pre = pre.slice(0, -1);
      if (pre.length > last.length) setInput([...words.slice(0, -1), pre].join(' '));
    }
  };

  return (
    <div className="term" style={{ height }} onClick={() => !window.getSelection()?.toString() && inRef.current?.focus()}>
      <div className="term-screen" ref={outRef} aria-live="polite">
        {entries.length === 0 && <div className="term-dim">{placeholder ?? 'Type a command and press Enter. Try: docker run hello-world · Tab completes · ↑ recalls'}</div>}
        {entries.map((e, i) => (
          <div key={i}>
            <div className="term-cmd">
              <span className="term-ps1">{prompt}</span> {e.cmd}
            </div>
            {e.lines.map((l, j) => (
              <div key={j} className={`term-line term-${l.kind}`}>
                {l.text || ' '}
              </div>
            ))}
          </div>
        ))}
      </div>
      <form
        className="term-in"
        onSubmit={(ev) => {
          ev.preventDefault();
          run(input);
        }}
      >
        <span className="term-ps1">{prompt}</span>
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
              setEntries([]);
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Terminal input"
          placeholder={disabled ? '' : 'docker …'}
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

/** Live picture of the engine: images, containers, volumes, networks. */
export function EngineView({ engine, version, compact }: { engine: DockerEngine; version: number; compact?: boolean }) {
  void version; // re-render trigger
  const s = engine.state;
  const box = (title: string, count: number, children: ReactNode) => (
    <div className="ev-col">
      <div className="ev-head">
        {title} <span className="tag">{count}</span>
      </div>
      <div className="ev-list">{children}</div>
    </div>
  );
  const ports = (c: (typeof s.containers)[number]) => engine.portsText(c);
  return (
    <div className={`engine-view ${compact ? 'compact' : ''}`}>
      {box(
        'Containers',
        s.containers.length,
        s.containers.length ? (
          s.containers.map((c) => (
            <motion.div key={c.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className={`ev-card ctr ${c.status}`}>
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <span className={`dot ${c.status}`} />
                <b className="mono ev-name">{c.name}</b>
                <span className="small muted" style={{ marginLeft: 'auto' }}>
                  {c.status === 'running' ? `Up${c.health ? ` · ${c.health}` : ''}` : c.status === 'exited' ? `Exited (${c.exitCode})` : c.status === 'restarting' ? 'Restarting' : 'Created'}
                </span>
              </div>
              <div className="small muted mono ev-sub">
                {c.image}
                {ports(c) && ` · ${ports(c).split(', ').filter((p) => !p.startsWith('[::]')).join(', ')}`}
              </div>
              {!compact && (c.mounts.length > 0 || c.networks.some((n) => n !== 'bridge')) && (
                <div className="small mono ev-sub">
                  {c.mounts.map((m) => (
                    <span key={m.target} className="tag warn" style={{ marginRight: 4 }}>
                      {m.type === 'bind' ? '📁' : '💾'} {/^[0-9a-f]{64}$/.test(m.source) ? 'anon' : m.source}:{m.target}
                      {m.readOnly ? ':ro' : ''}
                    </span>
                  ))}
                  {c.networks.filter((n) => n !== 'bridge').map((n) => (
                    <span key={n} className="tag accent" style={{ marginRight: 4 }}>
                      🔌 {n}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          ))
        ) : (
          <div className="ev-empty">No containers</div>
        ),
      )}
      {box(
        'Images',
        s.images.reduce((n, i) => n + Math.max(1, i.tags.length), 0),
        s.images.length ? (
          s.images.flatMap((i) =>
            (i.tags.length ? i.tags : ['<none>']).map((t) => (
              <div key={i.id + t} className="ev-card img">
                <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <span className="dot image" />
                  <span className="mono ev-name">
                    {i.tags.length ? `${i.repo}:${t}` : '<none>:<none>'}
                  </span>
                  <span className="small muted" style={{ marginLeft: 'auto' }}>
                    {i.size >= 100 ? Math.round(i.size) : i.size.toFixed(1)} MB
                  </span>
                </div>
                {!compact && (
                  <div className="ev-layers">
                    {i.layers.filter((l) => l.size > 0).slice(-6).map((l, k) => (
                      <div key={k} className="ev-layer" title={l.createdBy} style={{ width: `${Math.max(12, Math.min(100, Math.log10(1 + l.size * 10) * 40))}%` }} />
                    ))}
                  </div>
                )}
              </div>
            )),
          )
        ) : (
          <div className="ev-empty">No images</div>
        ),
      )}
      <div className="ev-col">
        <div className="ev-head">
          Volumes <span className="tag">{s.volumes.length}</span>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {s.volumes.length ? s.volumes.map((v) => <span key={v.name} className="tag warn mono">💾 {/^[0-9a-f]{64}$/.test(v.name) ? v.name.slice(0, 12) : v.name}</span>) : <span className="ev-empty">none</span>}
        </div>
        <div className="ev-head" style={{ marginTop: 8 }}>
          Networks <span className="tag">{s.networks.length}</span>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {s.networks.map((n) => (
            <span key={n.name} className={`tag mono ${n.builtIn ? '' : 'accent'}`}>
              🔌 {n.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
