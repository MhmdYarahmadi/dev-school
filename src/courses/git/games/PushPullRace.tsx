import { GameShell } from '../../../games/kit';
import { MissionRounds } from './MissionRounds';
import { PUSH_PULL } from './missions';

export default function PushPullRace() {
  return (
    <GameShell
      gameId="pushpull"
      intro={
        <>
          <p>You and Sam share the shop on the hub, and Sam is busy: 📣 messages tell you when Sam pushes. Get your work onto the hub without ever losing Sam's, and end in sync.</p>
          <p>The 🌳 Graph shows your copy and the hub's side by side. Looking (<code>git status</code>, <code>git log</code>) and editing files is free; other git commands count against par, and Sam moves after some of them.</p>
        </>
      }
    >
      {(finish, playKey) => <MissionRounds missions={PUSH_PULL} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
