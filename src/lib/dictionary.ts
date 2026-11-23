/** Pure helpers for the personal dictionary (unit-tested). */

const MAX_LEN = 48;
// Letters, marks, digits and the joiners used in names and tech terms (O'Brien, gRPC, C++, C#, k8s, Node.js).
const WORD_RE = /^[\p{L}\p{M}\p{N}'’._+#-]+$/u;
const HAS_LETTER = /\p{L}/u;

/** Strips quotes/brackets/punctuation around a word and a trailing possessive. */
export function cleanWord(raw: string): string | null {
  let w = raw.trim().replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}+#]+$/u, '');
  w = w.replace(/['’]s$/u, ''); // Rahul's → Rahul (the possessive is added back automatically)
  if (!w || w.length > MAX_LEN || !HAS_LETTER.test(w) || !WORD_RE.test(w)) return null;
  return w;
}

/** Splits pasted text ("Atharv, Bhasme\nkubectl; pnpm") into clean, unique words. */
export function parseWords(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of input.split(/[\s,;|]+/u)) {
    const w = cleanWord(piece);
    if (w && !seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

/** True if a flagged problem text can be added to the dictionary as one word. */
export function canAddToDictionary(problem: string): boolean {
  return cleanWord(problem) !== null && !/\s/.test(problem.trim());
}

/**
 * The words actually sent to Harper: each word plus its possessive form, because Harper
 * treats "Rahul's" as a separate word from "Rahul".
 */
export function expandForms(words: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const w of words) {
    out.add(w);
    if (/^[\p{L}\p{M}]+$/u.test(w)) out.add(`${w}'s`);
  }
  return [...out];
}

export function sortWords(words: string[]): string[] {
  return [...words].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}
