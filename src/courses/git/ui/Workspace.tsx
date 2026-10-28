import { useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor } from '../../../components/CodeEditor';
import type { GitMachine } from '../engine';
import type { GitEvent } from '../engine/types';
import { worktreeFiles } from '../engine/worktree';
import { saveCommand } from '../check';
import { AreasView } from './AreasView';
import { describeEvents, machineGraphs, type GraphData } from './graphLayout';
import { GraphView, type Arrivals } from './GraphView';
import { HubView } from './HubView';
import { promptOf, Terminal, type TermEntry } from './Terminal';
import { mark, t } from '../../../shared/i18n';
import { T } from '../../../shared/T';

export type View = 'graph' | 'areas' | 'hub' | 'files';
const LABELS: Record<View, string> = { graph: mark('🌳 Graph'), areas: mark('📋 Areas'), hub: mark('🌐 Hub'), files: mark('✏️ Files') };

/** Which commits fly in from where, after a push or fetch. */
function arrivalsOf(events: GitEvent[]): Record<string, Arrivals> {
  const out: Record<string, Arrivals> = {};
  for (const e of events) {
    if (e.type !== 'transfer') continue;
    const side = e.kind === 'push' ? 'left' : 'right';
    out[e.to] ??= {};
    for (const c of e.commits) out[e.to][c] = side;
  }
  return out;
}

/** Edit files of the current repository (or folder); saving runs `cat > file` in the terminal. */
function FilesPanel({ machine, version, run }: { machine: GitMachine; version: number; run: (cmd: string) => void }) {
  void version;
  const u = machine.learner;
  const r = machine.repoAt(u);
  const base = r?.root ?? u.cwd;
  const files = r ? [...worktreeFiles(u.fs, r).keys()] : u.fs.walk(base);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const rel = (p: string) => {
    const abs = `${base}/${p}`;
    return abs.startsWith(u.cwd + '/') ? abs.slice(u.cwd.length + 1) : abs.startsWith(u.home + '/') ? '~/' + abs.slice(u.home.length + 1) : abs;
  };
  const edit = (p: string) => {
    setOpen(p);
    setText(u.fs.read(`${base}/${p}`) ?? '');
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="small muted">
        <T text={t('Files in {dir}. Saving runs a {cmd} command in the terminal, like saving in an editor.')} vars={{ dir: <span className="mono">{base.startsWith(u.home) ? '~' + base.slice(u.home.length) : base}</span>, cmd: <code>cat &gt; file</code> }} />
      </div>
      <div className="files-tabs">
        {files.map((f) => (
          <button key={f} type="button" className={`files-tab ${f === open ? 'on' : ''}`} onClick={() => edit(f)}>
            {f}
          </button>
        ))}
        {!files.length && <span className="ev-empty">{t('no files yet')}</span>}
      </div>
      {open !== null && (
        <>
          <CodeEditor key={open} value={text} onChange={setText} lang="text" minHeight="160px" />
          {/^<<<<<<< |^=======$|^>>>>>>> /m.test(text) && <div className="small warn-text">{t('⚠️ This file still has conflict markers. Keep the lines you want and delete the three marker lines.')}</div>}
          <div className="row">
            <button
              className="btn small primary"
              onClick={() => {
                run(saveCommand(rel(open), text));
                setOpen(null);
              }}
            >
              {t('💾 Save {file}', { file: open })}
            </button>
            <button className="btn small ghost" onClick={() => setOpen(null)}>
              {t('Cancel')}
            </button>
          </div>
        </>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim().replace(/^\/+/, '');
          if (!n) return;
          setName('');
          setOpen(n);
          setText(u.fs.read(`${base}/${n}`) ?? '');
        }}
      >
        <input className="input" placeholder={t('new file, e.g. notes.txt')} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn small">{t('+ New file')}</button>
      </form>
    </div>
  );
}

interface Props {
  machine: GitMachine;
  /** Commands already run (shown in the terminal). */
  initial?: TermEntry[];
  views?: View[];
  height?: number;
  onCommand?: (cmd: string, code: number) => void;
  suggestions?: string[];
  disabled?: boolean;
  placeholder?: string;
}

/** A terminal on the simulated machine, beside the live graph, the three areas, the hub and the files. */
export function Workspace({ machine, initial = [], views = ['graph', 'areas', 'files'], height = 380, onCommand, suggestions, disabled, placeholder }: Props) {
  const [entries, setEntries] = useState<TermEntry[]>(initial);
  const [version, setVersion] = useState(0);
  const [events, setEvents] = useState<GitEvent[]>([]);
  const [tab, setTab] = useState<View>(views[0]);
  const [replay, setReplay] = useState<GraphData[] | null>(null);
  const [slow, setSlow] = useState(false);
  const before = useRef<GraphData[]>([]);
  const graphs = useMemo(() => machineGraphs(machine), [machine, version]);
  const hasHub = machine.hub.repos.size > 0;
  const tabs = views.filter((v) => v !== 'hub' || hasHub);

  useEffect(() => {
    if (tab === 'hub' && !hasHub) setTab(views[0]);
  }, [hasHub, tab, views]);

  const run = (cmd: string) => {
    before.current = machineGraphs(machine);
    const ps1 = promptOf(machine);
    const r = machine.exec(cmd);
    setEntries((e) => [...e, { cmd, lines: r.lines, code: r.exitCode, ps1 }]);
    setEvents(r.events);
    setReplay(null);
    setSlow(false);
    setVersion((v) => v + 1);
    // Show the hub when a command changed something there.
    if (r.events.some((e) => e.type === 'pr') && views.includes('hub')) setTab('hub');
    onCommand?.(cmd, r.exitCode);
  };

  const doReplay = () => {
    setReplay(before.current);
    setSlow(true);
    setTimeout(() => setReplay(null), 450);
  };

  const caption = describeEvents(events);
  return (
    <div className="workspace">
      <div className="ws-term">
        <Terminal machine={machine} entries={entries} onRun={run} onClear={() => setEntries([])} height={height} suggestions={suggestions} disabled={disabled} placeholder={placeholder} />
      </div>
      <div className="ws-side">
        {tabs.length > 1 && (
          <div className="ws-tabs" role="tablist">
            {tabs.map((v) => (
              <button key={v} type="button" role="tab" aria-selected={tab === v} className={`ws-tab ${tab === v ? 'on' : ''}`} onClick={() => setTab(v)}>
                {t(LABELS[v])}
              </button>
            ))}
          </div>
        )}
        <div className="ws-panel">
          {tab === 'graph' && <GraphView graphs={replay ?? graphs} arrivals={replay ? undefined : Object.fromEntries(Object.entries(arrivalsOf(events)))} slow={slow} />}
          {tab === 'areas' && <AreasView machine={machine} version={version} />}
          {tab === 'hub' && <HubView machine={machine} version={version} run={run} />}
          {tab === 'files' && <FilesPanel machine={machine} version={version} run={run} />}
        </div>
        {caption.length > 0 && (
          <div className="ws-caption small">
            <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
              <b>{t('What the last command did')}</b>
              {tab === 'graph' && (
                <button type="button" className="btn ghost small" onClick={doReplay} title={t('Show the graph before the last command, then play the change slowly')}>
                  {t('▶ Replay')}
                </button>
              )}
            </div>
            {caption.map((c, i) => (
              <div key={i}>{c}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
