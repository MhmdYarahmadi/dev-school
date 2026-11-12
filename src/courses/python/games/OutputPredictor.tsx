import { useMemo, useState } from 'react';
import { GameShell, Hud, useCountdown, type FinishFn } from '../../../games/kit';
import { course } from '../../../shared/course';

/**
 * 🎯 حدس خروجی — a timed arcade round of "what does this print?". Questions come
 * from the course's own readQuery (predict-output) items, so it reinforces exactly
 * what the learner studied. Builds the predict-before-you-run reflex.
 */
interface Round { code: string; choices: string[]; answer: number }

const FALLBACK: Round[] = [
  { code: 'print(2 + 3 * 4)', choices: ['20', '14', '24'], answer: 1 },
  { code: 'print("ab" * 3)', choices: ['ababab', 'ab3', 'aaabbb'], answer: 0 },
  { code: 'print(10 // 3)', choices: ['3.33', '3', '1'], answer: 1 },
  { code: 'print(len("python"))', choices: ['5', '6', '7'], answer: 1 },
];

const ROUND_SECONDS = 12;
const MAX_ROUNDS = 10;

function bank(): Round[] {
  const fromCourse = course()
    .modules.flatMap((m) => [...m.practice, ...m.test])
    .filter((it): it is Extract<typeof it, { kind: 'readQuery' }> => it.kind === 'readQuery' && !!it.sql)
    .map((it) => ({ code: it.sql!, choices: it.choices, answer: it.answer }));
  return fromCourse.length >= 3 ? fromCourse : FALLBACK;
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Play({ finish, playKey }: { finish: FinishFn; playKey: number }) {
  const rounds = useMemo(() => shuffle(bank()).slice(0, MAX_ROUNDS), [playKey]);
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const q = rounds[i];

  const advance = (correct: boolean) => {
    const next = score + (correct ? 1 : 0);
    setTimeout(() => {
      if (i + 1 >= rounds.length) finish(next, rounds.length);
      else { setScore(next); setI(i + 1); setPicked(null); }
    }, 850);
  };

  const pick = (choice: number) => {
    if (picked !== null) return;
    setPicked(choice);
    advance(choice === q.answer);
  };

  const left = useCountdown(ROUND_SECONDS, picked === null, () => pick(-1), i);

  return (
    <div className="card stack" style={{ maxWidth: 760 }}>
      <Hud round={i} rounds={rounds.length} score={score} timeLeft={left} timeTotal={ROUND_SECONDS} />
      <div className="small muted">این کد چه چیزی چاپ می‌کند؟</div>
      <pre dir="ltr" style={{ fontSize: '1.1rem' }}>{q.code}</pre>
      <div className="choices">
        {q.choices.map((c, idx) => {
          const cls = picked === null ? '' : idx === q.answer ? 'right' : idx === picked ? 'wrong' : '';
          return (
            <button key={idx} className={`choice ${cls}`} disabled={picked !== null} onClick={() => pick(idx)} dir="ltr">
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function OutputPredictor() {
  return (
    <GameShell
      gameId="outputPredictor"
      intro={
        <>
          <p>هر قطعه کد را ببین و حدس بزن چه چیزی چاپ می‌شود. سریع باش — برای هر سؤال {ROUND_SECONDS} ثانیه وقت داری!</p>
          <p>این بازی دقیقاً همان چیزهایی را تمرین می‌دهد که در این درس‌ها یاد گرفتی.</p>
        </>
      }
    >
      {(finish, playKey) => <Play finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
