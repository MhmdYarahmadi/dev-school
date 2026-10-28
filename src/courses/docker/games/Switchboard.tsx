import { motion } from 'framer-motion';
import { GameShell } from '../../../games/kit';
import type { DockerEngine } from '../engine';
import { MissionRounds } from './MissionRounds';
import { reaches, SWITCHBOARD, type Mission } from './missions';

/** The switchboard: each line lights up when `from` reaches `to` by name. */
function Board({ m, e }: { m: Mission; e: DockerEngine }) {
  if (!m.lines) return null;
  return (
    <div className="card stack" style={{ gap: 6 }}>
      <div className="ev-head">Switchboard</div>
      {m.lines.map((l) => {
        const up = reaches(e, l.from, l.to);
        const good = up === l.want;
        return (
          <div key={`${l.from}-${l.to}`} className={`lane ${good ? 'ok' : 'bad'}`}>
            <span className="mono">{l.from}</span>
            <div className="lane-track">
              {up && [0, 1].map((i) => <motion.span key={i} className="packet" animate={{ left: ['0%', '92%'] }} transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.7, ease: 'linear' }} />)}
            </div>
            <span className="mono">{l.to}</span>
            <span className="small">
              {good ? '✅' : '⛔'} {up ? 'connected' : 'no line'}
            </span>
            <span className="small muted">want: {l.want ? 'connected' : 'cut off'}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Switchboard() {
  return (
    <GameShell
      gameId="switchboard"
      intro={
        <>
          <p>You run the switchboard. Each line on the board must be <b>connected</b> (the caller reaches the other container by name) or <b>cut off</b>, as the order says.</p>
          <p>Your tools: <code>docker network create</code>, <code>--network</code>, <code>docker network connect</code> and <code>disconnect</code>. Names only resolve on user-defined networks. Inspecting (<code>docker network ls</code>, <code>inspect</code>) is free.</p>
        </>
      }
    >
      {(finish, playKey) => <MissionRounds missions={SWITCHBOARD} finish={finish} playKey={playKey} extra={(m, e) => <Board m={m} e={e} />} />}
    </GameShell>
  );
}
