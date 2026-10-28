/**
 * The ASCII graph of `git log --graph`, ported from Git's graph.c (the state
 * machine that draws `*`, `|`, `/`, `\` and `_`), so the text matches real Git.
 */

type State = 'padding' | 'skip' | 'pre' | 'commit' | 'postMerge' | 'collapsing';
const MERGE_CHARS = ['/', '|', '\\'];

export class TextGraph {
  private commit: string | null = null;
  private parents: string[] = [];
  private width = 0;
  private expansionRow = 0;
  private state: State = 'padding';
  private prevState: State = 'padding';
  private commitIndex = 0;
  private prevCommitIndex = 0;
  private mergeLayout = 0;
  private edgesAdded = 0;
  private prevEdgesAdded = 0;
  private columns: string[] = [];
  private newColumns: string[] = [];
  private mapping: number[] = [];
  private oldMapping: number[] = [];
  private mappingSize = 0;

  constructor(
    /** A parent is drawn only if the walk shows it. */
    private interesting: (sha: string) => boolean,
  ) {}

  /** Starts drawing the next commit (in the order the log shows them). */
  update(commit: string, parents: string[]) {
    this.commit = commit;
    this.parents = parents.filter((p) => this.interesting(p));
    this.prevCommitIndex = this.commitIndex;
    this.updateColumns();
    this.expansionRow = 0;
    if (this.state !== 'padding') this.state = 'skip';
    else if (this.needsPreCommitLine()) this.state = 'pre';
    else this.state = 'commit';
  }

  isCommitFinished(): boolean {
    return this.state === 'padding';
  }

  /** The next row of the graph; `commit` is true for the row with this commit's `*`. */
  nextLine(): { text: string; commit: boolean } {
    const line: string[] = [];
    let commit = false;
    switch (this.state) {
      case 'padding':
        for (let i = 0; i < this.newColumns.length; i++) line.push('|', ' ');
        break;
      case 'skip':
        line.push('...');
        this.setState(this.needsPreCommitLine() ? 'pre' : 'commit');
        break;
      case 'pre':
        this.preCommitLine(line);
        break;
      case 'commit':
        this.commitLine(line);
        commit = true;
        break;
      case 'postMerge':
        this.postMergeLine(line);
        break;
      case 'collapsing':
        this.collapsingLine(line);
        break;
    }
    let text = line.join('');
    if (text.length < this.width) text += ' '.repeat(this.width - text.length);
    return { text, commit };
  }

  /** The graph part of the blank line printed before a commit's entry (graph_padding_line). */
  paddingLine(): string {
    if (this.state !== 'commit') return this.nextLine().text;
    let text = '';
    for (const c of this.columns) text += c === this.commit && this.parents.length > 2 ? '|' + ' '.repeat((this.parents.length - 2) * 2) : '| ';
    this.prevState = 'padding';
    return text.length < this.width ? text + ' '.repeat(this.width - text.length) : text;
  }

  private setState(s: State) {
    this.prevState = this.state;
    this.state = s;
  }

  private numExpansionRows() {
    return (this.parents.length - 2) * 2;
  }

  private needsPreCommitLine() {
    return this.parents.length >= 3 && this.commitIndex < this.columns.length - 1 && this.expansionRow < this.numExpansionRows();
  }

  private findNewColumn(c: string): number {
    return this.newColumns.indexOf(c);
  }

  private insertIntoNewColumns(c: string, idx: number) {
    let i = this.findNewColumn(c);
    let mappingIdx: number;
    if (i < 0) {
      i = this.newColumns.length;
      this.newColumns.push(c);
    }
    if (this.parents.length > 1 && idx > -1 && this.mergeLayout === -1) {
      const dist = idx - i;
      const shift = dist > 1 ? 2 * dist - 3 : 1;
      this.mergeLayout = dist > 0 ? 0 : 1;
      this.edgesAdded = this.parents.length + this.mergeLayout - 2;
      mappingIdx = this.width + (this.mergeLayout - 1) * shift;
      this.width += 2 * this.mergeLayout;
    } else if (this.edgesAdded > 0 && i === this.mapping[this.width - 2]) {
      mappingIdx = this.width - 2;
      this.edgesAdded = -1;
    } else {
      mappingIdx = this.width;
      this.width += 2;
    }
    this.mapping[mappingIdx] = i;
  }

  private updateColumns() {
    this.columns = this.newColumns;
    this.newColumns = [];
    const maxNew = this.columns.length + this.parents.length;
    this.mappingSize = 2 * maxNew;
    this.mapping = Array(this.mappingSize).fill(-1);
    this.width = 0;
    this.prevEdgesAdded = this.edgesAdded;
    this.edgesAdded = 0;
    let seenThis = false;
    for (let i = 0; i <= this.columns.length; i++) {
      let colCommit: string;
      if (i === this.columns.length) {
        if (seenThis) break;
        colCommit = this.commit!;
      } else colCommit = this.columns[i];
      if (colCommit === this.commit) {
        seenThis = true;
        this.commitIndex = i;
        this.mergeLayout = -1;
        for (const p of this.parents) this.insertIntoNewColumns(p, i);
        if (this.parents.length === 0) this.width += 2;
      } else this.insertIntoNewColumns(colCommit, -1);
    }
    while (this.mappingSize > 1 && this.mapping[this.mappingSize - 1] < 0) this.mappingSize--;
  }

