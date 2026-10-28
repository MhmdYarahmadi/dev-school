import { motion } from 'framer-motion';
import type { ResultSet } from '../db/runQuery';
import { displayValue } from '../db/values';
import { GameShell } from './kit';
import { QueryRounds } from './QueryRounds';
import { PODIUM_LEVELS } from './levels/queryGames';

const MEDALS = ['🥇', '🥈', '🥉'];

function Board({ set, title, highlight }: { set: ResultSet | null; title: string; highlight?: (i: number) => boolean }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 260 }}>
      <b>{title}</b>
      {!set && <div className="muted small" style={{ marginTop: 8 }}>Run your query to see your board.</div>}
      {set && (
        <div className="stack" style={{ gap: 6, marginTop: 8 }}>
          {set.rows.map((r, i) => (
            <motion.div
              key={`${JSON.stringify(r)}#${set.rows.slice(0, i).filter((x) => JSON.stringify(x) === JSON.stringify(r)).length}`}
              layout
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              className="lane"
              style={{ borderColor: highlight?.(i) === false ? 'var(--bad)' : undefined }}
            >
              <span style={{ width: 28 }}>{MEDALS[i] ?? `${i + 1}.`}</span>
              {r.map((v, j) => (
                <span key={j} style={{ flex: j === 0 ? 1 : undefined, minWidth: j === 0 ? 0 : 60, textAlign: j === 0 ? 'left' : 'right' }}>
                  {displayValue(v, set.typeIds[j])}
                </span>
              ))}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Podium() {
  return (
    <GameShell
      gameId="podium"
      intro={
        <>
          <p>🏎 The <code>racers</code> table holds a racing season: <code>name, team, points, wins, best_lap</code> (best_lap can be NULL).</p>
          <p>Each round shows a <b>target leaderboard</b>. Sort the racers into exactly that order. Press <b>Run</b> to watch your rows slide into place, then <b>Submit</b>.</p>
          <p>Order matters here! Ties, NULLs and pages will try to trip you up.</p>
        </>
      }
    >
      {(finish, key) => (
        <QueryRounds
          key={key}
          levels={PODIUM_LEVELS}
          finish={finish}
          visual={({ target, mine }) => (
            <div className="row" style={{ alignItems: 'stretch' }}>
              <Board set={target} title="🎯 Target leaderboard" />
              <Board
                set={mine}
                title="🏁 Your leaderboard"
                highlight={(i) => (mine && target.rows[i] ? JSON.stringify(mine.rows[i]) === JSON.stringify(target.rows[i]) : false)}
              />
            </div>
          )}
        />
      )}
    </GameShell>
  );
}
