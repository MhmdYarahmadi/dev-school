/**
 * Checks a Farsi translation against its English source (used by translate-git.mjs and the tests).
 * It never edits a translation: a failure goes back to Gemini.
 */
const spans = (s) => s.match(/`[^`]*`/g) ?? [];
const holders = (s) => (s.match(/\{\w+\}/g) ?? []).sort();
const count = (s, re) => (s.match(re) ?? []).length;
const emoji = (s) => (s.match(/\p{Extended_Pictographic}/gu) ?? []).sort().join('');
export const isProse = (s) => /[A-Za-z]{2,}/.test(s.replace(/`[^`]*`/g, ' ').replace(/\{\w+\}/g, ' ')) && !/^\s*(git|gh|cd|echo|cat|ls|mkdir|printf|touch|rm|mv)\s/.test(s);

/** Why a translation can't be used, or null. */
export function problem(en, fa) {
  if (typeof fa !== 'string' || !fa.trim()) return 'empty';
  const a = spans(en);
  const b = spans(fa);
  if (a.join('\u0000') !== b.join('\u0000')) {
    const missing = a.filter((x) => !b.includes(x));
    return missing.length ? `code spans must stay exactly as in English; missing or changed: ${missing.slice(0, 4).join(' ')}` : 'code spans (in backticks) must be the same ones, in the same order';
  }
  if (holders(en).join() !== holders(fa).join()) return `placeholders must be exactly ${holders(en).join(' ') || '(none)'}`;
  if (count(en, /\*\*/g) !== count(fa, /\*\*/g)) return 'keep the same **bold** markers';
  if (count(en, /\n/g) !== count(fa, /\n/g)) return `keep the same line breaks (${count(en, /\n/g)})`;
  if (count(en, /^\s*(-|\d+\.) /gm) !== count(fa, /^\s*(-|\d+\.) /gm)) return 'keep the same list items';
  if (emoji(en) !== emoji(fa)) return 'keep the same emoji';
  // Short texts Gemini kept as they are are Git output, commit messages or file contents (e.g. "Untracked").
  if (isProse(en) && !/[\u0600-\u06FF]/.test(fa) && !(fa === en && en.length <= 40)) return 'not translated into Farsi';
  return null;
}

