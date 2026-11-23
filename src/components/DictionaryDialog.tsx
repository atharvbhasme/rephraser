import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dictionary } from '../hooks/useDictionary';
import { parseWords } from '../lib/dictionary';
import { WORD_PACKS, type PackId } from '../lib/wordPacks';

interface Props {
  open: boolean;
  onClose: () => void;
  dictionary: Dictionary;
}

/** Manage the personal dictionary: add words in bulk, remove them, word packs, import/export. */
export function DictionaryDialog({ open, onClose, dictionary }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');
  const [note, setNote] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (open) {
      setNote('');
      setConfirmClear(false);
    }
  }, [open]);

  const pending = useMemo(() => parseWords(draft), [draft]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? dictionary.words.filter((w) => w.toLowerCase().includes(q)) : dictionary.words;
  }, [dictionary.words, filter]);

  const addDraft = () => {
    if (!pending.length) return;
    const n = dictionary.add(pending);
    setNote(n ? `Added ${n} word${n === 1 ? '' : 's'}.` : 'Those words are already in your dictionary.');
    setDraft('');
  };

  const download = () => {
    const blob = new Blob([dictionary.exportText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rephraser-dictionary.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setNote('That file is too large (max 2 MB).');
      return;
    }
    const n = dictionary.add(await file.text());
    setNote(`Imported ${n} new word${n === 1 ? '' : 's'} from ${file.name}.`);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="dict-title">
      <div className="dialog-head">
        <h2 id="dict-title">My dictionary</h2>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="dialog-sub">
        Words here are never flagged as spelling mistakes — add names, places, brands and technical terms. Saved in
        this browser only.
      </p>

      <form
        className="dict-add"
        onSubmit={(e) => {
          e.preventDefault();
          addDraft();
        }}
      >
        <textarea
          className="dict-input"
          aria-label="Words to add"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              addDraft();
            }
          }}
          placeholder="Type or paste words: Atharv, Bhasme, kubectl, Pune…"
        />
        <button type="submit" className="btn btn-primary" disabled={!pending.length}>
          Add{pending.length > 1 ? ` ${pending.length}` : ''}
        </button>
      </form>
      {note && (
        <p className="dialog-note" role="status">
          {note}
        </p>
      )}

      <h3 className="dialog-h3">Word packs</h3>
      <div className="packs">
        {(Object.keys(WORD_PACKS) as PackId[]).map((id) => {
          const p = WORD_PACKS[id];
          return (
            <label key={id} className="pack">
              <input
                type="checkbox"
                checked={dictionary.packs.includes(id)}
                onChange={(e) => dictionary.setPack(id, e.target.checked)}
              />
              <span>
                <strong>{p.title}</strong> <span className="issue-kind">{p.words.length} words</span>
                <br />
                <span className="pack-desc">{p.description}</span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="dialog-row">
        <h3 className="dialog-h3">
          Your words <span className="tab-badge">{dictionary.words.length}</span>
        </h3>
        {dictionary.words.length > 12 && (
          <input
            className="select dict-filter"
            type="search"
            placeholder="Filter…"
            aria-label="Filter your words"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
      </div>
      {dictionary.words.length === 0 ? (
        <p className="pack-desc">
          No words yet. Use <strong>+ Add to dictionary</strong> on a flagged word, or type words above.
        </p>
      ) : (
        <ul className="word-chips" aria-label="Your words">
          {shown.map((w) => (
            <li key={w} className="word-chip">
              {w}
              <button type="button" aria-label={`Remove ${w}`} title="Remove" onClick={() => dictionary.remove(w)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="dialog-foot">
        <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
          Import .txt
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.csv,text/plain"
          hidden
          onChange={(e) => importFile(e.target.files?.[0])}
        />
        <button type="button" className="btn btn-sm" disabled={!dictionary.words.length} onClick={download}>
          Export .txt
        </button>
        <span className="spacer" />
        {dictionary.words.length > 0 && (
          <button
            type="button"
            className={`btn btn-sm${confirmClear ? ' btn-danger' : ' btn-ghost'}`}
            onClick={() => {
              if (confirmClear) {
                dictionary.clear();
                setConfirmClear(false);
                setNote('Removed all your words.');
              } else setConfirmClear(true);
            }}
          >
            {confirmClear ? 'Click again to remove all' : 'Remove all'}
          </button>
        )}
        <button type="button" className="btn btn-sm btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
