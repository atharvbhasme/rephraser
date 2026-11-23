# Rephraser

An offline English **spelling & grammar corrector** with an optional **rephraser**. Everything runs inside your browser: there is no server-side processing, no account, and your text never leaves your device. It is light enough for an old laptop (Intel i3 7th gen, 8 GB RAM).

**→ Setup instructions: [SETUP.md](SETUP.md)**

## Features

**✓ Spelling & Grammar** (no AI model)
- Underlines spelling mistakes (red) and grammar mistakes (blue) as you type.
- Shows the corrected text in an output box, with every change highlighted. You can edit it directly before copying.
- Click a suggestion to choose a different fix, or keep the original.
- Ignore an issue, or add a word to your **personal dictionary** so names and technical terms are never flagged again.
- **📖 Dictionary** manager: add many words at once, remove words, import/export a `.txt` list, and turn on built-in word packs (524 Indian names & places, 139 tech terms).
- US, UK, Canadian, Australian and Indian English.
- Optional style suggestions (redundancy, wordiness and similar).

**↻ Rephrase** (optional small local model)
- Checks your device before loading anything, and tells you if it can't run here.
- Shows an estimated time before you start, based on your device's measured speed.
- Shows live progress: loading the model, preparing it, warming up, then "sentence 2 of 5 · ~4 s left".
- Click any sentence to see more alternatives, or edit the result directly. You can cancel at any time.

## How it works

| | Spelling & Grammar | Rephrase |
|---|---|---|
| Engine | [Harper](https://github.com/Automattic/harper) (rule-based, Rust → WebAssembly) | T5-base paraphraser ([humarin/chatgpt_paraphraser_on_T5_base](https://huggingface.co/humarin/chatgpt_paraphraser_on_T5_base), 8-bit ONNX) via [Transformers.js](https://github.com/huggingface/transformers.js) |
| Size | ~20 MB (≈ 8.5 MB compressed) | ~240 MB, downloaded once with `npm run setup:rephrase` |
| Speed | ~100 ms for 1,000 words | under 1 s per sentence on an i5-8250U (measured); est. 2–3 s on an i3 7th gen |
| Runs in | a Web Worker, so typing never lags | a Web Worker, on the CPU (multi-threaded WebAssembly) |

**Offline by design:**
- The production build sends a strict Content-Security-Policy, so the browser blocks any request to another site.
- The model and the ONNX Runtime files are served from the app itself (`public/models`, `public/ort`). Remote model downloads are switched off in code.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start the development server (http://localhost:5173) |
| `npm run build` / `npm run preview` | Build and serve the fast production version (http://localhost:4173) |
| `npm run check:system` | Check whether this computer can run Rephrase (downloads nothing) |
| `npm run setup:rephrase` | Check the system, then download and verify the rephrase model (~250 MB, one time) |
| `npm run remove:rephrase` | Delete the rephrase model |
| `npm test` | Run unit tests and a real Harper integration test |

## Project layout

```
src/
  components/          UI (CorrectTab, RephraseTab, InputEditor, IssuesStrip, ...)
  hooks/               useChecker (Harper worker), useRephraser (model worker)
  lib/                 pure logic: issues, applyFixes, sentences, estimate, deviceCheck
  workers/             check.worker.ts (Harper), rephrase.worker.ts (Transformers.js)
scripts/               check-system, setup/remove model, copy ONNX Runtime files
deploy/                nginx.conf + Dockerfile for hosting
tests/                 Vitest tests
rephrase-model.json    which model is used (repo, pinned revision, files)
```

## Licenses

- Harper: Apache-2.0.
- Transformers.js and ONNX Runtime: Apache-2.0 / MIT.
- The paraphrase model is under the OpenRAIL license. See its model card before commercial use.
