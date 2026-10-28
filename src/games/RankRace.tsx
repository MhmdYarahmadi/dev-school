import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { ResultsTable } from '../components/ResultsTable';
import type { ResultSet } from '../db/runQuery';
import { GameShell } from './kit';
import { QueryRounds } from './QueryRounds';
import { RANKRACE_LEVELS } from './levels/queryGames';

const COLORS: Record<string, string> = { Ada: '#e4572e', Bo: '#2f6fdb', Cleo: '#1f8a4c', Dev: '#a86bd1' };

/** Animated race: for each lap, drivers sorted by the third column. */
function Race({ set, label }: { set: ResultSet; label: string }) {
  const laps = useMemo(() => [...new Set(set.rows.map((r) => Number(r[1])))].sort((a, b) => a - b), [set]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setI((x) => (x + 1) % laps.length), 1400);
    return () => clearInterval(t);
  }, [playing, laps.length]);
  const lap = laps[i];
  const rows = set.rows.filter((r) => Number(r[1]) === lap && r[2] !== null).sort((a, b) => Number(a[2]) - Number(b[2]));
  const vals = set.rows.map((r) => Number(r[2])).filter(Number.isFinite);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return (
    <div className="card" style={{ flex: 1, minWidth: 280 }}>
      <div className="row">
        <b>{label}</b>
        <span className="tag">Lap {lap}</span>
        <div className="grow" />
        <button className="btn small" onClick={() => setPlaying(!playing)}>{playing ? '⏸' : '▶'}</button>
      </div>
      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
        {rows.map((r, pos) => {
          const v = Number(r[2]);
          const width = max === min ? 100 : 25 + ((v - min) / (max - min)) * 75;
          return (
            <motion.div key={String(r[0])} layout transition={{ type: 'spring', stiffness: 200, damping: 24 }} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <span style={{ width: 22 }}>{pos + 1}.</span>
              <span style={{ width: 44 }} className="small">{String(r[0])}</span>
              <motion.div animate={{ width: `${width}%` }} style={{ height: 18, borderRadius: 4, background: COLORS[String(r[0])] ?? 'var(--accent)' }} />
              <span className="mono small">{v.toFixed(2)}</span>
            </motion.div>
          );
        })}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>Sorted by column 3 (smallest first).</div>
    </div>
  );
}

export default function RankRace() {
  return (
    <GameShell
      gameId="rankrace"
      intro={
        <>
          <p>🏁 Four drivers, five laps: <code>laps(driver, lap, lap_time)</code>.</p>
          <p>Each round asks for a <b>window function</b> query: running totals, positions, gaps to the leader, lap-on-lap changes. When your result has the shape <code>driver, lap, value</code>, it <b>drives the race animation</b>.</p>
        </>
      }
    >
      {(finish, key) => (
        <QueryRounds
          key={key}
          levels={RANKRACE_LEVELS}
          finish={finish}
          visual={({ target, mine }) => {
            const raceable = (s: ResultSet | null) => !!s && s.columns.length === 3 && s.rows.length > 0 && s.rows.some((r) => r[2] !== null) && new Set(s.rows.map((r) => r[1])).size > 1;
            return (
              <div className="row" style={{ alignItems: 'stretch' }}>
                {raceable(target) ? <Race set={target} label="🎯 Target race" /> : <div className="card" style={{ flex: 1 }}><b>🎯 Target</b><ResultsTable set={target} maxRows={20} showTypes={false} /></div>}
                {mine && (raceable(mine) ? <Race set={mine} label="🏎 Your race" /> : <div className="card" style={{ flex: 1 }}><b>Your result</b><ResultsTable set={mine} maxRows={20} showTypes={false} /></div>)}
              </div>
            );
          }}
        />
      )}
    </GameShell>
  );
}
