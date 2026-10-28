import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { GameShell, Hud, useCountdown, type FinishFn } from '../../../games/kit';
import { CodeEditor } from '../../../components/CodeEditor';
import { FilesView, TranscriptView } from '../ui/Transcript';
import { blueprintMet, COMPOSER, deploy, type Deployment } from './composer';
import { MISSION_MAX, missionScore } from './MissionRounds';

interface Result {
  title: string;
  points: number;
  deploys: number;
  par: number;
}

/** The visualiser: each project network as a box with its services, their ports and volumes. */
function Topology({ d }: { d: Deployment }) {
  const e = d.engine;
  const ctrs = e.state.containers.filter((c) => c.labels['com.docker.compose.project'] === 'myapp').sort((a, b) => (a.name < b.name ? -1 : 1));
  const nets = e.state.networks.filter((n) => n.labels['com.docker.compose.project'] === 'myapp');
  if (!ctrs.length) return null;
  const chip = (name: string) => {
    const c = ctrs.find((x) => x.name === name)!;
    const svc = c.labels['com.docker.compose.service'];
    const color = c.status === 'running' ? (c.health === 'unhealthy' ? 'var(--warn)' : 'var(--good)') : 'var(--bad)';
    return (
      <motion.div key={name} layout className="card" style={{ padding: '6px 10px', borderLeft: `4px solid ${color}`, minWidth: 110 }}>
        <div className="mono" style={{ fontWeight: 600 }}>{svc}</div>
        <div className="small muted">
          {c.image}
          {c.health ? ` · ${c.health}` : ''}
          {c.status !== 'running' ? ` · ${c.status} (${c.exitCode})` : ''}
        </div>
        {c.ports.map((p) => (
          <div key={`${p.hostPort}`} className="small">🌐 localhost:{p.hostPort} → {p.containerPort}</div>
        ))}
        {c.mounts
          .filter((m) => !m.anonymous)
          .map((m) => (
            <div key={m.target} className="small">{m.type === 'volume' ? '💾' : '📁'} {m.type === 'volume' ? m.source.replace(/^myapp_/, '') : m.source.replace(/^.*\/myapp/, '.')} → {m.target}</div>
          ))}
      </motion.div>
    );
  };
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="ev-head">Topology</div>
      {nets.map((n) => (
        <div key={n.name} style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: 8 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>network <span className="mono">{n.name}</span></div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>{ctrs.filter((c) => c.networks.includes(n.name)).map((c) => chip(c.name))}</div>
        </div>
      ))}
    </div>
  );
}