  private isMappingCorrect(): boolean {
    for (let i = 0; i < this.mappingSize; i++) {
      const t = this.mapping[i];
      if (t >= 0 && t !== Math.floor(i / 2)) return false;
    }
    return true;
  }

  private preCommitLine(line: string[]) {
    let seenThis = false;
    for (let i = 0; i < this.columns.length; i++) {
      if (this.columns[i] === this.commit) {
        seenThis = true;
        line.push('|', ' '.repeat(this.expansionRow));
      } else if (seenThis && this.expansionRow === 0) {
        line.push(this.prevState === 'postMerge' && this.prevCommitIndex < i ? '\\' : '|');
      } else if (seenThis && this.expansionRow > 0) line.push('\\');
      else line.push('|');
      line.push(' ');
    }
    this.expansionRow++;
    if (!this.needsPreCommitLine()) this.setState('commit');
  }

  private commitLine(line: string[]) {
    let seenThis = false;
    for (let i = 0; i <= this.columns.length; i++) {
      let colCommit: string;
      if (i === this.columns.length) {
        if (seenThis) break;
        colCommit = this.commit!;
      } else colCommit = this.columns[i];
      if (colCommit === this.commit) {
        seenThis = true;
        line.push('*');
        if (this.parents.length > 2) {
          const dashed = this.parents.length + this.mergeLayout - 3;
          for (let k = 0; k < dashed; k++) line.push('-', k === dashed - 1 ? '.' : '-');
        }
      } else if (seenThis && this.edgesAdded > 1) line.push('\\');
      else if (seenThis && this.edgesAdded === 1) {
        line.push(this.prevState === 'postMerge' && this.prevEdgesAdded > 0 && this.prevCommitIndex < i ? '\\' : '|');
      } else if (this.prevState === 'collapsing' && this.oldMapping[2 * i + 1] === i && this.mapping[2 * i] < i) line.push('/');
      else line.push('|');
      line.push(' ');
    }
    if (this.parents.length > 1) this.setState('postMerge');
    else if (this.isMappingCorrect()) this.setState('padding');
    else this.setState('collapsing');
  }

  private postMergeLine(line: string[]) {
    let seenThis = false;
    const firstParent = this.parents[0];
    let parentCol = false;
    for (let i = 0; i <= this.columns.length; i++) {
      let colCommit: string;
      if (i === this.columns.length) {
        if (seenThis) break;
        colCommit = this.commit!;
      } else colCommit = this.columns[i];
      if (colCommit === this.commit) {
        seenThis = true;
        let idx = this.mergeLayout;
        for (let j = 0; j < this.parents.length; j++) {
          line.push(MERGE_CHARS[idx]);
          if (idx === 2) {
            if (this.edgesAdded > 0 || j < this.parents.length - 1) line.push(' ');
          } else idx++;
        }
        if (this.edgesAdded === 0) line.push(' ');
      } else if (seenThis) {
        line.push(this.edgesAdded > 0 ? '\\' : '|', ' ');
      } else {
        line.push('|');
        if (this.mergeLayout !== 0 || i !== this.commitIndex - 1) line.push(parentCol ? '_' : ' ');
      }
      if (colCommit === firstParent) parentCol = true;
    }
    this.setState(this.isMappingCorrect() ? 'padding' : 'collapsing');
  }

  private collapsingLine(line: string[]) {
    let usedHorizontal = false;
    let horizontalEdge = -1;
    let horizontalEdgeTarget = -1;
    this.oldMapping = this.mapping;
    this.mapping = Array(this.mappingSize).fill(-1);
    for (let i = 0; i < this.mappingSize; i++) {
      const target = this.oldMapping[i];
      if (target < 0) continue;
      if (target * 2 === i) this.mapping[i] = target;
      else if (this.mapping[i - 1] < 0) {
        this.mapping[i - 1] = target;
        if (horizontalEdge === -1) {
          horizontalEdge = i;
          horizontalEdgeTarget = target;
          for (let j = target * 2 + 3; j < i - 2; j += 2) this.mapping[j] = target;
        }
      } else if (this.mapping[i - 1] === target) {
        // Joins the branch line on its left (same parent).
      } else {
        this.mapping[i - 2] = target;
        if (horizontalEdge === -1) {
          horizontalEdgeTarget = target;
          horizontalEdge = i - 1;
          for (let j = target * 2 + 3; j < i - 2; j += 2) this.mapping[j] = target;
        }
      }
    }
    this.oldMapping = [...this.mapping];
    if (this.mapping[this.mappingSize - 1] < 0) this.mappingSize--;
    for (let i = 0; i < this.mappingSize; i++) {
      const target = this.mapping[i];
      if (target < 0) line.push(' ');
      else if (target * 2 === i) line.push('|');
      else if (target === horizontalEdgeTarget && i !== horizontalEdge - 1) {
        if (i !== target * 2 + 3) this.mapping[i] = -1;
        usedHorizontal = true;
        line.push('_');
      } else {
        if (usedHorizontal && i < horizontalEdge) this.mapping[i] = -1;
        line.push('/');
      }
    }
    if (this.isMappingCorrect()) this.setState('padding');
  }
}
