# Rephraser

An offline English **spelling & grammar corrector** with an optional **rephraser**. Everything runs inside your browser: there is no server-side processing, no account, and your text never leaves your device. It is light enough for an old laptop (Intel i3 7th gen, 8 GB RAM).

**→ Setup instructions: [SETUP.md](SETUP.md)**

## Features

**✓ Spelling & Grammar** (no AI model)
- Underlines spelling mistakes (red) and grammar mistakes (blue) as you type.
- Extra rules for the mistakes that are most common in quick work messages: missing *the/a/an* ("in the runbook", "book an appointment"), "I have send" → "sent", "is require" → "is required", "Last sprint we have added" → "we added", "it work" → "it works", greetings ("hi, rahul I…" → "Hi Rahul, I…"), a full stop or question mark at the end, ", We have…" → ". We have…", "Please Update" → "Please update".
- Never "corrects" code, links, file names or abbreviations (`lastRunAt`, `error.message`, KDP, URLs). Unsure fixes (unknown names, US/UK spellings) are shown as suggestions but not applied automatically.
- Shows the corrected text in an output box, with every change highlighted. You can edit it directly before copying.
- Click a suggestion to choose a different fix, or keep the original.
- Ignore an issue, or add a word to your **personal dictionary** so names and technical terms are never flagged again.
- **📖 Dictionary** manager: add many words at once, remove words, import/export a `.txt` list, and turn on built-in word packs (524 Indian names & places, 139 tech terms).
- US, UK, Canadian, Australian and Indian English. The first time, it picks the one that matches your browser's language (en-IN → Indian).
- Optional style suggestions (redundancy, wordiness and similar).

**↻ Rephrase** (optional small local model)
- Checks your device before loading anything, and tells you if it can't run here.
- Shows an estimated time before you start, based on your device's measured speed.
- Shows live progress: loading the model, preparing it, warming up, then "sentence 2 of 5 · ~4 s left".
- Click any sentence to see more alternatives, or edit the result directly. You can cancel at any time.

## How it works

| | Spelling & Grammar | Rephrase |
|---|---|---|
| Engine | [Harper](https://github.com/Automattic/harper) (rule-based, Rust → WebAssembly) + Rephraser's own rules (`src/lib/rules/`) | T5-base paraphraser ([humarin/chatgpt_paraphraser_on_T5_base](https://huggingface.co/humarin/chatgpt_paraphraser_on_T5_base), 8-bit ONNX) via [Transformers.js](https://github.com/huggingface/transformers.js) |
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
| `npm run eval` | Accuracy benchmark on your own past corrections in `test-data/` (writes `test-data/eval-report.md`) |

## Project layout

```
src/
  components/          UI (CorrectTab, RephraseTab, InputEditor, IssuesStrip, ...)
  hooks/               useChecker (Harper worker), useRephraser (model worker)
  lib/                 pure logic: issues, applyFixes, sentences, estimate, deviceCheck
  workers/             check.worker.ts (Harper), rephrase.worker.ts (Transformers.js)
  lib/rules/            Rephraser's own grammar rules + the precision filter for Harper
scripts/               check-system, setup-model / remove-model, copy ONNX Runtime files
deploy/                nginx.conf + Dockerfile for hosting
tests/                 Vitest tests (npm test)
eval/                  accuracy benchmark (npm run eval) and a dev page for testing models
models.json            optional models (repo, pinned revision, files)
```

## Accuracy

Measured with `npm run eval` on 106 real messages that had been corrected by an AI assistant. A fix counts as precise if it matches the AI's edit exactly; "closer" is how much nearer the whole text gets to the AI's version.

| | Precision | Recall | Closer to the AI version |
|---|---|---|---|
| Harper alone (before) | 11.7% | 3.4% | −4.8% (made text *worse*) |
| Harper + Rephraser rules (now) | 39.9% | 10.2% | +8.9% |

What it fixes reliably now: spelling (about half of all misspellings, with very few wrong "corrections"), capital letters, greetings, end-of-sentence punctuation, and the specific grammar patterns listed above. What it still misses: most missing *the/a/an* outside the common patterns, singular/plural agreement in general, and anything that needs the sentence rewritten. An AI assistant rewrites sentences; a lightweight offline tool can't.

Two small offline grammar models (32 MB and 95 MB T5 models) were also tested with the benchmark page in `eval/browser/`. Both made results worse (they invent words and loop on long sentences), so they are not included.

## Licenses

- Harper: Apache-2.0.
- Transformers.js and ONNX Runtime: Apache-2.0 / MIT.
- The paraphrase model is under the OpenRAIL license. See its model card before commercial use.
