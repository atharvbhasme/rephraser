export type LoadStage = 'files' | 'prepare' | 'warmup';

export type RephraseRequest =
  /** Optional shared flag (cross-origin isolated pages only) for instant cancel. */
  | { type: 'init'; cancelBuffer: SharedArrayBuffer | null }
  | { type: 'load' }
  | { type: 'rephrase'; jobId: number; sentences: string[] }
  | { type: 'alternatives'; jobId: number; index: number; sentence: string; count: number }
  | { type: 'cancel' };

export type RephraseResponse =
  /** Model loading progress. `loaded`/`total` are bytes across all model files. */
  | { type: 'loading'; stage: LoadStage; file?: string; loaded?: number; total?: number }
  | { type: 'ready'; loadMs: number; msPerToken: number; threads: number }
  | { type: 'sentence-start'; jobId: number; index: number; expectedTokens: number }
  | { type: 'tokens'; jobId: number; index: number; generated: number; expectedTokens: number }
  | { type: 'sentence-done'; jobId: number; index: number; text: string; ms: number; tokens: number }
  | { type: 'done'; jobId: number; totalMs: number; msPerToken: number }
  | { type: 'alternatives'; jobId: number; index: number; options: string[]; ms: number }
  | { type: 'cancelled'; jobId: number }
  | { type: 'error'; message: string; jobId?: number };
