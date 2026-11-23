import { forwardRef, useImperativeHandle, useMemo, useRef, type ReactNode } from 'react';

export interface Mark {
  start: number;
  end: number;
  className: string;
  key: string;
}

export interface InputEditorHandle {
  selectRange: (start: number, end: number) => void;
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Ranges to decorate (underline / highlight). Must be valid for `value`. */
  marks?: Mark[];
  /** Called with the caret position after a click or key press. */
  onCaret?: (pos: number) => void;
  placeholder?: string;
  label: string;
  readOnly?: boolean;
  className?: string;
}

/**
 * A plain, fully native <textarea> (undo, IME, selection, copy all work) with a mirrored
 * layer behind it that draws underlines/highlights at the given ranges.
 */
export const InputEditor = forwardRef<InputEditorHandle, Props>(function InputEditor(
  { value, onChange, marks = [], onCaret, placeholder, label, readOnly, className },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    selectRange(start, end) {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(start, end);
    },
    focus() {
      taRef.current?.focus();
    },
  }));

  const decorated = useMemo(() => {
    const out: ReactNode[] = [];
    let cursor = 0;
    const sorted = [...marks].sort((a, b) => a.start - b.start);
    for (const m of sorted) {
      if (m.start < cursor || m.end <= m.start || m.end > value.length) continue;
      if (m.start > cursor) out.push(value.slice(cursor, m.start));
      out.push(
        <mark key={m.key} className={m.className}>
          {value.slice(m.start, m.end)}
        </mark>,
      );
      cursor = m.end;
    }
    out.push(value.slice(cursor));
    // A trailing newline needs a character after it or the backdrop is one line short.
    out.push('​');
    return out;
  }, [value, marks]);

  const syncScroll = () => {
    if (backRef.current && taRef.current) {
      backRef.current.scrollTop = taRef.current.scrollTop;
      backRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  const reportCaret = () => {
    if (taRef.current && onCaret) onCaret(taRef.current.selectionStart);
  };

  return (
    <div className={`editor${className ? ` ${className}` : ''}`}>
      <div className="editor-backdrop" ref={backRef} aria-hidden="true">
        {decorated}
      </div>
      <textarea
        ref={taRef}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onClick={reportCaret}
        onKeyUp={reportCaret}
      />
    </div>
  );
});
