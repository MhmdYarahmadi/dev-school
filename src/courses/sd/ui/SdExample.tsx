import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { designToYaml } from '../engine';
import { scenarioFromYaml } from '../engine/scenario';
import { Lab } from './Lab';

function useScenario(code: string) {
  return useMemo(() => {
    const p = scenarioFromYaml(code);
    if (!p.scenario) return { errors: p.errors };
    const { design, ...run } = p.scenario;
    return { design: designToYaml(design), run, errors: [] };
  }, [code]);
}

function Broken({ errors }: { errors: string[] }) {
  return <div className="callout bad small">This example can't be read: {errors.join(' ')}</div>;
}

/** Learn tab: the worked example is a scenario; the learner runs it, changes it and runs it again. */
export function SdExampleRunner({ code, disabled }: { code: string; disabled?: boolean }) {
  const s = useScenario(code);
  if (!s.design) return <Broken errors={s.errors} />;
  return (
    <div className="stack" style={{ gap: 8, pointerEvents: disabled ? 'none' : undefined }} aria-disabled={disabled}>
      <Lab key={code} initial={s.design} run={s.run} height={320} />
      <Link className="small" to="/sandbox">
        Build your own in the sandbox →
      </Link>
    </div>
  );
}

/** After a prediction: run the scenario straight away and show what really happens. */
export function SdPredictResult({ code }: { code: string }) {
  const s = useScenario(code);
  if (!s.design) return <Broken errors={s.errors} />;
  return <Lab key={code} initial={s.design} run={s.run} autoRun height={280} />;
}
