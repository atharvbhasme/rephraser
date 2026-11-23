/**
 * Integration test: runs the real Harper engine (inlined WASM build) in Node through
 * the same HarperEngine wrapper the browser worker uses.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { LocalLinter } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
import { HarperEngine, dialectValue } from '../src/lib/harperEngine';
import { applyFixes } from '../src/lib/applyFixes';
import { expandForms } from '../src/lib/dictionary';

let engine: HarperEngine;

beforeAll(async () => {
  const linter = new LocalLinter({ binary: binaryInlined, dialect: dialectValue('American') as never });
  await linter.setup();
  engine = new HarperEngine(linter);
}, 60_000);

describe('Harper engine', () => {
  it('finds spelling and grammar mistakes and corrects them', async () => {
    const text = 'i has went too the libary yesterday and buyed three book.';
    const issues = await engine.check(text);
    const problems = issues.map((i) => i.problem);
    expect(problems).toEqual(expect.arrayContaining(['i', 'has', 'went', 'too', 'libary', 'buyed']));
    expect(issues.find((i) => i.problem === 'libary')?.category).toBe('spelling');
    expect(issues.find((i) => i.problem === 'has')?.category).toBe('grammar');
    const { corrected } = applyFixes(text, issues);
    expect(corrected).toContain('I have gone to the library');
    expect(corrected).toContain('bought');
  });

  it('reports spans that match the text even after emoji', async () => {
    const text = '👨‍👩‍👧 Café naïve recieve.';
    const issues = await engine.check(text);
    for (const i of issues) expect(text.slice(i.start, i.end)).toBe(i.problem);
    expect(issues.some((i) => i.problem === 'recieve')).toBe(true);
  });

  it('respects dialect, dictionary and ignore', async () => {
    expect((await engine.check('The colour is nice.')).some((i) => i.problem === 'colour')).toBe(true);
    await engine.setDialect('British');
    expect((await engine.check('The colour is nice.')).some((i) => i.problem === 'colour')).toBe(false);
    await engine.setDialect('American');

    expect((await engine.check('Atharvv wrote it.')).length).toBe(1);
    await engine.addWords(['Atharvv']);
    expect((await engine.check('Atharvv wrote it.')).length).toBe(0);

    // Replacing the dictionary (as the dictionary manager does) — with possessive forms.
    await engine.setWords(expandForms(['Bhasme', 'kubectl']));
    expect((await engine.check("Atharvv met Bhasme. Bhasme's team uses kubectl.")).map((i) => i.problem)).toEqual([
      'Atharvv',
    ]);
    await engine.setWords([]);
    expect((await engine.check('Bhasme uses kubectl.')).map((i) => i.problem)).toEqual(['Bhasme', 'kubectl']);

    const text = 'He recieve it.';
    const first = await engine.check(text);
    const json = await engine.ignore(text, first[0].index);
    expect(json).toContain('context_hashes');
    expect(await engine.check(text)).toHaveLength(0);
    await engine.clearIgnored();
  });
});
