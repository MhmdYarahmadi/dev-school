import type { Confidence } from '../pedagogy/review';

/** Asked after answering: correct-but-guessed answers come back in review sooner. */
export function ConfidencePicker({ onPick }: { onPick: (c: Confidence) => void }) {
  return (
    <div className="row small">
      <span className="muted">How sure were you?</span>
      <button className="btn small" onClick={() => onPick('guessed')}>🎲 Guessed</button>
      <button className="btn small" onClick={() => onPick('unsure')}>🤔 Unsure</button>
      <button className="btn small" onClick={() => onPick('confident')}>💪 Confident</button>
    </div>
  );
}
