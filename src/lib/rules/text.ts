/** Small text helpers shared by the rules. */

/** Damerau–Levenshtein (optimal string alignment) distance. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

const LIST_MARKER = /^\s*(?:[-*•>]|\d+[.)])\s+/;

const ABBREVIATION_END = /\b(?:dr|mr|mrs|ms|prof|st|sr|jr|vs|etc|approx|no|e\.g|i\.e)\.\s+$/i;

/** True if `pos` begins a sentence: start of a line/list item, or after . ! ? (not "Dr."). */
export function isSentenceStart(text: string, pos: number): boolean {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const before = text.slice(lineStart, pos).replace(LIST_MARKER, '');
  if (!before.trim()) return true;
  if (ABBREVIATION_END.test(before)) return false;
  return /[.!?]["')\]]*\s+$/.test(before);
}

/** The word right before `pos` (same line), lower-cased, without punctuation. */
export function previousWord(text: string, pos: number): string {
  const m = /([\p{L}]+)[^\p{L}\n]*$/u.exec(text.slice(Math.max(0, pos - 40), pos));
  return m ? m[1].toLowerCase() : '';
}

/** US ↔ UK spelling pairs (center/centre, color/colour, defense/defence, organize/organise …). */
export function isDialectVariant(a: string, b: string): boolean {
  const norm = (w: string) =>
    w
      .toLowerCase()
      .replace(/our/g, 'or')
      .replace(/([^aeiou])re\b/g, '$1er')
      .replace(/is(e|ed|es|ing|ation|ations)\b/g, 'iz$1')
      .replace(/ys(e|ed|es|ing)\b/g, 'yz$1')
      .replace(/enc(e|es)\b/g, 'ens$1')
      .replace(/ogue\b/g, 'og')
      .replace(/ll(ed|ing|er|ation)\b/g, 'l$1')
      .replace(/dgement/g, 'dgment')
      .replace(/amme\b/g, 'am');
  return a.toLowerCase() !== b.toLowerCase() && norm(a) === norm(b);
}

export interface Line {
  text: string;
  start: number;
}

export function lines(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (const part of text.split('\n')) {
    out.push({ text: part, start });
    start += part.length + 1;
  }
  return out;
}

export function stripListMarker(line: string): { body: string; offset: number } {
  const m = LIST_MARKER.exec(line);
  return m ? { body: line.slice(m[0].length), offset: m[0].length } : { body: line, offset: 0 };
}

export const isListItem = (line: string) => LIST_MARKER.test(line);

export const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** Regular past participle: add → added, try → tried, create → created, submit → submitted. */
export function regularParticiple(verb: string): string {
  const doubled: Record<string, string> = {
    submit: 'submitted',
    commit: 'committed',
    admit: 'admitted',
    plan: 'planned',
    stop: 'stopped',
    drop: 'dropped',
    ship: 'shipped',
    refer: 'referred',
    prefer: 'preferred',
    occur: 'occurred',
    transfer: 'transferred',
  };
  if (doubled[verb]) return doubled[verb];
  if (verb.endsWith('e')) return `${verb}d`;
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ied`;
  return `${verb}ed`;
}

/** Regular plural: query → queries, box → boxes, alert → alerts. */
export function plural(noun: string): string {
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  return `${noun}s`;
}
