import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SandboxEnv } from '../../../content/types';
import { answerCommands, sandbox } from '../check';
import { machineGraphs } from './graphLayout';
import { GraphView } from './GraphView';
import { promptOf, type TermEntry } from './Terminal';
import { Workspace, type View } from './Workspace';

/** Runs every command of `code` on a fresh machine prepared by `env`. */
function runAll(code: string, env?: SandboxEnv) {
  const machine = sandbox(env);
  const entries: TermEntry[] = answerCommands(code).map((cmd) => {
    const ps1 = promptOf(machine);
    const r = machine.exec(cmd);
    return { cmd, lines: r.lines, code: r.exitCode, ps1 };
  });
  return { machine, entries };
}

function viewsFor(code: string, env?: SandboxEnv): View[] {
  const all = code + (env?.setup ?? []).join('\n');
  const v: View[] = /\bgit (add|restore|rm)\b|\bgit status\b/.test(code) && !/\bgit (merge|switch|branch)\b/.test(code) ? ['areas', 'graph'] : ['graph', 'areas'];
  if (/@hub|clone|push|pull|fetch|gh /.test(all)) v.splice(1, 0, 'hub');
  v.push('files');
  return v;
}

/** The example after running, in a live workspace the learner can keep typing into. */
function LiveResult({ code, env, height = 320 }: { code: string; env?: SandboxEnv; height?: number }) {
  const { machine, entries } = useMemo(() => runAll(code, env), [code, env]);
  return <Workspace machine={machine} initial={entries} height={height} views={viewsFor(code, env)} />;
}

/** Learn tab: the worked example. Running it opens a terminal to keep experimenting. */
export function GitExampleRunner({ code, disabled, env }: { code: string; disabled?: boolean; env?: SandboxEnv }) {
  const [runKey, setRunKey] = useState(0);
  return (
    <>
      <pre style={{ margin: 0 }}>{code}</pre>
      <div className="row">
        <button className="btn" disabled={disabled} onClick={() => setRunKey((k) => k + 1)}>
          ▶ {runKey ? 'Run again (fresh machine)' : 'Run example'}
        </button>
        <Link className="small" to="/playground">
          Experiment in the playground →
        </Link>
      </div>
      {runKey > 0 && <LiveResult key={runKey} code={code} env={env} />}
    </>
  );
}

/** Before predicting: the commands, and the repository they start from (if there is one). */
export function GitPredictSetup({ code, env }: { code: string; env?: SandboxEnv }) {
  const graphs = useMemo(() => machineGraphs(sandbox(env)), [env]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {graphs.length > 0 && (
        <details open>
          <summary className="small muted">The repository before these commands</summary>
          <GraphView graphs={graphs} />
        </details>
      )}
      <pre style={{ margin: 0 }}>{code}</pre>
    </div>
  );
}

/** After a prediction: what really happens. */
export function GitPredictResult({ code, env }: { code: string; env?: SandboxEnv }) {
  return <LiveResult code={code} env={env} height={260} />;
}
