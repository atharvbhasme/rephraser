/** What the rules know about the user's dictionary. Built once per dictionary change. */
export interface RuleContext {
  /** lower-case → correct casing, for dictionary words with capitals (rahul → Rahul, sqlite → SQLite). */
  canonical: Map<string, string>;
  /** Lower-case forms of dictionary words that are names (start with a capital). */
  names: Set<string>;
}

export function makeContext(words: Iterable<string>): RuleContext {
  const canonical = new Map<string, string>();
  const names = new Set<string>();
  const lowerPresent = new Set<string>();
  const list = [...words].filter((w) => !/['’]s$/.test(w));
  for (const w of list) if (w === w.toLowerCase()) lowerPresent.add(w);
  for (const w of list) {
    if (w === w.toLowerCase()) continue;
    const lower = w.toLowerCase();
    if (lowerPresent.has(lower)) continue; // both casings are valid, e.g. "Node" and "node"
    if (!canonical.has(lower)) canonical.set(lower, w);
    if (/^\p{Lu}\p{Ll}+$/u.test(w)) names.add(lower);
  }
  return { canonical, names };
}

export const EMPTY_CONTEXT: RuleContext = { canonical: new Map(), names: new Set() };
