import { it } from 'vitest';
import { runSandboxed } from '../src/db/runQuery';
import { displayValue } from '../src/db/values';
it('q', async () => {
  const qs = (process.env.Q ?? '').split('|||');
  for (const q of qs) {
    const r = await runSandboxed(q);
    console.log('>>', q);
    if (!r.ok) { console.log('ERR', r.error.message); continue; }
    const s = r.last!;
    console.log(s.columns.join(' | '));
    for (const row of s.rows.slice(0, 40)) console.log(row.map((v, i) => displayValue(v, s.typeIds[i])).join(' | '));
    console.log(`(${s.rows.length} rows)`);
  }
});
