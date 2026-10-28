import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { GameShell, Hud, useCountdown, type FinishFn } from '../../../games/kit';
import { lintDockerfile } from '../engine';
import { CodeEditor } from '../../../components/CodeEditor';
import { FilesView, TranscriptView } from '../ui/Transcript';
import { cook, KITCHEN, ordersMet, type Tasting } from './kitchen';
import { MISSION_MAX, missionScore } from './MissionRounds';

interface Result {
  title: string;
  points: number;
  cooks: number;
}

function Orders({ finish, playKey }: { finish: FinishFn; playKey: number }) {
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const o = KITCHEN[Math.min(round, KITCHEN.length - 1)];
  const [text, setText] = useState(o.starter);
  const [tasting, setTasting] = useState<Tasting | null>(null);
  const [cooks, setCooks] = useState(0);
  const [hinted, setHinted] = useState(false);
  const met = ordersMet(o, tasting);
  const served = !!tasting && met.every(Boolean);
  const score = results.reduce((s, r) => s + r.points, 0);

  useEffect(() => {
    setRound(0);
    setResults([]);
  }, [playKey]);
  useEffect(() => {
    setText(KITCHEN[Math.min(round, KITCHEN.length - 1)].starter);
    setTasting(null);
    setCooks(0);
    setHinted(false);
  }, [round, playKey]);

  const next = (points: number) => {
    const all = [...results, { title: o.title, points, cooks }];
    setResults(all);
    if (round + 1 >= KITCHEN.length)
      finish(
        all.reduce((s, r) => s + r.points, 0),
        KITCHEN.length * MISSION_MAX,
        <table className="small" style={{ width: '100%' }}>
          <tbody>
            {all.map((r, i) => (
              <tr key={i}>
                <td>{r.points > 0 ? '✅' : '⏱'} {r.title}</td>
                <td className="muted">{r.points > 0 ? `${r.cooks} build${r.cooks === 1 ? '' : 's'}` : 'not served'}</td>
                <td style={{ textAlign: 'right' }}>{r.points} pts</td>
              </tr>
            ))}
          </tbody>
        </table>,
      );
    else setRound((r) => r + 1);
  };
  const left = useCountdown(o.seconds, !served, () => next(0), `${round}-${playKey}`);

  const doCook = () => {
    if (served) return;
    setTasting(cook(o, text));
    setCooks((c) => c + 1);
  };
  const lint = text.trim() ? lintDockerfile(text).filter((i) => i.kind === 'error') : [];
  const points = missionScore(cooks, 1, hinted);

  return (
    <div className="stack">
      <Hud round={round} rounds={KITCHEN.length} score={score} timeLeft={left} timeTotal={o.seconds} extra={<span>🍳 {cooks} build{cooks === 1 ? '' : 's'} (par 1)</span>} />
      <div className="mission-grid">
        <div className="stack" style={{ gap: 10, minWidth: 0 }}>
          <div className="card stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>🧾 {o.title}</h3>
            <div className="md">
              <ReactMarkdown>{o.ticket}</ReactMarkdown>
            </div>
            <ul className="goal-list">
              {o.goals.map((g, i) => (
                <motion.li key={g.label} className={met[i] ? 'met' : ''} animate={{ scale: met[i] ? [1, 1.04, 1] : 1 }}>
                  <span>{tasting ? (met[i] ? '✅' : '❌') : '⬜'}</span> <ReactMarkdown components={{ p: 'span' }}>{g.label}</ReactMarkdown>
                </motion.li>
              ))}
            </ul>
            {!hinted && !served && (
              <div>
                <button className="btn ghost small" onClick={() => setHinted(true)}>
                  💡 Hint (−25 pts)
                </button>
              </div>
            )}
            {hinted && (
              <div className="callout info small">
                <ReactMarkdown components={{ p: 'span' }}>{o.hint}</ReactMarkdown>
              </div>
            )}
          </div>
          {o.files && <FilesView files={o.files} title="Ingredients" />}
          {served && (
            <motion.div className="callout good row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <b>Order served!</b>
              <span>
                {cooks} build{cooks === 1 ? '' : 's'} (par 1) → <b>{points} pts</b>
              </span>
              <div className="grow" />
              <button className="btn primary" onClick={() => next(points)} autoFocus>
                {round + 1 >= KITCHEN.length ? 'Finish' : 'Next order →'}
              </button>
            </motion.div>
          )}
        </div>
        <div className="stack" style={{ gap: 10, minWidth: 0 }}>
          <CodeEditor value={text} onChange={setText} lang="dockerfile" onRun={doCook} minHeight="180px" readOnly={served} />
          {lint.map((i, k) => (
            <div key={k} className="callout bad small">
              <ReactMarkdown components={{ p: "span" }}>{i.message}</ReactMarkdown>
            </div>
          ))}
          <div className="row">
            <button className="btn primary" onClick={doCook} disabled={served}>
              🍳 Build &amp; taste
            </button>
            <span className="small muted">Every build counts. Ctrl+Enter builds too.</span>
          </div>
          {tasting && !tasting.built && <div className="callout bad small">The build failed: read the error at the end of the output.</div>}
          {tasting?.built && (
            <details className="small">
              <summary className="muted">Build output</summary>
              <TranscriptView entries={tasting.transcript.slice(0, 1)} maxHeight={220} />
            </details>
          )}
          {tasting && <TranscriptView entries={tasting.built ? tasting.transcript.slice(1) : tasting.transcript.slice(0, 1)} maxHeight={260} />}
        </div>
      </div>
    </div>
  );
}

export default function Kitchen() {
  return (
    <GameShell
      gameId="kitchen"
      intro={
        <>
          <p>Orders come in as tickets: a base image, files to pack, settings, and what the image must do when it runs. Write the Dockerfile, then <b>Build &amp; taste</b>: it's built as the image <code>order</code> and tasted with real <code>docker run</code> commands.</p>
          <p>Par is <b>one build</b>. Each extra build and the hint cost points, so read the ticket carefully before cooking.</p>
        </>
      }
    >
      {(finish, playKey) => <Orders finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
