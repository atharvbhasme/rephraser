import type { Issue } from './issues';

/** Which suggestion to use for each issue id. -1 means "leave as is". Missing = first suggestion. */
export type Choices = Record<string, number>;

export interface Segment {
  text: string;
  /** True when this piece of output differs from the input. */
  changed: boolean;
  /** For changed segments: the original text and the issue that produced it. */
  original?: string;
  issueId?: string;
}

export interface FixResult {
  corrected: string;
  segments: Segment[];
  applied: number;
}

interface Edit {
  start: number;
  end: number;
  insert: string;
  original: string;
  issueId: string;
}

function toEdit(text: string, issue: Issue, choice: number): Edit | null {
  const s = issue.suggestions[choice];
  if (!s) return null;
  let { start, end } = issue;
  switch (s.kind) {
    case 'replace':
      return { start, end, insert: s.text, original: text.slice(start, end), issueId: issue.id };
    case 'insertAfter':
      return { start: end, end, insert: s.text, original: '', issueId: issue.id };
    case 'remove':
      // Avoid leaving a double space behind ("a  b") when a whole word is removed.
      if (text[start - 1] === ' ' && text[end] === ' ') end += 1;
      else if (start === 0 && text[end] === ' ') end += 1;
      return { start, end, insert: '', original: text.slice(start, end), issueId: issue.id };
  }
}

/**
 * Applies the chosen suggestion for every issue and returns the corrected text,
 * plus segments that mark what changed (for green highlighting).
 * Edits are applied left to right; an edit overlapping an earlier one is skipped.
 */
export function applyFixes(text: string, issues: Issue[], choices: Choices = {}): FixResult {
  const edits: Edit[] = [];
  for (const issue of issues) {
    const choice = choices[issue.id] ?? 0;
    if (choice < 0) continue;
    const edit = toEdit(text, issue, choice);
    if (edit) edits.push(edit);
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end);

  const segments: Segment[] = [];
  let cursor = 0;
  let applied = 0;
  for (const e of edits) {
    if (e.start < cursor) continue; // overlaps a previous edit
    if (e.start > cursor) segments.push({ text: text.slice(cursor, e.start), changed: false });
    segments.push({ text: e.insert, changed: true, original: e.original, issueId: e.issueId });
    cursor = e.end;
    applied++;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), changed: false });

  return { corrected: segments.map((s) => s.text).join(''), segments, applied };
}
