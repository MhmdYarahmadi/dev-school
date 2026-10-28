import { GameShell } from '../../../games/kit';
import { SdRounds } from './SdRounds';
import { SHARD_LEVELS } from './shards';

export default function ShardShuffle() {
  return (
    <GameShell
      gameId="shards"
      intro={
        <>
          <p>Five rounds with a growing orders database: too many writes, ever-increasing ids, a viral product, a new shard, and a query that asks every shard.</p>
          <p>
            Tune the design and run the scenario as often as you like. Passing every requirement scores 70 points; the other 30 are for cost: full marks at or under <b>par</b> (what an expert spends), nothing at 1.5× par. Your best passing run counts.
          </p>
        </>
      }
    >
      {(finish, playKey) => <SdRounds levels={SHARD_LEVELS} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
