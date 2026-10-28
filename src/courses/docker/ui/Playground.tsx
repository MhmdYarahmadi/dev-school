import { useState } from 'react';
import { PROJECT, sandbox } from '../check';
import type { DockerEngine } from '../engine';
import { CodeEditor } from '../../../components/CodeEditor';
import { EngineView, Terminal } from './Terminal';

const STARTER: Record<string, string> = {
  'index.html': '<h1>Hello from my container!</h1>\n',
  'app.js': "const http = require('http');\nhttp.createServer((req, res) => res.end('hello from node\\n')).listen(3000);\nconsole.log('listening on 3000');\n",
  'package.json': '{\n  "name": "myapp",\n  "version": "1.0.0",\n  "main": "app.js"\n}\n',
  Dockerfile: 'FROM node:22-alpine\nWORKDIR /app\nCOPY package.json .\nRUN npm install\nCOPY . .\nEXPOSE 3000\nCMD ["node", "app.js"]\n',
  'compose.yaml': 'services:\n  web:\n    build: .\n    ports:\n      - "3000:3000"\n',
};

// Kept for the whole visit, so leaving the page and coming back keeps your containers.
let engine: DockerEngine | null = null;
const fresh = () => sandbox({ files: STARTER });

const langOf = (f: string) => (/Dockerfile/.test(f) ? 'dockerfile' : /\.ya?ml$/.test(f) ? 'yaml' : /\.sh$/.test(f) ? 'shell' : 'text');

/** A free sandbox: a terminal, a live view of the machine, and the project files. */
export default function DockerPlayground() {
  if (!engine) engine = fresh();
  const [e, setE] = useState(engine);
  const [version, setVersion] = useState(0);
  const [termKey, setTermKey] = useState(0);
  const projectFiles = () => Object.keys(e.files).filter((f) => f.startsWith(PROJECT + '/')).map((f) => f.slice(PROJECT.length + 1)).sort();
  const [open, setOpen] = useState('Dockerfile');
  const [newName, setNewName] = useState('');
  const bump = () => setVersion((v) => v + 1);

  const reset = () => {
    engine = fresh();
    setE(engine);
    setTermKey((k) => k + 1);
    setOpen('Dockerfile');
    bump();
  };

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0 }}>🧪 Playground</h1>
        <div className="grow" />
        <button className="btn ghost small" onClick={reset}>
          ↺ Reset machine
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        A simulated Docker machine, all yours. Nothing here is graded. Your project folder is <code>{PROJECT}</code>: edit the files on the right, then <code>docker build</code> or <code>docker compose up</code>. Type <code>help</code> to see what the simulator understands.
      </p>
      <div className="playground-grid">
        <div className="stack" style={{ gap: 8, minWidth: 0 }}>
          <Terminal key={termKey} engine={e} height={420} onCommand={bump} suggestions={['docker ps -a', 'docker images', 'docker build -t myapp .', 'docker run -d -p 3000:3000 --name app myapp', 'curl localhost:3000']} />
          <EngineView engine={e} version={version} />
        </div>
        <div className="stack" style={{ gap: 8, minWidth: 0 }}>
          <div className="files-tabs">
            {projectFiles().map((f) => (
              <button key={f} type="button" className={`files-tab ${f === open ? 'on' : ''}`} onClick={() => setOpen(f)}>
                {f}
              </button>
            ))}
          </div>
          {e.files[`${PROJECT}/${open}`] !== undefined && (
            <CodeEditor
              key={open + termKey}
              value={e.files[`${PROJECT}/${open}`]}
              lang={langOf(open)}
              minHeight="260px"
              onChange={(v) => {
                e.files[`${PROJECT}/${open}`] = v;
              }}
            />
          )}
          <form
            className="row"
            onSubmit={(ev) => {
              ev.preventDefault();
              const n = newName.trim().replace(/^\/+/, '');
              if (!n) return;
              if (e.files[`${PROJECT}/${n}`] === undefined) e.files[`${PROJECT}/${n}`] = '';
              setOpen(n);
              setNewName('');
              bump();
            }}
          >
            <input className="input" placeholder="new file, e.g. .dockerignore" value={newName} onChange={(ev) => setNewName(ev.target.value)} />
            <button className="btn small">+ Add file</button>
            {open !== 'Dockerfile' && open !== 'compose.yaml' && (
              <button
                type="button"
                className="btn ghost small"
                onClick={() => {
                  delete e.files[`${PROJECT}/${open}`];
                  setOpen('Dockerfile');
                  bump();
                }}
              >
                🗑 Delete {open}
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
