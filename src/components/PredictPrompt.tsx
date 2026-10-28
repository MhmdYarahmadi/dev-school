import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { PredictPrompt as Predict, SandboxEnv } from '../content/types';
import { course } from '../shared/course';

/** "What will this return?" Commit to a guess, then run it and compare. */
export function PredictPrompt({ predict, onAnswered, env }: { predict: Predict; onAnswered?: (correct: boolean) => void; env?: SandboxEnv }) {
  const [picked, setPicked] = useState<number | null>(null);
  const { PredictResult, PredictSetup } = course().ui;

  const pick = (i: number) => {
    if (picked !== null) return;
    setPicked(i);
    onAnswered?.(i === predict.answer);
  };

  return (
    <div className="card" style={{ background: 'var(--surface-2)' }}>
      <div className="row"><span className="tag accent">Predict first</span><span className="small muted">Guessing wrong is fine. It's how this sticks.</span></div>
      {PredictSetup ? <PredictSetup code={predict.sql} env={env} /> : <pre>{predict.sql}</pre>}
      <div className="predict-q" style={{ margin: '6px 0', fontWeight: 600 }}><ReactMarkdown>{predict.question ?? 'What will happen?'}</ReactMarkdown></div>
      <div className="choices">
        {predict.choices.map((c, i) => {
          const cls = picked === null ? '' : i === predict.answer ? 'right' : i === picked ? 'wrong' : '';
          return (
            <button key={i} className={`choice ${cls}`} disabled={picked !== null} onClick={() => pick(i)}>
              {c}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div style={{ marginTop: 10 }}>
          <div className={`callout ${picked === predict.answer ? 'good' : 'warn'}`}>
            <p><b>{picked === predict.answer ? '✓ Nice prediction!' : 'Not quite. Here is what really happens:'}</b> <ReactMarkdown components={{ p: 'span' }}>{predict.why}</ReactMarkdown></p>
          </div>
          <div style={{ marginTop: 8 }}><PredictResult code={predict.sql} env={env} /></div>
        </div>
      )}
    </div>
  );
}
