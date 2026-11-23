import { describe, expect, it } from 'vitest';
import { joinSentences, joinWithRanges, splitSentences } from '../src/lib/sentences';

describe('splitSentences', () => {
  it('splits and rebuilds text exactly', () => {
    const text = 'First one. Second one?  Third!\n\nFourth line';
    const s = splitSentences(text);
    expect(s.map((x) => x.text)).toEqual(['First one.', 'Second one?', 'Third!', 'Fourth line']);
    expect(joinSentences(s)).toBe(text);
    expect(text.slice(s[1].start, s[1].end)).toBe('Second one?');
  });

  it('replaces individual sentences', () => {
    const s = splitSentences('A cat sat. A dog ran.');
    expect(joinSentences(s, { 1: 'The dog ran.' })).toBe('A cat sat. The dog ran.');
  });
});

describe('joinWithRanges', () => {
  it('reports where each (replaced) sentence sits in the result', () => {
    const s = splitSentences('A cat sat. A dog ran.');
    const { text, ranges } = joinWithRanges(s, { 0: 'The cat was sitting.' });
    expect(text).toBe('The cat was sitting. A dog ran.');
    expect(ranges.map((r) => text.slice(r.start, r.end))).toEqual(['The cat was sitting.', 'A dog ran.']);
  });
});
