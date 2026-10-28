import { makeHelpers, PASS_MARK } from '../shared/course';
import type { Module } from './types';
import { m01 } from './modules/m01-select';
import { m02 } from './modules/m02-where';
import { m03 } from './modules/m03-order';
import { m04 } from './modules/m04-expressions';
import { m05 } from './modules/m05-aggregates';
import { m06 } from './modules/m06-joins';
import { m07 } from './modules/m07-subqueries';
import { m08 } from './modules/m08-dml';
import { m09 } from './modules/m09-ddl';
import { m10 } from './modules/m10-power';

/** The PostgreSQL course's modules. */
export const MODULES: Module[] = [m01, m02, m03, m04, m05, m06, m07, m08, m09, m10];
export { PASS_MARK };

const helpers = makeHelpers(MODULES);
export const { getModule, findItem, allItems, allConcepts, isUnlocked, composeTest, masteredConcepts } = helpers;
