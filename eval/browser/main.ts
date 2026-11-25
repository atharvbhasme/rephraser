/**
 * Dev-only benchmark for the optional grammar models, run in the real browser runtime.
 * Compares: rules only · model rewrite · rules + filtered model edits.
 */
import { AutoModelForSeq2SeqLM, AutoTokenizer, env, type PreTrainedModel, type PreTrainedTokenizer, type Tensor } from '@huggingface/transformers';
import { LocalLinter } from 'harper.js';
import { binary } from 'harper.js/binary';
import { applyFixes } from '../../src/lib/applyFixes';
import { expandForms } from '../../src/lib/dictionary';
import { HarperEngine, dialectValue } from '../../src/lib/harperEngine';
import type { Issue } from '../../src/lib/issues';
import { modelEditsToIssues } from './modelEdits';
import { protectedRanges } from '../../src/lib/rules/protect';
import { splitSentences } from '../../src/lib/sentences';
import { WORD_PACKS } from '../../src/lib/wordPacks';
import { diff, distance, editKey, score, tokenize } from '../metrics';
import { parseCorrections, parsePrompts, type Case } from '../parse';

const params = new URLSearchParams(location.search);
const MODEL = params.get('model') ?? 't5-tiny-gec';
const PREFIX = params.get('prefix') ?? '';
const LIMIT = Number(params.get('limit') ?? 1000);
const logEl = document.getElementById('log')!;
const log = (s: string) => {
  logEl.textContent = s;
  document.title = s.slice(0, 60);
};

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.useBrowserCache = false;
const wasm = env.backends.onnx.wasm!;
wasm.wasmPaths = { mjs: `${location.origin}/ort/ort-wasm-simd-threaded.mjs`, wasm: `${location.origin}/ort/ort-wasm-simd-threaded.wasm` };
wasm.numThreads = self.crossOriginIsolated ? Math.min(4, Math.floor(navigator.hardwareConcurrency / 2)) : 1;

const EOS = 1;
const PAD = 0;

async function correctSentence(tok: PreTrainedTokenizer, model: PreTrainedModel, s: string): Promise<string> {
  const inputs = tok([PREFIX + s], { truncation: true, max_length: 256 }) as { input_ids: Tensor; attention_mask: Tensor };
  const len = inputs.input_ids.dims.at(-1) ?? 16;
  const out = (await model.generate({
    ...inputs,
    max_new_tokens: Math.min(200, Math.ceil(len * 1.3) + 6),
    do_sample: false,
    no_repeat_ngram_size: 3,
    repetition_penalty: 1.2,
  } as never)) as Tensor;
  const row = (out.tolist() as bigint[][])[0].slice(1).map(Number);
  const ids: number[] = [];
  for (const id of row) {
    if (id === EOS) break;
    if (id !== PAD) ids.push(id);
  }
  return tok.decode(ids, { skip_special_tokens: true }).trim();
}

/** Sentences worth sending to the model: prose, not code/links/list markers. */
function segments(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  const prot = protectedRanges(text);
  let lineStart = 0;
  for (const line of text.split('\n')) {
    const marker = /^\s*(?:[-*•>]|\d+[.)])\s+/.exec(line)?.[0].length ?? 0;
    for (const s of splitSentences(line.slice(marker))) {
      const start = lineStart + marker + s.start;
      const words = s.text.match(/[\p{L}]+/gu) ?? [];
      const protChars = prot.reduce((n, r) => n + Math.max(0, Math.min(r.end, start + s.text.length) - Math.max(r.start, start)), 0);
      if (words.length < 3 || protChars / s.text.length >= 0.3) continue;
      // Small models lose the thread on long sentences: send long ones clause by clause.
      if (words.length > 22) {
        let from = 0;
        for (const m of s.text.matchAll(/[,;]\s+/g)) {
          const piece = s.text.slice(from, m.index!);
          if ((piece.match(/[\p{L}]+/gu) ?? []).length >= 3) out.push({ start: start + from, text: piece });
          from = m.index! + m[0].length;
        }
        const last = s.text.slice(from);
        if ((last.match(/[\p{L}]+/gu) ?? []).length >= 3) out.push({ start: start + from, text: last });
      } else out.push({ start, text: s.text });
    }
    lineStart += line.length + 1;
  }
  return out;
}

function merge(rules: Issue[], model: Issue[], modelWins: boolean): Issue[] {
  const edit = (i: Issue): [number, number] => (i.suggestions[0]?.kind === 'insertAfter' ? [i.end, i.end] : [i.start, i.end]);
  const clash = (a: Issue, b: Issue) => {
    const [as, ae] = edit(a);
    const [bs, be] = edit(b);
    if (as === ae || bs === be) return as === bs || (as > bs && as < be) || (bs > as && bs < ae);
    return as < be && bs < ae;
  };
  const applied = rules.filter((i) => i.auto !== false && i.category !== 'style');
  const out = modelWins ? model.filter(() => true) : [...applied];
  const others = modelWins ? applied : model;
  for (const x of others) if (!out.some((y) => clash(x, y))) out.push(x);
  return out;
}

