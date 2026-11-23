import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Cross-origin isolation lets ONNX Runtime use multi-threaded WebAssembly,
 * which makes the rephraser noticeably faster. Everything is same-origin,
 * so these headers never block anything the app needs.
 */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * Strict Content-Security-Policy for production builds: the browser itself
 * refuses any request that is not to the app's own origin, so the app
 * provably works without the internet. (Not applied in dev because Vite's
 * dev server needs inline scripts and a websocket for hot reload.)
 */
// `blob:` only ever refers to data created inside this page (the rephraser loads
// the ONNX Runtime glue code as a blob), never to anything on the network.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function injectCsp(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

/**
 * ONNX Runtime contains a fallback `new URL("ort-wasm-…asyncify.wasm", import.meta.url)`
 * that makes Vite copy a 27 MB WebGPU build into dist/ even though it is never used: the
 * rephraser always points ONNX Runtime at the smaller CPU build in /ort/. Strip it.
 */
function dropUnusedOrtWasm(): Plugin {
  const pattern = /new URL\("(ort-wasm-simd-threaded[a-z.]*\.wasm)",\s*import\.meta\.url\)\.href/g;
  return {
    name: 'drop-unused-ort-wasm',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('onnxruntime-web') || !pattern.test(code)) return null;
      pattern.lastIndex = 0;
      return { code: code.replace(pattern, '"/ort/$1"'), map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), injectCsp(), dropUnusedOrtWasm()],
  // These packages load .wasm files via `new URL(..., import.meta.url)`;
  // pre-bundling would break those URLs.
  optimizeDeps: {
    exclude: ['harper.js', '@huggingface/transformers'],
  },
  worker: {
    format: 'es',
    // Workers are bundled separately, so they need the plugin too.
    plugins: () => [dropUnusedOrtWasm()],
  },
  server: { headers: isolationHeaders },
  // As a header the CSP also covers the Web Workers (a <meta> tag only covers the page).
  preview: { headers: { ...isolationHeaders, 'Content-Security-Policy': CSP } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
