import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { GameShell, Hud, useCountdown, type FinishFn } from '../../../games/kit';
import { fmtNumber, parseEstimate } from '../check';
import '../ui/sd.css';
import { makeQuestions, napkinScore, ROUND_MAX, ROUNDS, SECONDS } from './napkin';

interface Result {
  topic: string;
  points: number;
  given: number | null;
  truth: number;
  unit: string;
}

function Rounds({ finish, playKey }: { finish: FinishFn; playKey: number }) {
  const questions = useMemo(() => makeQuestions(Date.now() ^ (playKey * 7919)), [playKey]);
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const [answered, setAnswered] = useState<Result | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const q = questions[Math.min(round, questions.length - 1)];
  const score = results.reduce((s, r) => s + r.points, 0) + (answered?.points ?? 0);

  useEffect(() => {
    setRound(0);
    setResults([]);
  }, [playKey]);
  useEffect(() => {
    setText('');
    setBad(false);
    setAnswered(null);
    input.current?.focus();
  }, [round, playKey]);

  const left = useCountdown(SECONDS, answered === null, () => setAnswered({ topic: q.topic, points: 0, given: null, truth: q.answer, unit: q.unit }), `${round}-${playKey}`);

  const submit = () => {
    const v = parseEstimate(text);
    if (v === null) {
      setBad(true);
      return;
    }
    const { points } = napkinScore(v, q.answer, left);
    setAnswered({ topic: q.topic, points, given: v, truth: q.answer, unit: q.unit });
  };

  const next = () => {
    const all = [...results, answered!];
    setResults(all);
    if (round + 1 < questions.length) {
      setRound(round + 1);
      return;
    }
    finish(
      all.reduce((s, r) => s + r.points, 0),
      ROUNDS * ROUND_MAX,
      <table className="small" style={{ width: '100%' }}>
        <tbody>
          {all.map((r, i) => (
            <tr key={i}>
              <td>{r.points >= 70 ? '🎯' : r.points > 0 ? '👍' : '❌'} {r.topic}</td>
              <td className="muted">
                {r.given === null ? 'no answer' : `${fmtNumber(r.given)}`} vs {fmtNumber(r.truth)} {r.unit}
              </td>
              <td style={{ textAlign: 'right' }}>{r.points} pts</td>
            </tr>
          ))}
        </tbody>
      </table>,
    );
  };

  const verdict = (r: Result) => {
    if (r.given === null) return 'Time’s up.';
    const err = Math.abs(r.given - r.truth) / r.truth;
    if (err <= 0.1) return 'Spot on!';
    if (err <= 0.25) return 'Close: good enough for a design review.';
    if (err <= 0.5) return 'In the right ballpark.';
    return `Off by ${r.given > r.truth ? (r.given / r.truth).toFixed(1) : (r.truth / Math.max(r.given, 1e-9)).toFixed(1)}×.`;
  };

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <Hud round={round} rounds={questions.length} score={score} timeLeft={left} timeTotal={SECONDS} extra={<span className="tag">{q.topic}</span>} />
      <div className="card stack">
        <div className="md" style={{ fontSize: '1.1rem' }}>
          <ReactMarkdown>{q.prompt}</ReactMarkdown>
        </div>
        <form
          className="sd-estimate"
          onSubmit={(e) => {
            e.preventDefault();
            if (answered) next();
            else submit();
          }}
        >
          <input
            ref={input}
            className="input"
            aria-label="Your estimate"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            disabled={!!answered}
            onChange={(e) => {
              setText(e.target.value);
              setBad(false);
            }}
            placeholder="e.g. 2300 or 2.3k"
          />
          <span>{q.unit}</span>
          {!answered && <button className="btn primary">Answer ↵</button>}
        </form>
        {bad && <div className="small bad-text">Type a number, like 1200, 1.2k or 3 million.</div>}
        {answered && (
          <motion.div className={`callout ${answered.points >= 70 ? 'good' : answered.points > 0 ? 'info' : 'bad'} stack`} style={{ gap: 6 }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <div className="row">
              <b>{verdict(answered)}</b>
              <span>+{answered.points} pts</span>
              <div className="grow" />
              <button className="btn primary small" onClick={next} autoFocus>
                {round + 1 < questions.length ? 'Next →' : 'Finish'}
              </button>
            </div>
            <div className="small">
              <ReactMarkdown components={{ p: 'span' }}>{q.steps}</ReactMarkdown>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default function Napkin() {
  return (
    <GameShell
      gameId="napkin"
      intro={
        <>
          <p>{ROUNDS} quick estimates: traffic, storage, bandwidth, memory, servers. Each comes with fresh numbers, so no two games are the same.</p>
          <p>
            Points for being close: within 10% scores 100, within 25% scores 70, within 50% scores 35. Answer within the first 15 seconds for full points; after that they shrink to half at the buzzer. You can type <code>2300</code>, <code>2.3k</code> or <code>3 million</code>.
          </p>
          <p className="small muted">Shortcuts: a day ≈ 86,400 s (call it 100,000); a month ≈ 2.6 million s; 1 MB/s ≈ 8 Mbit/s.</p>
        </>
      }
    >
      {(finish, playKey) => <Rounds finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
