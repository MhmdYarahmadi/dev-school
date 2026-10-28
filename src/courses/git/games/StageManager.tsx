import { GameShell } from '../../../games/kit';
import { MissionRounds } from './MissionRounds';
import { STAGE_MANAGER } from './missions';

export default function StageManager() {
  return (
    <GameShell
      gameId="stagemanager"
      intro={
        <>
          <p>You're the stage manager: only the right changes go on stage (the staging area), and each commit tells one story.</p>
          <p>Each mission says what belongs in the history. Get exactly that into commits before the clock runs out. Looking (<code>git status</code>, <code>git diff</code>, <code>git log</code>) and editing files is free; other git commands count against par.</p>
        </>
      }
    >
      {(finish, playKey) => <MissionRounds missions={STAGE_MANAGER} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
