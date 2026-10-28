import { useEffect, useMemo } from 'react';
import { designToYaml } from '../engine';
import { scenarioFromYaml } from '../engine/scenario';
import { DesignEditor } from './DesignEditor';
import { RunSummary, useSimRun } from './Lab';
import { RunPanel } from './RunPanel';

/**
 * A scenario shown read-only: the design, the run in words and, with `autoRun`, what happened.
 * Used by diagnose questions (the run is the evidence) and before a prediction (no run yet).
 */
export function ScenarioView({ code, autoRun, height = 260 }: { code: string; autoRun?: boolean; height?: number }) {
  const parsed = useMemo(() => scenarioFromYaml(code), [code]);
  const sim = useSimRun();
  const s = parsed.scenario;
  useEffect(() => {
    if (autoRun && s) {
      const { design, ...run } = s;
      void sim.run(design, run);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, autoRun]);
  if (!s) return <pre style={{ whiteSpace: 'pre-wrap' }}>{code}</pre>;
  const { design, ...run } = s;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <DesignEditor value={designToYaml(design)} mode="view" stats={sim.outcome?.result?.nodes} height={height} />
      <RunSummary run={run} />
      {autoRun && sim.running && (
        <div className="small muted">
          <span className="sd-spinner" /> Running the simulation…
        </div>
      )}
      {sim.error && <div className="callout bad small">{sim.error}</div>}
      {sim.outcome?.result && <RunPanel result={sim.outcome.result} checks={sim.outcome.checks} run={run} />}
    </div>
  );
}

/** Before a prediction: just the setup, nothing run yet. */
export function SdPredictSetup({ code }: { code: string }) {
  return <ScenarioView code={code} height={240} />;
}
