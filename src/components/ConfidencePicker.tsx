import type { Confidence } from '../pedagogy/review';
import { t } from '../shared/i18n';

/** Asked after answering: correct-but-guessed answers come back in review sooner. */
export function ConfidencePicker({ onPick }: { onPick: (c: Confidence) => void }) {
  return (
    <div className="row small">
      <span className="muted">{t('How sure were you?')}</span>
      <button className="btn small" onClick={() => onPick('guessed')}>{t('🎲 Guessed')}</button>
      <button className="btn small" onClick={() => onPick('unsure')}>{t('🤔 Unsure')}</button>
      <button className="btn small" onClick={() => onPick('confident')}>{t('💪 Confident')}</button>
    </div>
  );
}
