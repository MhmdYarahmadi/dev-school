import { applyNodeChanges, Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, type Connection, type EdgeChange, type Node, type NodeChange, type NodeProps, type Edge as RfEdge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor, usePrefersDark } from '../../../components/CodeEditor';
import { CONNECTS, designToYaml, KIND_NAMES, yamlToDesign, type Design, type DesignNode, type NodeKind, type NodeStats } from '../engine';
import { addNode, connect, disconnect, edgeSummary, layout, nodeSummary, removeNode } from './designOps';
import { ICONS, KIND_HELP } from './fields';
import { Inspector, type Selection } from './Inspector';
import './sd.css';

export type EditMode = 'edit' | 'tune' | 'view';

type SdNodeData = { node: DesignNode; stats?: NodeStats };
type SdFlowNode = Node<SdNodeData, 'sd'>;

const PALETTE: NodeKind[] = ['client', 'cdn', 'ratelimiter', 'lb', 'app', 'cache', 'db', 'queue', 'worker', 'objectstore', 'external'];
const EMPTY: Design = { nodes: [], edges: [] };
const BUSY_KINDS = new Set<NodeKind>(['app', 'db', 'cache', 'worker']);

const pct = (x: number) => `${Math.round(x * 100)}%`;
const level = (u: number) => (u >= 0.85 ? 'hot' : u >= 0.6 ? 'warm' : 'cool');

function statLine(s: NodeStats): string {
  const p: string[] = [];
  if (s.kind === 'cache' && s.hits !== undefined && s.misses !== undefined && s.hits + s.misses > 0) p.push(`${pct(s.hits / (s.hits + s.misses))} hits`);
  if (s.kind === 'queue') p.push(`backlog ${s.maxBacklog ?? 0} max`);
  if (s.replicaLagMs) p.push(`lag ${Math.round(s.replicaLagMs)} ms`);
  if (s.instances !== s.maxInstances) p.push(`${s.instances} now, ${s.maxInstances} max`);
  const errs = Object.values(s.errors).reduce((a, b) => a + b, 0);
  if (errs) p.push(`⚠ ${errs.toLocaleString('en')} errors`);
  if (s.uptime < 0.9999) p.push(`up ${(s.uptime * 100).toFixed(1)}%`);
  return p.join(' · ');
}

const SdNodeView = memo(function SdNodeView({ data, selected }: NodeProps<SdFlowNode>) {
  const { node, stats } = data;
  // only components with a real capacity (CPU, database work, cache thread) get a "busy" bar
  const busy = stats && BUSY_KINDS.has(stats.kind) ? stats.maxInstanceUtilisation : undefined;
  const takesCalls = node.kind !== 'client';
  const calls = CONNECTS[node.kind].length > 0;
  const sum = nodeSummary(node);
  return (
    <div className={`sd-node ${selected ? 'selected' : ''} ${busy !== undefined ? level(busy) : ''}`} title={KIND_HELP[node.kind]}>
      {takesCalls && <Handle type="target" position={Position.Left} />}
      <div className="sd-node-head">
        <span className="sd-node-icon" aria-hidden>
          {ICONS[node.kind]}
        </span>
        <span className="sd-node-name">{node.id}</span>
      </div>
      <div className="sd-node-kind">{KIND_NAMES[node.kind]}</div>
      {sum && <div className="sd-node-sum">{sum}</div>}
      {busy !== undefined && (
        <div className="sd-util" title={`Busiest instance ${pct(busy)} busy (average ${pct(stats!.utilisation)})`}>
          <div style={{ width: pct(Math.min(1, busy)) }} />
          <span>{pct(busy)} busy</span>
        </div>
      )}
      {stats && statLine(stats) && <div className="sd-node-stat">{statLine(stats)}</div>}
      {calls && <Handle type="source" position={Position.Right} />}
    </div>
  );
});

const NODE_TYPES = { sd: SdNodeView };
const FIT = { padding: 0.15, maxZoom: 1.1 };

/**
 * Fit the view once components are measured, when components are added or removed, and when the
 * canvas changes size (it may first render before its container is laid out).
 */
