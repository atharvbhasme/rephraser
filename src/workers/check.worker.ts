/// <reference lib="webworker" />
/**
 * Spelling & grammar worker. Runs Harper (Rust → WebAssembly) off the main thread so
 * typing never stutters. Only plain JSON crosses the worker boundary.
 */
import { LocalLinter } from 'harper.js';
import { binary } from 'harper.js/binary';
import { HarperEngine, dialectValue } from '../lib/harperEngine';
import type { CheckRequest, CheckResponse } from './checkProtocol';

let engine: HarperEngine | null = null;
let ready: Promise<HarperEngine> | null = null;

const post = (msg: CheckResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

async function init(req: Extract<CheckRequest, { type: 'init' }>): Promise<HarperEngine> {
  const t0 = performance.now();
  const linter = new LocalLinter({ binary, dialect: dialectValue(req.dialect) as never });
  await linter.setup();
  const e = new HarperEngine(linter);
  if (req.words.length) await e.addWords(req.words);
  if (req.ignored) {
    try {
      await e.importIgnored(req.ignored);
    } catch {
      /* stale or corrupt ignore list: start fresh */
    }
  }
  engine = e;
  post({ type: 'ready', ms: Math.round(performance.now() - t0) });
  return e;
}

self.onmessage = async (ev: MessageEvent<CheckRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'init') {
      ready = init(req);
      await ready;
      return;
    }
    const e = engine ?? (ready ? await ready : null);
    if (!e) throw new Error('Checker not initialised');
    switch (req.type) {
      case 'check': {
        const t0 = performance.now();
        const issues = await e.check(req.text);
        post({ type: 'result', id: req.id, issues, ms: Math.round(performance.now() - t0) });
        break;
      }
      case 'setDialect':
        await e.setDialect(req.dialect);
        post({ type: 'changed' });
        break;
      case 'setWords':
        await e.setWords(req.words);
        post({ type: 'changed' });
        break;
      case 'ignore': {
        const json = await e.ignore(req.text, req.index, req.key);
        if (json) post({ type: 'ignored', json });
        post({ type: 'changed' });
        break;
      }
      case 'clearIgnored':
        await e.clearIgnored();
        post({ type: 'ignored', json: null });
        post({ type: 'changed' });
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
