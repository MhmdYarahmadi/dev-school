/**
 * The Farsi Git course: the English source files are current, every translation keeps the
 * code, placeholders and Markdown of its English text, and the course still works in Farsi.
 */
import { describe, expect, it } from 'vitest';
import uiEn from '../src/i18n/ui.en.json';
import gitEn from '../src/i18n/git.en.json';
import uiFa from '../src/i18n/ui.fa.json';
import gitFa from '../src/i18n/git.fa.json';
import { extractContent, extractUi } from '../scripts/i18n/extract';
// @ts-expect-error plain JavaScript module shared with the translation script
import { problem } from '../scripts/i18n/validate.mjs';
import { applyContentTable, initLang, inEnglish, lang, setTable, t, walkProse } from '../src/shared/i18n';
import { gitContent } from '../src/courses/git/content';
import { evaluateGit } from '../src/courses/git/check';
import { detectGitMisconceptions } from '../src/courses/git/misconceptions';

const ui = uiFa as Record<string, string>;
const content = gitFa as Record<string, string>;

describe('English source files', () => {
  it('ui.en.json lists every t()/mark() string (run scripts/i18n/extract.sh)', () => {
    expect(uiEn).toEqual(extractUi());
  });
  it('git.en.json has every prose field of the Git course', () => {
    expect(gitEn).toEqual(extractContent());
  });
});

describe('Farsi translations', () => {
  it('every interface string is translated, with its code, placeholders and Markdown kept', () => {
    const bad = (uiEn as string[]).map((en) => [en, problem(en, ui[en])]).filter(([, p]) => p);
    expect(bad).toEqual([]);
  });
  it('every content field is translated, with its code, placeholders and Markdown kept', () => {
    const bad = Object.entries(gitEn as Record<string, string>).map(([k, en]) => [k, problem(en, content[k])]).filter(([, p]) => p);
    expect(bad).toEqual([]);
  });
  it('no stale translations', () => {
    expect(Object.keys(ui).filter((k) => !(uiEn as string[]).includes(k))).toEqual([]);
    expect(Object.keys(content).filter((k) => !(k in gitEn))).toEqual([]);
  });
  it('applying the content table changes only prose', () => {
    const fa = applyContentTable(structuredClone({ ...gitContent, badges: [] }), content);
    expect(fa.modules[0].title).toBe(content['g01/title']);
    const blank = (c: object) => {
      walkProse(c, (_p, _v, set) => set(''));
      return JSON.stringify(c);
    };
    expect(blank(fa)).toEqual(blank(structuredClone({ ...gitContent, badges: [] })));
  });
});

describe('running in Farsi', () => {
  it('t() fills placeholders and falls back to English', () => {
    expect(t('{n} pts', { n: 5 })).toBe('5 pts');
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => 'fa', setItem: () => undefined };
    initLang('git');
    setTable({ '{n} pts': '{n} X' });
    expect(lang()).toBe('fa');
    expect(t('{n} pts', { n: 5 })).toBe('5 X');
    expect(t('Not in the table')).toBe('Not in the table');
    expect(inEnglish(() => t('{n} pts', { n: 5 }))).toBe('5 pts');
    setTable(ui);
  });
  it('feedback is in Farsi, and misconceptions still fire (they match the English copy)', () => {
    const e = gitContent.modules[0].practice.find((x) => x.git && /git commit/.test('solution' in x ? x.solution : '') && /git add/.test('solution' in x ? x.solution : ''))!;
    const answer = ('solution' in e ? e.solution : '').split('\n').filter((l) => !/git add/.test(l)).join('\n');
    const o = evaluateGit(e, answer);
    expect(o.status).toBe('wrong');
    expect(o.feedback.join(' ')).toMatch(/[؀-ۿ]/);
    expect(o.feedbackEn.join(' ')).not.toMatch(/[؀-ۿ]/);
    const ms = detectGitMisconceptions({ answer, spec: e.git!, outcome: o });
    expect(ms.map((m) => m.id)).toContain('commit-without-add');
    expect(ms[0].title).toMatch(/[؀-ۿ]/);
  });
});
