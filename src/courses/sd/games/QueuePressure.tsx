import { GameShell } from '../../../games/kit';
import { SdRounds } from './SdRounds';
import { QUEUE_LEVELS } from './queues';

export default function QueuePressure() {
  return (
    <GameShell
      gameId="queues"
      intro={
        <>
          <p>Five shifts on the queue: CPU-bound workers, a slow email API, a flash sale, a poison message and double-charged customers.</p>
          <p>
            Tune the design and run the scenario as often as you like. Passing every requirement scores 70 points; the other 30 are for cost: full marks at or under <b>par</b> (what an expert spends), nothing at 1.5× par. Your best passing run counts.
          </p>
        </>
      }
    >
      {(finish, playKey) => <SdRounds levels={QUEUE_LEVELS} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
