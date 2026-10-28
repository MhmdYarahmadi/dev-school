import { useEffect, useState } from 'react';
import { EDGE_FIELDS, FIELDS, KIND_NAMES, type Design, type DesignNode, type Edge } from '../engine';
import { renameNode, removeNode, disconnect, setEdgeField, setField } from './designOps';
import { COMMON_INFO, EDGE_INFO, FIELD_INFO, ICONS, KIND_HELP, type FieldInfo } from './fields';

type FieldType = (typeof FIELDS)['app'][string];
const COMMON_TYPES: Record<string, FieldType> = { label: [], azs: 'azs', mtbfMs: 'number', mttrMs: 'number' };

export type Selection = { type: 'node'; id: string } | { type: 'edge'; from: string; to: string } | null;

/** The settings panel for the selected component or connection. */
export function Inspector({ design, sel, mode, onDesign, onSelect }: { design: Design; sel: Selection; mode: 'edit' | 'tune' | 'view'; onDesign: (d: Design) => void; onSelect: (s: Selection) => void }) {
  if (!sel) {
    return (
      <div className="sd-inspector muted small">
        {mode === 'view' ? 'Click a component or connection to see its settings.' : mode === 'tune' ? 'Click a component or connection to change its settings.' : 'Add components from the palette, drag from a component’s right edge to another to connect them, and click one to change its settings.'}
      </div>
    );
  }
  if (sel.type === 'edge') {
    const e = design.edges.find((x) => x.from === sel.from && x.to === sel.to);
    if (!e) return null;
    return <EdgePanel edge={e} design={design} mode={mode} onDesign={onDesign} onSelect={onSelect} />;
  }
  const n = design.nodes.find((x) => x.id === sel.id);
  if (!n) return null;
  return <NodePanel key={n.id} node={n} design={design} mode={mode} onDesign={onDesign} onSelect={onSelect} />;
}

function NodePanel({ node, design, mode, onDesign, onSelect }: { node: DesignNode; design: Design; mode: 'edit' | 'tune' | 'view'; onDesign: (d: Design) => void; onSelect: (s: Selection) => void }) {
  const [name, setName] = useState(node.id);
  const [err, setErr] = useState('');
  useEffect(() => setName(node.id), [node.id]);
  const rec = node as unknown as Record<string, unknown>;
  const info = FIELD_INFO[node.kind];
  const fields: [string, FieldType, FieldInfo][] = [
    ...Object.entries(FIELDS[node.kind]).map(([k, t]) => [k, t, info[k] ?? { help: '' }] as [string, FieldType, FieldInfo]),
    ...(node.kind === 'client' ? [] : Object.entries(COMMON_TYPES).filter(([k]) => k !== 'label').map(([k, t]) => [k, t, COMMON_INFO[k]] as [string, FieldType, FieldInfo])),
  ];
  const rename = () => {
    const r = renameNode(design, node.id, name.trim());
    if ('error' in r) {
      setErr(r.error);
      return;
    }
    setErr('');
    onDesign(r);
    onSelect({ type: 'node', id: name.trim() });
  };
  return (
    <div className="sd-inspector">
      <div className="row" style={{ gap: 6 }}>
        <span style={{ fontSize: '1.3rem' }}>{ICONS[node.kind]}</span>
        <b>{KIND_NAMES[node.kind]}</b>
        <div className="grow" />
        {mode === 'edit' && (
          <button className="btn ghost small" onClick={() => (onDesign(removeNode(design, node.id)), onSelect(null))} title="Remove this component and its connections">
            🗑 Remove
          </button>
        )}
      </div>
      <div className="small muted">{KIND_HELP[node.kind]}</div>
      <label className="sd-field">
        <span>Name</span>
        <input
          className="input"
          value={name}
          disabled={mode !== 'edit'}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === 'Enter' && rename()}
        />
      </label>
      {err && <div className="small bad-text">{err}</div>}
      {fields.length === 0 && <div className="small muted">No settings: set the traffic in the run settings.</div>}
      {fields.map(([k, t, fi]) => (
        <Field key={k} name={k} type={t} info={fi} value={rec[k]} disabled={mode === 'view'} onChange={(v) => onDesign(setField(design, node.id, k, v))} />
      ))}
    </div>
  );
}

function EdgePanel({ edge, design, mode, onDesign, onSelect }: { edge: Edge; design: Design; mode: 'edit' | 'tune' | 'view'; onDesign: (d: Design) => void; onSelect: (s: Selection) => void }) {
  const rec = edge as unknown as Record<string, unknown>;
  return (
    <div className="sd-inspector">
      <div className="row" style={{ gap: 6 }}>
        <b>
          {edge.from} → {edge.to}
        </b>
        <div className="grow" />
        {mode === 'edit' && (
          <button className="btn ghost small" onClick={() => (onDesign(disconnect(design, edge.from, edge.to)), onSelect(null))}>
            🗑 Remove
          </button>
        )}
      </div>
      <div className="small muted">How {edge.from} calls {edge.to}: timeouts, retries and protection when {edge.to} is slow or failing.</div>
      {Object.entries(EDGE_FIELDS).map(([k, t]) => (
        <Field key={k} name={k} type={t} info={EDGE_INFO[k]} value={rec[k]} disabled={mode === 'view'} onChange={(v) => onDesign(setEdgeField(design, edge.from, edge.to, k, v))} />
      ))}
    </div>
  );
}

