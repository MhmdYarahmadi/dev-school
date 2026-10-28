/** The simulated Docker engine. Importing this module wires up `docker build` and `docker compose`. */
import './dockerfile';
import './compose';
export { DockerEngine, type EngineOptions } from './engine';
export { buildSteps, lintDockerfile, parseDockerfile } from './dockerfile';
export { loadCompose } from './compose';
export { CATALOG } from './catalog';
export type * from './types';
