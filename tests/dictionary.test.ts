import { describe, expect, it } from 'vitest';
import { canAddToDictionary, cleanWord, expandForms, parseWords } from '../src/lib/dictionary';
import { WORD_PACKS } from '../src/lib/wordPacks';

describe('dictionary helpers', () => {
  it('cleans words and strips possessives and punctuation', () => {
    expect(cleanWord('  "Atharv," ')).toBe('Atharv');
    expect(cleanWord("Rahul's")).toBe('Rahul');
    expect(cleanWord('Priya’s')).toBe('Priya');
    expect(cleanWord('Node.js.')).toBe('Node.js');
    expect(cleanWord('C++')).toBe('C++');
    expect(cleanWord('C#')).toBe('C#');
    expect(cleanWord('k8s')).toBe('k8s');
    expect(cleanWord('1234')).toBeNull();
    expect(cleanWord('two words')).toBeNull();
    expect(cleanWord('')).toBeNull();
  });

  it('parses pasted lists of names and terms', () => {
    expect(parseWords('Atharv, Bhasme\nkubectl; pnpm  Atharv')).toEqual(['Atharv', 'Bhasme', 'kubectl', 'pnpm']);
  });

  it('decides which flagged problems can be added', () => {
    expect(canAddToDictionary('Bhasme')).toBe(true);
    expect(canAddToDictionary('useEffect')).toBe(true);
    expect(canAddToDictionary('a lot')).toBe(false);
  });

  it('adds possessive forms for plain words only', () => {
    expect(expandForms(['Atharv', 'Node.js'])).toEqual(['Atharv', "Atharv's", 'Node.js']);
  });

  it('ships non-empty word packs without duplicates', () => {
    for (const p of Object.values(WORD_PACKS)) {
      expect(p.words.length).toBeGreaterThan(50);
      expect(new Set(p.words).size).toBe(p.words.length);
    }
  });
});
