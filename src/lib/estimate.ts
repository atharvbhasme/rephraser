/**
 * Time estimates for rephrasing. The model writes one token (~0.75 word) at a time,
 * so time ≈ tokens × (ms per token). ms/token comes from, in order of preference:
 *   1. "measured": real speed from previous runs on this device (saved in localStorage)
 *   2. "benchmark": a ~0.1 s CPU micro-benchmark, scaled by a calibration constant
 */
import { load, save } from './storage';

export type EstimateSource = 'measured' | 'benchmark';

/** T5 sentencepiece produces roughly 1.4 tokens per English word (plus punctuation). */
export function estimateTokens(text: string): number {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const punct = (text.match(/[.,;:!?'"()-]/g) ?? []).length;
  return Math.ceil(words * 1.3 + punct * 0.5) + 1;
}

/** Output length is about the same as the input for a paraphrase. */
export function expectedOutputTokens(inputTokens: number): number {
  return Math.ceil(inputTokens * 1.1) + 2;
}

/** Seconds to rephrase one sentence: decoder steps plus the encoder pass (~25% overhead). */
export function sentenceSeconds(text: string, msPerToken: number): number {
  return (expectedOutputTokens(estimateTokens(text)) * msPerToken * 1.25) / 1000;
}

export function totalSeconds(sentences: string[], msPerToken: number): number {
  return sentences.reduce((s, t) => s + sentenceSeconds(t, msPerToken), 0);
}

/* ----------------------- device speed (ms/token) ----------------------- */

/**
 * Calibration: on an Intel i5-8250U (4 cores / 8 threads, multi-threaded WASM) the
 * benchmark below takes ~CAL_BENCH_MS and the model runs at ~CAL_MS_PER_TOKEN.
 */
const CAL_BENCH_MS = 11;
const CAL_MS_PER_TOKEN = 31;
const CAL_THREADS = 4;

/** Same float32 matrix-multiply micro-benchmark as scripts/check-system.mjs. */
export function cpuBenchmarkMs(): number {
  const n = 160;
  const a = new Float32Array(n * n).map((_, i) => (i % 7) * 0.1);
  const b = new Float32Array(n * n).map((_, i) => (i % 5) * 0.2);
  const out = new Float32Array(n * n);
  const run = () => {
    for (let i = 0; i < n; i++)
      for (let k = 0; k < n; k++) {
        const aik = a[i * n + k];
        for (let j = 0; j < n; j++) out[i * n + j] += aik * b[k * n + j];
      }
  };
  run();
  const reps = 4;
  const t0 = performance.now();
  for (let r = 0; r < reps; r++) run();
  return (performance.now() - t0) / reps;
}

/** Time after the files are read: build the model for this CPU, then a short warm-up. */
export function prepareSeconds(msPerToken: number): number {
  const prepare = 1.5 * (msPerToken / CAL_MS_PER_TOKEN);
  const warmup = (16 * msPerToken * 1.25) / 1000;
  return prepare + warmup;
}

/**
 * Rough first-load time. Reading ~250 MB from a local server runs at roughly 30–40 MB/s
 * in a browser; from a hosted site the first visit is a real download (assume ~8 MB/s).
 */
export function estimateLoadSeconds(totalBytes: number, msPerToken: number, local = true): number {
  const read = totalBytes / ((local ? 35 : 8) * 1024 ** 2);
  return read + prepareSeconds(msPerToken);
}

export function msPerTokenFromBenchmark(benchMs: number, threads: number, isolated: boolean): number {
  const usable = isolated ? Math.max(1, Math.min(CAL_THREADS, Math.floor(threads / 2) || 1)) : 1;
  const speedup = (t: number) => 1 + (t - 1) * 0.6;
  return CAL_MS_PER_TOKEN * (benchMs / CAL_BENCH_MS) * (speedup(CAL_THREADS) / speedup(usable));
}

interface SpeedRecord {
  msPerToken: number;
  loadMs?: number;
}

export function loadMeasuredSpeed(): SpeedRecord | null {
  const r = load<SpeedRecord | null>('rephraseSpeed', null);
  return r && Number.isFinite(r.msPerToken) && r.msPerToken > 0 ? r : null;
}

/** Blends a new measurement into the saved one so estimates improve over time. */
export function saveMeasuredSpeed(msPerToken: number, loadMs?: number): void {
  const prev = loadMeasuredSpeed();
  const blended = prev ? prev.msPerToken * 0.4 + msPerToken * 0.6 : msPerToken;
  save('rephraseSpeed', { msPerToken: blended, loadMs: loadMs ?? prev?.loadMs });
}

/* ------------------------------ formatting ------------------------------ */

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '…';
  if (seconds < 1) return '<1 s';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}
