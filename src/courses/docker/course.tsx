import { lazy } from 'react';
import type { Course } from '../../shared/course';
import { dockerContent } from './content';
import { DockerExampleRunner, DockerPredictResult } from './ui/DockerExample';
import { DockerExerciseCard } from './ui/DockerExerciseCard';
import DockerPlayground from './ui/Playground';
import { DockerProjectView } from './ui/ProjectView';

export const dockerCourse: Course = {
  ...dockerContent,
  ui: {
    ExerciseCard: DockerExerciseCard,
    ExampleRunner: DockerExampleRunner,
    PredictResult: DockerPredictResult,
    ProjectView: DockerProjectView,
    extraPages: [{ path: '/playground', label: 'Playground', Component: DockerPlayground }],
    games: {
      enginematch: lazy(() => import('./games/EngineMatch')),
      lifecycle: lazy(() => import('./games/LifecycleRush')),
      ports: lazy(() => import('./games/PortControl')),
      datarescue: lazy(() => import('./games/DataRescue')),
      switchboard: lazy(() => import('./games/Switchboard')),
      kitchen: lazy(() => import('./games/Kitchen')),
      layerdiet: lazy(() => import('./games/LayerDiet')),
      composer: lazy(() => import('./games/Composer')),
      breakit: lazy(() => import('./games/BreakIt')),
      incident: lazy(() => import('./games/Incident')),
    },
  },
};
