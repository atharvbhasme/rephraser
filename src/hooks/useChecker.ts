import { useCallback, useEffect, useRef, useState } from 'react';
import type { DialectName, Issue } from '../lib/issues';
import { load, save } from '../lib/storage';
import type { CheckRequest, CheckResponse } from '../workers/checkProtocol';

export type CheckerStatus = 'loading' | 'ready' | 'checking' | 'error';

export interface CheckerState {
  status: CheckerStatus;
  /** Issues for `checkedText` (may lag behind the current input while typing). */
  issues: Issue[];
  checkedText: string;
  ms: number | null;
  error: string | null;
  checkNow: () => void;
  ignore: (issue: Issue) => void;
  clearIgnored: () => void;
  hasIgnored: boolean;
}

const DEBOUNCE_MS = 300;

/**
 * Runs Harper in a Web Worker and re-checks `text` shortly after the user stops typing.
 * `words` is the personal dictionary; whenever it changes the worker is updated and the
 * text re-checked.
 */
export function useChecker(text: string, dialect: DialectName, words: string[]): CheckerState {
  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const reqId = useRef(0);
  const pending = useRef(new Map<number, string>());
  const textRef = useRef(text);
  textRef.current = text;
  const wordsRef = useRef(words);
  wordsRef.current = words;
  /** The dictionary the worker currently has, to avoid redundant updates. */
  const sentWords = useRef<string[] | null>(null);

  const [status, setStatus] = useState<CheckerStatus>('loading');
  const [result, setResult] = useState<{ issues: Issue[]; text: string; ms: number | null }>({
    issues: [],
    text: '',
    ms: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [hasIgnored, setHasIgnored] = useState(() => /\d/.test(load<string | null>('ignored', null) ?? ''));

  const send = useCallback((msg: CheckRequest) => workerRef.current?.postMessage(msg), []);

  const checkNow = useCallback(() => {
    if (!readyRef.current) return;
    const id = ++reqId.current;
    pending.current.set(id, textRef.current);
    setStatus('checking');
    send({ type: 'check', id, text: textRef.current });
  }, [send]);

  // Start the worker once. The dialect at mount time is passed to init; later
  // changes go through the effect below.
  const initialDialect = useRef(dialect);
  useEffect(() => {
    const worker = new Worker(new URL('../workers/check.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (ev: MessageEvent<CheckResponse>) => {
      const msg = ev.data;
      switch (msg.type) {
        case 'ready':
          readyRef.current = true;
          setStatus('ready');
          if (sentWords.current !== wordsRef.current) {
            // The dictionary changed while the engine was starting.
            sentWords.current = wordsRef.current;
            send({ type: 'setWords', words: wordsRef.current });
          } else checkNow();
          break;
        case 'result': {
          const checked = pending.current.get(msg.id);
          pending.current.delete(msg.id);
          if (msg.id !== reqId.current || checked === undefined) return; // superseded
          setResult({ issues: msg.issues, text: checked, ms: msg.ms });
          setStatus('ready');
          break;
        }
        case 'changed':
          checkNow();
          break;
        case 'ignored':
          save('ignored', msg.json);
          setHasIgnored(/\d/.test(msg.json ?? ''));
          break;
        case 'error':
          setError(msg.message);
          setStatus('error');
          break;
      }
    };
    worker.onerror = (e) => {
      setError(e.message || 'The spelling & grammar engine failed to start.');
      setStatus('error');
    };
    sentWords.current = wordsRef.current;
    send({
      type: 'init',
      dialect: initialDialect.current,
      words: wordsRef.current,
      ignored: load<string | null>('ignored', null),
    });
    return () => {
      worker.terminate();
      workerRef.current = null;
      readyRef.current = false;
    };
  }, [send, checkNow]);

  // Debounced re-check while typing.
  useEffect(() => {
    if (!readyRef.current) return;
    const t = setTimeout(checkNow, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, checkNow]);

  useEffect(() => {
    if (dialect === initialDialect.current && !readyRef.current) return;
    send({ type: 'setDialect', dialect });
  }, [dialect, send]);

  // Dictionary changes (added/removed words, word packs).
  useEffect(() => {
    if (!readyRef.current || sentWords.current === words) return;
    sentWords.current = words;
    send({ type: 'setWords', words });
  }, [words, send]);

  const resultTextRef = useRef(result.text);
  resultTextRef.current = result.text;
  const ignore = useCallback(
    (issue: Issue) => send({ type: 'ignore', text: resultTextRef.current, index: issue.index }),
    [send],
  );

  const clearIgnored = useCallback(() => send({ type: 'clearIgnored' }), [send]);

  return {
    status,
    issues: result.issues,
    checkedText: result.text,
    ms: result.ms,
    error,
    checkNow,
    ignore,
    clearIgnored,
    hasIgnored,
  };
}
