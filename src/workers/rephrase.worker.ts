/// <reference lib="webworker" />
/**
 * Rephrase worker: runs a small T5 paraphrase model (ONNX, 8-bit) on the CPU via
 * WebAssembly. Loaded only when the Rephrase tab is used. Everything it loads comes
 * from this site (public/models and public/ort) — remote downloads are disabled.
 */
import {
  AutoModelForSeq2SeqLM,
  AutoTokenizer,
  BaseStreamer,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type ProgressInfo,
  type Tensor,
} from '@huggingface/transformers';
import { MODEL_DTYPE, MODEL_ID, MODEL_PROMPT, MODELS_BASE, ORT_BASE } from '../lib/modelInfo';
import type { RephraseRequest, RephraseResponse } from './rephraseProtocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: RephraseResponse) => scope.postMessage(msg);
const abs = (p: string) => new URL(p, self.location.href).href;

/* ------------------------- offline configuration ------------------------- */
env.allowRemoteModels = false; // never contact huggingface.co
env.allowLocalModels = true;
// Must be a path, not a full URL: transformers.js only treats non-URL paths as "local".
env.localModelPath = new URL(MODELS_BASE, self.location.href).pathname;
// On localhost the files are already on disk; caching them again in the browser would
// just duplicate ~250 MB. On a hosted site, the cache makes later visits instant.
const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);
env.useBrowserCache = !isLocalHost && typeof caches !== 'undefined';

const threads = self.crossOriginIsolated
  ? Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)))
  : 1;
const wasmEnv = env.backends.onnx.wasm!;
wasmEnv.wasmPaths = {
  mjs: abs(`${ORT_BASE}ort-wasm-simd-threaded.mjs`),
  wasm: abs(`${ORT_BASE}ort-wasm-simd-threaded.wasm`),
};
wasmEnv.numThreads = threads;

/* ------------------------------- state ---------------------------------- */
let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;
let loading: Promise<void> | null = null;
let msPerToken = 0;
let cancelledFlag = false;
/** Shared with the page when cross-origin isolated, so Cancel works mid-sentence even
 *  while this thread is busy computing (normal messages only arrive between jobs). */
let sharedCancel: Int32Array | null = null;
const isCancelled = () => cancelledFlag || (sharedCancel !== null && Atomics.load(sharedCancel, 0) === 1);
/** Gives the event loop a turn so a plain "cancel" message can be delivered. */
const yieldToEvents = () => new Promise<void>((r) => setTimeout(r, 0));

const EOS = 1; // T5 </s>
const PAD = 0; // T5 <pad> (also the decoder start token)

class Cancelled extends Error {}

/** Counts generated tokens (for live progress) and lets "Cancel" stop generation. */
class ProgressStreamer extends BaseStreamer {
  count = 0;
  private first = true;
  private lastPost = 0;
  firstTokenAt = 0;
  lastTokenAt = 0;
  private readonly onToken: (n: number) => void;
  constructor(onToken: (n: number) => void) {
    super();
    this.onToken = onToken;
  }
  put(_value: bigint[][]) {
    if (isCancelled()) throw new Cancelled('cancelled');
    if (this.first) {
      this.first = false; // the first call carries the decoder start token
      return;
    }
    this.count++;
    const now = performance.now();
    if (!this.firstTokenAt) this.firstTokenAt = now;
    this.lastTokenAt = now;
    if (now - this.lastPost > 150) {
      this.lastPost = now;
      this.onToken(this.count);
    }
  }
  end() {}
}

/* ------------------------------- loading -------------------------------- */
async function loadModel(): Promise<void> {
  const t0 = performance.now();
  const files: Record<string, { loaded: number; total: number }> = {};
  let onnxDone = 0;
  const progress_callback = (info: ProgressInfo) => {
    const i = info as ProgressInfo & { file?: string; loaded?: number; total?: number; status: string };
    if (i.status === 'progress' && i.file) {
      files[i.file] = { loaded: i.loaded ?? 0, total: i.total ?? 0 };
      const loaded = Object.values(files).reduce((s, f) => s + f.loaded, 0);
      const total = Object.values(files).reduce((s, f) => s + f.total, 0);
      post({ type: 'loading', stage: 'files', file: i.file, loaded, total });
    } else if (i.status === 'initiate' && i.file) {
      post({ type: 'loading', stage: 'files', file: i.file });
    } else if (i.status === 'done' && i.file?.endsWith('.onnx')) {
      // Both ONNX files fetched: ONNX Runtime now builds the model for this CPU.
      if (++onnxDone >= 2) post({ type: 'loading', stage: 'prepare' });
    }
  };

  tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback });
  model = await AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID, {
    dtype: MODEL_DTYPE,
    device: 'wasm',
    progress_callback,
  });

  // Warm-up: one short generation compiles kernels and measures this device's speed.
  post({ type: 'loading', stage: 'warmup' });
  const r = await generate('The weather is very nice today, so we are going for a walk.');
  msPerToken = r.msPerToken;
  post({ type: 'ready', loadMs: Math.round(performance.now() - t0), msPerToken, threads });
}

