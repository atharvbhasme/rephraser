/** Loads the personal test data in test-data/ (keep it out of git: it contains private messages). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCorrections, parsePrompts, type Case } from './parse';

export type { Case } from './parse';

const DIR = join(import.meta.dirname, '..', 'test-data');
const read = (name: string) => (existsSync(join(DIR, name)) ? JSON.parse(readFileSync(join(DIR, name), 'utf8')) : null);

export function loadCases(): Case[] {
  return [...parseCorrections(read('spelling_grammar_corrections.json')), ...parsePrompts(read('spelling_grammar_prompts.json'))];
}
