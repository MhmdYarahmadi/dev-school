import type { Module } from '../../../content/types';
import { g01 } from './g01-basics';
import { g02 } from './g02-history';
import { g03 } from './g03-branches';
import { g04 } from './g04-conflicts';
import { g05 } from './g05-remotes';
import { g06 } from './g06-team';

/** The Git course's modules. */
export const GIT_MODULES: Module[] = [g01, g02, g03, g04, g05, g06];
