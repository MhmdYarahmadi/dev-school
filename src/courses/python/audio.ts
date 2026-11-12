/**
 * Voiceovers for Python lessons: src/courses/python/audio/<concept id>.m4a, made from raw recordings
 * by scripts/audio/prepare.mjs. A lesson without a file simply has no Listen button.
 */
const files = import.meta.glob<string>('./audio/*.m4a', { query: '?url', import: 'default', eager: true });

export const pythonAudio: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.slice('./audio/'.length, -'.m4a'.length), url]),
);
