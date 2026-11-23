import { describe, expect, it } from 'vitest';
import {
  estimateLoadSeconds,
  estimateTokens,
  formatDuration,
  msPerTokenFromBenchmark,
  sentenceSeconds,
  totalSeconds,
} from '../src/lib/estimate';

describe('estimates', () => {
  it('estimates tokens from words', () => {
    expect(estimateTokens('')).toBe(1);
    expect(estimateTokens('The meeting was postponed because the manager was not feeling well.')).toBeGreaterThan(14);
  });

  it('scales time with sentence length and device speed', () => {
    const short = sentenceSeconds('Hello there.', 31);
    const long = sentenceSeconds('We need to finish this whole project before the end of the month, no matter what.', 31);
    expect(long).toBeGreaterThan(short);
    expect(sentenceSeconds('Hello there.', 62)).toBeCloseTo(short * 2);
    expect(totalSeconds(['Hello there.', 'Hello there.'], 31)).toBeCloseTo(short * 2);
  });

  it('predicts a slower old dual-core laptop', () => {
    const fast = msPerTokenFromBenchmark(11, 8, true);
    const old = msPerTokenFromBenchmark(16, 4, true);
    expect(fast).toBeCloseTo(31, 0);
    expect(old).toBeGreaterThan(fast * 2);
    expect(msPerTokenFromBenchmark(11, 8, false)).toBeGreaterThan(fast); // single-threaded
  });

  it('estimates the one-time load and formats durations', () => {
    expect(estimateLoadSeconds(241 * 1024 ** 2, 31)).toBeGreaterThan(2);
    expect(formatDuration(0.4)).toBe('<1 s');
    expect(formatDuration(42)).toBe('42 s');
    expect(formatDuration(125)).toBe('2 min 5 s');
  });
});
