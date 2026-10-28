import { GameShell } from '../../../games/kit';
import { MissionRounds } from './MissionRounds';
import { ENGINE_MATCH } from './missions';

export default function EngineMatch() {
  return (
    <GameShell
      gameId="enginematch"
      intro={
        <>
          <p>Each round shows a <b>target</b>: images that must be on the machine, containers that must be running or finished. Reach it in the terminal.</p>
          <p>The goals tick off live as you type. <b>Par</b> is how many changing commands an expert needs. Looking around (<code>docker ps</code>, <code>docker images</code>…) is free. Every command over par costs points, and so does the hint.</p>
        </>
      }
    >
      {(finish, playKey) => <MissionRounds missions={ENGINE_MATCH} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
