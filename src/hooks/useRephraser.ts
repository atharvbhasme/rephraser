import { useCallback, useEffect, useRef, useState } from 'react';
import { saveMeasuredSpeed } from '../lib/estimate';
import type { LoadStage, RephraseRequest, RephraseResponse } from '../workers/rephraseProtocol';

export type Phase = 'idle' | 'loading' | 'ready' | 'running' | 'error';

export interface LoadProgress {
  stage: LoadStage;
  file?: string;
  loaded?: number;
  total?: number;
}

export interface Job {
  id: number;
  sentences: string[];
  results: (string | null)[];
  /** Index of the sentence being rephrased, or -1 when finished. */
  current: number;
  generated: number;
  expectedTokens: number;
  startedAt: number;
  /** Wall-clock time spent on each finished sentence. */
  sentenceMs: number[];
  finishedMs?: number;
  cancelled?: boolean;
  /** Time spent loading the model as part of this job (first run only). */
  loadMs?: number;
}

export interface Alternatives {
  loading: boolean;
  options: string[];
}

export function useRephraser() {
  const workerRef = useRef<Worker | null>(null);
  const jobId = useRef(0);
  /** True while a rephrase/alternatives request is in flight. */
  const busy = useRef(false);
  /** Shared cancel flag: lets Cancel stop the worker mid-sentence. */
  const cancelFlag = useRef<Int32Array | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [modelReady, setModelReady] = useState(false);
  const [load, setLoad] = useState<LoadProgress | null>(null);
  const [loadStartedAt, setLoadStartedAt] = useState<number | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [alts, setAlts] = useState<Record<number, Alternatives>>({});
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState<{ msPerToken: number; loadMs?: number } | null>(null);

  const onMessage = useCallback((ev: MessageEvent<RephraseResponse>) => {
    const msg = ev.data;
    switch (msg.type) {
      case 'loading':
        setLoad((prev) => ({
          stage: msg.stage,
          file: msg.file ?? prev?.file,
          loaded: msg.loaded ?? (msg.stage === prev?.stage ? prev?.loaded : undefined),
          total: msg.total ?? (msg.stage === prev?.stage ? prev?.total : undefined),
        }));
        break;
      case 'ready':
        setModelReady(true);
        setLoad(null);
        setSpeed({ msPerToken: msg.msPerToken, loadMs: msg.loadMs });
        saveMeasuredSpeed(msg.msPerToken, msg.loadMs);
        setJob((j) => (j ? { ...j, loadMs: msg.loadMs, startedAt: performance.now() } : j));
        setPhase(busy.current ? 'running' : 'ready');
        break;
      case 'sentence-start':
        if (msg.jobId !== jobId.current) return;
        setJob((j) => (j ? { ...j, current: msg.index, generated: 0, expectedTokens: msg.expectedTokens } : j));
        break;
      case 'tokens':
        if (msg.jobId !== jobId.current) return;
        setJob((j) => (j ? { ...j, generated: msg.generated, expectedTokens: msg.expectedTokens } : j));
        break;
      case 'sentence-done':
        if (msg.jobId !== jobId.current) return;
        setJob((j) => {
          if (!j) return j;
          const results = j.results.slice();
          results[msg.index] = msg.text;
          const sentenceMs = j.sentenceMs.slice();
          sentenceMs[msg.index] = msg.ms;
          return { ...j, results, sentenceMs, generated: 0 };
        });
        break;
      case 'done':
        if (msg.jobId !== jobId.current) return;
        saveMeasuredSpeed(msg.msPerToken);
        setSpeed((s) => ({ ...s, msPerToken: msg.msPerToken }));
        setJob((j) => (j ? { ...j, current: -1, finishedMs: msg.totalMs } : j));
        busy.current = false;
        setPhase('ready');
        break;
      case 'alternatives':
        setAlts((a) => ({ ...a, [msg.index]: { loading: false, options: msg.options } }));
        busy.current = false;
        setPhase('ready');
        break;
      case 'cancelled':
        setJob((j) => (j ? { ...j, current: -1, cancelled: true } : j));
        setAlts((a) => Object.fromEntries(Object.entries(a).filter(([, v]) => !v.loading)));
        busy.current = false;
        setPhase('ready');
        break;
      case 'error':
        setError(msg.message);
        busy.current = false;
        setPhase('error');
        setLoad(null);
        break;
    }
  }, []);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const w = new Worker(new URL('../workers/rephrase.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = onMessage;
      w.onerror = (e) => {
        setError(e.message || 'The rephrase engine crashed (possibly out of memory).');
        setPhase('error');
      };
      let buffer: SharedArrayBuffer | null = null;
      if (globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function') {
        buffer = new SharedArrayBuffer(4);
        cancelFlag.current = new Int32Array(buffer);
      } else cancelFlag.current = null;
      w.postMessage({ type: 'init', cancelBuffer: buffer } satisfies RephraseRequest);
      workerRef.current = w;
    }
    return workerRef.current;
  }, [onMessage]);

  const send = useCallback((msg: RephraseRequest) => getWorker().postMessage(msg), [getWorker]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const start = useCallback(
    (sentences: string[]) => {
      const id = ++jobId.current;
      busy.current = true;
      if (cancelFlag.current) Atomics.store(cancelFlag.current, 0, 0);
      setError(null);
      setAlts({});
      setJob({
        id,
        sentences,
        results: sentences.map(() => null),
        current: modelReady ? 0 : -1,
        generated: 0,
        expectedTokens: 0,
        startedAt: performance.now(),
        sentenceMs: [],
      });
      if (!modelReady) {
        setPhase('loading');
        setLoadStartedAt(performance.now());
        setLoad({ stage: 'files' });
      } else setPhase('running');
      send({ type: 'rephrase', jobId: id, sentences });
    },
    [modelReady, send],
  );

  const cancel = useCallback(() => {
    if (cancelFlag.current) Atomics.store(cancelFlag.current, 0, 1);
    workerRef.current?.postMessage({ type: 'cancel' } satisfies RephraseRequest);
  }, []);

  const requestAlternatives = useCallback(
    (index: number, sentence: string) => {
      setAlts((a) => ({ ...a, [index]: { loading: true, options: a[index]?.options ?? [] } }));
      busy.current = true;
      if (cancelFlag.current) Atomics.store(cancelFlag.current, 0, 0);
      if (!modelReady) {
        setPhase('loading');
        setLoadStartedAt(performance.now());
        setLoad({ stage: 'files' });
      } else setPhase('running');
      send({ type: 'alternatives', jobId: ++jobId.current, index, sentence, count: 3 });
    },
    [modelReady, send],
  );

  /** Frees the ~600 MB the model uses. It reloads automatically next time. */
  const unload = useCallback(() => {
    busy.current = false;
    workerRef.current?.terminate();
    workerRef.current = null;
    setModelReady(false);
    setPhase('idle');
    setLoad(null);
  }, []);

  const resetError = useCallback(() => {
    busy.current = false;
    workerRef.current?.terminate();
    workerRef.current = null;
    setModelReady(false);
    setError(null);
    setPhase('idle');
  }, []);

  return {
    phase,
    modelReady,
    load,
    loadStartedAt,
    job,
    alts,
    error,
    speed,
    start,
    cancel,
    requestAlternatives,
    unload,
    resetError,
  };
}
