import { lazy } from 'react';
import { ExerciseCard } from '../../components/ExerciseCard';
import { ProjectView } from '../../pages/ProjectView';
import Playground from '../../pages/Playground';
import type { Course } from '../../shared/course';
import { pgContent } from './content';
import { PgExampleRunner, PgPredictResult } from './PgExample';

export const pgCourse: Course = {
  ...pgContent,
  ui: {
    ExerciseCard,
    ExampleRunner: PgExampleRunner,
    PredictResult: PgPredictResult,
    ProjectView,
    extraPages: [{ path: '/playground', label: 'Playground', Component: Playground }],
    games: {
      snapshot: lazy(() => import('../../games/Snapshot')),
      lineup: lazy(() => import('../../games/Lineup')),
      podium: lazy(() => import('../../games/Podium')),
      forge: lazy(() => import('../../games/Forge')),
      warehouse: lazy(() => import('../../games/Warehouse')),
      bridge: lazy(() => import('../../games/Bridge')),
      casefiles: lazy(() => import('../../games/CaseFiles')),
      doctor: lazy(() => import('../../games/Doctor')),
      gatekeeper: lazy(() => import('../../games/Gatekeeper')),
      rankrace: lazy(() => import('../../games/RankRace')),
      indexracer: lazy(() => import('../../games/IndexRacer')),
      finale: lazy(() => import('../../games/CaseFiles').then((m) => ({ default: m.FinaleGame }))),
    },
  },
};
