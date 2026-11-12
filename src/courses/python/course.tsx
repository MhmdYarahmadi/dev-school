import { lazy } from 'react';
import type { Course } from '../../shared/course';
import { pythonAudio } from './audio';
import { pythonContent } from './content';
import { PyExampleRunner, PyPredictResult } from './ui/PyExample';
import { PyExerciseCard } from './ui/PyExerciseCard';
import { PyProjectView } from './ui/PyProjectView';

export const pythonCourse: Course = {
  ...pythonContent,
  ui: {
    ExerciseCard: PyExerciseCard,
    ExampleRunner: PyExampleRunner,
    PredictResult: PyPredictResult,
    ProjectView: PyProjectView,
    lessonAudio: pythonAudio,
    games: {
      outputPredictor: lazy(() => import('./games/OutputPredictor')),
    },
  },
};
