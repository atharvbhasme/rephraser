import { useEffect, useMemo, useRef, useState } from 'react';
import { useChecker } from '../hooks/useChecker';
import { applyFixes, type Choices } from '../lib/applyFixes';
import { countByCategory, type DialectName, type Issue } from '../lib/issues';
import { load, save } from '../lib/storage';
import { CopyButton } from './CopyButton';
import { InputEditor, type InputEditorHandle, type Mark } from './InputEditor';
import { IssuesStrip } from './IssuesStrip';

interface Props {
  text: string;
  onText: (t: string) => void;
  dialect: DialectName;
  /** Effective personal dictionary (user words + word packs). */
  words: string[];
  onAddWord: (word: string) => void;
  onSendToRephrase: (t: string) => void;
  onCounts: (n: number) => void;
}

const SAMPLE =
  'i has went too the libary yesterday and buyed three book. Their going to the store tomorow, ' +
  'but she dont like it because its to expensive. He is a honest man and he have alot of freinds.';

/** The user's own edits to the corrected text, and the corrected text they started from. */
interface Edited {
  text: string;
  base: string;
}

export function CorrectTab({ text, onText, dialect, words, onAddWord, onSendToRephrase, onCounts }: Props) {
  const checker = useChecker(text, dialect, words);
  const editorRef = useRef<InputEditorHandle>(null);
  const [showStyle, setShowStyle] = useState(() => load('showStyle', false));
  const [choices, setChoices] = useState<Choices>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [edited, setEdited] = useState<Edited | null>(null);

  const visible = useMemo(
    () => checker.issues.filter((i) => showStyle || i.category !== 'style'),
    [checker.issues, showStyle],
  );
  const counts = useMemo(() => countByCategory(checker.issues), [checker.issues]);

  // While the user is typing, keep only highlights that still line up with the text.
  const liveIssues = useMemo(
    () =>
      checker.checkedText === text
        ? visible
        : visible.filter((i) => text.slice(i.start, i.end) === i.problem),
    [visible, checker.checkedText, text],
  );
  const inputMarks = useMemo<Mark[]>(
    () =>
      liveIssues.map((i) => ({
        start: i.start,
        end: i.end,
        key: i.id,
        className: `u u-${i.category}${i.id === activeId ? ' is-active' : ''}`,
      })),
    [liveIssues, activeId],
  );

  const fix = useMemo(
    () => applyFixes(checker.checkedText, visible, choices),
    [checker.checkedText, visible, choices],
  );

  // Green highlights on every change in the corrected text.
  const fixMarks = useMemo<Mark[]>(() => {
    const marks: Mark[] = [];
    let pos = 0;
    fix.segments.forEach((s, i) => {
      if (s.changed && s.text) marks.push({ start: pos, end: pos + s.text.length, key: `f${i}`, className: 'fix' });
      pos += s.text.length;
    });
    return marks;
  }, [fix.segments]);

  // Output = the user's edits if any, otherwise the automatic correction.
  const output = edited?.text ?? fix.corrected;
  const stale = edited !== null && edited.base !== fix.corrected;
  const outputMarks = useMemo(
    () =>
      edited === null
        ? fixMarks
        : // After editing, keep only highlights whose text is still in the same place.
          fixMarks.filter((m) => edited.text.slice(m.start, m.end) === fix.corrected.slice(m.start, m.end)),
    [edited, fixMarks, fix.corrected],
  );

  // Clearing the input also clears any edits.
  useEffect(() => {
    if (!text.trim()) setEdited(null);
  }, [text]);

  const total = counts.spelling + counts.grammar + (showStyle ? counts.style : 0);
  // Report the badge count up to the tab bar.
  useEffect(() => onCounts(total), [total, onCounts]);

  const locate = (issue: Issue) => {
    setActiveId(issue.id);
    if (checker.checkedText === text) editorRef.current?.selectRange(issue.start, issue.end);
  };

  const busy = checker.status === 'checking' || checker.checkedText !== text;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <>
      {checker.error && (
        <div className="error-banner" role="alert">
          Spelling & grammar engine error: {checker.error}
        </div>
      )}
      <div className="panes">
        <section className="pane" aria-label="Your text">
          <div className="pane-head">
            <h2 className="pane-title">Your text</h2>
            {!text && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => onText(SAMPLE)}>
                Try a sample
              </button>
            )}
            {text && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => onText('')}>
                Clear
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm"
              onClick={checker.checkNow}
              disabled={checker.status === 'loading'}
            >
              Check
            </button>
          </div>
          <InputEditor
            ref={editorRef}
            label="Text to check"
            value={text}
            onChange={onText}
            marks={inputMarks}
            onCaret={(pos) => setActiveId(liveIssues.find((i) => pos >= i.start && pos <= i.end)?.id ?? null)}
            placeholder="Type or paste English text here. Mistakes are underlined as you type."
          />
          <div className="pane-foot">
            <span>
              {wordCount} {wordCount === 1 ? 'word' : 'words'}
            </span>
            <span className="spacer">
              {checker.status === 'loading'
                ? 'Loading spelling & grammar engine…'
                : checker.ms !== null && text
                  ? `Checked in ${checker.ms} ms`
                  : ''}
            </span>
          </div>
        </section>

        <section className="pane" aria-label="Corrected text">
          <div className="pane-head">
            <h2 className="pane-title">Corrected</h2>
            <CopyButton text={output} />
            <button
              type="button"
              className="btn"
              disabled={!output.trim()}
              onClick={() => onSendToRephrase(output)}
            >
              Send to Rephrase →
            </button>
          </div>
          {stale && (
            <div className="edit-bar" role="status">
              <span>Your text changed after you edited the corrected version.</span>
              <button type="button" className="btn btn-sm" onClick={() => setEdited(null)}>
                Update (drops my edits)
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setEdited((e) => (e ? { ...e, base: fix.corrected } : e))}
              >
                Keep my edits
              </button>
            </div>
          )}
          <InputEditor
            label="Corrected text (editable)"
            value={output}
            onChange={(v) => setEdited((e) => ({ text: v, base: e?.base ?? fix.corrected }))}
            marks={outputMarks}
            placeholder="The corrected text will appear here. You can edit it before copying."
            className="editor-output"
          />
          <div className="pane-foot">
            {edited ? (
              <>
                <span className="edited-tag">✎ Edited by you</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEdited(null)}>
                  Undo my edits
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  title="Move this text to the left box to check it again"
                  onClick={() => {
                    onText(edited.text);
                    setEdited(null);
                  }}
                >
                  Check my edits
                </button>
              </>
            ) : (
              <>
                <span>
                  {fix.applied} {fix.applied === 1 ? 'fix' : 'fixes'} applied
                </span>
                <span className="spacer">Click in the box to edit · pick other suggestions below</span>
              </>
            )}
          </div>
        </section>
      </div>

      <IssuesStrip
        issues={visible}
        counts={counts}
        showStyle={showStyle}
        onShowStyle={(v) => {
          setShowStyle(v);
          save('showStyle', v);
        }}
        choices={choices}
        onChoose={(id, c) => setChoices((prev) => ({ ...prev, [id]: c }))}
        onIgnore={checker.ignore}
        onAddWord={onAddWord}
        onLocate={locate}
        activeId={activeId}
        busy={busy}
        hasIgnored={checker.hasIgnored}
        onResetIgnored={checker.clearIgnored}
      />
    </>
  );
}
