import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { course, h } from '../shared/course';
import { dueCards } from '../pedagogy/review';
import { completeVariant, recordReview, useProgress } from '../progress/store';
import { t } from '../shared/i18n';

/**
 * Daily mixed review: variants of exercises whose solution you viewed, plus
 * spaced-repetition cards that are due, mixed across modules.
 */
export default function ReviewPage() {
  const { findItem } = h();
  const { ExerciseCard } = course().ui;
  const p = useProgress();
  // Freeze the queue when the page opens, so answering doesn't reshuffle it.
  const [queue] = useState(() => {
    const variants = p.variantQueue.filter((id) => findItem(id));
    const due = dueCards(Object.values(p.review), Date.now(), 10)
      .map((c) => c.itemId)
      .filter((id) => findItem(id) && !variants.includes(id));
    // Interleave so consecutive items tend to come from different modules.
    const all = [...variants, ...due];
    return all.sort((a, b) => (findItem(a)!.module.number % 3) - (findItem(b)!.module.number % 3));
  });
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<Record<string, boolean>>({});
  // Only the first attempt at a review item counts for scheduling.
  const [firstTry, setFirstTry] = useState<Record<string, boolean>>({});
  const upcoming = useMemo(
    () => Object.values(p.review).filter((c) => c.due > Date.now()).sort((a, b) => a.due - b.due)[0],
    [p.review],
  );

  if (queue.length === 0) {
    return (
      <div className="card stack" style={{ maxWidth: 680 }}>
        <h2 style={{ margin: 0 }}>{t('🧠 Review')}</h2>
        <p>{t('Nothing due right now. 🎉')}</p>
        <p className="muted small">
          {t('Everything you answer joins your review deck. Items come back after a gap that grows each time you get them right: 1 day, then about 6, then weeks. This is spaced repetition, one of the most reliable ways to make learning stick.')}
          {upcoming && <> {t('Next item due {when}.', { when: new Date(upcoming.due).toLocaleString() })}</>}
        </p>
        <Link className="btn primary" to="/" style={{ alignSelf: 'start' }}>{t('Back to the course')}</Link>
      </div>
    );
  }

  if (idx >= queue.length) {
    const right = Object.values(done).filter(Boolean).length;
    return (
      <div className="card stack" style={{ maxWidth: 680 }}>
        <h2 style={{ margin: 0 }}>{t('Review complete ✓')}</h2>
        <p>{t('{n} of {total} correct. Items you missed will come back soon. See you tomorrow!', { n: right, total: queue.length })}</p>
        <Link className="btn primary" to="/" style={{ alignSelf: 'start' }}>{t('Back to the course')}</Link>
      </div>
    );
  }

  const id = queue[idx];
  const found = findItem(id)!;
  const isVariant = id.includes('~');
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="row">
        <h2 style={{ margin: 0 }}>{t('🧠 Review')}</h2>
        <span className="muted">{idx + 1} / {queue.length}</span>
        <span className="tag">{t('Module {n}: {title}', { n: found.module.number, title: found.module.title })}</span>
        {isVariant && <span className="tag accent">{t('🔁 variant of an exercise you saw the solution for')}</span>}
      </div>
      <ExerciseCard
        key={id}
        exercise={found.item}
        progressId={id}
        mode="review"
        record={isVariant}
        onAttempt={(correct) => {
          if (id in firstTry) return;
          setFirstTry((f) => ({ ...f, [id]: correct }));
          if (!correct) {
            if (!isVariant) recordReview(id, false, 'unsure');
            setDone((d) => ({ ...d, [id]: false }));
          }
        }}
        onDone={(correct, confidence) => {
          if (isVariant && correct) completeVariant(id);
          if (firstTry[id] === false) return; // already recorded as a miss
          if (!isVariant) recordReview(id, correct, confidence ?? 'unsure');
          setDone((d) => ({ ...d, [id]: correct }));
        }}
      />
      <div className="row"><div className="grow" />
        <button className={`btn ${id in done ? 'primary' : ''}`} onClick={() => setIdx(idx + 1)}>{id in done ? t('Next →') : t('Skip →')}</button>
      </div>
    </div>
  );
}
