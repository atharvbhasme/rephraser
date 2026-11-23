#!/usr/bin/env node
/**
 * One-time download of the small paraphrase model used by the Rephrase tab.
 * This is the ONLY step that uses the internet. After it finishes, the app runs offline.
 *
 *   npm run setup:rephrase            # checks your system first, then downloads (~250 MB)
 *   npm run setup:rephrase -- --yes   # don't ask for confirmation
 *   npm run setup:rephrase -- --force # download even if the system check fails
 *
 * Interrupted? Just run it again: finished files are kept and partial files resume.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { c, ICON, MODEL, printReport, ROOT, runSystemCheck } from './check-system.mjs';

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const YES = args.has('--yes') || args.has('-y') || !process.stdin.isTTY;
const MODEL_DIR = join(ROOT, 'public', 'models', MODEL.id);
const HUB = 'https://huggingface.co';
const MB = 1024 ** 2;

const fmtMB = (b) => (b < MB ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / MB).toFixed(b < 10 * MB ? 1 : 0)} MB`);
const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '…';
  if (s < 60) return `${Math.max(1, Math.round(s))}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
};

async function main() {
  // 1. System check first — never download onto a machine that can't use it.
  console.log(c.bold('\nStep 1/4 — Checking your system'));
  const check = await runSystemCheck();
  printReport(check);
  if (check.verdict === 'fail' && !FORCE) {
    console.log(c.red('Stopped: nothing was downloaded.'), 'Use --force to download anyway.\n');
    process.exit(1);
  }
  if (!check.online) {
    console.log(c.red('Stopped: cannot reach huggingface.co right now.'), 'Connect to the internet and run this again.\n');
    process.exit(1);
  }

  // 2. What will be downloaded.
  console.log(c.bold('Step 2/4 — Looking up model files'));
  const tree = await fetchJson(`${HUB}/api/models/${MODEL.repo}/tree/${MODEL.revision}?recursive=true`);
  const files = MODEL.files.map((path) => {
    const entry = tree.find((e) => e.path === path);
    if (!entry) throw new Error(`File ${path} not found in ${MODEL.repo}@${MODEL.revision}`);
    return {
      path,
      size: entry.lfs?.size ?? entry.size,
      sha256: entry.lfs?.oid ?? null, // large files: SHA-256 published by the hub
      gitSha1: entry.lfs ? null : entry.oid, // small files: git blob hash
    };
  });
  const total = files.reduce((s, f) => s + f.size, 0);
  const done = files.filter((f) => isComplete(f));
  const todo = files.filter((f) => !done.includes(f));
  const todoBytes = todo.reduce((s, f) => s + f.size, 0);
  const partBytes = todo.reduce((s, f) => s + partialSize(f), 0);
  const leftBytes = todoBytes - partBytes;

  console.log(`  Model:   ${MODEL.repo} ${c.dim(`(rev ${MODEL.revision.slice(0, 7)}, license ${MODEL.license})`)}`);
  console.log(`  Files:   ${files.length} files, ${fmtMB(total)} total`);
  if (done.length) console.log(`  Already downloaded: ${done.length} file(s) — skipping`);
  if (partBytes) console.log(`  Resuming: ${fmtMB(partBytes)} of an interrupted download is kept`);
  console.log(`  To download: ${fmtMB(leftBytes)} → ${c.dim(MODEL_DIR)}`);
  console.log(
    `  Estimated time: ~${fmtTime(leftBytes / (2 * MB))} at 2 MB/s, ~${fmtTime(leftBytes / (10 * MB))} at 10 MB/s`,
  );

  if (todo.length && !YES) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`\nDownload ${fmtMB(leftBytes)} now? [Y/n] `)).trim().toLowerCase();
    rl.close();
    if (answer && answer !== 'y' && answer !== 'yes') {
      console.log('Cancelled. Nothing was downloaded.\n');
      process.exit(0);
    }
  }

  // 3. Download with progress, speed and time left. Resumes partial files.
  console.log(c.bold('\nStep 3/4 — Downloading'));
  const progress = new Progress(todoBytes);
  for (const f of todo) await download(f, progress);
  progress.finish();

  // 4. Verify every file.
  console.log(c.bold('\nStep 4/4 — Verifying files'));
  for (const f of files) {
    const ok = await verify(f);
    console.log(`  ${ok ? ICON.pass : ICON.fail}  ${f.path} ${c.dim(fmtMB(f.size))}`);
    if (!ok) {
      rmSync(join(MODEL_DIR, f.path), { force: true });
      throw new Error(`${f.path} is corrupted and was deleted. Run "npm run setup:rephrase" again.`);
    }
  }

  // Manifest tells the browser the model is installed (and the file sizes for progress bars).
  writeFileSync(
    join(MODEL_DIR, 'manifest.json'),
    JSON.stringify(
      {
        id: MODEL.id,
        repo: MODEL.repo,
        revision: MODEL.revision,
        prompt: MODEL.prompt,
        dtype: MODEL.dtype,
        files: files.map(({ path, size }) => ({ path, size })),
        totalBytes: total,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(`\n${c.green(c.bold('✅ Rephrase is ready.'))} The app no longer needs the internet.`);
  console.log(`   Refresh the browser (or run ${c.cyan('npm run dev')}) and open the ${c.bold('Rephrase')} tab.`);
  console.log(c.dim(`   To remove the model later: npm run remove:rephrase\n`));
}

/* ------------------------------ helpers ------------------------------ */

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

