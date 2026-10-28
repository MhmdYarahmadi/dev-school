import { useState } from 'react';
import { h } from '../shared/course';
import { useProgress } from '../progress/store';

/** A personal SQL reference that fills up as you master concepts. */
export default function CheatSheetPage() {
  const p = useProgress();
  const [q, setQ] = useState('');
  const mastered = h().masteredConcepts(p.exercises);
  const all = h().allConcepts();
  const unlocked = all.filter(({ concept }) => mastered.has(concept.id));
  const shown = unlocked.filter(({ concept }) =>
    (concept.title + concept.cheat.syntax + concept.cheat.note).toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0 }}>📇 Your cheat sheet</h1>
        <span className="tag accent">{unlocked.length} / {all.length} cards</span>
        <div className="grow" />
        <input
          type="search"
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit' }}
        />
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        A card appears here when you solve a practice exercise that uses the concept. It's your own reference, built from what you've actually done.
      </p>
      <div className="cheat-grid">
        {shown.map(({ concept, module }) => (
          <div key={concept.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{concept.title}</b>
              <span className="tag">M{module.number}</span>
            </div>
            <pre>{concept.cheat.syntax}</pre>
            <div className="small">{concept.cheat.note}</div>
          </div>
        ))}
        {!q && all.filter(({ concept }) => !mastered.has(concept.id)).slice(0, 6).map(({ concept, module }) => (
          <div key={concept.id} className="card locked-card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>🔒 {concept.title}</span>
              <span className="tag">M{module.number}</span>
            </div>
            <div className="small">Solve a practice exercise on this to unlock the card.</div>
          </div>
        ))}
      </div>
    </div>
  );
}
