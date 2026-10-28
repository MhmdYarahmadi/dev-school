import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { extractContent, extractUi } from './i18n/extract';
// Run by scripts/i18n/extract.sh: rewrites the English source files for translation.
it('extract', () => {
  writeFileSync('src/i18n/ui.en.json', JSON.stringify(extractUi(), null, 1) + '\n');
  writeFileSync('src/i18n/git.en.json', JSON.stringify(extractContent(), null, 1) + '\n');
});
