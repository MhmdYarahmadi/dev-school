import { lazy } from 'react';
import type { Course } from '../../shared/course';
import { mark } from '../../shared/i18n';
import { gitContent } from './content';
import { GitExampleRunner, GitPredictResult, GitPredictSetup } from './ui/GitExample';
import { GitExerciseCard } from './ui/GitExerciseCard';
import GitPlayground from './ui/Playground';
import { GitProjectView } from './ui/ProjectView';

export const gitCourse: Course = {
  ...gitContent,
  ui: {
    ExerciseCard: GitExerciseCard,
    ExampleRunner: GitExampleRunner,
    PredictResult: GitPredictResult,
    PredictSetup: GitPredictSetup,
    ProjectView: GitProjectView,
    extraPages: [{ path: '/playground', label: mark('Playground'), Component: GitPlayground }],
    games: {
      stagemanager: lazy(() => import('./games/StageManager')),
      branchrunner: lazy(() => import('./games/BranchRunner')),
      conflictdoctor: lazy(() => import('./games/ConflictDoctor')),
      pushpull: lazy(() => import('./games/PushPullRace')),
    },
  },
};
