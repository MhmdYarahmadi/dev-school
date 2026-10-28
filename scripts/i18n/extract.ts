/**
 * Collects the English text to translate:
 * - every `t('…')` / `mark('…')` string in the learner-facing code (src/, minus the admin dashboard and engines);
 * - every prose field of the Git course content, by path (see walkProse).
 * Run `scripts/i18n/extract.sh` to rewrite src/i18n/*.en.json; tests/git-i18n.test.ts checks they're current.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { gitContent } from '../../src/courses/git/content';
import { walkProse } from '../../src/shared/i18n';

const ROOT = join(__dirname, '..', '..');
const SKIP = [/^src\/admin\//, /^src\/pages\/AdminPage\.tsx$/, /\/engine\//, /^src\/i18n\//];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });
}

/** Every literal passed to t() or mark(), in a stable order (by file, then position). */
export function extractUi(): string[] {
  const out = new Set<string>();
  for (const file of files(join(ROOT, 'src')).sort()) {
    const rel = relative(ROOT, file);
    if (SKIP.some((re) => re.test(rel))) continue;
    const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === 't' || n.expression.text === 'mark')) {
        const a = n.arguments[0];
        if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) out.add(a.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return [...out];
}

/** Lines that are only code (a command, a file name) are left as they are. */
export function isProse(s: string): boolean {
  const words = s.replace(/`[^`]*`/g, ' ').replace(/\{\w+\}/g, ' ');
  return /[A-Za-z]{2,}/.test(words) && !/^\s*(git|gh|cd|echo|cat|ls|mkdir|printf|touch|rm|mv)\s/.test(s);
}

/** The Git course's prose, by path: course texts, games, modules and the project. */
export function extractContent(): Record<string, string> {
  const out: Record<string, string> = {};
  walkProse(gitContent, (path, value) => {
    if (isProse(value)) out[path] = value;
  });
  return out;
}
