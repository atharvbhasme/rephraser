/**
 * Accuracy metrics for spelling/grammar correction, in the spirit of ERRANT/M2 scoring:
 * both the reference correction and the system output are turned into word-level edits
 * against the original input, then compared.
 */

export type Token = string;

/** Normalises text so formatting differences (markdown, curly quotes, bullets) don't count. */
export function normalise(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/^\s*-{3,}\s*$/gm, '')
    .replace(/[—–]/g, '-');
}

const TOKEN_RE = /[\p{L}\p{N}]+(?:['._\-/:@][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;

export function tokenize(text: string): Token[] {
  return normalise(text).match(TOKEN_RE) ?? [];
}

export const isWord = (t: Token) => /[\p{L}\p{N}]/u.test(t);

export interface Edit {
  /** Token range in the source that is replaced. */
  i1: number;
  i2: number;
  /** Tokens it is replaced with. */
  ins: Token[];
  del: Token[];
}

/** Word-level diff (LCS) between two token lists, grouped into edits. */
export function diff(a: Token[], b: Token[]): Edit[] {
  const n = a.length;
  const m = b.length;
  // LCS lengths from the end, so we can walk forward greedily.
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  let cur: Edit | null = null;
  const flush = () => {
    if (cur) edits.push(cur);
    cur = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      cur ??= { i1: i, i2: i, ins: [], del: [] };
      cur.ins.push(b[j++]);
    } else {
      cur ??= { i1: i, i2: i, ins: [], del: [] };
      cur.del.push(a[i++]);
      cur.i2 = i;
    }
  }
  flush();
  return edits;
}

export const editKey = (e: Edit) => `${e.i1}:${e.i2}:${e.ins.join(' ')}`;

/** Token-level Levenshtein distance. */
export function distance(a: Token[], b: Token[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export type EditType =
  | 'missing word'
  | 'extra word'
  | 'capitalization'
  | 'spelling'
  | 'word form / choice'
  | 'punctuation'
  | 'rewrite';

/** Classifies a reference edit. `misspelled` = input words Harper flags as misspellings. */
export function classify(e: Edit, misspelled: Set<string>): EditType {
  const insWords = e.ins.filter(isWord);
  const delWords = e.del.filter(isWord);
  if (!insWords.length && !delWords.length) return 'punctuation';
  if (e.del.length === 0 && insWords.length <= 3) return 'missing word';
  if (e.ins.length === 0 && delWords.length <= 3) return 'extra word';
  if (insWords.length === 1 && delWords.length === 1) {
    const [x] = delWords;
    const [y] = insWords;
    if (x.toLowerCase() === y.toLowerCase()) return 'capitalization';
    return misspelled.has(x) ? 'spelling' : 'word form / choice';
  }
  return 'rewrite';
}

export interface Score {
  tp: number;
  sys: number;
  ref: number;
  precision: number;
  recall: number;
  f05: number;
}

export function score(tp: number, sys: number, ref: number): Score {
  const precision = sys ? tp / sys : 1;
  const recall = ref ? tp / ref : 1;
  const b2 = 0.25;
  const f05 = precision + recall ? ((1 + b2) * precision * recall) / (b2 * precision + recall) : 0;
  return { tp, sys, ref, precision, recall, f05 };
}