function ensureLoaded(): Promise<void> {
  if (!loading) {
    loading = loadModel().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

/* ------------------------------ generation ------------------------------ */
function tokenize(texts: string[]) {
  return tokenizer!(texts.map((t) => MODEL_PROMPT + t), {
    padding: true,
    truncation: true,
    max_length: 256,
  }) as { input_ids: Tensor; attention_mask: Tensor };
}

/** Decodes generated ids, cutting each row at its first end-of-sequence token. */
function decodeRows(sequences: Tensor): string[] {
  const rows = sequences.tolist() as bigint[][];
  return rows.map((row) => {
    const ids: number[] = [];
    for (const id of row.slice(1)) {
      const n = Number(id);
      if (n === EOS) break;
      if (n !== PAD) ids.push(n);
    }
    return tokenizer!.decode(ids, { skip_special_tokens: true }).trim();
  });
}

interface GenResult {
  texts: string[];
  tokens: number;
  ms: number;
  msPerToken: number;
}

async function generate(
  sentence: string,
  opts: { count?: number; sample?: boolean; onToken?: (n: number, expected: number) => void } = {},
): Promise<GenResult> {
  const count = opts.count ?? 1;
  const inputs = tokenize(Array(count).fill(sentence));
  const inLen = inputs.input_ids.dims.at(-1) ?? 16;
  const expected = Math.ceil(inLen * 1.1);
  const streamer = new ProgressStreamer((n) => opts.onToken?.(n, expected));
  const t0 = performance.now();
  const out = (await model!.generate({
    ...inputs,
    max_new_tokens: Math.min(256, Math.ceil(inLen * 1.6) + 8),
    no_repeat_ngram_size: 3,
    repetition_penalty: 1.2,
    // Gentle sampling for alternatives: varied wording without drifting from the meaning.
    ...(opts.sample ? { do_sample: true, temperature: 0.7, top_k: 40, top_p: 0.9 } : { do_sample: false }),
    streamer,
  } as unknown as Parameters<PreTrainedModel["generate"]>[0])) as Tensor;
  const ms = performance.now() - t0;
  const decodeSpan = streamer.lastTokenAt - streamer.firstTokenAt;
  const perTok = streamer.count > 1 ? decodeSpan / (streamer.count - 1) : ms / Math.max(1, streamer.count);
  return { texts: decodeRows(out), tokens: streamer.count, ms, msPerToken: perTok };
}

/** Keeps the original's trailing punctuation style if the model dropped it. */
function tidy(original: string, out: string): string {
  if (!out) return original;
  let s = out.replace(/\s+/g, ' ').trim();
  const end = /[.!?…]["')\]]*$/.exec(original)?.[0];
  if (end && !/[.!?…]["')\]]*$/.test(s)) s += end;
  if (/^[A-Z]/.test(original) && /^[a-z]/.test(s)) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

/* ------------------------------- messages ------------------------------- */
scope.onmessage = async (ev: MessageEvent<RephraseRequest>) => {
  const req = ev.data;
  if (req.type === 'cancel') {
    cancelledFlag = true;
    return;
  }
  if (req.type === 'init') {
    sharedCancel = req.cancelBuffer ? new Int32Array(req.cancelBuffer) : null;
    return;
  }
  try {
    if (req.type === 'load') {
      await ensureLoaded();
      return;
    }
    if (req.type === 'rephrase') {
      cancelledFlag = false;
      await ensureLoaded();
      const t0 = performance.now();
      let tokSum = 0;
      let msSum = 0;
      for (let index = 0; index < req.sentences.length; index++) {
        await yieldToEvents();
        if (isCancelled()) throw new Cancelled('cancelled');
        const sentence = req.sentences[index];
        const inLen = tokenize([sentence]).input_ids.dims.at(-1) ?? 16;
        const expectedTokens = Math.ceil(inLen * 1.1);
        post({ type: 'sentence-start', jobId: req.jobId, index, expectedTokens });
        const r = await generate(sentence, {
          onToken: (generated, expected) =>
            post({ type: 'tokens', jobId: req.jobId, index, generated, expectedTokens: expected }),
        });
        tokSum += r.tokens;
        msSum += r.ms;
        post({
          type: 'sentence-done',
          jobId: req.jobId,
          index,
          text: tidy(sentence, r.texts[0]),
          ms: Math.round(r.ms),
          tokens: r.tokens,
        });
      }
      if (tokSum > 0) msPerToken = msSum / tokSum / 1.25; // same 25% encoder overhead as the estimator
      post({ type: 'done', jobId: req.jobId, totalMs: Math.round(performance.now() - t0), msPerToken });
      return;
    }
    if (req.type === 'alternatives') {
      cancelledFlag = false;
      await ensureLoaded();
      const r = await generate(req.sentence, { count: req.count, sample: true });
      const seen = new Set<string>([req.sentence.toLowerCase()]);
      const options: string[] = [];
      for (const t of r.texts.map((x) => tidy(req.sentence, x))) {
        const key = t.toLowerCase();
        if (!t || seen.has(key)) continue;
        seen.add(key);
        options.push(t);
      }
      post({ type: 'alternatives', jobId: req.jobId, index: req.index, options, ms: Math.round(r.ms) });
    }
  } catch (err) {
    if (err instanceof Cancelled || (err instanceof Error && err.message === 'cancelled')) {
      post({ type: 'cancelled', jobId: 'jobId' in req ? req.jobId : 0 });
      return;
    }
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      jobId: 'jobId' in req ? req.jobId : undefined,
    });
  }
};
