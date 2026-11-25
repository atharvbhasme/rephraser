/** Shared types and pure helpers for spelling/grammar issues. No Harper imports here
 *  so this file can be used on the main thread without loading the WASM engine. */

export type Category = 'spelling' | 'grammar' | 'style';

export type SuggestionKind = 'replace' | 'remove' | 'insertAfter';

export interface Suggestion {
  kind: SuggestionKind;
  /** Replacement text (for replace) or inserted text (for insertAfter); '' for remove. */
  text: string;
}

export interface Issue {
  /** Stable id for this issue within one check result. */
  id: string;
  /** Position of this lint in the worker's last result (used for "Ignore"). */
  index: number;
  /** UTF-16 offsets into the checked text (same units as String.prototype.slice). */
  start: number;
  end: number;
  /** Harper's lint kind, e.g. "Spelling", "Agreement". */
  kind: string;
  category: Category;
  message: string;
  problem: string;
  suggestions: Suggestion[];
  /**
   * false = shown as a suggestion but NOT applied to the corrected text automatically
   * (used when a fix is likely to be wrong, e.g. an unknown name). Default true.
   */
  auto?: boolean;
  /** Which check produced it: "harper" or "rule:<name>" (used by the accuracy benchmark). */
  source?: string;
  /** For Rephraser's own rules: key used to remember "Ignore" (Harper issues use `index`). */
  ignoreKey?: string;
}

/** The suggestion used in the corrected text when the user hasn't picked one: -1 = keep original. */
export function defaultChoice(issue: Issue): number {
  return issue.auto === false || issue.suggestions.length === 0 ? -1 : 0;
}

export const DIALECTS = ['American', 'British', 'Canadian', 'Australian', 'Indian'] as const;
export type DialectName = (typeof DIALECTS)[number];

const SPELLING_KINDS = new Set(['Spelling', 'Typo']);
const STYLE_KINDS = new Set([
  'Style',
  'Readability',
  'Redundancy',
  'Repetition',
  'Enhancement',
  'Formatting',
  'Regionalism',
]);

/** Groups Harper's ~20 lint kinds into the three buckets shown in the UI. */
export function categorize(kind: string): Category {
  if (SPELLING_KINDS.has(kind)) return 'spelling';
  if (STYLE_KINDS.has(kind)) return 'style';
  // Grammar, Agreement, WordOrder, Punctuation, Capitalization, Usage, Malapropism,
  // Eggcorn, BoundaryError, Nonstandard, WordChoice, Miscellaneous, and anything new.
  return 'grammar';
}

/** Raw lint data as extracted from Harper inside the worker. */
export interface RawLint {
  start: number;
  end: number;
  kind: string;
  message: string;
  problem: string;
  suggestions: Suggestion[];
}

/** Converts a code-point offset to a UTF-16 offset. */
export function codePointToUtf16(text: string, cp: number): number {
  let units = 0;
  let count = 0;
  for (const ch of text) {
    if (count === cp) return units;
    units += ch.length;
    count++;
  }
  return units;
}

/**
 * Makes sure a lint's span really points at its problem text in UTF-16 units.
 * harper.js already reports UTF-16 offsets, but this guards against version
 * changes (code-point offsets) so highlights never drift.
 */
export function resolveSpan(text: string, lint: RawLint): { start: number; end: number } | null {
  const { start, end, problem } = lint;
  if (text.slice(start, end) === problem) return { start, end };
  const s = codePointToUtf16(text, start);
  const e = codePointToUtf16(text, end);
  if (text.slice(s, e) === problem) return { start: s, end: e };
  if (!problem) return start <= text.length ? { start, end: Math.min(end, text.length) } : null;
  // Last resort: nearest occurrence of the problem text.
  const after = text.indexOf(problem, Math.max(0, start - 8));
  return after >= 0 ? { start: after, end: after + problem.length } : null;
}

function dedupeSuggestions(list: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const s of list) {
    const key = `${s.kind}:${s.text.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Turns raw lints into UI issues (UTF-16 spans, categories, de-duplicated suggestions). */
export function toIssues(text: string, lints: RawLint[], maxSuggestions = 5): Issue[] {
  const issues: Issue[] = [];
  lints.forEach((lint, index) => {
    const span = resolveSpan(text, lint);
    if (!span) return;
    issues.push({
      id: `${span.start}:${span.end}:${lint.kind}`,
      index,
      start: span.start,
      end: span.end,
      kind: lint.kind,
      category: categorize(lint.kind),
      message: lint.message,
      problem: text.slice(span.start, span.end),
      suggestions: dedupeSuggestions(lint.suggestions).slice(0, maxSuggestions),
    });
  });
  return issues.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Short human label for a suggestion chip. */
export function suggestionLabel(s: Suggestion, problem: string): string {
  if (s.kind === 'remove') return `remove “${problem}”`;
  if (s.kind === 'insertAfter') return `add “${s.text.trim()}”`;
  return s.text === '' ? '(remove)' : s.text;
}

export function countByCategory(issues: Issue[]): Record<Category, number> {
  const counts: Record<Category, number> = { spelling: 0, grammar: 0, style: 0 };
  for (const i of issues) counts[i.category]++;
  return counts;
}
