import { CACHE_LEVELS } from './cachegame';
import { CHAOS_LEVELS } from './chaos';
import { LAUNCH_LEVELS } from './launch';
import { QUEUE_LEVELS } from './queues';
import type { SdLevel } from './rounds';
import { SHARD_LEVELS } from './shards';
import { SURGE } from './surge';

/** Every scenario game's levels, by game id (for tests). */
export const SD_LEVELS: Record<string, SdLevel[]> = { surge: SURGE, cachegame: CACHE_LEVELS, shards: SHARD_LEVELS, queues: QUEUE_LEVELS, chaos: CHAOS_LEVELS, launch: LAUNCH_LEVELS };
