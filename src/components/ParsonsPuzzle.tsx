import { Reorder } from 'framer-motion';
import { useMemo } from 'react';

interface Block {
  id: string;
  text: string;
}

/** Deterministic shuffle so the puzzle doesn't reshuffle on every render. */
export function shuffled<T>(xs: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function makeBlocks(id: string, blocks: string[], distractors: string[] = []): Block[] {
  const all = [...blocks, ...distractors].map((text, i) => ({ id: `${id}-${i}`, text }));
  return shuffled(all, id);
}

interface Props {
  pool: Block[];
  answer: Block[];
  onChange: (pool: Block[], answer: Block[]) => void;
  disabled?: boolean;
  /** What the assembled answer is called, e.g. 'query', 'commands', 'Dockerfile'. */
  noun?: string;
}

/**
 * Click a block to move it between the pool and your answer; drag to reorder
 * within the answer. Keyboard users can tab to blocks and press Enter.
 */
export function ParsonsPuzzle({ pool, answer, onChange, disabled, noun = 'query' }: Props) {
  const preview = useMemo(() => answer.map((b) => b.text).join('\n'), [answer]);
  return (
    <div className="stack">
      <div className="parsons">
        <div>
          <div className="small muted" style={{ marginBottom: 4 }}>Blocks (click to add). Not every block belongs!</div>
          <ul className="parsons-zone">
            {pool.map((b) => (
              <li key={b.id}>
                <button
                  className="block"
                  style={{ width: '100%' }}
                  disabled={disabled}
                  onClick={() => onChange(pool.filter((x) => x.id !== b.id), [...answer, b])}
                >
                  {b.text}
                </button>
              </li>
            ))}
            {pool.length === 0 && <li className="small muted">All blocks used.</li>}
          </ul>
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 4 }}>Your {noun} (drag ⋮⋮ to reorder, click to remove)</div>
          <Reorder.Group axis="y" values={answer} onReorder={(a) => onChange(pool, a)} className="parsons-zone answer">
            {answer.map((b) => (
              <Reorder.Item key={b.id} value={b} className="block" dragListener={!disabled}>
                <span className="handle" aria-hidden>⋮⋮</span>
                <span className="grow">{b.text}</span>
                <button
                  className="btn ghost small"
                  aria-label={`Remove ${b.text}`}
                  disabled={disabled}
                  onClick={() => onChange([...pool, b], answer.filter((x) => x.id !== b.id))}
                >
                  ✕
                </button>
              </Reorder.Item>
            ))}
            {answer.length === 0 && <li className="small muted" style={{ listStyle: 'none' }}>Click blocks on the left to build your {noun}.</li>}
          </Reorder.Group>
        </div>
      </div>
      {answer.length > 0 && <pre className="small" style={{ margin: 0 }}>{preview}</pre>}
    </div>
  );
}
