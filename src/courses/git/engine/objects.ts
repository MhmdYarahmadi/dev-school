/**
 * Git's object database: blobs (file contents), trees (folders) and commits,
 * serialised byte for byte the way Git does it, so every hash is the real one.
 */
import { sha1, utf8 } from './sha1';

export interface Signature {
  name: string;
  email: string;
  /** Unix seconds. */
  time: number;
}

export interface TreeEntry {
  mode: '100644' | '40000';
  name: string;
  sha: string;
}

export interface Commit {
  type: 'commit';
  tree: string;
  parents: string[];
  author: Signature;
  committer: Signature;
  /** Always ends with a newline, as Git stores it. */
  message: string;
}

export type GitObject = { type: 'blob'; content: string } | { type: 'tree'; entries: TreeEntry[] } | Commit;

const sig = (s: Signature) => `${s.name} <${s.email}> ${s.time} +0000`;

function hexBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < 40; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

function body(o: GitObject): Uint8Array {
  if (o.type === 'blob') return utf8(o.content);
  if (o.type === 'commit') {
    const head = [`tree ${o.tree}`, ...o.parents.map((p) => `parent ${p}`), `author ${sig(o.author)}`, `committer ${sig(o.committer)}`];
    return utf8(head.join('\n') + '\n\n' + o.message);
  }
  const parts: number[] = [];
  for (const e of o.entries) parts.push(...utf8(`${e.mode} ${e.name}\0`), ...hexBytes(e.sha));
  return Uint8Array.from(parts);
}

export function hashObject(o: GitObject): string {
  const b = body(o);
  const header = utf8(`${o.type} ${b.length}\0`);
  const all = new Uint8Array(header.length + b.length);
  all.set(header);
  all.set(b, header.length);
  return sha1(all);
}

/** Git sorts tree entries by name, comparing a folder as if its name ended in '/'. */
export function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  const key = (e: TreeEntry) => (e.mode === '40000' ? e.name + '/' : e.name);
  return [...entries].sort((a, b) => {
    const x = utf8(key(a));
    const y = utf8(key(b));
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
    return x.length - y.length;
  });
}

export class ObjectStore {
  objects = new Map<string, GitObject>();

  put(o: GitObject): string {
    const sha = hashObject(o);
    if (!this.objects.has(sha)) this.objects.set(sha, o);
    return sha;
  }

  get(sha: string): GitObject | undefined {
    return this.objects.get(sha);
  }

  has(sha: string): boolean {
    return this.objects.has(sha);
  }

  commit(sha: string): Commit {
    const o = this.objects.get(sha);
    if (!o || o.type !== 'commit') throw new Error(`not a commit: ${sha}`);
    return o;
  }

  blob(sha: string): string {
    const o = this.objects.get(sha);
    if (!o || o.type !== 'blob') throw new Error(`not a blob: ${sha}`);
    return o.content;
  }

  /** A flat map of file path → blob sha from a (nested) tree, e.g. { 'src/app.js': '…' }. */
  flatten(tree: string, prefix = ''): Map<string, string> {
    const out = new Map<string, string>();
    const o = this.objects.get(tree);
    if (!o || o.type !== 'tree') return out;
    for (const e of o.entries) {
      if (e.mode === '40000') for (const [p, s] of this.flatten(e.sha, `${prefix}${e.name}/`)) out.set(p, s);
      else out.set(prefix + e.name, e.sha);
    }
    return out;
  }

  /** Writes the trees for a flat path → blob sha map; returns the root tree's sha. */
  writeTree(files: Map<string, string>): string {
    const here: TreeEntry[] = [];
    const dirs = new Map<string, Map<string, string>>();
    for (const [p, s] of files) {
      const i = p.indexOf('/');
      if (i < 0) here.push({ mode: '100644', name: p, sha: s });
      else {
        const d = p.slice(0, i);
        if (!dirs.has(d)) dirs.set(d, new Map());
        dirs.get(d)!.set(p.slice(i + 1), s);
      }
    }
    for (const [d, sub] of dirs) here.push({ mode: '40000', name: d, sha: this.writeTree(sub) });
    return this.put({ type: 'tree', entries: sortEntries(here) });
  }

  /** Every object reachable from these commits (for clone, fetch and push). */
  reachable(tips: string[], stopAt: Set<string> = new Set()): Set<string> {
    const seen = new Set<string>();
    const walkTree = (t: string) => {
      if (seen.has(t)) return;
      seen.add(t);
      const o = this.objects.get(t);
      if (o?.type === 'tree') for (const e of o.entries) e.mode === '40000' ? walkTree(e.sha) : seen.add(e.sha);
    };
    const stack = [...tips];
    while (stack.length) {
      const c = stack.pop()!;
      if (seen.has(c) || stopAt.has(c) || !this.objects.has(c)) continue;
      seen.add(c);
      const co = this.commit(c);
      walkTree(co.tree);
      stack.push(...co.parents);
    }
    return seen;
  }

  copyFrom(other: ObjectStore, shas: Iterable<string>) {
    for (const s of shas) {
      const o = other.objects.get(s);
      if (o && !this.objects.has(s)) this.objects.set(s, o);
    }
  }
}
