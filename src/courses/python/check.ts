/**
 * Checks Python-course answers by running real CPython (Pyodide). Three modes,
 * chosen by the item's `python` spec:
 *   - tests:   append hidden asserts after the learner's code; pass iff none raise.
 *   - nonEmpty: the code must run and print something.
 *   - default:  run the reference `solution` (the oracle) and compare its stdout to
 *               the learner's, after normalising trailing whitespace.
 */
import type { Exercise } from '../../content/types';
import { runPython } from './engine/run';

export type CheckStatus = 'correct' | 'wrong' | 'error';

export interface PyOutcome {
  status: CheckStatus;
  feedback: string[];
  /** What the learner's code printed (for display). */
  stdout: string;
  /** The expected output in stdout-compare mode (for display). */
  expected?: string;
}

/** Normalise output so trivial whitespace differences don't fail a correct answer. */
export function norm(s: string): string {
  return String(s ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/u, ''))
    .join('\n')
    .replace(/\n+$/u, '');
}

function referenceOf(item: Exercise): string {
  if ('solution' in item && item.solution) return item.solution;
  if (item.kind === 'parsons') return item.blocks.join('\n');
  return '';
}

export async function evaluatePython(item: Exercise, answer: string): Promise<PyOutcome> {
  const spec = item.python ?? {};
  const stdin = spec.stdin ?? '';
  if (/___/.test(answer)) return { status: 'wrong', feedback: ['اول همهٔ جاهای خالی (___) را پر کن.'], stdout: '' };
  if (!answer.trim()) return { status: 'wrong', feedback: ['اول کدت را بنویس!'], stdout: '' };

  // Mode: hidden assert tests (function-writing tasks).
  if (Array.isArray(spec.tests) && spec.tests.length) {
    const r = await runPython(`${answer}\n\n# --- tests ---\n${spec.tests.join('\n')}\n`, stdin);
    if (r.error) {
      const friendly = /AssertionError/.test(r.stderr) || /AssertionError/.test(r.error)
        ? 'خروجی تابع با چیزی که انتظار می‌رفت یکی نیست.'
        : r.error;
      return { status: r.timedOut ? 'error' : 'wrong', feedback: [friendly], stdout: r.stdout };
    }
    return { status: 'correct', feedback: [], stdout: r.stdout };
  }

  // Mode: just require some non-empty output that runs cleanly.
  if (spec.nonEmpty) {
    const r = await runPython(answer, stdin);
    if (r.error) return { status: 'error', feedback: [r.error], stdout: r.stdout };
    const ok = norm(r.stdout).length > 0;
    return { status: ok ? 'correct' : 'wrong', feedback: ok ? [] : ['چیزی چاپ نشد — یادت نرود از print استفاده کنی.'], stdout: r.stdout };
  }

  // Mode: compare stdout against the reference solution.
  const reference = referenceOf(item);
  if (!reference) return { status: 'error', feedback: ['این تمرین راه‌حل مرجع ندارد.'], stdout: '' };
  const want = await runPython(reference, stdin);
  if (want.error) return { status: 'error', feedback: ['خطا در راه‌حل مرجع: ' + want.error], stdout: '' };
  const got = await runPython(answer, stdin);
  if (got.error) return { status: 'error', feedback: [got.error], stdout: got.stdout, expected: want.stdout };
  if (norm(got.stdout) === norm(want.stdout)) return { status: 'correct', feedback: [], stdout: got.stdout, expected: want.stdout };
  return {
    status: 'wrong',
    feedback: ['خروجی‌ات با چیزی که انتظار می‌رفت فرق دارد. خروجی مورد انتظار و خروجی تو را پایین مقایسه کن.'],
    stdout: got.stdout,
    expected: want.stdout,
  };
}

/** Run an answer without checking it (the Run button). */
export function tryPython(code: string, stdin = '') {
  return runPython(code, stdin);
}
