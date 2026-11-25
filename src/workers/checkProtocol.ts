import type { DialectName, Issue } from '../lib/issues';

export type CheckRequest =
  | { type: 'init'; dialect: DialectName; words: string[]; ignored: string | null }
  | { type: 'check'; id: number; text: string }
  | { type: 'setDialect'; dialect: DialectName }
  /** Replaces the whole personal dictionary (user words + enabled packs). */
  | { type: 'setWords'; words: string[] }
  | { type: 'ignore'; text: string; index: number; key?: string }
  | { type: 'clearIgnored' };

export type CheckResponse =
  | { type: 'ready'; ms: number }
  | { type: 'result'; id: number; issues: Issue[]; ms: number }
  /** Settings changed (dialect, dictionary, ignore list): the caller should re-check. */
  | { type: 'changed' }
  /** Harper's ignore list as JSON (null = cleared), to persist verbatim. */
  | { type: 'ignored'; json: string | null }
  | { type: 'error'; message: string };
