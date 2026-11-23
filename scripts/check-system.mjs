#!/usr/bin/env node
/**
 * Checks whether this computer can run the optional Rephrase feature BEFORE anything
 * is downloaded. Uses only Node built-ins.
 *
 *   npm run check:system
 *
 * Spelling & grammar always works (it needs no model). This check is only about Rephrase.
 *
 * Testing overrides (pretend to be a weaker machine):
 *   REPHRASER_FAKE_RAM_GB=3  REPHRASER_FAKE_FREE_RAM_GB=0.8  REPHRASER_FAKE_DISK_MB=200
 *   REPHRASER_FAKE_THREADS=1  REPHRASER_OFFLINE=1
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statfsSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MODEL = JSON.parse(readFileSync(join(ROOT, 'rephrase-model.json'), 'utf8'));

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const env = process.env;
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));

/* --------------------------- ANSI helpers --------------------------- */
const tty = process.stdout.isTTY && !env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = { green: paint(32), yellow: paint(33), red: paint(31), dim: paint(2), bold: paint(1), cyan: paint(36) };
export const ICON = { pass: c.green('✔'), warn: c.yellow('⚠'), fail: c.red('✖'), info: c.cyan('ℹ') };

/* ---------------------------- Probes -------------------------------- */
function totalRamBytes() {
  const fake = num(env.REPHRASER_FAKE_RAM_GB);
  return fake !== undefined ? fake * GB : os.totalmem();
}

function availableRamBytes() {
  const fake = num(env.REPHRASER_FAKE_FREE_RAM_GB);
  if (fake !== undefined) return fake * GB;
  if (process.platform === 'linux') {
    try {
      const m = /MemAvailable:\s+(\d+)\s+kB/.exec(readFileSync('/proc/meminfo', 'utf8'));
      if (m) return Number(m[1]) * 1024;
    } catch {
      /* fall through */
    }
  }
  return os.freemem();
}

function freeDiskBytes() {
  const fake = num(env.REPHRASER_FAKE_DISK_MB);
  if (fake !== undefined) return fake * MB;
  try {
    const s = statfsSync(ROOT);
    return s.bavail * s.bsize;
  } catch {
    return undefined;
  }
}

function cpuThreads() {
  const fake = num(env.REPHRASER_FAKE_THREADS);
  if (fake !== undefined) return fake;
  return typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
}

/** Returns 'yes' | 'no' | 'neon' | 'unknown'. */
function simdSupport() {
  if (os.arch() === 'arm64') return 'neon';
  try {
    if (process.platform === 'linux') {
      return /\bavx2\b/.test(readFileSync('/proc/cpuinfo', 'utf8')) ? 'yes' : 'no';
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('sysctl', ['-n', 'machdep.cpu.leaf7_features'], { encoding: 'utf8' });
      return /AVX2/i.test(out) ? 'yes' : 'no';
    }
  } catch {
    /* unknown */
  }
  return 'unknown';
}

/**
 * Quick single-thread benchmark (~0.3 s): float32 matrix multiplies, the same kind of
 * work the model does. Returns milliseconds for a fixed amount of work.
 */
export function cpuBenchmarkMs() {
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
  run(); // warm-up / JIT
  const reps = 6;
  const t0 = performance.now();
  for (let r = 0; r < reps; r++) run();
  return (performance.now() - t0) / reps;
}

/**
 * Converts the benchmark score into "seconds per sentence" for the rephrase model.
 * Calibrated on an Intel i5-8250U (4 cores / 8 threads): benchmark ≈ CAL_BENCH_MS
 * and a typical 15–20 word sentence took ≈ CAL_SEC_PER_SENTENCE in the browser.
 */
const CAL_BENCH_MS = 15;
const CAL_SEC_PER_SENTENCE = 0.9;
const CAL_THREADS = 4; // ONNX Runtime uses up to 4 threads

export function estimateSecondsPerSentence(benchMs, threads) {
  const usable = Math.max(1, Math.min(CAL_THREADS, Math.floor(threads / 2) || 1));
  // Threads help, but not linearly (roughly 60% efficiency per extra thread).
  const speedup = (t) => 1 + (t - 1) * 0.6;
  return CAL_SEC_PER_SENTENCE * (benchMs / CAL_BENCH_MS) * (speedup(CAL_THREADS) / speedup(usable));
}

