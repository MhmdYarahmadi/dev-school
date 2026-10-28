import type { Exercise } from '../../../content/types';

/** The tag on an exercise card. Data only (the admin dashboard imports the course content). */
export function sdKindLabel(ex: Exercise): string {
  if (ex.sd?.target === 'estimate') return '🧮 Estimate';
  switch (ex.kind) {
    case 'write':
      return '🏗️ Design it';
    case 'fixBug':
      return ex.sd?.tuneOnly ? '🎛️ Tune it' : '🔧 Fix the design';
    case 'fillBlank':
      return '🧩 Fill in the blanks';
    case 'parsons':
      return '🧱 Put in order';
    case 'readQuery':
      return ex.sql ? '🔎 Diagnose' : '👀 Read and decide';
  }
}

/** Short names in the practice list. */
export function sdShortLabel(ex: Exercise): string {
  return sdKindLabel(ex).replace(/^\S+\s/, '');
}
