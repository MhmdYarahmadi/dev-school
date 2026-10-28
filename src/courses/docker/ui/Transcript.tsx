import { useState } from 'react';
import type { TranscriptEntry } from '../check';

/** Read-only terminal output: the commands that ran and what they printed. */
export function TranscriptView({ entries, maxHeight = 320 }: { entries: TranscriptEntry[]; maxHeight?: number }) {
  if (!entries.length) return null;
  return (
    <div className="term static" style={{ maxHeight }}>
      <div className="term-screen">
        {entries.map((e, i) => (
          <div key={i}>
            <div className="term-cmd">
              <span className="term-ps1">$</span> {e.cmd}
            </div>
            {e.lines.map((l, j) => (
              <div key={j} className={`term-line term-${l.kind}`}>
                {l.text || ' '}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The project folder's files, one tab each. */
export function FilesView({ files, title = 'Project files' }: { files: Record<string, string>; title?: string }) {
  const names = Object.keys(files);
  const [open, setOpen] = useState(names[0]);
  if (!names.length) return null;
  return (
    <div className="files-view">
      <div className="files-tabs">
        <span className="small muted">📁 {title}:</span>
        {names.map((n) => (
          <button key={n} type="button" className={`files-tab ${n === open ? 'on' : ''}`} onClick={() => setOpen(n)}>
            {n}
          </button>
        ))}
      </div>
      <pre className="files-body">{files[open ?? names[0]]}</pre>
    </div>
  );
}
