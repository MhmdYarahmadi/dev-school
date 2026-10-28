/**
 * SM-2 spaced repetition (the algorithm behind Anki), with one twist:
 * a correct answer you only *guessed* is scheduled almost like a miss.
 */

export type Confidence = 'guessed' | 'unsure' | 'confident';

export interface ReviewCard {
  itemId: string;
  ease: number;
  intervalDays: number;
  reps: number;
  due: number; // epoch ms
  lapses: number;
}

const DAY = 24 * 60 * 60 * 1000;

export function quality(correct: boolean, confidence: Confidence): number {
  if (!correct) return confidence === 'confident' ? 0 : 1;
  return confidence === 'guessed' ? 3 : confidence === 'unsure' ? 4 : 5;
}

export function newCard(itemId: string, now = Date.now()): ReviewCard {
  return { itemId, ease: 2.5, intervalDays: 0, reps: 0, due: now, lapses: 0 };
}

export function schedule(card: ReviewCard, q: number, now = Date.now()): ReviewCard {
  let { ease, intervalDays, reps, lapses } = card;
  if (q < 3) {
    reps = 0;
    intervalDays = 0; // see it again in this session / tomorrow
    lapses += 1;
  } else {
    reps += 1;
    if (reps === 1) intervalDays = q === 3 ? 1 : 2;
    else if (reps === 2) intervalDays = q === 3 ? 3 : 6;
    else intervalDays = Math.round(intervalDays * ease * (q === 3 ? 0.6 : 1));
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  const due = q < 3 ? now + 10 * 60 * 1000 : now + intervalDays * DAY;
  return { itemId: card.itemId, ease, intervalDays, reps, due, lapses };
}

/** Due cards first (most overdue first), capped. */
export function dueCards(cards: ReviewCard[], now = Date.now(), limit = 10): ReviewCard[] {
  return cards
    .filter((c) => c.due <= now)
    .sort((a, b) => a.due - b.due)
    .slice(0, limit);
}
