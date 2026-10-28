import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Hud, useCountdown, type FinishFn } from '../../../games/kit';
import { GraphView } from '../ui/GraphView';
import { Workspace } from '../ui/Workspace';
import { t } from '../../../shared/i18n';
import { goalsMet, goalsOf, isFree, playTeammate, prepareMission, targetGraph, teammateDue, type GitMission } from './missions';

export const MISSION_MAX = 100;

const commandsVsPar = (n: number, par: number) => (n === 1 ? t('1 git command (par {par})', { par }) : t('{n} git commands (par {par})', { n, par }));

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

/** Plays a list of Git missions: goals (and a target graph) beside a workspace, one mission per round. */
export function MissionRounds({ missions, finish, playKey }: { missions: GitMission[]; finish: FinishFn; playKey: number }) {
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const m = missions[Math.min(round, missions.length - 1)];
  const prepared = useMemo(() => prepareMission(m), [m, playKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const goals = useMemo(() => goalsOf(m), [m]);
  const target = useMemo(() => (m.target ? targetGraph(m) : null), [m]);
  const [version, setVersion] = useState(0);
  const [actions, setActions] = useState(0);
  const [hinted, setHinted] = useState(false);
  const [solvedAt, setSolvedAt] = useState<number | null>(null);
  /** What Sam did during this mission (Push/Pull Race). */
  const [news, setNews] = useState<string[]>([]);
  const score = results.reduce((s, r) => s + r.points, 0);

  useEffect(() => {
    setRound(0);
    setResults([]);
  }, [playKey]);
  useEffect(() => {
    setVersion(0);
    setActions(0);
    setHinted(false);
    setSolvedAt(null);
    setNews([]);
  }, [round, playKey]);

  void version;
  const met = goalsMet(goals, prepared.machine, prepared.start);
  const done = met.every(Boolean);

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
                <td className="muted">{r.points > 0 ? commandsVsPar(r.actions, r.par) : t('not finished')}</td>
                <td style={{ textAlign: 'end' }}>{t('{n} pts', { n: r.points })}</td>
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

  return (
    <div className="stack">
      <Hud round={round} rounds={missions.length} score={score} timeLeft={left} timeTotal={m.seconds} extra={<span>🔧 {t('{n} / par {par}', { n: actions, par: m.par })}</span>} />
      <div className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>{m.title}</h3>
        <div className="md">
          <ReactMarkdown>{m.story}</ReactMarkdown>
        </div>
        <div className={target ? 'mission-target' : ''}>
          <ul className="goal-list">
            {goals.map((g, i) => (
              <motion.li key={g.label} className={met[i] ? 'met' : ''} animate={{ scale: met[i] ? [1, 1.04, 1] : 1 }}>
                <span>{met[i] ? '✅' : '⬜'}</span> <ReactMarkdown components={{ p: 'span' }}>{g.label}</ReactMarkdown>
              </motion.li>
            ))}
          </ul>
          {target && (
            <div>
              <div className="small muted">{t('Make your graph look like this (messages and hashes can differ):')}</div>
              <GraphView graphs={[target]} />
            </div>
          )}
        </div>
        {news.map((n, i) => (
          <motion.div key={i} className="callout warn small" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>
            📣 {n}
          </motion.div>
        ))}
        {!hinted && solvedAt === null && (
          <div>
            <button className="btn ghost small" onClick={() => setHinted(true)}>
              {t('💡 Hint (−25 pts)')}
            </button>
          </div>
        )}
        {hinted && (
          <div className="callout info small">
            <ReactMarkdown components={{ p: 'span' }}>{m.hint}</ReactMarkdown>
          </div>
        )}
        {solvedAt !== null && (
          <motion.div className="callout good row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <b>{t('Mission complete!')}</b>
            <span>
              {commandsVsPar(actions, m.par)} → <b>{t('{n} pts', { n: missionScore(actions, m.par, hinted) })}</b>
            </span>
            <div className="grow" />
            <button className="btn primary" onClick={() => next(missionScore(actions, m.par, hinted))} autoFocus>
              {round + 1 >= missions.length ? t('Finish') : t('Next mission →')}
            </button>
          </motion.div>
        )}
      </div>
      <Workspace
        key={`${round}-${playKey}`}
        machine={prepared.machine}
        height={320}
        views={['graph', 'hub', 'areas', 'files']}
        disabled={solvedAt !== null}
        placeholder={t('Your machine for this mission. Looking (status, log, diff) and editing files is free; other git commands count.')}
        onCommand={(cmd) => {
          if (!isFree(cmd)) {
            setActions(actions + 1);
            // Sam acts right after the learner's n-th counted command.
            const due = teammateDue(m, actions + 1);
            for (const move of due) playTeammate(prepared.machine, move);
            if (due.length) setNews((x) => [...x, ...due.map((move) => move.say)]);
          }
          setVersion((v) => v + 1);
        }}
      />
    </div>
  );
}
