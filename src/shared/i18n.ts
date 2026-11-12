/**
 * Interface languages. English is the source: every learner-facing string in the code goes
 * through `t('English text', vars)`, and a translation table maps that English text to the
 * other language. Course content (lessons, exercises) is translated by path instead, see
 * `applyContentTable`. Only courses that ship a table (Git, in Farsi) offer a switch.
 * scripts/i18n/extract.ts collects every `t('…')` call; the translations come from Gemini.
 */
export type Lang = 'en' | 'fa';

let current: Lang = 'en';
let storageKey = '';
let table: Record<string, string> = {};
let forced: Lang | null = null;

/** Reads the saved language for a course that offers a switch. */
export function initLang(courseId: string): Lang {
  storageKey = `zs-lang-${courseId}`;
  try {
    current = localStorage.getItem(storageKey) === 'fa' ? 'fa' : 'en';
  } catch {
    current = 'en';
  }
  return current;
}

/** A course that is only in one language (the Persian Python course): no switch is offered. */
export function fixLang(l: Lang) {
  storageKey = '';
  current = l;
}

export function lang(): Lang {
  return forced ?? current;
}

/** Is a language switch offered on this page? */
export function hasLangSwitch(): boolean {
  return storageKey !== '';
}

/** Saves the choice and reloads, since content is translated once at start-up. */
export function setLang(l: Lang) {
  try {
    localStorage.setItem(storageKey, l);
  } catch {
    // private mode: the switch only lasts for this page load
  }
  current = l;
  location.reload();
}

export function setTable(t: Record<string, string>) {
  table = t;
}

/** Text direction for the current language. */
export const dir = (): 'rtl' | 'ltr' => (lang() === 'fa' ? 'rtl' : 'ltr');

/** Translates English text and fills `{name}` placeholders. */
export function t(en: string, vars?: Record<string, string | number>): string {
  let s = (lang() !== 'en' && table[en]) || en;
  // Right to left, "Next →" and "← Back" must point the other way (arrows mid-sentence, as in
  // "{from} → {to}" between commit hashes, already read correctly).
  if (dir() === 'rtl') s = s.replace(/^← /, '→ ').replace(/ →$/, ' ←');
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return dir() === 'rtl' ? isolateLtr(s) : s;
}

const ISO = (x: string) => `\u2068${x}\u2069`;

/**
 * Right to left, a path ("~/shop", "origin/main") or a “quoted” English title would be reordered
 * by the words around it ("shop/~"). Those pieces are wrapped in Unicode isolates. Text in
 * backticks is left alone (it's shown as code, already isolated, and may be copied).
 */
export function isolateLtr(s: string): string {
  return s
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(/“[^”]*”/g, ISO).replace(/(?<![\w\u2068])~?[\w.-]*\/[\w./-]*\w/g, ISO)))
    .join('');
}

/** Runs `f` with English text, e.g. for checks that match feedback against English patterns. */
export function inEnglish<T>(f: () => T): T {
  const was = forced;
  forced = 'en';
  try {
    return f();
  } finally {
    forced = was;
  }
}

// ---------------------------------------------------------------- content by path

type Node = Record<string, unknown>;

/**
 * Calls `visit(path, get, set)` for every translatable prose field of a course's content.
 * Code (commands, setups, solutions, `verify` patterns, GitSpec) is never visited.
 */
export function walkProse(course: object, visit: (path: string, value: string, set: (v: string) => void) => void) {
  const root = course as { modules: Node[]; levels?: Node[]; kindLabels?: Node; games?: Record<string, Node> };
  const field = (o: Node | undefined, key: string, path: string) => {
    if (o && typeof o[key] === 'string') visit(path, o[key] as string, (v) => (o[key] = v));
  };
  const list = (o: Node | undefined, key: string, path: string) => {
    const xs = o?.[key];
    if (Array.isArray(xs)) xs.forEach((x, i) => typeof x === 'string' && visit(`${path}/${i}`, x, (v) => (xs[i] = v)));
  };
  const top = root as unknown as Node;
  field(top, 'heroTitle', 'course/heroTitle');
  field(top, 'heroText', 'course/heroText');
  root.levels?.forEach((l, i) => field(l, 'title', `course/levels/${i}`));
  for (const k of Object.keys(root.kindLabels ?? {})) field(root.kindLabels, k, `course/kindLabels/${k}`);
  for (const [id, g] of Object.entries(root.games ?? {})) {
    field(g, 'title', `game/${id}/title`);
    field(g, 'pitch', `game/${id}/pitch`);
  }
  for (const m of root.modules) {
    const p = m.id as string;
    field(m, 'title', `${p}/title`);
    field(m, 'tagline', `${p}/tagline`);
    for (const c of m.concepts as Node[]) {
      const cp = `${p}/concept/${c.id}`;
      field(c, 'title', `${cp}/title`);
      field(c, 'card', `${cp}/card`);
      field(c.example as Node, 'note', `${cp}/example/note`);
      field(c.cheat as Node, 'note', `${cp}/cheat/note`);
      const pr = c.predict as Node | undefined;
      field(pr, 'question', `${cp}/predict/question`);
      list(pr, 'choices', `${cp}/predict/choices`);
      field(pr, 'why', `${cp}/predict/why`);
    }
    for (const e of [...(m.practice as Node[]), ...(m.test as Node[])]) {
      const ep = `${p}/item/${e.id}`;
      field(e, 'prompt', `${ep}/prompt`);
      field(e, 'explanation', `${ep}/explanation`);
      list(e, 'hints', `${ep}/hints`);
      // choice questions: the choices are prose (commands inside them are in backticks)
      if (e.kind === 'readQuery') list(e, 'choices', `${ep}/choices`);
    }
    const pj = m.project as Node | undefined;
    if (pj) {
      const pp = `${p}/project`;
      field(pj, 'title', `${pp}/title`);
      field(pj, 'story', `${pp}/story`);
      for (const tk of pj.tasks as Node[]) {
        const tp = `${pp}/task/${tk.id}`;
        field(tk, 'prompt', `${tp}/prompt`);
        field(tk, 'discussion', `${tp}/discussion`);
        list(tk, 'hints', `${tp}/hints`);
        (tk.requirements as Node[] | undefined)?.forEach((r, i) => field(r, 'label', `${tp}/req/${i}`));
      }
    }
  }
}

/** Replaces prose with its translation where the table has one (missing paths stay English). */
export function applyContentTable<T extends object>(content: T, tableByPath: Record<string, string>): T {
  walkProse(content, (path, _v, set) => {
    const tr = tableByPath[path];
    if (tr) set(isolateLtr(tr));
  });
  return content;
}

/** Marks English text for translation where it's defined; it's translated with `t()` where it's shown. */
export const mark = (en: string) => en;
