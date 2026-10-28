import { GameShell } from '../../../games/kit';
import { CACHE_LEVELS } from './cachegame';
import { SdRounds } from './SdRounds';

export default function CacheGame() {
  return (
    <GameShell
      gameId="cachegame"
      intro={
        <>
          <p>Six shops, six caching problems: a cache that is too small, a database that can’t keep up, stale prices, a thundering herd, a restart and a flood of images.</p>
          <p>
            Change the design and run it as often as you like. Passing every requirement scores 70 points; the other 30 are for cost: full marks at or under <b>par</b>, nothing at 1.5× par. Your best passing run counts.
          </p>
        </>
      }
    >
      {(finish, playKey) => <SdRounds levels={CACHE_LEVELS} finish={finish} playKey={playKey} />}
    </GameShell>
  );
}
