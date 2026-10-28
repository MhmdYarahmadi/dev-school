/** A user's files: absolute path → content, plus explicit (possibly empty) folders. */

export function normalizePath(p: string): string {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export function joinPath(base: string, p: string): string {
  return normalizePath(p.startsWith('/') ? p : `${base}/${p}`);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/** `to` relative to the folder `from` ('../a.txt'), as Git prints paths in `status`. */
export function relativePath(from: string, to: string): string {
  const a = from === '/' ? [] : from.slice(1).split('/');
  const b = to.slice(1).split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

export class FileSystem {
  files = new Map<string, string>();
  dirs = new Set<string>(['/']);

  isFile(p: string): boolean {
    return this.files.has(p);
  }

  isDir(p: string): boolean {
    if (this.dirs.has(p)) return true;
    const pre = p === '/' ? '/' : p + '/';
    for (const f of this.files.keys()) if (f.startsWith(pre)) return true;
    return false;
  }

  exists(p: string): boolean {
    return this.isFile(p) || this.isDir(p);
  }

  read(p: string): string | undefined {
    return this.files.get(p);
  }

  write(p: string, content: string) {
    this.mkdirp(dirname(p));
    this.files.set(p, content);
  }

  mkdirp(p: string) {
    for (let d = p; d !== '/'; d = dirname(d)) this.dirs.add(d);
  }

  /** Removes a file, or a folder and everything in it. */
  remove(p: string) {
    this.files.delete(p);
    const pre = p + '/';
    for (const f of [...this.files.keys()]) if (f.startsWith(pre)) this.files.delete(f);
    for (const d of [...this.dirs]) if (d === p || d.startsWith(pre)) this.dirs.delete(d);
  }

  /** Names directly inside a folder, sorted. */
  list(p: string): string[] {
    const pre = p === '/' ? '/' : p + '/';
    const names = new Set<string>();
    for (const f of [...this.files.keys(), ...this.dirs]) {
      if (f.startsWith(pre) && f.length > pre.length) names.add(f.slice(pre.length).split('/')[0]);
    }
    return [...names].sort();
  }

  /** Every file under a folder, as paths relative to it ('src/app.js'). */
  walk(root: string): string[] {
    const pre = root === '/' ? '/' : root + '/';
    const out: string[] = [];
    for (const f of this.files.keys()) if (f.startsWith(pre)) out.push(f.slice(pre.length));
    return out.sort();
  }
}
