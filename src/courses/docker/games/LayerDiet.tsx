import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { GameShell, Hud, useCountdown, type FinishFn } from '../../../games/kit';
import { lintDockerfile } from '../engine';
import { CodeEditor } from '../../../components/CodeEditor';
import { FilesView, TranscriptView } from '../ui/Transcript';
import { dietMet, LAYER_DIET, weigh, type Diet, type Weighing } from './layerdiet';
import { MISSION_MAX, missionScore } from './MissionRounds';

interface Result {
  title: string;
  points: number;
  builds: number;
  par: number;
}

const fmt = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`);

/** The analyser: weight against the target, the layers, and what the rebuild reused. */
function Analysis({ d, w }: { d: Diet; w: Weighing }) {
  if (!w.image) return null;
  const target = Number(/under \*\*(\d+) MB/.exec(d.goals.map((g) => g.label).join(' '))?.[1] ?? 0);
  const size = w.image.size;
  const scale = Math.max(size, target || size) * 1.05;
  const layers = w.image.layers.filter((l) => l.size > 0.05);
  const biggest = Math.max(...layers.map((l) => l.size));
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="ev-head">Analyser</div>
      <div className="small">
        <b>{fmt(size)}</b>
        {target > 0 && <span className="muted"> · target under {target} MB</span>}
      </div>
      <div style={{ position: 'relative', height: 14, background: 'var(--surface-2)', borderRadius: 7, overflow: 'hidden' }}>
        <motion.div initial={{ width: 0 }} animate={{ width: `${(size / scale) * 100}%` }} style={{ height: '100%', background: target && size >= target ? 'var(--bad)' : 'var(--good)' }} />
        {target > 0 && <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(target / scale) * 100}%`, borderLeft: '2px dashed var(--text)' }} title="target" />}
      </div>
      <div className="small muted">Layers (biggest first):</div>
      {[...layers]
        .sort((a, b) => b.size - a.size)
        .slice(0, 6)
        .map((l, i) => (
          <div key={i} className="small" style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 8, alignItems: 'center' }}>
            <span className="mono" style={{ textAlign: 'right' }}>{fmt(l.size)}</span>
            <div>
              <div style={{ height: 6, width: `${Math.max(2, (l.size / biggest) * 100)}%`, background: 'var(--accent)', borderRadius: 3 }} />
              <div className="mono muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.createdBy}</div>
            </div>
          </div>
        ))}
      {w.rebuild.length > 0 && (
        <>
          <div className="small muted">Rebuild after a change to <code>{d.edit}</code>:</div>
          <div className="mono" style={{ fontSize: 12 }}>
            {w.rebuild.map((s, i) => (
              <div key={i} style={{ color: s.cached ? 'var(--good)' : 'var(--warn, var(--bad))' }}>
                {s.cached ? 'CACHED' : 'RAN   '} {s.instr}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Diets({ finish, playKey }: { finish: FinishFn; playKey: number }) {
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const d = LAYER_DIET[Math.min(round, LAYER_DIET.length - 1)];
  const [text, setText] = useState(d.starter);
  const [ignore, setIgnore] = useState(d.ignore ?? '');
  const [w, setW] = useState<Weighing | null>(null);
  const [builds, setBuilds] = useState(0);
  const [hinted, setHinted] = useState(false);
  const met = dietMet(d, w);
  const done = !!w && met.every(Boolean);
  const score = results.reduce((s, r) => s + r.points, 0);

  useEffect(() => {
    setRound(0);
    setResults([]);
  }, [playKey]);
  useEffect(() => {
    const x = LAYER_DIET[Math.min(round, LAYER_DIET.length - 1)];
    setText(x.starter);
    setIgnore(x.ignore ?? '');
    setW(null);
    setBuilds(0);
    setHinted(false);
  }, [round, playKey]);

  const next = (points: number) => {
    const all = [...results, { title: d.title, points, builds, par: d.par }];
    setResults(all);
    if (round + 1 >= LAYER_DIET.length)
      finish(
        all.reduce((s, r) => s + r.points, 0),
        LAYER_DIET.length * MISSION_MAX,
        <table className="small" style={{ width: '100%' }}>
          <tbody>
            {all.map((r, i) => (
              <tr key={i}>
                <td>{r.points > 0 ? '✅' : '⏱'} {r.title}</td>
                <td className="muted">{r.points > 0 ? `${r.builds} build${r.builds === 1 ? '' : 's'} (par ${r.par})` : 'not finished'}</td>
                <td style={{ textAlign: 'right' }}>{r.points} pts</td>
              </tr>
            ))}
          </tbody>
        </table>,
      );
    else setRound((r) => r + 1);
  };
  const left = useCountdown(d.seconds, !done, () => next(0), `${round}-${playKey}`);

  const doWeigh = () => {
    if (done) return;
    setW(weigh(d, text, d.ignore !== undefined ? ignore : undefined));
    setBuilds((b) => b + 1);
  };
  const lint = text.trim() ? lintDockerfile(text).filter((i) => i.kind !== 'ok') : [];
  const points = missionScore(builds, d.par, hinted);

  return (
    <div className="stack">
      <Hud round={round} rounds={LAYER_DIET.length} score={score} timeLeft={left} timeTotal={d.seconds} extra={<span>⚖️ {builds} build{builds === 1 ? '' : 's'} (par {d.par})</span>} />
      <div className="mission-grid">
        <div className="stack" style={{ gap: 10, minWidth: 0 }}>
          <div className="card stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>🥗 {d.title}</h3>
            <div className="md">
              <ReactMarkdown>{d.ticket}</ReactMarkdown>
            </div>
            <ul className="goal-list">
              {d.goals.map((g, i) => (
                <motion.li key={g.label} className={met[i] ? 'met' : ''} animate={{ scale: met[i] ? [1, 1.04, 1] : 1 }}>
                  <span>{w ? (met[i] ? '✅' : '❌') : '⬜'}</span> <ReactMarkdown components={{ p: 'span' }}>{g.label}</ReactMarkdown>
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
                <ReactMarkdown components={{ p: 'span' }}>{d.hint}</ReactMarkdown>
              </div>
            )}
          </div>
          {Object.keys(d.files).length > 0 && <FilesView files={d.files} title="Project folder" />}
          {w && <Analysis d={d} w={w} />}
          {done && (
            <motion.div className="callout good row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <b>Diet complete!</b>
              <span>
                {builds} build{builds === 1 ? '' : 's'} (par {d.par}) → <b>{points} pts</b>
              </span>
              <div className="grow" />
              <button className="btn primary" onClick={() => next(points)} autoFocus>
                {round + 1 >= LAYER_DIET.length ? 'Finish' : 'Next diet →'}
              </button>
            </motion.div>
          )}
        </div>
        <div className="stack" style={{ gap: 10, minWidth: 0 }}>
          <div className="small muted">Dockerfile</div>
          <CodeEditor value={text} onChange={setText} lang="dockerfile" onRun={doWeigh} minHeight="170px" readOnly={done} />
          {d.ignore !== undefined && (
            <>
              <div className="small muted">.dockerignore (one pattern per line)</div>
              <CodeEditor value={ignore} onChange={setIgnore} lang="text" onRun={doWeigh} minHeight="70px" readOnly={done} placeholder="node_modules" />
            </>
          )}
          {lint.length > 0 && (
            <details className="small">
              <summary className="muted">Reviewer's notes ({lint.length})</summary>
              {lint.map((i, k) => (
                <div key={k} className={`callout ${i.kind === 'error' ? 'bad' : 'info'} small`} style={{ marginTop: 4 }}>
                  <ReactMarkdown components={{ p: 'span' }}>{i.message}</ReactMarkdown>
                </div>
              ))}
            </details>
          )}
          <div className="row">
            <button className="btn primary" onClick={doWeigh} disabled={done}>
              ⚖️ Build &amp; weigh
            </button>
            <span className="small muted">Builds, runs it, then rebuilds after a code change. Ctrl+Enter too.</span>
          </div>
          {w && !w.built && <div className="callout bad small">The build failed: read the error at the end of the output.</div>}
          {w && <TranscriptView entries={w.built ? w.transcript.slice(1, -1) : w.transcript.slice(0, 1)} maxHeight={240} />}
        </div>
      </div>
    </div>
  );
}

export default function LayerDiet() {
  return (
    <GameShell
      gameId="layerdiet"
      intro={
        <>
          <p>Each image works, but it's overweight, slow to rebuild, or carrying things it shouldn't. Put it on a diet: rewrite the Dockerfile until every goal is green, <b>without breaking the app</b>.</p>
          <p>
            <b>Build &amp; weigh</b> builds the image, runs it, then changes a source file and rebuilds, so you can see which steps the cache reused. The analyser shows the size against the target and the heaviest layers. Par is one or two builds; extra builds and the hint cost points.
          </p>
        </>
      }
    >
      {(finish, playKey) => <Diets finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
