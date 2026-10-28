import { motion } from 'framer-motion';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { Hud, useCountdown, type FinishFn } from '../../../games/kit';
import type { DockerEngine } from '../engine';
import { EngineView, Terminal } from '../ui/Terminal';
import { goalsMet, isLookOnly, prepareMission, type Mission } from './missions';

export const MISSION_MAX = 100;

/** Points for a solved mission: full marks at par, −15 per extra changing command, −25 for the hint. Never below 30. */
export function missionScore(actions: number, par: number, hinted: boolean): number {
  return Math.max(30, MISSION_MAX - 15 * Math.max(0, actions - par) - (hinted ? 25 : 0));
}

interface Result {
  title: string;
  points: number;
  actions: number;
  par: number;
}

/** Plays a list of missions: terminal + live goals + engine view, one mission per round. */
export function MissionRounds({ missions, finish, playKey, extra }: { missions: Mission[]; finish: FinishFn; playKey: number; extra?: (m: Mission, e: DockerEngine, version: number) => ReactNode }) {
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const m = missions[Math.min(round, missions.length - 1)];
  const prepared = useMemo(() => prepareMission(m), [m, playKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [version, setVersion] = useState(0);
  const [actions, setActions] = useState(0);
  const [hinted, setHinted] = useState(false);
  const [answer, setAnswer] = useState('');
  const [answerWrong, setAnswerWrong] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [solvedAt, setSolvedAt] = useState<number | null>(null);
  const score = results.reduce((s, r) => s + r.points, 0);

  useEffect(() => {
    setRound(0);
    setResults([]);
  }, [playKey]);
  useEffect(() => {
    setVersion(0);
    setActions(0);
    setHinted(false);
    setAnswer('');
    setAnswerWrong(false);
    setAnswered(false);
    setSolvedAt(null);
  }, [round, playKey]);

  const met = goalsMet(m, prepared.engine, prepared.start);
  void version;
  const done = met.every(Boolean) && (!m.ask || answered);

  const next = (points: number) => {
    const all = [...results, { title: m.title, points, actions, par: m.par }];
    setResults(all);
    if (round + 1 >= missions.length) {
      finish(
        all.reduce((s, r) => s + r.points, 0),
        missions.length * MISSION_MAX,
        <table className="small" style={{ width: '100%' }}>
          <tbody>
            {all.map((r, i) => (
              <tr key={i}>
                <td>{r.points > 0 ? '✅' : '⏱'} {r.title}</td>
                <td className="muted">{r.points > 0 ? `${r.actions} command${r.actions === 1 ? '' : 's'} (par ${r.par})` : 'not finished'}</td>
                <td style={{ textAlign: 'right' }}>{r.points} pts</td>
              </tr>
            ))}
          </tbody>
        </table>,
      );
    } else setRound((r) => r + 1);
  };

  useEffect(() => {
    if (done && solvedAt === null) setSolvedAt(Date.now());
  }, [done, solvedAt]);

  const left = useCountdown(m.seconds, solvedAt === null, () => next(0), `${round}-${playKey}`);

  const submitAnswer = () => {
    if (!m.ask) return;
    const ok = answer.trim().toLowerCase() === m.ask.answer(prepared.engine).toLowerCase();
    setAnswerWrong(!ok);
    if (ok) setAnswered(true);
  };

  return (
    <div className="stack">
      <Hud round={round} rounds={missions.length} score={score} timeLeft={left} timeTotal={m.seconds} extra={<span>🔧 {actions} / par {m.par}</span>} />
      <div className="mission-grid">
        <div className="stack" style={{ gap: 10, minWidth: 0 }}>
          <div className="card stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>{m.title}</h3>
            <div className="md">
              <ReactMarkdown>{m.story}</ReactMarkdown>
            </div>
            <ul className="goal-list">
              {m.goals.map((g, i) => (
                <motion.li key={g.label} className={met[i] ? 'met' : ''} animate={{ scale: met[i] ? [1, 1.04, 1] : 1 }}>
                  <span>{met[i] ? '✅' : '⬜'}</span> <ReactMarkdown components={{ p: 'span' }}>{g.label}</ReactMarkdown>
                </motion.li>
              ))}
            </ul>
            {m.ask && (
              <form
                className="row"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  submitAnswer();
                }}
              >
                <label className="small">
                  <b>{m.ask.question}</b>
                </label>
                <input className="input" value={answer} disabled={answered} onChange={(ev) => setAnswer(ev.target.value)} style={{ maxWidth: 200 }} />
                {!answered && <button className="btn small">Submit</button>}
                {answered && <span className="tag good">✓ correct</span>}
                {answerWrong && !answered && <span className="small bad-text">Not that. Look again.</span>}
              </form>
            )}
            {!hinted && solvedAt === null && (
              <div>
                <button className="btn ghost small" onClick={() => setHinted(true)}>
                  💡 Hint (−25 pts)
                </button>
              </div>
            )}
            {hinted && (
              <div className="callout info small">
                <ReactMarkdown components={{ p: 'span' }}>{m.hint}</ReactMarkdown>
              </div>
            )}
          </div>
          {extra?.(m, prepared.engine, version)}
          {solvedAt !== null && (
            <motion.div className="callout good row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <b>Mission complete!</b>
              <span>
                {actions} changing command{actions === 1 ? '' : 's'} (par {m.par}) → <b>{missionScore(actions, m.par, hinted)} pts</b>
              </span>
              <div className="grow" />
              <button className="btn primary" onClick={() => next(missionScore(actions, m.par, hinted))} autoFocus>
                {round + 1 >= missions.length ? 'Finish' : 'Next mission →'}
              </button>
            </motion.div>
          )}
        </div>
        <div className="stack" style={{ gap: 10, minWidth: 0 }}>
          <Terminal
            key={`${round}-${playKey}`}
            engine={prepared.engine}
            height={300}
            disabled={solvedAt !== null}
            placeholder="Your machine for this mission. Commands that only look (ps, images, logs, curl…) are free; the others count."
            onCommand={(cmd) => {
              if (!isLookOnly(cmd)) setActions((a) => a + 1);
              setVersion((v) => v + 1);
            }}
          />
          <EngineView engine={prepared.engine} version={version} compact />
        </div>
      </div>
    </div>
  );
}
