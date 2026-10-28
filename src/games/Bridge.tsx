import { motion } from 'framer-motion';
import type { ResultSet } from '../db/runQuery';
import { canonicalRow, displayValue } from '../db/values';
import { GameShell } from './kit';
import { QueryRounds } from './QueryRounds';
import { BRIDGE_LEVELS } from './levels/queryGames';

interface Pair {
  left: string | null;
  right: string | null;
}

function pairs(set: ResultSet | null): Pair[] {
  return (set?.rows ?? []).map((r) => ({
    left: r[0] === null ? null : displayValue(r[0], set!.typeIds[0]),
    right: r[1] === null ? null : displayValue(r[1], set!.typeIds[1]),
  }));
}

/** Two river banks; every result row is a bridge (or a stranded node when one side is NULL). */
function River({ target, mine }: { target: ResultSet; mine: ResultSet | null }) {
  const tp = pairs(target);
  const mp = pairs(mine);
  const lefts = [...new Set([...tp, ...mp].map((p) => p.left).filter((x): x is string => x !== null))].sort();
  const rights = [...new Set([...tp, ...mp].map((p) => p.right).filter((x): x is string => x !== null))].sort();
  const rowH = 30;
  const h = Math.max(lefts.length, rights.length) * rowH + 40;
  const W = 520;
  const ly = (v: string) => 30 + lefts.indexOf(v) * rowH;
  const ry = (v: string) => 30 + rights.indexOf(v) * rowH;
  const targetKeys = new Set(target.rows.map((r) => canonicalRow(r, target.typeIds)));

  const strandedL = (ps: Pair[]) => new Set(ps.filter((p) => p.right === null && p.left !== null).map((p) => p.left));
  const strandedR = (ps: Pair[]) => new Set(ps.filter((p) => p.left === null && p.right !== null).map((p) => p.right));
  const tL = strandedL(tp);
  const tR = strandedR(tp);
  const mL = strandedL(mp);
  const mR = strandedR(mp);

  return (
    <div className="card">
      <div className="row small muted" style={{ marginBottom: 4 }}>
        <span>— — target bridge</span><span style={{ color: 'var(--good)' }}>━ your bridge (correct)</span><span style={{ color: 'var(--bad)' }}>━ your bridge (wrong)</span><span>⚑ kept without a partner</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${h}`} className="bridge-svg" style={{ minWidth: 420 }} role="img" aria-label="Join diagram">
          <rect x={150} y={0} width={W - 300} height={h} fill="var(--accent-soft)" opacity={0.6} rx={10} />
          <text x={W / 2} y={16} textAnchor="middle" style={{ fill: 'var(--muted)' }}>~ ~ river ~ ~</text>
          {tp.filter((p) => p.left && p.right).map((p, i) => (
            <line key={`t${i}`} x1={150} y1={ly(p.left!)} x2={W - 150} y2={ry(p.right!)} stroke="var(--muted)" strokeDasharray="5 5" strokeWidth={1.5} />
          ))}
          {(mine?.rows ?? []).map((r, i) => {
            const p = mp[i];
            if (!p.left || !p.right) return null;
            const ok = targetKeys.has(canonicalRow(r, mine!.typeIds));
            return (
              <motion.line
                key={`m${i}`}
                x1={150} y1={ly(p.left)} x2={W - 150} y2={ry(p.right)}
                stroke={ok ? 'var(--good)' : 'var(--bad)'} strokeWidth={3.5}
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: i * 0.05 }}
              />
            );
          })}
          {lefts.map((v) => (
            <g key={`l${v}`}>
              <rect x={10} y={ly(v) - 11} width={135} height={22} rx={5} fill="var(--surface)" stroke={tL.has(v) || mL.has(v) ? 'var(--warn)' : 'var(--border)'} />
              <text x={18} y={ly(v) + 4}>{(mL.has(v) ? '⚑ ' : '') + v}</text>
            </g>
          ))}
          {rights.map((v) => (
            <g key={`r${v}`}>
              <rect x={W - 145} y={ry(v) - 11} width={135} height={22} rx={5} fill="var(--surface)" stroke={tR.has(v) || mR.has(v) ? 'var(--warn)' : 'var(--border)'} />
              <text x={W - 137} y={ry(v) + 4}>{(mR.has(v) ? '⚑ ' : '') + v}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="small muted">Rows in target: {target.rows.length}{mine ? ` · rows in yours: ${mine.rows.length}` : ''}</div>
    </div>
  );
}

export default function Bridge() {
  return (
    <GameShell
      gameId="bridge"
      intro={
        <>
          <p>🌉 Heroes live on the west bank, guilds on the east: <code>heroes(hero_id, hero, guild_id, mentor_id)</code>, <code>guilds(guild_id, guild, city_id)</code>, <code>cities(city_id, city)</code>.</p>
          <p>Every row your JOIN returns becomes a <b>bridge</b> between its first and second column. A row with a NULL side is a hero (or guild) kept <b>without a partner</b> ⚑.</p>
          <p>Match the dashed target bridges exactly. Watch out for Dax (no guild), Finn (a guild that doesn't exist) and the Druids (no members)!</p>
        </>
      }
    >
      {(finish, key) => <QueryRounds key={key} levels={BRIDGE_LEVELS} finish={finish} visual={({ target, mine }) => <River target={target} mine={mine} />} />}
    </GameShell>
  );
}