async function canReachHub(timeoutMs = 6000) {
  if (env.REPHRASER_OFFLINE === '1') return false;
  try {
    const res = await fetch(`https://huggingface.co/api/models/${MODEL.repo}/revision/${MODEL.revision}`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* --------------------------- The check ------------------------------ */
const fmtGB = (b) => `${(b / GB).toFixed(1)} GB`;
const fmtMB = (b) => (b >= GB ? fmtGB(b) : `${Math.round(b / MB)} MB`);

/**
 * @returns {Promise<{ verdict: 'pass'|'warn'|'fail', rows: {name:string,status:string,value:string,note?:string}[],
 *   secPerSentence: number, online: boolean, reasons: string[] }>}
 */
export async function runSystemCheck({ network = true } = {}) {
  const rows = [];
  const add = (name, status, value, note) => rows.push({ name, status, value, note });

  // OS / architecture
  const arch = os.arch();
  const archOk = arch === 'x64' || arch === 'arm64';
  add('OS / CPU architecture', archOk ? 'pass' : 'fail', `${os.type()} ${arch}`, archOk ? undefined : '64-bit required');

  // Node version (only needed for the setup scripts)
  const major = Number(process.versions.node.split('.')[0]);
  add('Node.js (for setup only)', major >= 20 ? 'pass' : major >= 18 ? 'warn' : 'fail', `v${process.versions.node}`,
    major >= 20 ? undefined : major >= 18 ? 'works, but Node 20+ is recommended' : 'Node 18+ needed to run setup');

  // RAM
  const total = totalRamBytes();
  add('Total RAM', total >= 6 * GB ? 'pass' : total >= 4 * GB ? 'warn' : 'fail', fmtGB(total),
    total >= 6 * GB ? undefined : total >= 4 * GB ? 'close other apps while rephrasing' : 'at least 4 GB needed');

  const avail = availableRamBytes();
  add('Available RAM now', avail >= 2 * GB ? 'pass' : avail >= 1 * GB ? 'warn' : 'fail', fmtGB(avail),
    avail >= 2 * GB ? undefined : avail >= 1 * GB ? 'close some browser tabs first' : 'about 1 GB free is needed');

  // Disk
  const disk = freeDiskBytes();
  if (disk === undefined) add('Free disk space', 'warn', 'unknown', 'could not read; about 300 MB is needed');
  else
    add('Free disk space', disk >= GB ? 'pass' : disk >= 400 * MB ? 'warn' : 'fail', fmtMB(disk),
      disk >= GB ? undefined : disk >= 400 * MB ? 'enough, but tight' : 'about 400 MB needed; the model is ~250 MB');

  // CPU
  const threads = cpuThreads();
  const model = (os.cpus()[0]?.model ?? 'unknown CPU').replace(/\s+/g, ' ').trim();
  add('CPU threads', threads >= 4 ? 'pass' : threads >= 2 ? 'warn' : 'fail', `${threads} (${model})`,
    threads >= 4 ? undefined : threads >= 2 ? 'will be slower' : 'a single thread is too slow');

  const simd = simdSupport();
  add('Vector instructions (AVX2 / NEON)', simd === 'yes' || simd === 'neon' ? 'pass' : 'warn',
    simd === 'neon' ? 'ARM NEON' : simd === 'yes' ? 'AVX2' : simd === 'no' ? 'no AVX2' : 'unknown',
    simd === 'yes' || simd === 'neon' ? undefined : 'works, but slower');

  // Speed
  const bench = cpuBenchmarkMs();
  const sps = estimateSecondsPerSentence(bench, threads);
  add('Estimated rephrase speed', sps <= 6 ? 'pass' : sps <= 15 ? 'warn' : 'fail',
    `~${sps < 10 ? sps.toFixed(1) : Math.round(sps)} s per sentence`,
    sps <= 6 ? undefined : sps <= 15 ? 'usable but slow' : 'very slow on this machine');

  // Network (only for the one-time download)
  let online = true;
  if (network) {
    online = await canReachHub();
    add('Can reach huggingface.co', online ? 'pass' : 'warn', online ? 'yes' : 'no',
      online ? 'only used once, to download the model' : 'needed once to download the model — retry when online');
  }

  const hardFails = rows.filter((r) => r.status === 'fail' && r.name !== 'Estimated rephrase speed');
  const verdict = hardFails.length ? 'fail' : rows.some((r) => r.status !== 'pass') ? 'warn' : 'pass';
  const reasons = hardFails.map((r) => `${r.name}: ${r.value}${r.note ? ` (${r.note})` : ''}`);
  return { verdict, rows, secPerSentence: sps, online, reasons };
}

export function printReport(result) {
  const { rows, verdict, secPerSentence, reasons } = result;
  const w = Math.max(...rows.map((r) => r.name.length));
  console.log(`\n${c.bold('Rephraser — system check for the optional Rephrase feature')}\n`);
  for (const r of rows) {
    console.log(`  ${ICON[r.status]}  ${r.name.padEnd(w)}  ${r.value}${r.note ? c.dim(`  — ${r.note}`) : ''}`);
  }
  console.log('');
  const per = `~${secPerSentence < 10 ? secPerSentence.toFixed(1) : Math.round(secPerSentence)} s per sentence`;
  if (verdict === 'pass') {
    console.log(`${c.green(c.bold('Rephrase: ✅ Supported'))} — est. ${per}.`);
  } else if (verdict === 'warn') {
    console.log(`${c.yellow(c.bold('Rephrase: ⚠️  Supported, may be slow'))} — est. ${per}. See the ⚠ notes above.`);
  } else {
    console.log(`${c.red(c.bold('Rephrase: ❌ Not supported on this computer'))}`);
    for (const r of reasons) console.log(`   • ${r}`);
    console.log(`\n${c.bold('Spelling & grammar will still work normally')} — it needs no model.`);
  }
  console.log(c.dim('\nNote: Rephrase runs inside the web browser. It needs Chrome/Edge 91+, Firefox 89+ or Safari 16.4+.'));
  console.log(c.dim('Your browser re-checks your device in the Rephrase tab before loading anything.\n'));
  if (verdict !== 'fail') {
    if (result.online) console.log(`Next step: ${c.cyan('npm run setup:rephrase')}  (one-time download, ~250 MB)\n`);
    else console.log(`Next step: connect to the internet once, then run ${c.cyan('npm run setup:rephrase')}\n`);
  }
}

// Run directly: `node scripts/check-system.mjs`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await runSystemCheck();
  printReport(result);
  process.exitCode = result.verdict === 'fail' ? 1 : 0;
}
