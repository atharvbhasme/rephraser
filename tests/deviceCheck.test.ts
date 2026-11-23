import { describe, expect, it } from 'vitest';
import { evaluate, type BrowserCaps } from '../src/lib/deviceCheck';

const good: BrowserCaps = { wasm: true, simd: true, workers: true, threads: 8, memoryGB: 8, isolated: true };
const manifest = { id: 'm', files: [], totalBytes: 241 * 1024 ** 2 };

describe('device check verdict', () => {
  it('passes on a capable device with the model installed', () => {
    const r = evaluate(good, manifest);
    expect(r.verdict).toBe('pass');
    expect(r.items[0].label).toContain('241 MB');
  });

  it('fails when the model is not installed', () => {
    const r = evaluate(good, null);
    expect(r.verdict).toBe('fail');
    expect(r.title).toMatch(/not set up/);
  });

  it('warns on an old dual-core laptop without isolation', () => {
    const r = evaluate({ ...good, threads: 4, memoryGB: 4, isolated: false }, manifest);
    expect(r.verdict).toBe('warn');
    expect(r.detail).toMatch(/multi-threading/);
  });

  it('fails without WebAssembly SIMD or with too little memory', () => {
    expect(evaluate({ ...good, simd: false }, manifest).verdict).toBe('fail');
    expect(evaluate({ ...good, memoryGB: 1 }, manifest).verdict).toBe('fail');
  });

  it('ignores unknown memory (Firefox/Safari do not report it)', () => {
    expect(evaluate({ ...good, memoryGB: undefined }, manifest).verdict).toBe('pass');
  });
});