function Blueprints({ finish, playKey }: { finish: FinishFn; playKey: number }) {
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const b = COMPOSER[Math.min(round, COMPOSER.length - 1)];
  const [text, setText] = useState(b.starter);
  const [d, setD] = useState<Deployment | null>(null);
  const [deploys, setDeploys] = useState(0);
  const [hinted, setHinted] = useState(false);
  const met = blueprintMet(b, d);
  const done = !!d && met.every(Boolean);
  const score = results.reduce((s, r) => s + r.points, 0);

  useEffect(() => {
    setRound(0);
    setResults([]);
  }, [playKey]);
  useEffect(() => {
    setText(COMPOSER[Math.min(round, COMPOSER.length - 1)].starter);
    setD(null);
    setDeploys(0);
    setHinted(false);
  }, [round, playKey]);

  const next = (points: number) => {
    const all = [...results, { title: b.title, points, deploys, par: b.par }];
    setResults(all);
    if (round + 1 >= COMPOSER.length)
      finish(
        all.reduce((s, r) => s + r.points, 0),
        COMPOSER.length * MISSION_MAX,
        <table className="small" style={{ width: '100%' }}>
          <tbody>
            {all.map((r, i) => (
              <tr key={i}>
                <td>{r.points > 0 ? '✅' : '⏱'} {r.title}</td>
                <td className="muted">{r.points > 0 ? `${r.deploys} deploy${r.deploys === 1 ? '' : 's'} (par ${r.par})` : 'not finished'}</td>
                <td style={{ textAlign: 'right' }}>{r.points} pts</td>
              </tr>
            ))}
          </tbody>
        </table>,
      );
    else setRound((r) => r + 1);
  };
  const left = useCountdown(b.seconds, !done, () => next(0), `${round}-${playKey}`);

  const doDeploy = () => {
    if (done) return;
    setD(deploy(b, text));
    setDeploys((n) => n + 1);
  };
  const points = missionScore(deploys, b.par, hinted);

  return (
    <div className="stack">
      <Hud round={round} rounds={COMPOSER.length} score={score} timeLeft={left} timeTotal={b.seconds} extra={<span>🚀 {deploys} deploy{deploys === 1 ? '' : 's'} (par {b.par})</span>} />
      <div className="mission-grid">
        <div className="stack" style={{ gap: 10, minWidth: 0 }}>
          <div className="card stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>📐 {b.title}</h3>
            <div className="md">
              <ReactMarkdown>{b.brief}</ReactMarkdown>
            </div>
            <ul className="goal-list">
              {b.goals.map((g, i) => (
                <motion.li key={g.label} className={met[i] ? 'met' : ''} animate={{ scale: met[i] ? [1, 1.04, 1] : 1 }}>
                  <span>{d ? (met[i] ? '✅' : '❌') : '⬜'}</span> <ReactMarkdown components={{ p: 'span' }}>{g.label}</ReactMarkdown>
                </motion.li>
              ))}
            </ul>
            {!hinted && !done && (
              <div>
                <button className="btn ghost small" onClick={() => setHinted(true)}>
                  💡 Hint (−25 pts)
                </button>
              </div>
            )}
            {hinted && (
              <div className="callout info small">
                <ReactMarkdown components={{ p: 'span' }}>{b.hint}</ReactMarkdown>
              </div>
            )}
          </div>
          {b.files && <FilesView files={b.files} title="Project folder" />}
          {d && <Topology d={d} />}
          {done && (
            <motion.div className="callout good row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <b>Blueprint approved!</b>
              <span>
                {deploys} deploy{deploys === 1 ? '' : 's'} (par {b.par}) → <b>{points} pts</b>
              </span>
              <div className="grow" />
              <button className="btn primary" onClick={() => next(points)} autoFocus>
                {round + 1 >= COMPOSER.length ? 'Finish' : 'Next blueprint →'}
              </button>
            </motion.div>
          )}
        </div>
        <div className="stack" style={{ gap: 10, minWidth: 0 }}>
          <div className="small muted">compose.yaml</div>
          <CodeEditor value={text} onChange={setText} lang="yaml" onRun={doDeploy} minHeight="220px" readOnly={done} />
          <div className="row">
            <button className="btn primary" onClick={doDeploy} disabled={done}>
              🚀 Deploy
            </button>
            <span className="small muted">Runs <code>docker compose up -d</code> on a fresh machine. Ctrl+Enter too.</span>
          </div>
          {d && !d.ok && <div className="callout bad small">The deploy failed: read the error at the end of the output.</div>}
          {d && <TranscriptView entries={d.transcript} maxHeight={260} />}
        </div>
      </div>
    </div>
  );
}

export default function Composer() {
  return (
    <GameShell
      gameId="composer"
      intro={
        <>
          <p>Each round is a blueprint: which services, which images, who may talk to whom, what's published and what must survive. Write the <code>compose.yaml</code>, then <b>Deploy</b>. The goals check the running result, and the topology view shows what you actually built.</p>
          <p>Par is one or two deploys. Extra deploys and the hint cost points. Remember: YAML indentation is two spaces per level, never tabs.</p>
        </>
      }
    >
      {(finish, playKey) => <Blueprints finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
