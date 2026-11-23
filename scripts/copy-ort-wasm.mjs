// Copies the ONNX Runtime WebAssembly files into public/ort/ so the rephraser
// never fetches them from a CDN. Runs automatically after `npm install`.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'ort');

// Prefer the copy nested under @huggingface/transformers (exact version match), else the hoisted one.
const candidates = [
  join(root, 'node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-web', 'dist'),
  join(root, 'node_modules', 'onnxruntime-web', 'dist'),
];
const distDir = candidates.find((d) => existsSync(d));
if (!distDir) {
  console.log('[copy-ort-wasm] onnxruntime-web not installed yet, skipping.');
  process.exit(0);
}

// Only the plain CPU build (SIMD + threads, ~14 MB) is needed: the rephraser runs on the
// CPU via WebAssembly. The larger WebGPU/JSEP variants are skipped to keep things light.
const wanted = (name) => /^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(name);
const files = readdirSync(distDir).filter(wanted);
if (files.length === 0) {
  console.warn('[copy-ort-wasm] No ort-wasm files found in', distDir);
  process.exit(0);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const f of files) cpSync(join(distDir, f), join(outDir, f));
console.log(`[copy-ort-wasm] Copied ${files.length} file(s) to public/ort/: ${files.join(', ')}`);
