import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { useEffect, useMemo, useRef, useState } from 'react';

export type Lang = 'shell' | 'dockerfile' | 'yaml' | 'text';

const LANGS = {
  shell: StreamLanguage.define(shell),
  dockerfile: StreamLanguage.define(dockerFile),
  yaml: StreamLanguage.define(yaml),
};

export function usePrefersDark(): boolean {
  const get = () =>
    document.documentElement.dataset.theme === 'dark' ||
    (document.documentElement.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [dark, setDark] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setDark(get());
    mq.addEventListener('change', on);
    const obs = new MutationObserver(on);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', on);
      obs.disconnect();
    };
  }, []);
  return dark;
}

/** CodeMirror for shell commands, Dockerfiles and YAML (compose files, system designs). Ctrl/Cmd+Enter runs onRun. */
export function CodeEditor({ value, onChange, lang, onRun, minHeight = '110px', readOnly, placeholder }: { value: string; onChange: (v: string) => void; lang: Lang; onRun?: () => void; minHeight?: string; readOnly?: boolean; placeholder?: string }) {
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const dark = usePrefersDark();
  const extensions = useMemo(
    () => [
      ...(lang === 'text' ? [] : [LANGS[lang]]),
      EditorView.lineWrapping,
      Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => (runRef.current?.(), true) }])),
    ],
    [lang],
  );
  return (
    <div className="editor">
      <CodeMirror value={value} onChange={onChange} extensions={extensions} minHeight={minHeight} readOnly={readOnly} placeholder={placeholder} theme={dark ? 'dark' : 'light'} basicSetup={{ lineNumbers: lang !== 'shell', foldGutter: false, highlightActiveLine: !readOnly }} />
    </div>
  );
}
