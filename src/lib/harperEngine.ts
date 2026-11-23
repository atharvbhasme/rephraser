/**
 * Thin wrapper around a Harper Linter. Used by the check worker in the browser and
 * by the Node integration test, so both exercise exactly the same code.
 */
import type { Lint, Linter } from 'harper.js';
import { toIssues, type DialectName, type Issue, type RawLint, type SuggestionKind } from './issues';

// Mirrors harper.js enums (kept local so this file has no runtime harper import).
const DIALECT_VALUE: Record<DialectName, number> = {
  American: 0,
  British: 1,
  Australian: 2,
  Canadian: 3,
  Indian: 4,
};
const SUGGESTION_KIND: Record<number, SuggestionKind> = { 0: 'replace', 1: 'remove', 2: 'insertAfter' };

export function dialectValue(name: DialectName): number {
  return DIALECT_VALUE[name] ?? 0;
}

export function extractLints(lints: Lint[]): RawLint[] {
  return lints.map((l) => {
    const span = l.span();
    return {
      start: span.start,
      end: span.end,
      kind: l.lint_kind(),
      message: l.message(),
      problem: l.get_problem_text(),
      suggestions: l.suggestions().map((s) => ({
        kind: SUGGESTION_KIND[s.kind() as number] ?? 'replace',
        text: s.get_replacement_text(),
      })),
    };
  });
}

export class HarperEngine {
  private lastText = '';
  private lastLints: Lint[] = [];
  private readonly linter: Linter;

  constructor(linter: Linter) {
    this.linter = linter;
  }

  async check(text: string): Promise<Issue[]> {
    const lints = await this.linter.lint(text, { language: 'plaintext' });
    this.lastText = text;
    this.lastLints = lints;
    return toIssues(text, extractLints(lints));
  }

  setDialect(name: DialectName): Promise<void> {
    return this.linter.setDialect(dialectValue(name) as never);
  }

  addWords(words: string[]): Promise<void> {
    return this.linter.importWords(words);
  }

  /** Replaces the personal dictionary. Harper's built-in dictionary is untouched. */
  async setWords(words: string[]): Promise<void> {
    await this.linter.clearWords();
    if (words.length) await this.linter.importWords(words);
  }

  /** Ignores one issue from the most recent check (in this exact context). Returns the
   *  updated ignore list as Harper's own JSON so it can be persisted verbatim. */
  async ignore(text: string, index: number): Promise<string | null> {
    if (text !== this.lastText) return null;
    const lint = this.lastLints[index];
    if (!lint) return null;
    await this.linter.ignoreLint(text, lint);
    return this.linter.exportIgnoredLints();
  }

  importIgnored(json: string): Promise<void> {
    return this.linter.importIgnoredLints(json);
  }

  async clearIgnored(): Promise<void> {
    await this.linter.clearIgnoredLints();
  }
}
