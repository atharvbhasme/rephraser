import { useEffect, useRef, useState } from 'react';
import type { Choices } from '../lib/applyFixes';
import { canAddToDictionary } from '../lib/dictionary';
import { suggestionLabel, type Category, type Issue } from '../lib/issues';

interface Props {
  issues: Issue[];
  counts: Record<Category, number>;
  showStyle: boolean;
  onShowStyle: (v: boolean) => void;
  choices: Choices;
  onChoose: (id: string, choice: number) => void;
  onIgnore: (issue: Issue) => void;
  onAddWord: (word: string) => void;
  onLocate: (issue: Issue) => void;
  activeId: string | null;
  busy: boolean;
  hasIgnored: boolean;
  onResetIgnored: () => void;
}

const LABEL: Record<Category, string> = { spelling: 'spelling', grammar: 'grammar', style: 'style' };

export function IssuesStrip({
  issues,
  counts,
  showStyle,
  onShowStyle,
  choices,
  onChoose,
  onIgnore,
  onAddWord,
  onLocate,
  activeId,
  busy,
  hasIgnored,
  onResetIgnored,
}: Props) {
  const [open, setOpen] = useState(true);
  const listRef = useRef<HTMLUListElement>(null);

  // Bring the issue under the caret into view.
  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-id="${CSS.escape(activeId)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const cats: Category[] = showStyle ? ['spelling', 'grammar', 'style'] : ['spelling', 'grammar'];

  return (
    <section className="issues" aria-label="Mistakes found">
      <div className="issues-head">
        <button
          type="button"
          className="issues-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="chev" aria-hidden="true">
            ▶
          </span>
          {cats.map((c) => (
            <span key={c} className="count">
              <span className={`dot dot-${c}`} aria-hidden="true" />
              {counts[c]} {LABEL[c]}
            </span>
          ))}
          {busy && <span className="issue-kind">checking…</span>}
        </button>
        {hasIgnored && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onResetIgnored}
            title="Show issues you chose to ignore again"
          >
            Reset ignored
          </button>
        )}
        <label className="toggle">
          <input type="checkbox" checked={showStyle} onChange={(e) => onShowStyle(e.target.checked)} />
          Show style suggestions{!showStyle && counts.style ? ` (${counts.style})` : ''}
        </label>
      </div>

      {open &&
        (issues.length === 0 ? (
          <p className="empty-state">{busy ? 'Checking…' : 'No mistakes found.'}</p>
        ) : (
          <ul className="issue-list" ref={listRef}>
            {issues.map((issue) => {
              const chosen = choices[issue.id] ?? 0;
              return (
                <li
                  key={issue.id}
                  data-id={issue.id}
                  className={`issue${issue.id === activeId ? ' is-active' : ''}`}
                >
                  <span className={`dot dot-${issue.category}`} aria-hidden="true" />
                  <div className="issue-main">
                    <div className="issue-line">
                      <button
                        type="button"
                        className="issue-problem"
                        title="Show in the text"
                        onClick={() => onLocate(issue)}
                      >
                        {issue.problem.trim() || '·'}
                      </button>
                      {issue.suggestions.length > 0 && <span className="arrow">→</span>}
                      {issue.suggestions.map((s, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="chip"
                          aria-pressed={chosen === idx}
                          onClick={() => onChoose(issue.id, idx)}
                        >
                          {suggestionLabel(s, issue.problem)}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="chip"
                        aria-pressed={chosen === -1}
                        title="Keep the original text in the output"
                        onClick={() => onChoose(issue.id, -1)}
                      >
                        keep
                      </button>
                      <span className="issue-kind">{issue.kind}</span>
                    </div>
                    <p className="issue-msg">{issue.message}</p>
                  </div>
                  <div className="issue-actions">
                    {issue.category === 'spelling' && canAddToDictionary(issue.problem) && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        title="Never flag this word again (names, technical terms…)"
                        onClick={() => onAddWord(issue.problem)}
                      >
                        + Add to dictionary
                      </button>
                    )}
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => onIgnore(issue)}>
                      Ignore
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}
