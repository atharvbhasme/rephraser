/**
 * Accuracy benchmark: runs the app's real correction pipeline on every message in
 * test-data/ and compares the result with the AI-corrected reference.
 *
 *   npm run eval            → prints a summary, writes test-data/eval-report.md
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalLinter } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
import { beforeAll, expect, it } from 'vitest';
import { applyFixes } from '../src/lib/applyFixes';
import { expandForms } from '../src/lib/dictionary';
import { HarperEngine, dialectValue, type EngineOptions } from '../src/lib/harperEngine';
import { defaultChoice, type DialectName, type Issue } from '../src/lib/issues';
import { WORD_PACKS } from '../src/lib/wordPacks';
import { loadCases } from './datasets';
import { classify, diff, distance, editKey, score, tokenize, type Edit, type EditType } from './metrics';

const DIALECT = (process.env.EVAL_DIALECT ?? 'Indian') as DialectName;
const CONFIGS: { name: string; options: EngineOptions }[] = [
  { name: 'Harper only (before)', options: { raw: true } },
  { name: '+ precision fixes', options: { rules: [] } },
  { name: '+ Rephraser rules (now)', options: {} },
];
const engines: HarperEngine[] = [];

beforeAll(async () => {
  for (const c of CONFIGS) {
    const linter = new LocalLinter({ binary: binaryInlined, dialect: dialectValue(DIALECT) as never });
    await linter.setup();
    const engine = new HarperEngine(linter, c.options);
    // Realistic setup: both word packs on (names and tech terms are everywhere in this data).
    await engine.setWords(expandForms([...WORD_PACKS.indian.words, ...WORD_PACKS.tech.words]));
    engines.push(engine);
  }
});

const types: EditType[] = ['missing word', 'extra word', 'capitalization', 'spelling', 'word form / choice', 'punctuation', 'rewrite'];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const show = (e: Edit) => `${e.del.join(' ') || '∅'} → ${e.ins.join(' ') || '∅'}`;

async function evaluate(engine: HarperEngine, cases: ReturnType<typeof loadCases>) {
  const byType = Object.fromEntries(types.map((t) => [t, { ref: 0, hit: 0 }])) as Record<EditType, { ref: number; hit: number }>;
  const totals = { all: { tp: 0, sys: 0, ref: 0, d0: 0, d1: 0 }, pure: { tp: 0, sys: 0, ref: 0, d0: 0, d1: 0 } };
  const details: string[] = [];
  const bySource = new Map<string, SourceStats>();
  let ms = 0;

  for (const c of cases) {
    const t0 = performance.now();
    const issues = (await engine.check(c.input)).filter((i) => i.category !== 'style');
    const output = applyFixes(c.input, issues).corrected;
    ms += performance.now() - t0;
    if (process.env.EVAL_CASE === c.id && engine === engines[engines.length - 1]) {
      console.log(`CASE ${c.id}\n` + issues.map((i) => `  ${i.source} [${i.problem}] → ${JSON.stringify(i.suggestions[0]?.text)} auto=${i.auto}`).join('\n'));
    }

    const inTok = tokenize(c.input);
    const refTok = tokenize(c.reference);
    const sysTok = tokenize(output);
    const refEdits = diff(inTok, refTok);
    const sysEdits = diff(inTok, sysTok);
    const refKeys = new Set(refEdits.map(editKey));
    const sysKeys = new Set(sysEdits.map(editKey));
    const tp = sysEdits.filter((e) => refKeys.has(editKey(e))).length;
    const misspelled = new Set(issues.filter((i) => i.category === 'spelling').map((i) => i.problem));

    for (const bucket of c.pure ? [totals.all, totals.pure] : [totals.all]) {
      bucket.tp += tp;
      bucket.sys += sysEdits.length;
      bucket.ref += refEdits.length;
      bucket.d0 += distance(inTok, refTok);
      bucket.d1 += distance(sysTok, refTok);
    }
    const missed: string[] = [];
    for (const e of refEdits) {
      const t = classify(e, misspelled);
      if (!c.pure) continue;
      byType[t].ref++;
      if (sysKeys.has(editKey(e))) byType[t].hit++;
      else missed.push(`${t}: ${show(e)}`);
    }
    const wrong = sysEdits.filter((e) => !refKeys.has(editKey(e))).map(show);
    if (c.pure) attribute(c.input, inTok, refTok, issues, bySource);
    if (c.pure) {
      details.push(
        `### ${c.id}\n\n- **input:** ${c.input.replace(/\n/g, ' ⏎ ')}\n- **ours:** ${output.replace(/\n/g, ' ⏎ ')}\n` +
          `- **missed (${missed.length}):** ${missed.join(' · ') || '—'}\n- **not in reference (${wrong.length}):** ${wrong.join(' · ') || '—'}\n`,
      );
    }
  }

  return { totals, byType, details, bySource, ms };
}

interface SourceStats {
  fired: number;
  helpful: number;
  harmful: number;
  bad: string[];
}

/**
 * Per-check precision: apply each fix on its own and see whether it brings the text closer
 * to the reference (helpful), further away (harmful) or neither.
 */
