/**
 * Finds parts of the text that must never be "corrected": links, e-mail addresses,
 * code in backticks, file paths and programming identifiers (lastRunAt, error.message,
 * GRAPHQL_ENDPOINT, p95, v7.10.2 …). Harper would otherwise turn `getTime` into "gentile".
 */

export interface Range {
  start: number;
  end: number;
}

const SPAN_PATTERNS: RegExp[] = [
  /```[\s\S]*?```/g, // fenced code
  /`[^`\n]+`/g, // inline code
  /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi, // URLs
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // e-mail
  /(?<![\w])@[\w.-]+/g, // @mentions
  /\b[\w-]+(?:\.[\w-]+)+\/\S*/g, // domain.tld/path without scheme
  /\b[\w-]+\.(?:com|net|org|io|dev|app|ai|co|in|me|gov|edu|ts|js|tsx|jsx|json|yaml|yml|md|py|go|rs|java|sql|sh|txt|csv|log|env|config)\b/gi, // domains, file names
  /(?<!\S)(?:~|\.{1,2})?\/[\w.\-/]+/g, // /absolute and ./relative paths
  /\b[\w.-]+\/[\w.\-/]+/g, // a/b/c paths
  /\{[^{}\n]*\}/g, // {"json": ...}
  /\$[\w.]+/g, // $variables
];

const WORD = /[\p{L}\p{N}_$][\p{L}\p{N}_$.'’-]*[\p{L}\p{N}_$]|[\p{L}\p{N}]/gu;

/** True for tokens that look like code rather than English. */
export function isIdentifier(token: string): boolean {
  const t = token.replace(/['’]s$/, '');
  if (/[a-z][A-Z]/.test(t)) return true; // camelCase / PascalCase with inner capital
  if (t.includes('_')) return true; // snake_case, UPPER_SNAKE
  if (/^\d+(?:st|nd|rd|th|s)$/i.test(t)) return false; // 3rd, 9th, 90s
  if (/\p{L}/u.test(t) && /\d/.test(t)) return true; // p95, Auth0, v4, kdp5t
  if (/\p{L}\.\p{L}/u.test(t) && !/^(?:\p{L}\.)+\p{L}?\.?$/u.test(t)) return true; // error.message (not e.g. / i.e.)
  return false;
}

/** ALL-CAPS abbreviations such as KDP, HPI, RU's. Never spelling-checked. */
export function isAcronym(token: string): boolean {
  return /^[A-Z][A-Z0-9&]{1,9}(?:['’]?s)?$/.test(token) && token !== 'I';
}

export function protectedRanges(text: string): Range[] {
  const ranges: Range[] = [];
  for (const re of SPAN_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) ranges.push({ start: m.index!, end: m.index! + m[0].length });
  }
  for (const m of text.matchAll(WORD)) {
    if (isIdentifier(m[0])) ranges.push({ start: m.index!, end: m.index! + m[0].length });
  }
  return merge(ranges);
}

function merge(ranges: Range[]): Range[] {
  ranges.sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export function overlaps(ranges: Range[], start: number, end: number): boolean {
  // An insertion (start === end) "overlaps" if it sits strictly inside a range.
  return ranges.some((r) => (start === end ? start > r.start && start < r.end : start < r.end && end > r.start));
}

/** The whole whitespace-delimited chunk around a position, e.g. "mobile-api." around "api". */
export function chunkAround(text: string, start: number, end: number): string {
  let s = start;
  let e = end;
  while (s > 0 && !/\s/.test(text[s - 1])) s--;
  while (e < text.length && !/\s/.test(text[e])) e++;
  return text.slice(s, e);
}
