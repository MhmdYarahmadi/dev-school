import { useState } from 'react';
import type { SandboxEnv } from '../../../content/types';
import { sandbox } from '../check';
import type { GitMachine } from '../engine';
import { Workspace } from './Workspace';

/** Starting points: an empty folder, a project with some history, or a team repository with Sam on the hub. */
const STARTS: { id: string; label: string; note: string; env: SandboxEnv }[] = [
  { id: 'empty', label: '📁 Empty folder', note: 'A fresh machine: try git init, add, commit.', env: { setup: ['mkdir project', 'cd project'] } },
  {
    id: 'history',
    label: '🌳 Project with history',
    note: 'A small website with a few commits and a feature branch.',
    env: {
      setup: [
        'git init -q site',
        'cd site',
        'echo "<h1>Shop</h1>" > index.html',
        'git add .',
        'git commit -qm "Add home page"',
        'echo "body { font-family: sans-serif; }" > style.css',
        'git add .',
        'git commit -qm "Add styles"',
        'git switch -qc about',
        'echo "<h1>About us</h1>" > about.html',
        'git add .',
        'git commit -qm "Add about page"',
        'git switch -q main',
        'echo "<p>Welcome!</p>" >> index.html',
        'git commit -qam "Welcome text"',
      ],
    },
  },
  {
    id: 'team',
    label: '👥 Team repository',
    note: 'You and Sam share team/shop on the hub. Make Sam push with @sam, e.g. @sam git push.',
    env: {
      setup: [
        '@hub init team/shop',
        '@sam git clone -q https://hub.zilber.tech/team/shop.git',
        '@sam cd shop',
        '@sam echo "<h1>Shop</h1>" > index.html',
        '@sam git add .',
        '@sam git commit -qm "Add home page"',
        '@sam git push -q',
        'git clone -q https://hub.zilber.tech/team/shop.git',
        'cd shop',
      ],
    },
  },
];

// Kept for the whole visit, so leaving the page and coming back keeps your work.
let saved: { start: string; machine: GitMachine } | null = null;

/** A free sandbox: a terminal with the live graph, the three areas, the hub and the files. */
export default function GitPlayground() {
  if (!saved) saved = { start: 'history', machine: sandbox(STARTS[1].env) };
  const [state, setState] = useState(saved);
  const [key, setKey] = useState(0);
  const pick = (id: string) => {
    const s = STARTS.find((x) => x.id === id)!;
    saved = { start: id, machine: sandbox(s.env) };
    setState(saved);
    setKey((k) => k + 1);
  };
  const start = STARTS.find((s) => s.id === state.start)!;
  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0 }}>🧪 Playground</h1>
        <div className="grow" />
        {STARTS.map((s) => (
          <button key={s.id} className={`btn small ${s.id === state.start ? 'primary' : 'ghost'}`} onClick={() => pick(s.id)} title="Start again from here">
            {s.label}
          </button>
        ))}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        A simulated computer with real Git behaviour, all yours. Nothing here is graded. {start.note} Lines starting with <code>@sam</code> run on your teammate Sam's computer.
      </p>
      <Workspace key={key} machine={state.machine} height={460} views={['graph', 'areas', 'hub', 'files']} suggestions={['git status', 'git log --oneline --graph --all', 'git branch -a', 'ls']} />
    </div>
  );
}