function attribute(input: string, inTok: string[], refTok: string[], issues: Issue[], bySource: Map<string, SourceStats>) {
  const before = distance(inTok, refTok);
  for (const issue of issues) {
    if (defaultChoice(issue) < 0) continue;
    const outTok = tokenize(applyFixes(input, [issue]).corrected);
    const edits = diff(inTok, outTok);
    if (!edits.length) continue;
    const after = distance(outTok, refTok);
    const src = issue.source ?? 'harper';
    const s = bySource.get(src) ?? { fired: 0, helpful: 0, harmful: 0, bad: [] };
    s.fired++;
    if (after < before) s.helpful++;
    else if (after > before) {
      s.harmful++;
      if (s.bad.length < 8) s.bad.push(edits.map(show).join(' + '));
      if (process.env.EVAL_DEBUG && src.includes(process.env.EVAL_DEBUG)) {
        const at = issue.suggestions[0]?.kind === 'insertAfter' ? issue.end : issue.start;
        console.log(`HARM ${src}: …${input.slice(Math.max(0, at - 60), at)}⟦${edits.map(show).join(' + ')}⟧${input.slice(at, at + 25)}…`.replace(/\n/g, '⏎'));
      }
    }
    bySource.set(src, s);
  }
}

it('accuracy report', async () => {
  const cases = loadCases();
  if (!cases.length) {
    console.log('No test data found in test-data/ — skipping.');
    return;
  }
  const results = [];
  for (const engine of engines) results.push(await evaluate(engine, cases));
  const { totals, byType, details, bySource, ms } = results[results.length - 1];
  const compare = CONFIGS.map((c, k) => {
    const t = results[k].totals.pure;
    const sc = score(t.tp, t.sys, t.ref);
    return `| ${c.name} | ${sc.sys} | ${sc.tp} | ${pct(sc.precision)} | ${pct(sc.recall)} | ${pct(sc.f05)} | ${pct(1 - t.d1 / t.d0)} |`;
  });
  const sources = [...bySource.entries()].sort((a, b) => b[1].fired - a[1].fired);

  const all = score(totals.all.tp, totals.all.sys, totals.all.ref);
  const pure = score(totals.pure.tp, totals.pure.sys, totals.pure.ref);
  const closer = (b: { d0: number; d1: number }) => 1 - b.d1 / b.d0;
  const pureCount = cases.filter((c) => c.pure).length;

  const lines = [
    `# Accuracy report`,
    ``,
    `${cases.length} messages (${pureCount} plain "correct spelling & grammar" requests). Average ${(ms / cases.length).toFixed(0)} ms per message.`,
    ``,
    `| Set | Edits made | Edits matching the AI reference | Precision | Recall | F0.5 | Closer to reference |`,
    `|---|---|---|---|---|---|---|`,
    `| Plain requests | ${pure.sys} | ${pure.tp} of ${pure.ref} | ${pct(pure.precision)} | ${pct(pure.recall)} | ${pct(pure.f05)} | ${pct(closer(totals.pure))} |`,
    `| All messages | ${all.sys} | ${all.tp} of ${all.ref} | ${pct(all.precision)} | ${pct(all.recall)} | ${pct(all.f05)} | ${pct(closer(totals.all))} |`,
    ``,
    `## Before / after (plain requests, dialect: ${DIALECT})`,
    ``,
    `| Setup | Edits made | Matching reference | Precision | Recall | F0.5 | Closer to reference |`,
    `|---|---|---|---|---|---|---|`,
    ...compare,
    ``,
    `## Each check on its own (does its fix bring the text closer to the AI reference?)`,
    ``,
    `| Check | Fixes applied | Helpful | Harmful | Helpful rate | Harmful examples |`,
    `|---|---|---|---|---|---|`,
    ...sources.map(([k, v]) => `| ${k} | ${v.fired} | ${v.helpful} | ${v.harmful} | ${pct(v.helpful / v.fired)} | ${v.bad.join(' · ').replace(/\|/g, '\\|')} |`),
    ``,
    `## Recall by kind of mistake (plain requests)`,
    ``,
    `| Kind | In reference | Fixed | Recall |`,
    `|---|---|---|---|`,
    ...types.map((t) => `| ${t} | ${byType[t].ref} | ${byType[t].hit} | ${pct(byType[t].ref ? byType[t].hit / byType[t].ref : 0)} |`),
    ``,
    `## Per message`,
    ``,
    ...details,
  ];
  writeFileSync(join(import.meta.dirname, '..', 'test-data', 'eval-report.md'), lines.join('\n'));
  console.log(lines.slice(0, 16 + compare.length + sources.length).join('\n'));
  expect(cases.length).toBeGreaterThan(0);
});
