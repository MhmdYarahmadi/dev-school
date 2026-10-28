import { GameShell } from '../../../games/kit';
import { MissionRounds } from './MissionRounds';
import { LIFECYCLE_RUSH } from './missions';

export default function LifecycleRush() {
  return (
    <GameShell
      gameId="lifecycle"
      intro={
        <>
          <p>You're on call. Each incident starts with a machine in trouble: stopped services, crashing workers, leftovers hogging names, clues hidden in logs.</p>
          <p>Fix it before the clock runs out. Reading (<code>docker ps -a</code>, <code>docker logs</code>, <code>docker exec … ls</code>) is free; changing commands count against par.</p>
        </>
      }
    >
      {(finish, playKey) => <MissionRounds missions={LIFECYCLE_RUSH} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
