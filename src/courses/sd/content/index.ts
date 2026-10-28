import type { Module } from '../../../content/types';
import { s01 } from './s01-foundations';
import { s02 } from './s02-estimation';
import { s03 } from './s03-compute';
import { s04 } from './s04-caching';
import { s05 } from './s05-databases';
import { s06 } from './s06-partitioning';
import { s07 } from './s07-async';
import { s08 } from './s08-consistency';
import { s09 } from './s09-reliability';
import { s10 } from './s10-together';

/** The System Design course's modules. */
export const SD_MODULES: Module[] = [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10];
