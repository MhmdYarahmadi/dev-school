import { lazy } from 'react';
import type { Course } from '../../shared/course';
import { sdContent } from './content';
import { SdProjectView } from './ui/ProjectView';
import Sandbox from './ui/Sandbox';
import { SdExampleRunner, SdPredictResult } from './ui/SdExample';
import { SdExerciseCard } from './ui/SdExerciseCard';
import { SdPredictSetup } from './ui/ScenarioView';

export const sdCourse: Course = {
  ...sdContent,
  ui: {
    ExerciseCard: SdExerciseCard,
    ExampleRunner: SdExampleRunner,
    PredictResult: SdPredictResult,
    PredictSetup: SdPredictSetup,
    ProjectView: SdProjectView,
    extraPages: [{ path: '/sandbox', label: 'Sandbox', Component: Sandbox }],
    games: {
      napkin: lazy(() => import('./games/Napkin')),
      surge: lazy(() => import('./games/TrafficSurge')),
      cachegame: lazy(() => import('./games/CacheGame')),
      shards: lazy(() => import('./games/ShardShuffle')),
      queues: lazy(() => import('./games/QueuePressure')),
      chaos: lazy(() => import('./games/ChaosDay')),
      launch: lazy(() => import('./games/LaunchNight')),
    },
  },
};
