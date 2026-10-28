import { GameShell } from '../../../games/kit';
import { SdRounds } from './SdRounds';
import { LAUNCH_LEVELS } from './launch';

export default function LaunchNight() {
  return (
    <GameShell
      gameId="launch"
      intro={
        <>
          <p>The finale. Launch night of a new app, in five acts: the traffic spike, an empty cache, a dead primary, a failing dependency, and then the whole night in one run.</p>
          <p>
            Tune the design and run the scenario as often as you like. Passing every requirement scores 70 points; the other 30 are for cost: full marks at or under <b>par</b> (what an expert spends), nothing at 1.5× par. Your best passing run counts.
          </p>
        </>
      }
    >
      {(finish, playKey) => <SdRounds levels={LAUNCH_LEVELS} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
