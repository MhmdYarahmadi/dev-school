import type { Module } from '../../../content/types';
import { p01 } from './p01-basics';
import { p02 } from './p02-variables';
import { p03 } from './p03-strings';
import { p04 } from './p04-numbers-input';
import { p05 } from './p05-conditionals';
import { p06 } from './p06-loops';
import { p07 } from './p07-lists';
import { p08 } from './p08-dicts';
import { p09 } from './p09-functions';

/** The Python course's modules (ported from the standalone pyschool course). */
export const PYTHON_MODULES: Module[] = [p01, p02, p03, p04, p05, p06, p07, p08, p09];
