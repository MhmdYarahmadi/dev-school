import { motion } from 'framer-motion';
import type { ResultSet } from '../db/runQuery';
import { canonicalValue, displayValue } from '../db/values';
import { GameShell } from './kit';
import { QueryRounds } from './QueryRounds';
import { WAREHOUSE_LEVELS } from './levels/queryGames';

/** Buckets: one per group (column 1), sized by the value (column 2). */
function Buckets({ target, mine }: { target: ResultSet; mine: ResultSet | null }) {
  const labelOf = (s: ResultSet, r: unknown[]) => displayValue(r[0], s.typeIds[0]);
  const valueOf = (r: unknown[]) => Number(r[1]);
  const mineMap = new Map((mine?.rows ?? []).map((r) => [labelOf(mine!, r), r]));
  const labels = [...new Set([...target.rows.map((r) => labelOf(target, r)), ...(mine?.rows ?? []).map((r) => labelOf(mine!, r))])];
  const max = Math.max(1, ...target.rows.map(valueOf), ...(mine?.rows ?? []).map(valueOf).filter(Number.isFinite));
  const targetMap = new Map(target.rows.map((r) => [labelOf(target, r), r]));

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row small muted">
        <span><span className="bucket-chip" style={{ background: 'transparent', border: '2px dashed var(--muted)' }} /> target</span>
        <span><span className="bucket-chip" /> your result</span>
        <span>✅ match · ❌ wrong · 👻 shouldn't exist</span>
      </div>
      {labels.map((label) => {
        const t = targetMap.get(label);
        const m = mineMap.get(label);
        const ok = t && m && m.length === t.length && m.every((v, i) => canonicalValue(v, mine!.typeIds[i]) === canonicalValue(t[i], target.typeIds[i]));
        return (
          <div key={label} className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
            <span style={{ width: 150, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis' }} className="mono small">📦 {label}</span>
            <div style={{ position: 'relative', flex: 1, height: 26 }}>
              {t && (
                <div style={{ position: 'absolute', inset: 0, width: `${(valueOf(t) / max) * 100}%`, border: '2px dashed var(--muted)', borderRadius: 6 }} />
              )}
              {m && (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(valueOf(m) / max) * 100}%` }}
                  transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                  style={{ position: 'absolute', top: 4, bottom: 4, left: 0, background: ok ? 'var(--good)' : 'var(--accent)', borderRadius: 4, opacity: 0.85 }}
                />
              )}
            </div>
            <span className="small mono" style={{ width: 120, textAlign: 'right' }}>
              {m ? displayValue(m[1], mine!.typeIds[1]) : '–'} / {t ? displayValue(t[1], target.typeIds[1]) : '–'}
            </span>
            <span style={{ width: 22 }}>{!m ? '' : !t ? '👻' : ok ? '✅' : '❌'}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Warehouse() {
  return (
    <GameShell
      gameId="warehouse"
      intro={
        <>
          <p>📦 Every round shows a set of <b>target buckets</b> (dashed). Write a <code>GROUP BY</code> query whose result fills exactly those buckets: the first column is the bucket label, the second its size.</p>
          <p>Use <b>HAVING</b> to clear out the buckets that shouldn't be there. Press Run to see your buckets fill up.</p>
        </>
      }
    >
      {(finish, key) => <QueryRounds key={key} levels={WAREHOUSE_LEVELS} finish={finish} visual={({ target, mine }) => <Buckets target={target} mine={mine} />} />}
    </GameShell>
  );
}
