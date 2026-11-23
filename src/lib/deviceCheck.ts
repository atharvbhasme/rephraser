import { fetchManifest, type ModelManifest } from './modelInfo';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type Verdict = 'pass' | 'warn' | 'fail';

export interface DeviceCheckItem {
  label: string;
  status: CheckStatus;
}

export interface DeviceCheckResult {
  verdict: Verdict;
  title: string;
  detail: string;
  items: DeviceCheckItem[];
  modelInstalled: boolean;
  manifest: ModelManifest | null;
  threads: number;
  isolated: boolean;
}

// Smallest WebAssembly module that uses a SIMD instruction (from wasm-feature-detect).
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

export interface BrowserCaps {
  wasm: boolean;
  simd: boolean;
  workers: boolean;
  threads: number;
  /** GB, Chromium only (rounded, capped at 8). */
  memoryGB: number | undefined;
  isolated: boolean;
}

export function readBrowserCaps(): BrowserCaps {
  const wasm = typeof WebAssembly === 'object' && typeof WebAssembly.validate === 'function';
  let simd = false;
  try {
    simd = wasm && WebAssembly.validate(SIMD_PROBE);
  } catch {
    simd = false;
  }
  return {
    wasm,
    simd,
    workers: typeof Worker === 'function',
    threads: navigator.hardwareConcurrency || 1,
    memoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    isolated: Boolean(globalThis.crossOriginIsolated),
  };
}

/** Pure verdict logic (unit-tested). */
export function evaluate(caps: BrowserCaps, manifest: ModelManifest | null): DeviceCheckResult {
  const items: DeviceCheckItem[] = [];
  const fails: string[] = [];
  const warns: string[] = [];

  const modelInstalled = Boolean(manifest);
  items.push({
    label: modelInstalled
      ? `Model installed (${Math.round((manifest!.totalBytes || 0) / 1024 ** 2)} MB)`
      : 'Model not installed',
    status: modelInstalled ? 'pass' : 'fail',
  });
  if (!modelInstalled) fails.push('the rephrase model is not installed');

  if (!caps.wasm || !caps.workers) {
    items.push({ label: 'WebAssembly & Web Workers not available', status: 'fail' });
    fails.push('this browser lacks WebAssembly or Web Workers');
  } else {
    items.push({ label: caps.simd ? 'WebAssembly SIMD' : 'No WebAssembly SIMD', status: caps.simd ? 'pass' : 'fail' });
    if (!caps.simd) fails.push('this browser is too old (no WebAssembly SIMD)');
  }

  const t = caps.threads;
  items.push({ label: `${t} CPU thread${t === 1 ? '' : 's'}`, status: t >= 4 ? 'pass' : t >= 2 ? 'warn' : 'fail' });
  if (t < 2) fails.push('only one CPU thread');
  else if (t < 4) warns.push('few CPU threads');

  if (caps.memoryGB !== undefined) {
    const m = caps.memoryGB;
    items.push({ label: `${m >= 8 ? '8+' : m} GB memory`, status: m >= 4 ? 'pass' : m >= 2 ? 'warn' : 'fail' });
    if (m < 2) fails.push('less than 2 GB of memory');
    else if (m < 4) warns.push('limited memory — close other tabs');
  }

  items.push({
    label: caps.isolated ? 'Multi-threading on' : 'Single-threaded mode',
    status: caps.isolated ? 'pass' : 'warn',
  });
  if (!caps.isolated) warns.push('multi-threading is off (server headers missing), so it is slower');

  const verdict: Verdict = fails.length ? 'fail' : warns.length ? 'warn' : 'pass';
  const title =
    verdict === 'pass'
      ? 'Ready to rephrase on this device'
      : verdict === 'warn'
        ? 'Rephrase works here, but may be slow'
        : modelInstalled
          ? 'Rephrase is not available on this device'
          : 'Rephrase is not set up yet';
  const detail =
    verdict === 'fail'
      ? `Because ${fails.join(' and ')}. Spelling & grammar still work normally.`
      : verdict === 'warn'
        ? `Note: ${warns.join('; ')}.`
        : 'Runs on this computer’s CPU. Nothing is sent anywhere.';

  return { verdict, title, detail, items, modelInstalled, manifest, threads: t, isolated: caps.isolated };
}

export async function runDeviceCheck(): Promise<DeviceCheckResult> {
  const [manifest] = await Promise.all([fetchManifest()]);
  return evaluate(readBrowserCaps(), manifest);
}
