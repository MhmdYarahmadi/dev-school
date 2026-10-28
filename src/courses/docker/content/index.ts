import type { Module } from '../../../content/types';
import { d01 } from './d01-images';
import { d02 } from './d02-lifecycle';
import { d03 } from './d03-ports';
import { d04 } from './d04-data';
import { d05 } from './d05-networks';
import { d06 } from './d06-dockerfile';
import { d07 } from './d07-images';
import { d08 } from './d08-compose';
import { d09 } from './d09-production';

/** The Docker course's modules. */
export const DOCKER_MODULES: Module[] = [d01, d02, d03, d04, d05, d06, d07, d08, d09];