function AutoFit({ count, box }: { count: number; box: React.RefObject<HTMLDivElement | null> }) {
  const { fitView } = useReactFlow();
  const ready = useNodesInitialized();
  useEffect(() => {
    if (ready) void fitView(FIT);
  }, [ready, count, fitView]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = '';
    const ro = new ResizeObserver(([e]) => {
      const size = `${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`;
      if (size !== last && e.contentRect.width > 0) {
        last = size;
        void fitView(FIT);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [box, fitView]);
  return null;
}

export interface DesignEditorProps {
  /** The design as YAML (components + connections). */
  value: string;
  onChange?: (yaml: string) => void;
  /** edit: anything; tune: settings only; view: read-only. */
  mode?: EditMode;
  /** Colour components by how busy they were in this run. */
  stats?: Record<string, NodeStats>;
  height?: number;
}

/** The design canvas with its settings panel, and a YAML tab showing the same design as text. */
export function DesignEditor(props: DesignEditorProps) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}

function EditorInner({ value, onChange, mode = 'edit', stats, height = 380 }: DesignEditorProps) {
  const dark = usePrefersDark();
  const [tab, setTab] = useState<'canvas' | 'yaml'>('canvas');
  const parsed = useMemo(() => yamlToDesign(value), [value]);
  const lastGood = useRef<Design>(EMPTY);
  if (parsed.design) lastGood.current = parsed.design;
  const design = parsed.design ?? lastGood.current;
  const [sel, setSel] = useState<Selection>(null);
  const [msg, setMsg] = useState('');
  const positions = useRef<Record<string, { x: number; y: number }>>({});
  const editable = mode === 'edit' && !!onChange;
  const box = useRef<HTMLDivElement>(null);

  // Positions: keep where the learner put things; new components get the auto layout, or a free spot.
  const auto = useMemo(() => layout(design), [design]);
  for (const n of design.nodes) {
    if (positions.current[n.id]) continue;
    const known = Object.values(positions.current);
    const spot = auto[n.id];
    const taken = known.some((p) => Math.abs(p.x - spot.x) < 150 && Math.abs(p.y - spot.y) < 80);
    positions.current[n.id] = taken ? { x: Math.max(0, ...known.map((p) => p.x)) / 2, y: Math.max(0, ...known.map((p) => p.y)) + 120 } : spot;
  }

  const build = (prev: SdFlowNode[]): SdFlowNode[] =>
    design.nodes.map((n) => ({
      id: n.id,
      type: 'sd',
      position: positions.current[n.id],
      data: { node: n, stats: stats?.[n.id] },
      selected: sel?.type === 'node' && sel.id === n.id,
      deletable: editable,
      // keep the measured size so edges stay attached while the node re-renders
      measured: prev.find((p) => p.id === n.id)?.measured,
    }));
  const [nodes, setNodes] = useState<SdFlowNode[]>(() => build([]));
  useEffect(() => {
    setNodes(build);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, stats, sel, editable]);

  const edges: RfEdge[] = useMemo(
    () =>
      design.edges.map((e) => ({
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        label: edgeSummary(e) || undefined,
        markerEnd: { type: MarkerType.ArrowClosed },
        selected: sel?.type === 'edge' && sel.from === e.from && sel.to === e.to,
        deletable: editable,
        className: 'sd-edge',
      })),
    [design, sel, editable],
  );

  const emit = (d: Design) => {
    setMsg('');
    onChange?.(designToYaml(d));
  };

  const onNodesChange = (changes: NodeChange<SdFlowNode>[]) => {
    let d = design;
    let removed = false;
    for (const c of changes) {
      if (c.type === 'position' && c.position) positions.current[c.id] = c.position;
      if (c.type === 'select') setSel(c.selected ? { type: 'node', id: c.id } : (s) => (s?.type === 'node' && s.id === c.id ? null : s));
      if (c.type === 'remove' && editable) {
        d = removeNode(d, c.id);
        delete positions.current[c.id];
        removed = true;
      }
    }
    setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type !== 'remove' && c.type !== 'select'), ns));
    if (removed) {
      setSel(null);
      emit(d);
    }
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    let d = design;
    let removed = false;
    for (const c of changes) {
      if (c.type === 'select') {
        const [from, to] = c.id.split('->');
        setSel(c.selected ? { type: 'edge', from, to } : (s) => (s?.type === 'edge' && `${s.from}->${s.to}` === c.id ? null : s));
      }
      if (c.type === 'remove' && editable) {
        const [from, to] = c.id.split('->');
        d = disconnect(d, from, to);
        removed = true;
      }
    }
    if (removed) {
      setSel(null);
      emit(d);
    }
  };

  const onConnect = (c: Connection) => {
    if (!editable || !c.source || !c.target) return;
    const r = connect(design, c.source, c.target);
    if ('error' in r) setMsg(r.error);
    else emit(r);
  };

  const add = (kind: NodeKind) => {
    const r = addNode(design, kind);
    if ('error' in r) {
      setMsg(r.error);
      return;
    }
    emit(r.design);
    setSel({ type: 'node', id: r.id });
  };

  return (
    <div className="sd-editor">
      <div className="sd-editor-bar">
        <div className="seg" role="tablist" aria-label="Design view">
          <button role="tab" aria-selected={tab === 'canvas'} className={tab === 'canvas' ? 'on' : ''} onClick={() => setTab('canvas')}>
            🧩 Canvas
          </button>
          <button role="tab" aria-selected={tab === 'yaml'} className={tab === 'yaml' ? 'on' : ''} onClick={() => setTab('yaml')}>
            📝 YAML
          </button>
        </div>
        {tab === 'canvas' && editable && (
          <div className="sd-palette" aria-label="Add a component">
            {PALETTE.map((k) => (
              <button key={k} className="btn small" onClick={() => add(k)} title={`Add: ${KIND_HELP[k]}`} disabled={k === 'client' && design.nodes.some((n) => n.kind === 'client')}>
                {ICONS[k]} {KIND_NAMES[k]}
              </button>
            ))}
          </div>
        )}
        {mode === 'tune' && <span className="small muted">Tune it: change settings only.</span>}
        {mode === 'view' && <span className="small muted">Read-only.</span>}
      </div>
      {msg && <div className="callout warn small">{msg}</div>}
      {tab === 'canvas' ? (
        <div className="sd-editor-main">
          <div className="sd-canvas" style={{ height }} ref={box}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onPaneClick={() => setSel(null)}
              nodesConnectable={editable}
              nodesDraggable
              deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
              colorMode={dark ? 'dark' : 'light'}
              fitView
              fitViewOptions={FIT}
              minZoom={0.3}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} size={1} />
              <Controls showInteractive={false} fitViewOptions={FIT} />
              <AutoFit count={design.nodes.length} box={box} />
            </ReactFlow>
          </div>
          <Inspector design={design} sel={sel} mode={onChange ? mode : 'view'} onDesign={emit} onSelect={setSel} />
        </div>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          <CodeEditor value={value} onChange={(v) => onChange?.(v)} lang="yaml" minHeight={`${Math.min(height, 320)}px`} readOnly={!onChange || mode === 'view'} />
          {parsed.errors.length > 0 && (
            <div className="callout bad small">
              {parsed.errors.slice(0, 6).map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
