/** Merging whole trees: what `git merge`, `git revert`, `git pull` and the hub's pull requests share. */
import { merge3 } from './diff';
import type { Repo, Unmerged } from './repo';

/** Where a merge left each path. */
export interface TreeMerge {
  /** Clean result: path → blob sha. */
  files: Map<string, string>;
  /** Conflicted paths: the three versions, plus the text with conflict markers (or the surviving version). */
  conflicts: Map<string, Unmerged & { text?: string; keep?: string }>;
  /** "Auto-merging x", "CONFLICT (content): …" in path order. */
  messages: string[];
}

/** A three-way merge of whole trees (no rename detection). */
export function mergeTrees(r: Repo, base: string | null, ours: string, theirs: string, oursLabel: string, theirsLabel: string): TreeMerge {
  const B = r.files(base);
  const O = r.files(ours);
  const T = r.files(theirs);
  const files = new Map<string, string>();
  const conflicts: TreeMerge['conflicts'] = new Map();
  const messages: string[] = [];
  const paths = [...new Set([...B.keys(), ...O.keys(), ...T.keys()])].sort();
  for (const p of paths) {
    const b = B.get(p);
    const o = O.get(p);
    const t = T.get(p);
    if (o === t || b === t) {
      if (o) files.set(p, o);
      continue;
    }
    if (b === o) {
      if (t) files.set(p, t);
      continue;
    }
    if (o && t) {
      const res = merge3(b ? r.objects.blob(b) : '', r.objects.blob(o), r.objects.blob(t), oursLabel, theirsLabel);
      messages.push(`Auto-merging ${p}`);
      if (res.conflicts) {
        messages.push(`CONFLICT (${b ? 'content' : 'add/add'}): Merge conflict in ${p}`);
        conflicts.set(p, { base: b, ours: o, theirs: t, text: res.text });
      } else files.set(p, r.objects.put({ type: 'blob', content: res.text }));
      continue;
    }
    // Modified on one side, deleted on the other.
    if (o) {
      messages.push(`CONFLICT (modify/delete): ${p} deleted in ${theirsLabel} and modified in ${oursLabel}.  Version ${oursLabel} of ${p} left in tree.`);
      conflicts.set(p, { base: b, ours: o, keep: o });
    } else {
      messages.push(`CONFLICT (modify/delete): ${p} deleted in ${oursLabel} and modified in ${theirsLabel}.  Version ${theirsLabel} of ${p} left in tree.`);
      conflicts.set(p, { base: b, theirs: t, keep: t });
    }
  }
  return { files, conflicts, messages };
}

