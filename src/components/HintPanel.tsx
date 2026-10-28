import { useState } from 'react';
import { t } from '../shared/i18n';

interface Props {
  hints: string[];
  shown: number;
  onShowHint: () => void;
  solution: string;
  explanation: string;
  failedAttempts: number;
  sawSolution: boolean;
  onShowSolution: () => void;
}

/**
 * Hints escalate (nudge → concept → partial query). The solution unlocks only
 * after every hint has been seen or two failed attempts, and asks for confirmation.
 */
export function HintPanel({ hints, shown, onShowHint, solution, explanation, failedAttempts, sawSolution, onShowSolution }: Props) {
  const [confirming, setConfirming] = useState(false);
  const solutionUnlocked = shown >= hints.length || failedAttempts >= 2;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {hints.slice(0, shown).map((h, i) => (
        <div key={i} className="callout info small">
          <b>{t('Hint {n}:', { n: i + 1 })}</b> {h}
        </div>
      ))}
      <div className="row">
        {shown < hints.length && (
          <button className="btn small" onClick={onShowHint}>
            💡 {shown === 0 ? t('Get a hint') : t('Another hint')} ({shown}/{hints.length})
          </button>
        )}
        {!sawSolution && !confirming && (
          <button
            className="btn small ghost"
            disabled={!solutionUnlocked}
            title={solutionUnlocked ? '' : t('Unlocks after all hints or 2 tries')}
            onClick={() => setConfirming(true)}
          >
            {solutionUnlocked ? t('Show solution') : t('🔒 Solution')}
          </button>
        )}
      </div>
      {confirming && !sawSolution && (
        <div className="callout warn small">
          <p>{t("Seeing the solution is fine. You'll get a similar practice question later, so you still earn the skill.")}</p>
          <div className="row">
            <button className="btn small" onClick={() => { setConfirming(false); onShowSolution(); }}>{t('Show it')}</button>
            <button className="btn small ghost" onClick={() => setConfirming(false)}>{t('Keep trying')}</button>
          </div>
        </div>
      )}
      {sawSolution && (
        <div className="callout good small">
          <b>{t('Solution')}</b>
          <pre>{solution}</pre>
          <p>{explanation}</p>
        </div>
      )}
    </div>
  );
}
