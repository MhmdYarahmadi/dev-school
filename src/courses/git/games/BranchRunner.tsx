import { GameShell } from '../../../games/kit';
import { MissionRounds } from './MissionRounds';
import { BRANCH_RUNNER } from './missions';

export default function BranchRunner() {
  return (
    <GameShell
      gameId="branchrunner"
      intro={
        <>
          <p>Each mission shows a 🎯 target graph: branches, commits and merges. Make your repository's graph look the same.</p>
          <p>Only the shape counts: which commit sits on which, where each branch points, and where HEAD is. Your messages and hashes can differ. Looking and editing files is free; other git commands count against par.</p>
        </>
      }
    >
      {(finish, playKey) => <MissionRounds missions={BRANCH_RUNNER} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
