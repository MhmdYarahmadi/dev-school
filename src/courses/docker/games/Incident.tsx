import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { GameShell, Hud, useCountdown, type FinishFn } from '../../../games/kit';
import { EngineView, Terminal } from '../ui/Terminal';
import { FilesView } from '../ui/Transcript';
import { ACTS, actMet, INCIDENT_FILES, prepareIncident } from './incident';
import { MISSION_MAX, missionScore } from './MissionRounds';
import { isLookOnly } from './missions';

const TOTAL_SECONDS = 20 * 60;

interface Result {
  title: string;
  points: number;
  actions: number;
  par: number;
}

function Shift({ finish, playKey }: { finish: FinishFn; playKey: number }) {
  const prepared = useMemo(() => prepareIncident(), [playKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [act, setAct] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [version, setVersion] = useState(0);
  const [actions, setActions] = useState(0);
  const [hinted, setHinted] = useState(false);
  const [answer, setAnswer] = useState('');
  const [answered, setAnswered] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [over, setOver] = useState(false);
  const a = ACTS[Math.min(act, ACTS.length - 1)];
  const met = actMet(a, prepared.engine, prepared.start);
  void version;
  const done = met.every(Boolean) && (!a.ask || answered);
  const score = results.reduce((s, r) => s + r.points, 0);

  useEffect(() => {
    setAct(0);
    setResults([]);
    setOver(false);
  }, [playKey]);
  useEffect(() => {
    setActions(0);
    setHinted(false);
    setAnswer('');
    setAnswered(false);
    setWrong(false);
  }, [act, playKey]);

  const summary = (all: Result[]) => (
    <table className="small" style={{ width: '100%' }}>
      <tbody>
        {ACTS.map((x, i) => (
          <tr key={i}>
            <td>{all[i] ? '✅' : '⏱'} {x.title}</td>
            <td className="muted">{all[i] ? `${all[i].actions} changing command${all[i].actions === 1 ? '' : 's'} (par ${all[i].par})` : 'not reached'}</td>
            <td style={{ textAlign: 'right' }}>{all[i]?.points ?? 0} pts</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const end = (all: Result[]) => {
    setOver(true);
    finish(
      all.reduce((s, r) => s + r.points, 0),
      ACTS.length * MISSION_MAX,
      summary(all),
    );
  };
  const next = () => {
    const all = [...results, { title: a.title, points: missionScore(actions, a.par, hinted), actions, par: a.par }];
    setResults(all);
    if (act + 1 >= ACTS.length) end(all);
    else setAct((n) => n + 1);
  };
  const left = useCountdown(TOTAL_SECONDS, !over, () => end(results), `incident-${playKey}`);

  const submit = () => {
    if (!a.ask) return;
    const ok = a.ask.accept.test(answer.trim().toLowerCase());
    setWrong(!ok);
    if (ok) setAnswered(true);
  };

  return (
    <div className="stack">
      <Hud round={act} rounds={ACTS.length} score={score} timeLeft={left} timeTotal={TOTAL_SECONDS} extra={<span>🔧 {actions} / par {a.par}</span>} />
      <div className="mission-grid">
        <div className="stack" style={{ gap: 10, minWidth: 0 }}>
          <motion.div key={act} className="card stack" style={{ gap: 8 }} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}>
            <div className="small muted">
              Act {act + 1} of {ACTS.length}
            </div>
            <h3 style={{ margin: 0 }}>🚨 {a.title}</h3>
            <div className="md">
              <ReactMarkdown>{a.story}</ReactMarkdown>
            </div>
            {a.goals.length > 0 && (
              <ul className="goal-list">
                {a.goals.map((g, i) => (
                  <motion.li key={g.label} className={met[i] ? 'met' : ''} animate={{ scale: met[i] ? [1, 1.04, 1] : 1 }}>
                    <span>{met[i] ? '✅' : '⬜'}</span> <ReactMarkdown components={{ p: 'span' }}>{g.label}</ReactMarkdown>
                  </motion.li>
                ))}
              </ul>
            )}
            {a.ask && (
              <form
                className="row"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  submit();
                }}
              >
                <label className="small">
                  <b>{a.ask.question}</b>
                </label>
                <input className="input" value={answer} disabled={answered} onChange={(ev) => setAnswer(ev.target.value)} style={{ maxWidth: 200 }} />
                {!answered && <button className="btn small">Submit</button>}
                {answered && <span className="tag good">✓ correct</span>}
                {wrong && !answered && <span className="small bad-text">Not that one. Look again.</span>}
              </form>
            )}
            {!hinted && !done && (
              <div>
                <button className="btn ghost small" onClick={() => setHinted(true)}>
                  💡 Hint (−25 pts)
                </button>
              </div>
            )}
            {hinted && (
              <div className="callout info small">
                <ReactMarkdown components={{ p: 'span' }}>{a.hint}</ReactMarkdown>
              </div>
            )}
          </motion.div>
          {done && !over && (
            <motion.div className="callout good row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <b>{act + 1 >= ACTS.length ? 'Incident closed!' : 'Fixed!'}</b>
              <span>
                {actions} changing command{actions === 1 ? '' : 's'} (par {a.par}) → <b>{missionScore(actions, a.par, hinted)} pts</b>
              </span>
              <div className="grow" />
              <button className="btn primary" onClick={next} autoFocus>
                {act + 1 >= ACTS.length ? 'Write the post-mortem' : 'Next act →'}
              </button>
            </motion.div>
          )}
          <details className="small">
            <summary className="muted">The project folder (~/myapp) at the start of the shift</summary>
            <FilesView files={INCIDENT_FILES} />
          </details>
        </div>
        <div className="stack" style={{ gap: 10, minWidth: 0 }}>
          <Terminal
            key={`incident-${playKey}`}
            engine={prepared.engine}
            height={340}
            disabled={over}
            placeholder="You're logged into the production server, in ~/myapp. Looking is free; changes count."
            onCommand={(cmd) => {
              if (!isLookOnly(cmd)) setActions((n) => n + 1);
              setVersion((v) => v + 1);
            }}
          />
          <EngineView engine={prepared.engine} version={version} compact />
        </div>
      </div>
    </div>
  );
}

export default function Incident() {
  return (
    <GameShell
      gameId="incident"
      intro={
        <>
          <p>
            <b>The finale.</b> It's the middle of the night and the bakery's production stack is in trouble. One server, one Compose project, and six acts: each fix reveals the next problem. Everything you've learned is fair game: images, lifecycle, ports, volumes, networks, Dockerfiles, Compose and troubleshooting.
          </p>
          <p>You have 20 minutes for the whole shift. Fixes carry over from act to act, so don't break what you've already repaired. Looking around is free; each changing command counts against the act's par.</p>
        </>
      }
    >
      {(finish, playKey) => <Shift finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
