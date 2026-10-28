// Consistent copy of the database while the server keeps running.
// Usage (on the VPS): docker exec pgschool-app node server/backup.mjs
import { DatabaseSync } from 'node:sqlite';
import { existsSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.env.DATA_DIR ?? './data');
const out = join(dir, 'backup.db');
if (existsSync(out)) unlinkSync(out);
new DatabaseSync(join(dir, 'pgschool.db')).exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
console.log(`backup written: ${out}`);
