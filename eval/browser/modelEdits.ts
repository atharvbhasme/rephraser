/**
 * Turns a grammar model's rewrite of a sentence into small, separate fixes (Issues) that
 * the user can review one by one — and filters out anything risky: changes to code, links,
 * names or numbers, and rewrites that change the meaning rather than the grammar.
 */
import { categorize, type Issue } from '../../src/lib/issues';
import { isAcronym, overlaps, type Range } from '../../src/lib/rules/protect';
import { editDistance } from '../../src/lib/rules/text';

interface Tok {
  text: string;
  start: number;
  end: number;
}

const TOKEN_RE = /[\p{L}\p{N}]+(?:['’._\-/:@][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;

function tokens(text: string, offset = 0): Tok[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => ({ text: m[0], start: offset + m.index!, end: offset + m.index! + m[0].length }));
}

const norm = (t: string) => t.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');

interface RawEdit {
  i1: number;
  i2: number;
  ins: string[];
}

function diff(a: string[], b: string[]): RawEdit[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: RawEdit[] = [];
  let i = 0;
  let j = 0;
  let cur: RawEdit | null = null;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      if (cur) out.push(cur);
      cur = null;
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      cur ??= { i1: i, i2: i, ins: [] };
      cur.ins.push(b[j++]);
    } else {
      cur ??= { i1: i, i2: i, ins: [] };
      i++;
      cur.i2 = i;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Small words a grammar fix may add, remove or swap without changing the meaning. */
const FUNCTION_WORDS = new Set(
  (
    'a an the this that these those is are was were be been being am have has had do does did will would can could ' +
    'should shall may might must to of in on at for from with by about into as and or but so if than then also ' +
    'very just it its it\'s i me my we our us you your he him his she her they them their there here which who ' +
    'whom whose what when where how not no any some all each every more most such only still currently ' +
    "i'm i've i'll we're we've we'll you're they're that's there's let's don't doesn't didn't can't won't isn't aren't"
  ).split(/\s+/),
);

const isWord = (t: string) => /[\p{L}\p{N}]/u.test(t);
const isFunction = (t: string) => FUNCTION_WORDS.has(t.toLowerCase());

/** Same word in another form: send/sent, alert/alerts, avaliable/available, look/looks. */
function sameWordFamily(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return true;
  const d = editDistance(x, y);
  if (d <= 2 && Math.min(x.length, y.length) >= 3) return true;
  // Shared stem of 4+ letters (configure/configured/configuration).
  let k = 0;
  while (k < x.length && k < y.length && x[k] === y[k]) k++;
  return k >= 4 && k >= Math.min(x.length, y.length) - 3;
}

export interface ModelEditOptions {
  /** Longest change (in words, either side) accepted from the model. */
  maxWords?: number;
}

/**
 * Compares `original` (a sentence found at `offset` in the full text) with the model's
 * `corrected` version and returns the acceptable differences as Issues.
 */
export function modelEditsToIssues(
  fullText: string,
  offset: number,
  original: string,
  corrected: string,
  protectedRanges: Range[],
  opts: ModelEditOptions = {},
): Issue[] {
  const maxWords = opts.maxWords ?? 4;
  const a = tokens(original, offset);
  const b = tokens(corrected);
  const edits = diff(
    a.map((t) => norm(t.text)),
    b.map((t) => norm(t.text)),
  );
  const out: Issue[] = [];
  for (const e of edits) {
    const del = a.slice(e.i1, e.i2).map((t) => t.text);
    const ins = e.ins;
    const delWords = del.filter(isWord);
    const insWords = ins.filter(isWord);
    if (delWords.length > maxWords || insWords.length > maxWords) continue;
    if (!acceptable(del, ins, delWords, insWords)) continue;

    // Where the edit sits in the full text.
    let start: number;
    let end: number;
    let replacement: string;
    let kind: 'replace' | 'insertAfter';
    if (e.i2 > e.i1) {
      start = a[e.i1].start;
      end = a[e.i2 - 1].end;
      replacement = joinTokens(ins);
      kind = 'replace';
    } else {
      // Pure insertion: attach to the previous token (or the next one at the start).
      if (e.i1 > 0) {
        const prev = a[e.i1 - 1];
        start = prev.start;
        end = prev.end;
        replacement = (/^[\p{L}\p{N}]/u.test(ins[0]) || ins[0] === '(' ? ' ' : '') + joinTokens(ins);
        kind = 'insertAfter';
      } else {
        const next = a[0];
        if (!next) continue;
        start = next.start;
        end = next.end;
        replacement = `${joinTokens(ins)} ${next.text}`;
        kind = 'replace';
      }
    }
    if (overlaps(protectedRanges, start, end)) continue;
    if (del.some((t) => isAcronym(t))) continue;

    const problem = fullText.slice(start, end);
    const label = kind === 'insertAfter' ? `${problem}${replacement}` : replacement;
    const kindName = !delWords.length && !insWords.length ? 'Punctuation' : !delWords.length ? 'MissingWord' : 'Grammar';
    out.push({
      id: `m:${start}:${end}:${replacement}`,
      index: -1,
      start,
      end,
      kind: kindName,
      category: categorize(kindName === 'MissingWord' ? 'Grammar' : kindName),
      message:
        kindName === 'MissingWord'
          ? `A word seems to be missing: “${label.trim()}”.`
          : `Deep check suggests “${label.trim()}”.`,
      problem,
      suggestions: [{ kind, text: replacement }],
      auto: true,
      source: `model:${kindName}`,
      ignoreKey: `model|${fullText.slice(Math.max(0, start - 20), end + 20)}|${replacement}`,
    });
  }
  return out;
}

/** Grammar-sized edits only: no new content words, names or numbers. */
function acceptable(del: string[], ins: string[], delWords: string[], insWords: string[]): boolean {
  if (!del.length && !ins.length) return false;
  // Numbers must never change.
  const nums = (xs: string[]) => xs.filter((t) => /\d/.test(t)).join(' ');
  if (nums(del) !== nums(ins)) return false;
  // Names (capitalised words) may only change case, not spelling.
  for (const w of delWords) {
    if (/^\p{Lu}/u.test(w) && !insWords.some((x) => x.toLowerCase() === w.toLowerCase()) && !isFunction(w)) return false;
  }
  // Every removed word must be a small function word or reappear in another form.
  for (const w of delWords) {
    if (isFunction(w)) continue;
    if (!insWords.some((x) => sameWordFamily(w, x))) return false;
  }
  // Every added word must be a small function word or a form of a removed word.
  for (const w of insWords) {
    if (isFunction(w)) continue;
    if (!delWords.some((x) => sameWordFamily(w, x))) return false;
  }
  return true;
}

function joinTokens(ts: string[]): string {
  let s = '';
  for (const t of ts) {
    if (!s) s = t;
    else if (/^[.,;:!?)\]}%]$/.test(t) || /[(\[{]$/.test(s) || /^['’]s$/.test(t)) s += t;
    else s += ` ${t}`;
  }
  return s;
}
