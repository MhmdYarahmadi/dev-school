import { GameShell } from '../../../games/kit';
import { MissionRounds } from './MissionRounds';
import { BREAK_IT } from './missions';

export default function BreakIt() {
  return (
    <GameShell
      gameId="breakit"
      intro={
        <>
          <p>You're on call. Each round, something on the server is broken: a container that won't stay up, a crash loop, a killed job, a full disk… Find the cause and fix it.</p>
          <p>Work like a pro: <code>docker ps -a</code>, <code>docker logs</code>, <code>docker inspect</code>, <code>docker stats</code> and <code>docker system df</code> are free. Every command that changes something counts against par, so diagnose first, then fix.</p>
        </>
      }
    >
      {(finish, playKey) => <MissionRounds missions={BREAK_IT} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
