import { describe, expect, it } from 'vitest';
import { categorize, codePointToUtf16, countByCategory, resolveSpan, toIssues } from '../src/lib/issues';

describe('categorize', () => {
  it('groups Harper kinds into spelling / grammar / style', () => {
    expect(categorize('Spelling')).toBe('spelling');
    expect(categorize('Typo')).toBe('spelling');
    expect(categorize('Agreement')).toBe('grammar');
    expect(categorize('Miscellaneous')).toBe('grammar');
    expect(categorize('SomethingNew')).toBe('grammar');
    expect(categorize('Redundancy')).toBe('style');
  });
});

describe('offsets', () => {
  it('converts code points to UTF-16 units', () => {
    const t = '😀😀 recieve';
    expect(codePointToUtf16(t, 3)).toBe(5);
    expect(t.slice(codePointToUtf16(t, 3), codePointToUtf16(t, 10))).toBe('recieve');
  });

  it('accepts UTF-16 spans and repairs code-point spans', () => {
    const t = '👨‍👩‍👧 recieve';
    const base = { kind: 'Spelling', message: '', problem: 'recieve', suggestions: [] };
    expect(resolveSpan(t, { ...base, start: 9, end: 16 })).toEqual({ start: 9, end: 16 });
    expect(resolveSpan(t, { ...base, start: 6, end: 13 })).toEqual({ start: 9, end: 16 });
  });
});

describe('toIssues', () => {
  it('dedupes suggestions, sorts by position and counts categories', () => {
    const text = 'Their going tomorow.';
    const issues = toIssues(text, [
      { start: 12, end: 19, kind: 'Spelling', message: 'm', problem: 'tomorow', suggestions: [{ kind: 'replace', text: 'tomorrow' }] },
      { start: 0, end: 5, kind: 'Grammar', message: 'm', problem: 'Their', suggestions: [{ kind: 'replace', text: "They're" }, { kind: 'replace', text: "They're " }] },
    ]);
    expect(issues.map((i) => i.problem)).toEqual(['Their', 'tomorow']);
    expect(issues[0].suggestions).toHaveLength(1);
    expect(countByCategory(issues)).toEqual({ spelling: 1, grammar: 1, style: 0 });
  });
});
