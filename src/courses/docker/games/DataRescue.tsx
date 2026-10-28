import { GameShell } from '../../../games/kit';
import { MissionRounds } from './MissionRounds';
import { DATA_RESCUE } from './missions';

export default function DataRescue() {
  return (
    <GameShell
      gameId="datarescue"
      intro={
        <>
          <p>Containers are about to be destroyed, and some hold data that exists nowhere else. Get it to safety: into a <b>volume</b>, a <b>bind-mounted</b> folder, or your own folder with <code>docker cp</code>.</p>
          <p>The goals check where the data really is, so data that only <i>looks</i> safe doesn't count. Remember: Redis saves to disk when it's <b>stopped</b>, not when it's killed. Looking around (<code>ls</code>, <code>cat</code>, <code>docker ps</code>, <code>docker volume ls</code>…) is free.</p>
        </>
      }
    >
      {(finish, playKey) => <MissionRounds missions={DATA_RESCUE} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
