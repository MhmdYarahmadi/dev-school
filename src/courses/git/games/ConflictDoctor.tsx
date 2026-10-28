import { GameShell } from '../../../games/kit';
import { MissionRounds } from './MissionRounds';
import { CONFLICT_DOCTOR } from './missions';

export default function ConflictDoctor() {
  return (
    <GameShell
      gameId="conflictdoctor"
      intro={
        <>
          <p>Every patient is a merge with a conflict. Each case says what the final files must say: read the markers, write exactly that, and finish the merge.</p>
          <p>Edit files in the ✏️ Files tab (or with <code>echo</code>/<code>printf</code>). Looking and editing is free; git commands count against par. A merge isn't healed until it's committed with no markers left.</p>
        </>
      }
    >
      {(finish, playKey) => <MissionRounds missions={CONFLICT_DOCTOR} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
