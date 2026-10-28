import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useSchema } from './useSchema';

export interface SqlEditorHandle {
  insert(text: string): void;
  focus(): void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  minHeight?: string;
  readOnly?: boolean;
  placeholder?: string;
}

function usePrefersDark(): boolean {
  const get = () =>
    document.documentElement.dataset.theme === 'dark' ||
    (document.documentElement.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [dark, setDark] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(get());
    mq.addEventListener('change', onChange);
    const obs = new MutationObserver(onChange);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', onChange);
      obs.disconnect();
    };
  }, []);
  return dark;
}

export const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor(
  { value, onChange, onRun, minHeight = '110px', readOnly, placeholder },
  ref,
) {
  const cm = useRef<ReactCodeMirrorRef>(null);
  const schema = useSchema();
  const runRef = useRef(onRun);
  runRef.current = onRun;
  const dark = usePrefersDark();

  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const view = cm.current?.view;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      view.focus();
    },
    focus() {
      cm.current?.view?.focus();
    },
  }));

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL, schema, upperCaseKeywords: true }),
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              runRef.current?.();
              return true;
            },
          },
        ]),
      ),
    ],
    [schema],
  );

  return (
    <div className="editor-wrap">
      <div className="editor">
        <CodeMirror
          ref={cm}
          value={value}
          onChange={onChange}
          extensions={extensions}
          minHeight={minHeight}
          readOnly={readOnly}
          placeholder={placeholder ?? 'Write your SQL here…'}
          theme={dark ? 'dark' : 'light'}
          basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly }}
        />
      </div>
    </div>
  );
});
