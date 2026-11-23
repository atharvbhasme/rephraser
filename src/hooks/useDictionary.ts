import { useCallback, useMemo, useState } from 'react';
import { expandForms, parseWords, sortWords } from '../lib/dictionary';
import { load, save } from '../lib/storage';
import { WORD_PACKS, type PackId } from '../lib/wordPacks';

export interface Dictionary {
  /** Words the user added (shown in the dictionary manager). */
  words: string[];
  /** Enabled word packs. */
  packs: PackId[];
  /** Everything Harper should accept: user words + packs, with possessive forms. */
  effective: string[];
  /** Adds one or many words (comma/space/newline separated). Returns how many were new. */
  add: (input: string | string[]) => number;
  remove: (word: string) => void;
  clear: () => void;
  setPack: (id: PackId, on: boolean) => void;
  exportText: () => string;
}

/** The personal dictionary, saved in this browser (localStorage). */
export function useDictionary(): Dictionary {
  const [words, setWords] = useState<string[]>(() => sortWords(load<string[]>('dictionary', [])));
  const [packs, setPacks] = useState<PackId[]>(() =>
    load<PackId[]>('wordPacks', []).filter((p) => p in WORD_PACKS),
  );

  const effective = useMemo(
    () => expandForms(new Set([...words, ...packs.flatMap((p) => WORD_PACKS[p].words)])),
    [words, packs],
  );

  const add = useCallback(
    (input: string | string[]) => {
      const incoming = parseWords(Array.isArray(input) ? input.join('\n') : input);
      const fresh = incoming.filter((w) => !words.includes(w));
      if (fresh.length) {
        setWords((prev) => {
          const next = sortWords([...new Set([...prev, ...fresh])]);
          save('dictionary', next);
          return next;
        });
      }
      return fresh.length;
    },
    [words],
  );

  const remove = useCallback((word: string) => {
    setWords((prev) => {
      const next = prev.filter((w) => w !== word);
      save('dictionary', next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setWords([]);
    save('dictionary', []);
  }, []);

  const setPack = useCallback((id: PackId, on: boolean) => {
    setPacks((prev) => {
      const next = on ? [...new Set([...prev, id])] : prev.filter((p) => p !== id);
      save('wordPacks', next);
      return next;
    });
  }, []);

  const exportText = useCallback(() => words.join('\n') + (words.length ? '\n' : ''), [words]);

  return { words, packs, effective, add, remove, clear, setPack, exportText };
}