async function main() {
  log('loading data…');
  const [c, p] = await Promise.all(
    ['spelling_grammar_corrections.json', 'spelling_grammar_prompts.json'].map((f) =>
      fetch(`/test-data/${f}`).then((r) => (r.ok ? r.json() : null)),
    ),
  );
  const cases: Case[] = [...parseCorrections(c), ...parsePrompts(p)].filter((x) => x.pure).slice(0, LIMIT);

  log('loading Harper…');
  const linter = new LocalLinter({ binary, dialect: dialectValue('Indian') as never });
  await linter.setup();
  const engine = new HarperEngine(linter);
  await engine.setWords(expandForms([...WORD_PACKS.indian.words, ...WORD_PACKS.tech.words]));

  log(`loading model ${MODEL}…`);
  const t0 = performance.now();
  const tok = await AutoTokenizer.from_pretrained(MODEL);
  const model = await AutoModelForSeq2SeqLM.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm' });
  const loadMs = performance.now() - t0;

  const strategies = ['rules only', 'model rewrite', 'rules + model edits (rules win)', 'rules + model edits (model wins)'];
  const tot = strategies.map(() => ({ tp: 0, sys: 0, ref: 0, d0: 0, d1: 0 }));
  let sentences = 0;
  const perEdit = new Map<string, { n: number; good: number; bad: number }>();
  let modelMs = 0;
  const samples: string[] = [];

  for (let k = 0; k < cases.length; k++) {
    const cs = cases[k];
    log(`${MODEL}: message ${k + 1}/${cases.length} · ${sentences} sentences · ${(modelMs / Math.max(1, sentences)).toFixed(0)} ms/sentence`);
    const ruleIssues = await engine.check(cs.input);
    const prot = protectedRanges(cs.input);
    let rewrite = cs.input;
    const modelIssues: Issue[] = [];
    const segs = segments(cs.input);
    for (const seg of segs.reverse()) {
      const t1 = performance.now();
      const fixed = await correctSentence(tok, model, seg.text);
      modelMs += performance.now() - t1;
      sentences++;
      rewrite = rewrite.slice(0, seg.start) + fixed + rewrite.slice(seg.start + seg.text.length);
      modelIssues.push(...modelEditsToIssues(cs.input, seg.start, seg.text, fixed, prot));
      if (samples.length < 40 && fixed !== seg.text) samples.push(`IN : ${seg.text}\nOUT: ${fixed}`);
    }
    const outputs = [
      applyFixes(cs.input, ruleIssues.filter((i) => i.category !== 'style')).corrected,
      rewrite,
      applyFixes(cs.input, merge(ruleIssues, modelIssues, false)).corrected,
      applyFixes(cs.input, merge(ruleIssues, modelIssues, true)).corrected,
    ];
    const inTok = tokenize(cs.input);
    const refTok = tokenize(cs.reference);
    // Per-edit attribution: does each model edit alone bring the text closer to the reference?
    const base = distance(inTok, refTok);
    for (const mi of modelIssues) {
      const after = distance(tokenize(applyFixes(cs.input, [mi]).corrected), refTok);
      const s0 = mi.suggestions[0];
      const added = s0.kind === 'insertAfter' ? s0.text.trim().toLowerCase() : `${mi.problem.toLowerCase()}→${s0.text.toLowerCase()}`;
      const key = mi.kind === 'Grammar' ? (/^[a-z]+→[a-z]+$/.test(added) && added.split('→').every((w) => w.length <= 5) ? `swap ${added}` : 'Grammar (other)') : `${mi.kind} ${added}`;
      const st = perEdit.get(key) ?? { n: 0, good: 0, bad: 0 };
      st.n++;
      if (after < base) st.good++;
      else if (after > base) st.bad++;
      perEdit.set(key, st);
    }
    const refKeys = new Set(diff(inTok, refTok).map(editKey));
    outputs.forEach((o, s) => {
      const sysTok = tokenize(o);
      const sysEdits = diff(inTok, sysTok);
      tot[s].tp += sysEdits.filter((e) => refKeys.has(editKey(e))).length;
      tot[s].sys += sysEdits.length;
      tot[s].ref += refKeys.size;
      tot[s].d0 += distance(inTok, refTok);
      tot[s].d1 += distance(sysTok, refTok);
    });
  }

  const rows = strategies.map((name, s) => {
    const sc = score(tot[s].tp, tot[s].sys, tot[s].ref);
    return { name, edits: sc.sys, match: sc.tp, precision: sc.precision, recall: sc.recall, f05: sc.f05, closer: 1 - tot[s].d1 / tot[s].d0 };
  });
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  document.getElementById('out')!.innerHTML =
    `<p>${cases.length} messages, ${sentences} sentences · model load ${(loadMs / 1000).toFixed(1)} s · ${(modelMs / sentences).toFixed(0)} ms per sentence</p>` +
    `<table><tr><th>Setup</th><th>Edits</th><th>Match</th><th>Precision</th><th>Recall</th><th>F0.5</th><th>Closer</th></tr>` +
    rows.map((r) => `<tr><td>${r.name}</td><td>${r.edits}</td><td>${r.match}</td><td>${pct(r.precision)}</td><td>${pct(r.recall)}</td><td>${pct(r.f05)}</td><td>${pct(r.closer)}</td></tr>`).join('') +
    `</table><pre>${samples.join('\n\n').replace(/</g, '&lt;')}</pre>`;
  const edits = [...perEdit.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${v.n}\t+${v.good}\t-${v.bad}\t${k}`);
  (window as unknown as { __eval: unknown }).__eval = { model: MODEL, rows, loadMs, msPerSentence: modelMs / sentences, sentences, edits };
  log(`done: ${MODEL}`);
}

main().catch((e) => log(`ERROR: ${e instanceof Error ? e.stack : e}`));
