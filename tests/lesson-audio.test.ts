/** Python lesson voiceovers: every file in src/courses/python/audio/ belongs to a real lesson. */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pythonContent } from '../src/courses/python/content';
import { pythonAudio } from '../src/courses/python/audio';

const DIR = resolve('src/courses/python/audio');
const ids = new Set(pythonContent.modules.flatMap((m) => m.concepts.map((c) => c.id)));
const files = (() => {
  try {
    return readdirSync(DIR).filter((f) => !f.startsWith('.'));
  } catch {
    return [];
  }
})();

describe('lesson voiceovers', () => {
  it('every recording is an .m4a named after a lesson id (a typo would hide it)', () => {
    for (const f of files) {
      expect(f, `${f} must be <lesson id>.m4a (made by scripts/audio/prepare.mjs)`).toMatch(/\.m4a$/);
      expect(ids.has(f.replace(/\.m4a$/, '')), `${f}: no lesson has this id`).toBe(true);
    }
  });

  it('the course finds every recording by its lesson id', () => {
    expect(Object.keys(pythonAudio).sort()).toEqual(files.map((f) => f.replace(/\.m4a$/, '')).sort());
  });
});
