import { LayoutGroup, motion } from 'framer-motion';
import { layout, type GraphData, type GraphLabel } from './graphLayout';

const ROW = 30;
const LANE = 20;
const PAD = 12;
const COLORS = ['var(--accent)', 'var(--good)', 'var(--warn)', '#b45ad6', '#d65a8a', '#3aa6a6'];

/** Where newly drawn commits fly in from (e.g. pushed commits arrive on the hub from the left). */
export type Arrivals = Record<string, 'left' | 'right'>;

/** M p0 L p1 C c1 c2 p2 L p3: every edge has the same shape, so moving edges animate smoothly. */
function edgePath(x1: number, y1: number, x2: number, y2: number, bendAt: 'end' | 'start'): string {
  const h = ROW * 0.4;
  const ya = x1 === x2 ? y1 : bendAt === 'end' ? Math.max(y1, y2 - 2 * h) : y1;
  const yb = x1 === x2 ? y1 : ya + 2 * h;
  return `M ${x1} ${y1} L ${x1} ${ya} C ${x1} ${ya + h} ${x2} ${yb - h} ${x2} ${yb} L ${x2} ${x1 === x2 ? y2 : Math.max(yb, y2)}`;
}

function Chip({ panel, label }: { panel: string; label: GraphLabel }) {
  const text = label.current ? `HEAD → ${label.name}` : label.name;
  return (
    <motion.span layout layoutId={`${panel}:${label.kind}:${label.name}`} className={`gchip ${label.kind}${label.current ? ' current' : ''}`} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
      {text}
    </motion.span>
  );
}

function Panel({ g, arrivals, slow }: { g: GraphData; arrivals?: Arrivals; slow?: boolean }) {
  const { nodes, edges, lanes } = layout(g);
  const pos = new Map(nodes.map((n) => [n.sha, n]));
  const width = PAD * 2 + lanes * LANE;
  const height = Math.max(1, g.commits.length) * ROW + 4;
  const x = (lane: number) => PAD + lane * LANE + LANE / 2;
  const y = (row: number) => row * ROW + ROW / 2;
  const t = { duration: slow ? 0.9 : 0.35, ease: 'easeOut' as const };
  const from = (sha: string) => (arrivals?.[sha] === 'left' ? -120 : arrivals?.[sha] === 'right' ? 120 : 0);
  const unborn = g.head && !g.head.sha;
  return (
    <div className="gpanel">
      <div className="gpanel-head">
        <span>{g.title}</span>
        {g.hidden > 0 && <span className="small muted">+{g.hidden} older</span>}
      </div>
      {g.commits.length === 0 ? (
        <div className="gempty">
          {unborn ? (
            <>
              No commits yet. <span className="gchip branch current">HEAD → {g.head!.branch}</span> is waiting for the first commit.
            </>
          ) : (
            'No commits yet.'
          )}
        </div>
      ) : (
        <div className="gbody" style={{ height }}>
          <svg width={width} height={height} className="gsvg" aria-hidden>
            {edges.map((e) => {
              const p = e.path;
              const lane = p.bendAt === 'start' ? p.x2 : p.x1;
              const d = edgePath(x(p.x1), y(p.y1), x(p.x2), e.open ? p.y2 * ROW : y(p.y2), p.bendAt);
              return (
                <motion.path
                  key={`${e.from}-${e.to}`}
                  initial={{ d, opacity: 0 }}
                  animate={{ d, opacity: 1 }}
                  transition={t}
                  fill="none"
                  stroke={COLORS[lane % COLORS.length]}
                  strokeWidth={2}
                  strokeDasharray={e.open ? '3 4' : undefined}
                />
              );
            })}
            {g.mergeHead && g.head?.sha && pos.get(g.mergeHead) && pos.get(g.head.sha) && (
              <path d={`M ${x(pos.get(g.head.sha)!.lane)} ${y(pos.get(g.head.sha)!.row)} C ${x(lanes)} ${y(pos.get(g.head.sha)!.row)} ${x(lanes)} ${y(pos.get(g.mergeHead)!.row)} ${x(pos.get(g.mergeHead)!.lane)} ${y(pos.get(g.mergeHead)!.row)}`} fill="none" stroke="var(--bad)" strokeWidth={2} strokeDasharray="4 4" />
            )}
            {nodes.map((n) => {
              const c = g.commits[n.row];
              const merge = c.parents.length > 1;
              return (
                <motion.circle
                  key={n.sha}
                  initial={{ cx: x(n.lane) + from(n.sha), cy: y(n.row), r: 0 }}
                  animate={{ cx: x(n.lane), cy: y(n.row), r: merge ? 7 : 6 }}
                  transition={t}
                  fill={merge ? 'var(--surface)' : COLORS[n.lane % COLORS.length]}
                  stroke={COLORS[n.lane % COLORS.length]}
                  strokeWidth={merge ? 3 : 2}
                />
              );
            })}
          </svg>
          <div className="grows" style={{ left: width }}>
            {nodes.map((n) => {
              const c = g.commits[n.row];
              const labels = g.labels[n.sha] ?? [];
              const head = labels.filter((l) => l.current || l.kind === 'head');
              const rest = labels.filter((l) => !l.current && l.kind !== 'head');
              return (
                <motion.div
                  key={n.sha}
                  className="grow-row"
                  initial={{ top: n.row * ROW, opacity: 0, x: from(n.sha) }}
                  animate={{ top: n.row * ROW, opacity: 1, x: 0 }}
                  transition={t}
                  style={{ height: ROW }}
                  title={g.anonymous ? c.subject : `${c.sha}\n${c.author}\n${c.subject}`}
                >
                  {[...head, ...rest].map((l) => (
                    <Chip key={`${l.kind}:${l.name}`} panel={g.id} label={l} />
                  ))}
                  {g.mergeHead === n.sha && <span className="gchip merge">MERGE_HEAD</span>}
                  {!g.anonymous && <span className="gsha">{c.sha.slice(0, 7)}</span>}
                  <span className="gmsg">{c.subject}</span>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** The live commit graph: one panel per repository (yours, and the hub's when you have a remote). */
export function GraphView({ graphs, arrivals, slow }: { graphs: GraphData[]; arrivals?: Record<string, Arrivals>; slow?: boolean }) {
  if (!graphs.length) return <div className="gempty">No repository here yet. Run <code>git init</code> (or <code>cd</code> into one) and the graph appears.</div>;
  return (
    <LayoutGroup>
      <div className={`gview ${graphs.length > 1 ? 'two' : ''}`}>
        {graphs.map((g) => (
          <Panel key={g.id} g={g} arrivals={arrivals?.[g.id]} slow={slow} />
        ))}
      </div>
    </LayoutGroup>
  );
}
