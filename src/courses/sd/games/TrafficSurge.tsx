import { GameShell } from '../../../games/kit';
import { SdRounds } from './SdRounds';
import { SURGE } from './surge';

export default function TrafficSurge() {
  return (
    <GameShell
      gameId="surge"
      intro={
        <>
          <p>Five nights in operations. Each round brings a traffic wave or a failure: a morning rush, logged-out users, slow requests, a crash at the peak, TV ads.</p>
          <p>
            Tune the design and run the scenario as often as you like. Passing every requirement scores 70 points; the other 30 are for cost: full marks at or under <b>par</b> (what an expert spends), nothing at 1.5× par. Your best passing run counts.
          </p>
        </>
      }
    >
      {(finish, playKey) => <SdRounds levels={SURGE} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
