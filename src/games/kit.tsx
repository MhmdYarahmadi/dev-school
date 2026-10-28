import { motion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { GameId } from '../content/types';
import { recordGame, useProgress } from '../progress/store';
import { course } from '../shared/course';

export function starsFor(score: number, max: number): number {
  const r = max > 0 ? score / max : 0;
  return r >= 0.85 ? 3 : r >= 0.6 ? 2 : r > 0.2 ? 1 : 0;
}

/** Countdown that pauses when `running` is false. Calls onExpire once. */
export function useCountdown(seconds: number, running: boolean, onExpire: () => void, resetKey: unknown) {
  const [left, setLeft] = useState(seconds);
  const expired = useRef(false);
  const cb = useRef(onExpire);
  cb.current = onExpire;
  useEffect(() => {
    setLeft(seconds);
    expired.current = false;
  }, [seconds, resetKey]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setLeft((l) => {
        const n = Math.max(0, l - 0.25);
        if (n === 0 && !expired.current) {
          expired.current = true;
          setTimeout(() => cb.current(), 0);
        }
        return n;
      });
    }, 250);
    return () => clearInterval(t);
  }, [running, resetKey]);
  return left;
}

export function Hud({ round, rounds, score, timeLeft, timeTotal, extra }: { round: number; rounds: number; score: number; timeLeft?: number; timeTotal?: number; extra?: ReactNode }) {
  return (
    <div className="game-hud">
      <span>Round {Math.min(round + 1, rounds)}/{rounds}</span>
      <span>⭐ {score} pts</span>
      {extra}
      {timeLeft !== undefined && timeTotal !== undefined && (
        <>
          <span className={`timer ${timeLeft < 10 ? 'low' : ''}`}>⏱ {Math.ceil(timeLeft)}s</span>
          <div className="timerbar"><div style={{ width: `${(timeLeft / timeTotal) * 100}%`, background: timeLeft < 10 ? 'var(--bad)' : undefined }} /></div>
        </>
      )}
    </div>
  );
}

export type FinishFn = (score: number, maxScore: number, summary?: ReactNode) => void;

/** Shared frame: intro → play → results (stars, XP, replay). */
export function GameShell({ gameId, intro, children }: { gameId: GameId; intro: ReactNode; children: (finish: FinishFn, playKey: number) => ReactNode }) {
  const meta = course().games[gameId];
  const p = useProgress();
  const [phase, setPhase] = useState<'intro' | 'play' | 'done'>('intro');
  const [playKey, setPlayKey] = useState(0);
  const [result, setResult] = useState<{ score: number; max: number; stars: number; summary?: ReactNode; prevBest: number } | null>(null);

  const finish: FinishFn = (score, max, summary) => {
    const stars = starsFor(score, max);
    const prevBest = p.games[gameId]?.stars ?? 0;
    recordGame(gameId, stars, score);
    setResult({ score, max, stars, summary, prevBest });
    setPhase('done');
  };

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <div className="row">
        <Link to={`/module/${meta.moduleId}/play`} className="small">← Back to module</Link>
      </div>
      <div className="row">
        <span style={{ fontSize: '2rem' }}>{meta.icon}</span>
        <h1 style={{ margin: 0 }}>{meta.title}</h1>
        <span className="tag accent">{meta.skills}</span>
      </div>
      {phase === 'intro' && (
        <div className="card stack" style={{ maxWidth: 760 }}>
          <div className="md">{intro}</div>
          <div className="small muted">Scoring: ★★★ for 85%+ of the maximum score, ★★ for 60%+, ★ for 20%+. Hints cost points.</div>
          <div><button className="btn primary" onClick={() => { setPlayKey((k) => k + 1); setPhase('play'); }}>Start ▶</button></div>
        </div>
      )}
      {phase === 'play' && children(finish, playKey)}
      {phase === 'done' && result && (
        <motion.div className="card stack" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ maxWidth: 760, textAlign: 'center', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{result.stars === 3 ? 'Outstanding!' : result.stars === 2 ? 'Great job!' : result.stars === 1 ? 'Nice start!' : 'Keep practising!'}</h2>
          <div className="big-stars">
            {[0, 1, 2].map((i) => (
              <motion.span key={i} className={i < result.stars ? '' : 'off'} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.25, type: 'spring' }}>★</motion.span>
            ))}
          </div>
          <div>{result.score} / {result.max} points{result.stars > result.prevBest && result.prevBest > 0 ? ' · new best!' : ''}</div>
          {result.summary && <div style={{ width: '100%', textAlign: 'left' }}>{result.summary}</div>}
          <div className="row">
            <button className="btn primary" onClick={() => { setPlayKey((k) => k + 1); setPhase('play'); }}>Play again</button>
            <Link className="btn" to={`/module/${meta.moduleId}/test`}>Take the module test →</Link>
          </div>
        </motion.div>
      )}
    </div>
  );
}
