import type { Job, LoadProgress, Phase } from '../hooks/useRephraser';
import { formatDuration } from '../lib/estimate';
import { fileLabel } from '../lib/modelInfo';

interface Props {
  phase: Phase;
  load: LoadProgress | null;
  job: Job | null;
  modelReady: boolean;
  /** Seconds since the current step began. */
  elapsed: number;
  /** Estimated seconds remaining (null = unknown). */
  remaining: number | null;
  totalBytes: number | undefined;
}

type StepState = 'done' | 'current' | 'todo';

const MB = 1024 ** 2;

export function ProgressStatus({ phase, load, job, modelReady, elapsed, remaining, totalBytes }: Props) {
  if (!job && phase !== 'loading') return null;

  const loadingStage = phase === 'loading' ? (load?.stage ?? 'files') : null;
  const order = ['files', 'prepare', 'warmup'] as const;
  const loadIdx = loadingStage ? order.indexOf(loadingStage) : modelReady ? 3 : -1;
  const running = phase === 'running' && job && job.current >= 0;
  const finished = job && (job.finishedMs !== undefined || job.cancelled);
  const doneCount = job ? job.results.filter((r) => r !== null).length : 0;
  const n = job?.sentences.length ?? 0;

  const st = (i: number): StepState => (loadIdx > i ? 'done' : loadIdx === i ? 'current' : 'todo');
  const steps: { label: string; state: StepState }[] = [
    { label: 'Device checked', state: 'done' },
    { label: 'Load model', state: st(0) },
    { label: 'Prepare for CPU', state: st(1) },
    { label: 'Warm up', state: st(2) },
    {
      label: n ? `Rephrase ${Math.min(doneCount + (running ? 1 : 0), n)}/${n}` : 'Rephrase',
      state: finished ? 'done' : running ? 'current' : 'todo',
    },
  ];

  // Headline and progress bar.
  let headline = '';
  let pct: number | null = null;
  if (loadingStage === 'files') {
    // The manifest knows the full size up front; per-file totals only appear as files start.
    const total = totalBytes || load?.total;
    const loaded = load?.loaded ?? 0;
    pct = total && loaded ? Math.min(100, (loaded / total) * 100) : null;
    const what = load?.file && fileLabel(load.file) === 'tokenizer' && loaded < 4 * MB ? 'tokenizer' : 'model files';
    headline =
      total && loaded
        ? `Loading ${what} — ${Math.round(pct ?? 0)}% (${Math.round(loaded / MB)} of ${Math.round(total / MB)} MB)`
        : `Loading ${what}…`;
  } else if (loadingStage === 'prepare') {
    headline = 'Preparing the model for your CPU…';
  } else if (loadingStage === 'warmup') {
    headline = 'Warming up — measuring speed on your device…';
  } else if (running && job) {
    const sentencePart = job.expectedTokens ? Math.min(0.95, job.generated / job.expectedTokens) : 0;
    pct = ((doneCount + sentencePart) / n) * 100;
    headline = `Rephrasing sentence ${job.current + 1} of ${n}`;
  } else if (job?.cancelled) {
    headline = `Cancelled — ${doneCount} of ${n} sentence${n === 1 ? '' : 's'} rephrased`;
    pct = (doneCount / Math.max(1, n)) * 100;
  } else if (job?.finishedMs !== undefined) {
    headline = `Done in ${formatDuration(job.finishedMs / 1000)}`;
    if (job.loadMs) headline += ` (+ ${formatDuration(job.loadMs / 1000)} model load)`;
    pct = 100;
  }

  const active = phase === 'loading' || running;
  return (
    <div className="progress" aria-live="polite">
      <div className="progress-line">
        <span className="progress-stage">{headline}</span>
        {active && (
          <span className="progress-meta">
            {formatDuration(elapsed)} elapsed
            {remaining !== null && ` · ~${formatDuration(Math.max(1, remaining))} left`}
          </span>
        )}
      </div>
      {(active || pct !== null) && (
        <div
          className={`bar${pct === null ? ' indeterminate' : ''}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct === null ? undefined : Math.round(pct)}
        >
          <span style={{ width: `${pct ?? 30}%` }} />
        </div>
      )}
      <ol className="steps" aria-label="Steps">
        {steps.map((s) => (
          <li key={s.label} className={s.state}>
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}
