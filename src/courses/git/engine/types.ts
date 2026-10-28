/** What a command prints and what it did (the events drive the live commit graph). */

export type LineKind = 'out' | 'err' | 'dim' | 'ok' | 'info';

export interface Line {
  text: string;
  kind: LineKind;
  /** Printed without a newline at the end (echo -n, printf, a file without one). */
  noNewline?: boolean;
}

/**
 * Something a command did to a repository. Repository ids: 'learner:/home/learner/shop'
 * for a local one, 'hub:team/shop' for one on the hub.
 */
export type GitEvent =
  | { type: 'commit'; repo: string; sha: string; parents: string[]; kind: 'commit' | 'merge' | 'revert' }
  /** A branch or remote-tracking ref was created (from null), moved, or deleted (to null). */
  | { type: 'ref'; repo: string; ref: string; from: string | null; to: string | null; fastForward: boolean }
  /** HEAD moved to another branch or commit. */
  | { type: 'head'; repo: string; from: string | null; to: string | null; branch: string | null }
  | { type: 'transfer'; kind: 'clone' | 'fetch' | 'push'; from: string; to: string; commits: string[] }
  | { type: 'conflict'; repo: string; paths: string[] }
  | { type: 'repo'; repo: string; action: 'init' | 'delete' }
  | { type: 'pr'; repo: string; number: number; action: 'opened' | 'updated' | 'reviewed' | 'commented' | 'merged' | 'closed' };

export interface ExecResult {
  lines: Line[];
  exitCode: number;
  events: GitEvent[];
}

export class Out {
  lines: Line[] = [];
  add(text: string, kind: LineKind = 'out') {
    for (const t of text.split('\n')) this.lines.push({ text: t, kind });
  }
  err(text: string) {
    this.add(text, 'err');
  }
}

/** Thrown by a command to stop with an error message (stderr) and an exit code. */
export class CliError extends Error {
  constructor(
    public text: string,
    public code: number,
  ) {
    super(text);
  }
}
