import { describe, expect, it } from 'vitest';
import { applyFixes } from '../src/lib/applyFixes';
import type { Issue } from '../src/lib/issues';

const issue = (start: number, end: number, problem: string, suggestions: Issue['suggestions'], id = `${start}`): Issue => ({
  id, index: 0, start, end, kind: 'Spelling', category: 'spelling', message: '', problem, suggestions,
});

describe('applyFixes', () => {
  const text = 'i has went too the libary.';
  const issues = [
    issue(0, 1, 'i', [{ kind: 'replace', text: 'I' }]),
    issue(2, 5, 'has', [{ kind: 'replace', text: 'have' }]),
    issue(6, 10, 'went', [{ kind: 'replace', text: 'gone' }]),
    issue(11, 14, 'too', [{ kind: 'replace', text: 'to' }]),
    issue(19, 25, 'libary', [{ kind: 'replace', text: 'library' }, { kind: 'replace', text: 'liberty' }]),
  ];

  it('applies the first suggestion for every issue', () => {
    const r = applyFixes(text, issues);
    expect(r.corrected).toBe('I have gone to the library.');
    expect(r.applied).toBe(5);
  });

  it('honours chosen suggestions and skipped issues', () => {
    const r = applyFixes(text, issues, { '19': 1, '0': -1 });
    expect(r.corrected).toBe('i have gone to the liberty.');
  });

  it('marks changed segments with the original text', () => {
    const r = applyFixes(text, issues);
    const changed = r.segments.filter((s) => s.changed);
    expect(changed.map((s) => [s.original, s.text])).toContainEqual(['libary', 'library']);
    expect(r.segments.map((s) => s.text).join('')).toBe(r.corrected);
  });

  it('skips overlapping edits', () => {
    const r = applyFixes('to to the park', [
      issue(0, 5, 'to to', [{ kind: 'replace', text: 'to' }], 'a'),
      issue(3, 5, 'to', [{ kind: 'replace', text: 'too' }], 'b'),
    ]);
    expect(r.corrected).toBe('to the park');
  });

  it('removes a word without leaving a double space', () => {
    const r = applyFixes('I really really like it', [issue(9, 15, 'really', [{ kind: 'remove', text: '' }])]);
    expect(r.corrected).toBe('I really like it');
  });

  it('inserts text after the problem', () => {
    const r = applyFixes('Hello world', [issue(0, 5, 'Hello', [{ kind: 'insertAfter', text: ',' }])]);
    expect(r.corrected).toBe('Hello, world');
  });

  it('keeps emoji and accents intact', () => {
    const t = '😀 café recieve';
    const r = applyFixes(t, [issue(8, 15, 'recieve', [{ kind: 'replace', text: 'receive' }])]);
    expect(r.corrected).toBe('😀 café receive');
  });
});
