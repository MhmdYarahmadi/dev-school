import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SandboxEnv } from '../../../content/types';
import { answerLines, sandbox } from '../check';
import { EngineView, Terminal, type TermEntry } from './Terminal';
import { FilesView } from './Transcript';

/** Run every line of `code` on a fresh sandbox. */
function runAll(code: string, env?: SandboxEnv) {
  const engine = sandbox(env);
  const entries: TermEntry[] = answerLines(code).map((cmd) => {
    const r = engine.exec(cmd);
    return { cmd, lines: r.lines, code: r.exitCode };
  });
  return { engine, entries };
}

/** The ran example, in a live terminal the learner can keep typing into. */
function LiveResult({ code, env, height = 300 }: { code: string; env?: SandboxEnv; height?: number }) {
  const { engine, entries } = useMemo(() => runAll(code, env), [code, env]);
  const [version, setVersion] = useState(0);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Terminal engine={engine} initial={entries} height={height} onCommand={() => setVersion((v) => v + 1)} />
      <EngineView engine={engine} version={version} compact />
    </div>
  );
}

/** Learn tab: the worked example. Running it opens a terminal to keep experimenting. */
export function DockerExampleRunner({ code, disabled, env }: { code: string; disabled?: boolean; env?: SandboxEnv }) {
  const [runKey, setRunKey] = useState(0);
  return (
    <>
      {env?.files && <FilesView files={env.files} />}
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

/** After a prediction: what really happens. */
export function DockerPredictResult({ code, env }: { code: string; env?: SandboxEnv }) {
  return <LiveResult code={code} env={env} height={240} />;
}
