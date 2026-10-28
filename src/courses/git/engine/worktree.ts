/** The working tree side of a repository: files on disk, .gitignore rules, status, and checking out trees safely. */
import { hashObject } from './objects';
import type { FileSystem } from './fs';
import type { Repo } from './repo';

export const blobSha = (content: string) => hashObject({ type: 'blob', content });

// ---------------------------------------------------------------- .gitignore

interface Rule {
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
  /** Folder (repo path, '' for the root) of the .gitignore holding the rule. */
  base: string;
}

function globToRe(pat: string, anchored: boolean): RegExp {
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*') {
      if (pat[i + 1] === '*') {
        // "**/" matches any folders (or none); a trailing "**" matches everything inside.
        if (pat[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i++;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const j = pat.indexOf(']', i + 1);
      if (j > i) {
        re += '[' + pat.slice(i + 1, j).replace(/^!/, '^') + ']';
        i = j;
      } else re += '\\[';
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(anchored ? `^${re}$` : `(?:^|/)${re}$`);
}

/** Every .gitignore rule in the working tree (deeper files win, later lines win). */
export function ignoreRules(files: Map<string, string>): Rule[] {
  const rules: Rule[] = [];
  const sources = [...files.keys()].filter((p) => p === '.gitignore' || p.endsWith('/.gitignore')).sort((a, b) => a.split('/').length - b.split('/').length);
  for (const src of sources) {
    const base = src.includes('/') ? src.slice(0, src.lastIndexOf('/')) : '';
    for (let line of files.get(src)!.split('\n')) {
      line = line.replace(/\s+$/, '');
      if (!line || line.startsWith('#')) continue;
      const negate = line.startsWith('!');
      if (negate) line = line.slice(1);
      const dirOnly = line.endsWith('/');
      if (dirOnly) line = line.slice(0, -1);
      // A slash at the start or middle anchors the pattern to the .gitignore's folder.
      const anchored = line.includes('/');
      line = line.replace(/^\//, '');
      rules.push({ re: globToRe(line, anchored), negate, dirOnly, base });
    }
  }
  return rules;
}

/** Is this repository path ignored? Checks each parent folder first, as Git does (an ignored folder hides everything in it). */
export function isIgnored(rules: Rule[], path: string): boolean {
  const parts = path.split('/');
  for (let k = 1; k <= parts.length; k++) {
    const p = parts.slice(0, k).join('/');
    const isDir = k < parts.length;
    let ignored = false;
    for (const r of rules) {
      if (r.dirOnly && !isDir) continue;
      if (r.base && !p.startsWith(r.base + '/')) continue;
      const rel = r.base ? p.slice(r.base.length + 1) : p;
      if (r.re.test(rel)) ignored = !r.negate;
    }
    if (ignored) return true;
  }
  return false;
}

// ---------------------------------------------------------------- the working tree

/** Files in the working tree: repo path → content (the .git folder excluded). */
export function worktreeFiles(fs: FileSystem, repo: Repo): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of fs.walk(repo.root!)) out.set(rel, fs.read(`${repo.root}/${rel}`)!);
  return out;
}

export type StagedKind = 'new file' | 'modified' | 'deleted' | 'renamed';
export type UnmergedHow = 'both modified' | 'both added' | 'deleted by us' | 'deleted by them' | 'added by us' | 'added by them' | 'both deleted';

export interface Status {
  staged: { path: string; kind: StagedKind; from?: string }[];
  unstaged: { path: string; kind: 'modified' | 'deleted' }[];
  untracked: string[];
  unmerged: { path: string; how: UnmergedHow }[];
}

export function unmergedHow(u: { base?: string; ours?: string; theirs?: string }): UnmergedHow {
  if (u.ours && u.theirs) return u.base ? 'both modified' : 'both added';
  if (u.ours) return u.base ? 'deleted by them' : 'added by us';
  if (u.theirs) return u.base ? 'deleted by us' : 'added by them';
  return 'both deleted';
}

/** Exact renames: a deleted path and a new path with the same content. */
export function pairRenames<T extends { path: string; kind: string; from?: string }>(items: T[], shaOld: (p: string) => string | undefined, shaNew: (p: string) => string | undefined): T[] {
  const deleted = items.filter((i) => i.kind === 'deleted');
  const added = items.filter((i) => i.kind === 'new file' || i.kind === 'added');
  const out = items.filter((i) => !deleted.includes(i) && !added.includes(i));
  const used = new Set<T>();
  for (const a of added) {
    const d = deleted.find((x) => !used.has(x) && shaOld(x.path) === shaNew(a.path));
    if (d) {
      used.add(d);
      out.push({ ...a, kind: 'renamed', from: d.path });
    } else out.push(a);
  }
  out.push(...deleted.filter((d) => !used.has(d)));
  return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

export function computeStatus(fs: FileSystem, repo: Repo): Status {
  const head = repo.files(repo.headCommit());
  const wt = worktreeFiles(fs, repo);
  const staged: Status['staged'] = [];
  for (const [p, sha] of repo.index) {
    if (repo.unmerged.has(p)) continue;
    if (!head.has(p)) staged.push({ path: p, kind: 'new file' });
    else if (head.get(p) !== sha) staged.push({ path: p, kind: 'modified' });
  }
  for (const p of head.keys()) if (!repo.index.has(p) && !repo.unmerged.has(p)) staged.push({ path: p, kind: 'deleted' });
  const unstaged: Status['unstaged'] = [];
  for (const [p, sha] of repo.index) {
    if (repo.unmerged.has(p)) continue;
    const c = wt.get(p);
    if (c === undefined) unstaged.push({ path: p, kind: 'deleted' });
    else if (blobSha(c) !== sha) unstaged.push({ path: p, kind: 'modified' });
  }
  unstaged.sort((a, b) => (a.path < b.path ? -1 : 1));
  const rules = ignoreRules(wt);
  const tracked = (p: string) => repo.index.has(p) || repo.unmerged.has(p);
  const trackedDirs = new Set<string>();
  for (const p of [...repo.index.keys(), ...repo.unmerged.keys()]) {
    const parts = p.split('/');
    for (let k = 1; k < parts.length; k++) trackedDirs.add(parts.slice(0, k).join('/'));
  }
  const untracked = new Set<string>();
  for (const p of wt.keys()) {
    if (tracked(p) || isIgnored(rules, p)) continue;
    // A folder with no tracked files is listed once, as "dir/".
    const parts = p.split('/');
    let shown = p;
    for (let k = 1; k < parts.length; k++) {
      const d = parts.slice(0, k).join('/');
      if (!trackedDirs.has(d)) {
        shown = d + '/';
        break;
      }
    }
    untracked.add(shown);
  }
  const unmerged = [...repo.unmerged.entries()].map(([path, u]) => ({ path, how: unmergedHow(u) })).sort((a, b) => (a.path < b.path ? -1 : 1));
  return {
    staged: pairRenames(staged, (p) => head.get(p), (p) => repo.index.get(p)),
    unstaged,
    untracked: [...untracked].sort(),
    unmerged,
  };
}

/**
 * Moves the index and working tree from tree `from` to tree `to` (flat maps), keeping local changes
 * to files the move doesn't touch. Returns the paths that would lose local work (nothing is changed then).
 */
export function switchTrees(fs: FileSystem, repo: Repo, from: Map<string, string>, to: Map<string, string>, dryRun = false): { dirty: string[]; untracked: string[]; removed: string[] } {
  const wt = worktreeFiles(fs, repo);
  const dirty: string[] = [];
  const untracked: string[] = [];
  const removed: string[] = [];
  const paths = new Set([...from.keys(), ...to.keys()]);
  for (const p of paths) {
    const a = from.get(p);
    const b = to.get(p);
    if (a === b) continue;
    const idx = repo.index.get(p);
    const c = wt.get(p);
    const wsha = c === undefined ? undefined : blobSha(c);
    if (a === undefined && idx === undefined) {
      // A new file in the target: an untracked file of the same name would be overwritten.
      if (c !== undefined && wsha !== b) untracked.push(p);
      continue;
    }
    // Deleted from the index but still on disk (untracked), and the move deletes it: Git won't remove it.
    if (a !== undefined && b === undefined && idx === undefined && c !== undefined) {
      removed.push(p);
      continue;
    }
    // The index already has the target version: keep it (and any edits on top).
    if (idx === b) continue;
    // Safe when nothing is staged or edited for this file (a deleted file loses nothing).
    if (!(idx === a && (wsha === undefined || wsha === idx))) dirty.push(p);
  }
  if (dirty.length || untracked.length || removed.length || dryRun) return { dirty: dirty.sort(), untracked: untracked.sort(), removed: removed.sort() };
  for (const p of paths) {
    const a = from.get(p);
    const b = to.get(p);
    if (a === b || repo.index.get(p) === b) continue;
    if (b === undefined) {
      repo.index.delete(p);
      fs.remove(`${repo.root}/${p}`);
      removeEmptyDirs(fs, repo.root!, p);
    } else {
      repo.index.set(p, b);
      fs.write(`${repo.root}/${p}`, repo.objects.blob(b));
    }
  }
  return { dirty: [], untracked: [], removed: [] };
}

/** Git removes folders left empty when it deletes files. */
export function removeEmptyDirs(fs: FileSystem, root: string, path: string) {
  const parts = path.split('/');
  for (let k = parts.length - 1; k >= 1; k--) {
    const d = `${root}/${parts.slice(0, k).join('/')}`;
    if (fs.list(d).length === 0) fs.dirs.delete(d);
    else break;
  }
}

/** Files that differ between the index and the working tree, or between HEAD and the index. */
export function localChanges(fs: FileSystem, repo: Repo): Set<string> {
  const s = computeStatus(fs, repo);
  return new Set([...s.staged.map((x) => x.path), ...s.staged.filter((x) => x.from).map((x) => x.from!), ...s.unstaged.map((x) => x.path)]);
}
