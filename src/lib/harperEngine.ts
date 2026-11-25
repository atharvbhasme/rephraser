/**
 * Thin wrapper around a Harper Linter. Used by the check worker in the browser and
 * by the Node integration test, so both exercise exactly the same code.
 */
import type { Lint, Linter } from 'harper.js';
import { toIssues, type DialectName, type Issue, type RawLint, type SuggestionKind } from './issues';
import { EMPTY_CONTEXT, makeContext, postProcess, type RuleContext } from './rules';

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

/** Harper rules that do more harm than good for everyday messages. */
const DISABLED_RULES = ['LongSentences'];

export interface EngineOptions {
  /** Which of Rephraser's own rules to run (default: all). [] = Harper only. */
  rules?: string[];
  /** Skip the precision/refinement pass entirely (benchmark baseline). */
  raw?: boolean;
}

export class HarperEngine {
  private lastText = '';
  private lastLints: Lint[] = [];
  private readonly linter: Linter;
  private readonly options: EngineOptions;
  private ctx: RuleContext = EMPTY_CONTEXT;
  private words: string[] = [];
  /** "Ignore" choices for Rephraser's own rules (Harper keeps its own list). */
  private ignoredRules = new Set<string>();

  constructor(linter: Linter, options: EngineOptions = {}) {
    this.linter = linter;
    this.options = options;
  }

  private configured: Promise<void> | null = null;

  /**
   * Harper's "long sentence" hint underlines a whole sentence, and Harper then hides every
   * other mistake inside it (overlapping lints are de-duplicated). Real messages often have
   * long run-on sentences, so that hint would hide most real errors: turn it off.
   */
  private configure(): Promise<void> {
    this.configured ??= (async () => {
      const config = await this.linter.getLintConfig();
      for (const rule of DISABLED_RULES) if (rule in config) config[rule] = false;
      await this.linter.setLintConfig(config);
    })();
    return this.configured;
  }

  async check(text: string): Promise<Issue[]> {
    if (!this.options.raw) await this.configure();
    const lints = await this.linter.lint(text, { language: 'plaintext' });
    this.lastText = text;
    this.lastLints = lints;
    const harper = toIssues(text, extractLints(lints));
    if (this.options.raw) return harper;
    return postProcess(text, harper, this.ctx, { rules: this.options.rules, ignored: this.ignoredRules });
  }

  async setDialect(name: DialectName): Promise<void> {
    await this.linter.setDialect(dialectValue(name) as never);
    // Changing the dialect resets Harper's rule settings: apply ours again.
    this.configured = null;
  }

  async addWords(words: string[]): Promise<void> {
    this.words = [...this.words, ...words];
    this.ctx = makeContext(this.words);
    await this.linter.importWords(words);
    this.configured = null;
  }

  /** Replaces the personal dictionary. Harper's built-in dictionary is untouched. */
  async setWords(words: string[]): Promise<void> {
    this.words = [...words];
    this.ctx = makeContext(this.words);
    await this.linter.clearWords();
    if (words.length) await this.linter.importWords(words);
    this.configured = null;
  }

  /**
   * Ignores one issue from the most recent check. Harper issues are identified by `index`,
   * Rephraser's own rules by `key`. Returns the full ignore list as JSON to persist.
   */
  async ignore(text: string, index: number, key?: string): Promise<string | null> {
    if (key) {
      this.ignoredRules.add(key);
      return this.exportIgnored();
    }
    if (text !== this.lastText) return null;
    const lint = this.lastLints[index];
    if (!lint) return null;
    await this.linter.ignoreLint(text, lint);
    return this.exportIgnored();
  }

  async exportIgnored(): Promise<string> {
    return JSON.stringify({ harper: await this.linter.exportIgnoredLints(), rules: [...this.ignoredRules] });
  }

  async importIgnored(json: string): Promise<void> {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed.harper === 'string') {
      await this.linter.importIgnoredLints(parsed.harper);
      this.ignoredRules = new Set(Array.isArray(parsed.rules) ? parsed.rules : []);
    } else {
      await this.linter.importIgnoredLints(json); // older format: Harper's list only
    }
  }

  async clearIgnored(): Promise<void> {
    this.ignoredRules.clear();
    await this.linter.clearIgnoredLints();
  }
}