const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

function Field({ name, type, info, value, disabled, onChange }: { name: string; type: FieldType; info: FieldInfo; value: unknown; disabled: boolean; onChange: (v: unknown) => void }) {
  const id = `f-${name}`;
  let input: React.ReactNode;
  if (Array.isArray(type) && type.length) {
    input = (
      <select id={id} className="input" value={(value as string) ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">default{info.def ? ` (${info.def})` : ''}</option>
        {type.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    );
  } else if (Array.isArray(type)) {
    input = <input id={id} className="input" value={(value as string) ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)} />;
  } else if (type === 'number' || type === 'int') {
    input = <NumberInput id={id} value={value as number | undefined} placeholder={info.def} disabled={disabled} int={type === 'int'} onChange={onChange} />;
  } else if (type === 'bool') {
    input = (
      <select id={id} className="input" value={value === undefined ? '' : String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}>
        <option value="">default{info.def ? ` (${info.def})` : ''}</option>
        <option value="true">yes</option>
        <option value="false">no</option>
      </select>
    );
  } else if (type === 'azs') {
    input = <AzInput id={id} value={value as string[] | undefined} disabled={disabled} onChange={onChange} placeholder={info.def} />;
  } else {
    return <GroupField name={name} info={info} value={value} disabled={disabled} onChange={onChange} />;
  }
  return (
    <label className="sd-field" htmlFor={id}>
      <span>
        <code>{name}</code>
      </span>
      {input}
      {info.help && <small className="muted">{info.help}</small>}
    </label>
  );
}

/** A number box that lets the learner type freely ("0.", "") and commits valid numbers. */
function NumberInput({ id, value, placeholder, disabled, int, onChange }: { id: string; value: number | undefined; placeholder?: string; disabled: boolean; int: boolean; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    if (num(text) !== value) setText(value === undefined ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      id={id}
      className="input"
      inputMode={int ? 'numeric' : 'decimal'}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const v = num(e.target.value);
        if (v === undefined || (Number.isFinite(v) && v >= 0 && (!int || Number.isInteger(v)))) onChange(v);
      }}
    />
  );
}

function AzInput({ id, value, disabled, onChange, placeholder }: { id: string; value: string[] | undefined; disabled: boolean; onChange: (v: unknown) => void; placeholder?: string }) {
  const [text, setText] = useState(value?.join(', ') ?? '');
  useEffect(() => {
    if ((value?.join(', ') ?? '') !== text.split(',').map((s) => s.trim()).filter(Boolean).join(', ')) setText(value?.join(', ') ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      id={id}
      className="input"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const list = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
        onChange(list.length ? list : undefined);
      }}
    />
  );
}

/** Grouped settings (autoscale, quorum, breaker, health checks): on/off plus their numbers. */
function GroupField({ name, info, value, disabled, onChange }: { name: string; info: FieldInfo; value: unknown; disabled: boolean; onChange: (v: unknown) => void }) {
  const sub = info.sub ?? {};
  const on = value !== undefined && value !== false;
  const obj = (on && typeof value === 'object' ? value : {}) as Record<string, number>;
  const canBeOff = name === 'healthCheck';
  const starter: Record<string, Record<string, number>> = {
    autoscale: { min: 2, max: 10 },
    quorum: { n: 3, w: 2, r: 2 },
    breaker: { failures: 5, resetMs: 5000 },
    healthCheck: {},
  };
  return (
    <fieldset className="sd-group" disabled={disabled}>
      <legend>
        <code>{name}</code>{' '}
        {canBeOff ? (
          <select className="input" style={{ width: 'auto', display: 'inline-block' }} value={value === false ? 'off' : value === undefined ? '' : 'custom'} onChange={(e) => onChange(e.target.value === 'off' ? false : e.target.value === '' ? undefined : { intervalMs: 5000, unhealthy: 2 })}>
            <option value="">default ({info.def})</option>
            <option value="custom">custom</option>
            <option value="off">off</option>
          </select>
        ) : (
          <label className="small">
            <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? starter[name] ?? {} : undefined)} /> on
          </label>
        )}
      </legend>
      <small className="muted">{info.help}</small>
      {on &&
        Object.entries(sub).map(([k, s]) => (
          <label key={k} className="sd-field sub">
            <span>
              <code>{k}</code>
            </span>
            <NumberInput
              id={`f-${name}-${k}`}
              value={obj[k]}
              placeholder={s.def}
              disabled={disabled}
              int={!/cpu|ratio/i.test(k)}
              onChange={(v) => {
                const next = { ...obj } as Record<string, unknown>;
                if (v === undefined) delete next[k];
                else next[k] = v;
                onChange(next);
              }}
            />
            <small className="muted">{s.help}</small>
          </label>
        ))}
    </fieldset>
  );
}