function partialSize(f) {
  const part = join(MODEL_DIR, `${f.path}.part`);
  if (!existsSync(part)) return 0;
  const size = statSync(part).size;
  return size <= f.size ? size : 0;
}

function isComplete(f) {
  const p = join(MODEL_DIR, f.path);
  return existsSync(p) && statSync(p).size === f.size;
}

async function download(f, progress) {
  const dest = join(MODEL_DIR, f.path);
  const part = `${dest}.part`;
  mkdirSync(dirname(dest), { recursive: true });
  let have = existsSync(part) ? statSync(part).size : 0;
  if (have > f.size) {
    rmSync(part);
    have = 0;
  }
  progress.label = f.path;
  progress.add(have);

  const url = `${HUB}/${MODEL.repo}/resolve/${MODEL.revision}/${f.path}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const headers = have > 0 ? { Range: `bytes=${have}-` } : {};
      const res = await fetch(url, { headers, redirect: 'follow' });
      if (res.status === 200 && have > 0) {
        // Server ignored the range: start over.
        progress.add(-have);
        have = 0;
      } else if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${res.status}`);
      }
      const out = createWriteStream(part, { flags: have > 0 ? 'a' : 'w' });
      const body = Readable.fromWeb(res.body);
      body.on('data', (chunk) => {
        have += chunk.length;
        progress.add(chunk.length);
      });
      await pipeline(body, out);
      break;
    } catch (err) {
      if (attempt >= 4) throw new Error(`Download of ${f.path} failed: ${err.message}. Run the command again to resume.`);
      progress.note(`network hiccup (${err.message}), retrying in ${attempt * 2}s…`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
      have = existsSync(part) ? statSync(part).size : 0;
    }
  }
  if (statSync(part).size !== f.size) throw new Error(`${f.path}: size mismatch, run again to retry.`);
  renameSync(part, dest);
}

async function hashFile(path, algo, prefix) {
  const h = createHash(algo);
  if (prefix) h.update(prefix);
  await pipeline(createReadStream(path), async function* (src) {
    for await (const chunk of src) h.update(chunk);
  });
  return h.digest('hex');
}

async function verify(f) {
  const p = join(MODEL_DIR, f.path);
  if (!existsSync(p) || statSync(p).size !== f.size) return false;
  if (f.sha256) return (await hashFile(p, 'sha256')) === f.sha256;
  if (f.gitSha1) return (await hashFile(p, 'sha1', `blob ${f.size}\0`)) === f.gitSha1;
  return true;
}

class Progress {
  constructor(total) {
    this.total = total;
    this.bytes = 0;
    this.start = Date.now();
    this.samples = [];
    this.label = 'starting…';
    this.lastDraw = 0;
    this.lastPct = -10;
  }
  add(n) {
    this.bytes += n;
    const now = Date.now();
    this.samples.push([now, this.bytes]);
    while (this.samples.length > 2 && now - this.samples[0][0] > 5000) this.samples.shift();
    if (now - this.lastDraw > 200) this.draw();
  }
  speed() {
    const [t0, b0] = this.samples[0] ?? [this.start, 0];
    const [t1, b1] = this.samples.at(-1) ?? [Date.now(), this.bytes];
    return t1 > t0 ? ((b1 - b0) / (t1 - t0)) * 1000 : 0;
  }
  draw() {
    this.lastDraw = Date.now();
    const pct = this.total ? Math.min(100, (this.bytes / this.total) * 100) : 100;
    const sp = this.speed();
    const eta = sp > 0 ? (this.total - this.bytes) / sp : Infinity;
    const line = `${pct.toFixed(0).padStart(3)}%  ${fmtMB(this.bytes)} / ${fmtMB(this.total)}  ·  ${fmtMB(sp)}/s  ·  ${fmtTime(eta)} left  ·  ${this.label}`;
    if (process.stdout.isTTY) {
      const width = 24;
      const filled = Math.round((pct / 100) * width);
      process.stdout.write(`\r  [${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${line}\x1b[K`);
    } else if (pct - this.lastPct >= 10) {
      this.lastPct = pct;
      console.log(`  ${line}`);
    }
  }
  note(msg) {
    if (process.stdout.isTTY) process.stdout.write('\n');
    console.log(`  ${ICON.warn} ${msg}`);
  }
  finish() {
    this.draw();
    if (process.stdout.isTTY) process.stdout.write('\n');
    const secs = (Date.now() - this.start) / 1000;
    if (this.total) console.log(`  Downloaded ${fmtMB(this.total)} in ${fmtTime(secs)}.`);
  }
}

main().catch((err) => {
  console.error(`\n${c.red('Setup failed:')} ${err.message}\n`);
  process.exit(1);
});
