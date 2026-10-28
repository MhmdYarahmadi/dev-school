import { GameShell } from '../../../games/kit';
import { SdRounds } from './SdRounds';
import { CHAOS_LEVELS } from './chaos';

export default function ChaosDay() {
  return (
    <GameShell
      gameId="chaos"
      intro={
        <>
          <p>A day of injected failures: a stuck payment provider, a dead zone, a queue that never empties, a scraper, and then everything at once.</p>
          <p>
            Tune the design and run the scenario as often as you like. Passing every requirement scores 70 points; the other 30 are for cost: full marks at or under <b>par</b> (what an expert spends), nothing at 1.5× par. Your best passing run counts.
          </p>
        </>
      }
    >
      {(finish, playKey) => <SdRounds levels={CHAOS_LEVELS} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
