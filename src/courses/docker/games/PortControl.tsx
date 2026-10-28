import { motion } from 'framer-motion';
import { GameShell } from '../../../games/kit';
import type { DockerEngine } from '../engine';
import { MissionRounds } from './MissionRounds';
import { PORT_CONTROL, type Mission } from './missions';

/** One lane per host port: what a request to it gets right now. */
function Lanes({ m, e }: { m: Mission; e: DockerEngine }) {
  if (!m.lanes) return null;
  return (
    <div className="card stack" style={{ gap: 6 }}>
      <div className="ev-head">Incoming traffic</div>
      {m.lanes.map((l) => {
        const r = e.probe(l.port);
        const ok = r.code === 0 && r.body.includes(l.marker);
        const what = r.code === 0 ? (ok ? `answered by ${l.want}` : 'answered by the wrong app') : r.code === 7 ? 'nothing listening' : r.code === 56 ? 'connection reset' : r.code === 52 ? 'empty reply' : `error ${r.code}`;
        return (
          <div key={l.port} className={`lane ${ok ? 'ok' : 'bad'}`}>
            <span className="mono">:{l.port}</span>
            <div className="lane-track">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="packet" animate={{ left: ok ? ['0%', '92%'] : ['0%', '45%'], opacity: ok ? [1, 1] : [1, 0] }} transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.5, ease: 'linear' }} />
              ))}
            </div>
            <span className="small">
              {ok ? '✅' : '⛔'} {what}
            </span>
            <span className="small muted">want: {l.want}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function PortControl() {
  return (
    <GameShell
      gameId="ports"
      intro={
        <>
          <p>Requests are arriving on your machine's ports. Each lane shows where they go right now: nowhere, a reset connection, or the right app.</p>
          <p>Publish the right container ports to the right host ports. Remember: <code>-p HOST:CONTAINER</code>, one container per host port, and the container port must be the one the app listens on. Checking with <code>curl</code> is free.</p>
        </>
      }
    >
      {(finish, playKey) => <MissionRounds missions={PORT_CONTROL} finish={finish} playKey={playKey} extra={(m, e) => <Lanes m={m} e={e} />} />}
    </GameShell>
  );
}
