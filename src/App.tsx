import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CorrectTab } from './components/CorrectTab';
import { DictionaryDialog } from './components/DictionaryDialog';
import { useDictionary } from './hooks/useDictionary';
import { cleanWord } from './lib/dictionary';
import { DIALECTS, type DialectName } from './lib/issues';
import { load, save } from './lib/storage';

// The Rephrase tab (and its AI runtime) is only downloaded when first opened.
const RephraseTab = lazy(() => import('./components/RephraseTab'));

type Tab = 'correct' | 'rephrase';

/** First-visit default: the English variety of the browser's language (en-IN → Indian …). */
function detectDialect(): DialectName {
  const byRegion: Record<string, DialectName> = { IN: 'Indian', GB: 'British', UK: 'British', IE: 'British', AU: 'Australian', NZ: 'Australian', CA: 'Canadian' };
  for (const lang of navigator.languages ?? [navigator.language]) {
    const m = /^en-([A-Z]{2})/i.exec(lang ?? '');
    if (m && byRegion[m[1].toUpperCase()]) return byRegion[m[1].toUpperCase()];
    if (/^en/i.test(lang ?? '')) return 'American';
  }
  // Non-English browser languages common in India (hi, mr, ta, te, kn, bn …) → Indian English.
  if ((navigator.languages ?? []).some((l) => /^(hi|mr|ta|te|kn|bn|gu|ml|pa|or)\b/i.test(l))) return 'Indian';
  return 'American';
}

export function App() {
  const [tab, setTab] = useState<Tab>(() => load<Tab>('tab', 'correct'));
  const [visited, setVisited] = useState<Record<Tab, boolean>>({ correct: true, rephrase: tab === 'rephrase' });
  const [dialect, setDialect] = useState<DialectName>(() => load<DialectName>('dialect', detectDialect()));
  const [correctText, setCorrectText] = useState(() => load('draft', ''));
  const [rephraseText, setRephraseText] = useState(() => load('rephraseDraft', ''));
  const [issueCount, setIssueCount] = useState(0);
  const dictionary = useDictionary();
  const [dictOpen, setDictOpen] = useState(false);
  const [toast, setToast] = useState<{ word: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const addWord = useCallback(
    (raw: string) => {
      const word = cleanWord(raw);
      if (!word) return;
      dictionary.add(word);
      setToast({ word });
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 5000);
    },
    [dictionary],
  );

  useEffect(() => save('tab', tab), [tab]);
  useEffect(() => save('dialect', dialect), [dialect]);
  useEffect(() => {
    const t = setTimeout(() => save('draft', correctText), 400);
    return () => clearTimeout(t);
  }, [correctText]);
  useEffect(() => {
    const t = setTimeout(() => save('rephraseDraft', rephraseText), 400);
    return () => clearTimeout(t);
  }, [rephraseText]);

  const open = useCallback((t: Tab) => {
    setTab(t);
    setVisited((v) => ({ ...v, [t]: true }));
  }, []);

  const sendToRephrase = useCallback(
    (text: string) => {
      setRephraseText(text);
      open('rephrase');
    },
    [open],
  );
  const sendToCorrect = useCallback(
    (text: string) => {
      setCorrectText(text);
      open('correct');
    },
    [open],
  );

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--accent)" />
            <path
              d="M8 17.5l5 5L24 10.5"
              fill="none"
              stroke="var(--on-accent)"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <h1>Rephraser</h1>
            <p>Spelling, grammar & rephrasing that never leaves your computer</p>
          </div>
        </div>
        <div className="header-controls">
          <span className="offline-pill" title="All processing happens in this browser. No text is sent anywhere.">
            Runs offline
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setDictOpen(true)}
            title="Words that should never be flagged: names, places, technical terms"
          >
            📖 Dictionary
            {dictionary.words.length + dictionary.packs.length > 0 && (
              <span className="tab-badge">{dictionary.words.length}</span>
            )}
          </button>
          <label className="toggle">
            <span>English</span>
            <select
              className="select"
              value={dialect}
              onChange={(e) => setDialect(e.target.value as DialectName)}
              aria-label="English dialect"
            >
              {DIALECTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Mode">
        <button
          type="button"
          role="tab"
          id="tab-correct"
          aria-controls="panel-correct"
          aria-selected={tab === 'correct'}
          className="tab"
          onClick={() => open('correct')}
        >
          ✓ Spelling & Grammar
          {issueCount > 0 && <span className="tab-badge">{issueCount}</span>}
        </button>
        <button
          type="button"
          role="tab"
          id="tab-rephrase"
          aria-controls="panel-rephrase"
          aria-selected={tab === 'rephrase'}
          className="tab"
          onClick={() => open('rephrase')}
        >
          ↻ Rephrase
        </button>
      </nav>

      <main>
        <div role="tabpanel" id="panel-correct" aria-labelledby="tab-correct" hidden={tab !== 'correct'}>
          <CorrectTab
            text={correctText}
            onText={setCorrectText}
            dialect={dialect}
            words={dictionary.effective}
            onAddWord={addWord}
            onSendToRephrase={sendToRephrase}
            onCounts={setIssueCount}
          />
        </div>
        <div role="tabpanel" id="panel-rephrase" aria-labelledby="tab-rephrase" hidden={tab !== 'rephrase'}>
          {visited.rephrase && (
            <Suspense fallback={<p className="empty-state">Loading…</p>}>
              <RephraseTab text={rephraseText} onText={setRephraseText} onSendToCorrect={sendToCorrect} />
            </Suspense>
          )}
        </div>
      </main>

      <DictionaryDialog open={dictOpen} onClose={() => setDictOpen(false)} dictionary={dictionary} />
      {toast && (
        <div className="toast" role="status">
          Added “{toast.word}” to your dictionary
          <button
            type="button"
            className="toast-btn"
            onClick={() => {
              dictionary.remove(toast.word);
              setToast(null);
            }}
          >
            Undo
          </button>
          <button
            type="button"
            className="toast-btn"
            onClick={() => {
              setToast(null);
              setDictOpen(true);
            }}
          >
            Manage
          </button>
        </div>
      )}

      <footer className="footer">
        Spelling & grammar by Harper (rule-based, no AI). Rephrasing by a small local T5 model. Your text never leaves
        this device.
      </footer>
    </div>
  );
}
