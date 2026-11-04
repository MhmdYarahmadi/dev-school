import { Fragment, type ReactNode } from 'react';

/** Translated text with elements in its `{placeholders}`: `<T text={t('Files in {dir}.')} vars={{ dir: <code>~/shop</code> }} />`. */
export function T({ text, vars }: { text: string; vars: Record<string, ReactNode> }) {
  const parts = text.split(/\{(\w+)\}/);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{i % 2 ? (p in vars ? vars[p] : `{${p}}`) : p}</Fragment>
      ))}
    </>
  );
}

/** Plain text with `backtick` spans shown as code (short notes that aren't full Markdown). */
export function Ticks({ text }: { text: string }) {
  return (
    <>
      {text.split(/`([^`]+)`/).map((p, i) => (i % 2 ? <code key={i}>{p}</code> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}
