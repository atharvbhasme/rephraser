/**
 * Precision pass over Harper's issues: drops "corrections" of code and abbreviations,
 * prefers the user's dictionary casing, and marks risky spelling fixes as suggestions
 * only (shown, but not applied to the corrected text automatically).
 */
import type { Issue } from '../issues';
import type { RuleContext } from './context';
import { chunkAround, isAcronym, overlaps, type Range } from './protect';
import { editDistance, isDialectVariant, isSentenceStart, previousWord } from './text';

export function refineHarperIssues(text: string, issues: Issue[], ctx: RuleContext, prot: Range[]): Issue[] {
  const out: Issue[] = [];
  for (const issue of issues) {
    if (overlaps(prot, issue.start, issue.end)) continue; // links, code, identifiers
    // "customer-connect-gateway" → "Customer-connect-gateway": a service name, not a sentence.
    if (issue.category !== 'spelling' && /^[\p{Ll}\d]+(?:-[\p{Ll}\d]+){2,}$/u.test(chunkAround(text, issue.start, issue.end).replace(/[^\p{L}\p{N}-]+$/u, '')))
      continue;
    if (issue.category === 'spelling') {
      const refined = refineSpelling(text, issue, ctx);
      if (refined) out.push(refined);
      continue;
    }
    // Known-bad suggestion pattern: "one using" → "one piece of using".
    if (/mass noun/i.test(issue.message) || risky(issue)) {
      out.push({ ...issue, auto: false });
      continue;
    }
    out.push(issue);
  }
  return out;
}

function refineSpelling(text: string, issue: Issue, ctx: RuleContext): Issue | null {
  const word = issue.problem;
  if (isAcronym(word)) return null; // KDP, HPI, RU's

  // A dictionary word typed with different casing: rahul → Rahul, jfrog → JFrog.
  const possessive = /['’]s$/.exec(word)?.[0] ?? '';
  const base = possessive ? word.slice(0, -possessive.length) : word;
  const canon = ctx.canonical.get(base.toLowerCase());
  if (canon) {
    const fix = canon + possessive;
    return {
      ...issue,
      message: `Write “${canon}” with this capitalization.`,
      suggestions: [{ kind: 'replace', text: fix }, ...issue.suggestions.filter((s) => s.text !== fix)],
      auto: true,
    };
  }

  return { ...issue, auto: !risky(issue) && confidentSpellingFix(text, issue) };
}

/** Fix patterns that are usually wrong whatever the check: splitting a word, expanding an abbreviation. */
function risky(issue: Issue): boolean {
  const top = issue.suggestions[0];
  if (!top) return false;
  // "runbook" → "run book", "cleanup" → "clean up", "validdated" → "valid dated".
  if (!/\s/.test(issue.problem) && /\s/.test(top.text.trim())) return true;
  // "GB" → "gigabytes", "FYI" → "For your information", "ms" → "milliseconds".
  if (isAcronym(issue.problem.trim())) return true;
  if (issue.problem.trim().length <= 3 && top.text.length > issue.problem.length * 2) return true;
  // Kinds whose automatic fixes measured as mostly unhelpful on real messages ("very" → "a lot", "∅ → be").
  if (issue.kind === 'Miscellaneous' || issue.kind === 'Usage') return true;
  return false;
}

const HONORIFIC_OR_GREETING = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'sir', 'madam', 'hi', 'hello', 'hey', 'dear', 'cc']);

/** Only auto-apply spelling fixes that are almost certainly right. */
function confidentSpellingFix(text: string, issue: Issue): boolean {
  const word = issue.problem;
  const top = issue.suggestions[0];
  if (!top || top.kind !== 'replace') return false;
  const fix = top.text;
  const atStart = isSentenceStart(text, issue.start);

  // Part of a compound like mobile-api or driver-schedular: likely a technical name.
  const chunk = chunkAround(text, issue.start, issue.end).replace(/[^\p{L}\p{N}-]+$/u, '');
  if (chunk.includes('-') && chunk.length > word.length) return false;
  // Capitalised in the middle of a sentence: probably a name (Naveen → "Nave's").
  if (/^\p{Lu}/u.test(word) && !atStart) return false;
  if (/^\p{Lu}/u.test(word)) {
    // A capitalised word alone on its line, or after "Dr."/"Hi": a name (Savvana, Pompole).
    const lineStart = text.lastIndexOf('\n', issue.start - 1) + 1;
    const lineEnd = text.indexOf('\n', issue.end);
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    // (but "Descrition:" on its own line is a label, not a name)
    if (!/:\s*$/.test(line) && line.replace(/[^\p{L}]/gu, '') === word.replace(/[^\p{L}]/gu, '')) return false;
    if (HONORIFIC_OR_GREETING.has(previousWord(text, issue.start))) return false;
  }
  // US/UK spelling variants are both correct (center/centre, color/colour).
  if (isDialectVariant(word, fix)) return false;
  // Adding/removing an ending changes the word, not its spelling (unassign → unassigned).
  const wl = word.toLowerCase();
  const fl = fix.toLowerCase();
  if (/^(?:s|es|d|ed|ing|er|ly)$/.test(fl.startsWith(wl) ? fl.slice(wl.length) : wl.startsWith(fl) ? wl.slice(fl.length) : '')) return false;
  // "naveen" → "nave's": adding an apostrophe isn't a spelling fix.
  if (/['’]/.test(fix) && !/['’]/.test(word)) return false;
  // Very short words have too many look-alikes (Ans → …).
  if (word.length <= 3) return false;
  // Splitting a short word into two ("pame" → "pa me") is usually wrong.
  if (fix.includes(' ') && word.length <= 6) return false;
  // Turning a lower-case word into a proper noun ("jehraico" → "Hebraic") is a guess.
  if (/^\p{Lu}/u.test(fix) && /^\p{Ll}/u.test(word) && !atStart && fix.toLowerCase() !== word.toLowerCase()) return false;

  const d = editDistance(word.toLowerCase(), fix.toLowerCase());
  return word.length <= 5 ? d <= 1 : d <= 2;
}
