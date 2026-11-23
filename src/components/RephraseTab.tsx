import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRephraser } from '../hooks/useRephraser';
import { runDeviceCheck, type DeviceCheckResult } from '../lib/deviceCheck';
import {
  cpuBenchmarkMs,
  estimateLoadSeconds,
  estimateTokens,
  prepareSeconds,
  expectedOutputTokens,
  formatDuration,
  loadMeasuredSpeed,
  msPerTokenFromBenchmark,
  sentenceSeconds,
  totalSeconds,
  type EstimateSource,
} from '../lib/estimate';
import { joinWithRanges, splitSentences, type Sentence } from '../lib/sentences';
import { CopyButton } from './CopyButton';
import { DeviceCheckCard } from './DeviceCheckCard';
import { InputEditor, type Mark } from './InputEditor';
import { ProgressStatus } from './ProgressStatus';

interface Props {
  text: string;
  onText: (t: string) => void;
  onSendToCorrect: (t: string) => void;
}

const MB = 1024 ** 2;
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

export default function RephraseTab({ text, onText, onSendToCorrect }: Props) {
  const r = useRephraser();
  const [check, setCheck] = useState<DeviceCheckResult | null>(null);
  const [benchMpt, setBenchMpt] = useState<number | null>(null);
  const [jobSentences, setJobSentences] = useState<{ list: Sentence[]; leading: string } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [choices, setChoices] = useState<Record<number, string>>({});
  /** The user's own edits to the rephrased text (null = not edited). */
  const [edited, setEdited] = useState<string | null>(null);
  const [now, setNow] = useState(() => performance.now());

  const recheck = useCallback(() => {
    setCheck(null);
    runDeviceCheck().then(setCheck);
  }, []);
  useEffect(recheck, [recheck]);

  // Quick CPU benchmark for the first estimate (only if this device has no measured speed yet).
  useEffect(() => {
    if (!check || check.verdict === 'fail' || loadMeasuredSpeed()) return;
    const t = setTimeout(
      () => setBenchMpt(msPerTokenFromBenchmark(cpuBenchmarkMs(), check.threads, check.isolated)),
      50,
    );
    return () => clearTimeout(t);
  }, [check]);

  const measured = r.speed?.msPerToken ?? loadMeasuredSpeed()?.msPerToken ?? null;
  const mpt = measured ?? benchMpt;
  const source: EstimateSource = measured ? 'measured' : 'benchmark';
  const savedLoadMs = loadMeasuredSpeed()?.loadMs;
  const totalBytes = check?.manifest?.totalBytes;

  const sentences = useMemo(() => splitSentences(text), [text]);
  const estimate = useMemo(() => {
    if (!mpt || !sentences.length) return null;
    const work = totalSeconds(
      sentences.map((s) => s.text),
      mpt,
    );
    const load = r.modelReady
      ? 0
      : savedLoadMs
        ? savedLoadMs / 1000
        : estimateLoadSeconds(totalBytes ?? 250 * MB, mpt, IS_LOCAL);
    return { work, load, per: work / sentences.length };
  }, [mpt, sentences, r.modelReady, savedLoadMs, totalBytes]);

  // Tick once a second while working so "elapsed / left" stays live.
  const active = r.phase === 'loading' || r.phase === 'running';
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(id);
  }, [active]);

  const job = r.job;
  const { elapsed, remaining } = useMemo(() => {
    if (!job || !mpt) return { elapsed: 0, remaining: null as number | null };
    if (r.phase === 'loading') {
      const since = Math.max(0, (now - (r.loadStartedAt ?? now)) / 1000);
      const work = totalSeconds(job.sentences, mpt);
      const total = totalBytes ?? r.load?.total;
      const loaded = r.load?.loaded ?? 0;
      let left: number;
      if (r.load?.stage === 'files' && total && loaded > 4 * MB && since > 0.5) {
        // Use the real transfer speed observed so far.
        left = (total - loaded) / (loaded / since) + prepareSeconds(mpt);
      } else if (r.load?.stage === 'files') {
        const est = savedLoadMs ? savedLoadMs / 1000 : estimateLoadSeconds(total ?? 250 * MB, mpt, IS_LOCAL);
        left = Math.max(1, est - since);
      } else {
        left = r.load?.stage === 'warmup' ? prepareSeconds(mpt) / 2 : prepareSeconds(mpt);
      }
      return { elapsed: since, remaining: left + work };
    }
    const since = Math.max(0, (now - job.startedAt) / 1000);
    // Adapt the estimate to how fast the finished sentences actually went.
    let actual = 0;
    let est = 0;
    job.results.forEach((res, i) => {
      if (res !== null && job.sentenceMs[i]) {
        actual += job.sentenceMs[i] / 1000;
        est += sentenceSeconds(job.sentences[i], mpt);
      }
    });
    const ratio = est > 0 ? Math.min(4, Math.max(0.25, actual / est)) : 1;
    let left = 0;
    job.sentences.forEach((s, i) => {
      if (job.results[i] !== null) return;
      if (i === job.current) {
        const expected = job.expectedTokens || expectedOutputTokens(estimateTokens(s));
        left += (Math.max(1, expected - job.generated) * mpt * 1.25 * ratio) / 1000;
      } else left += sentenceSeconds(s, mpt) * ratio;
    });
    return { elapsed: since, remaining: left };
  }, [job, mpt, now, r.phase, r.loadStartedAt, savedLoadMs, totalBytes]);

  const start = () => {
    if (!sentences.length) return;
    setJobSentences({ list: sentences, leading: text.match(/^\s*/)?.[0] ?? '' });
    setChoices({});
    setSelected(null);
    setEdited(null);
    r.start(sentences.map((s) => s.text));
  };

  const generated = useMemo(() => {
    if (!job || !jobSentences) return { text: '', ranges: [] as { start: number; end: number }[] };
    const repl: Record<number, string> = {};
    job.results.forEach((res, i) => {
      const chosen = choices[i] ?? res;
      if (chosen) repl[i] = chosen;
    });
    return joinWithRanges(jobSentences.list, repl, jobSentences.leading);
  }, [job, jobSentences, choices]);

  const blocked = !check || check.verdict === 'fail';
  const working = r.phase === 'loading' || r.phase === 'running';
  /** The main rephrase job is still producing sentences (show the live, read-only view). */
  const inProgress = Boolean(job && job.finishedMs === undefined && !job.cancelled);
  const output = edited ?? generated.text;

  const outputMarks = useMemo<Mark[]>(() => {
    if (edited !== null || selected === null || !generated.ranges[selected]) return [];
    const { start, end } = generated.ranges[selected];
    return [{ start, end, key: `s${selected}`, className: 'sent-active' }];
  }, [edited, selected, generated.ranges]);

  /** Clicking a sentence in the (unedited) result opens its alternatives. */
  const onOutputCaret = (pos: number) => {
    if (edited !== null || !job) return;
    const i = generated.ranges.findIndex((rg) => pos >= rg.start && pos <= rg.end);
    if (i >= 0 && job.results[i] !== null) setSelected(i);
  };
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const sel = selected !== null && job ? selected : null;
  const selAlts = sel !== null ? r.alts[sel] : undefined;

  return (
    <>
      <DeviceCheckCard result={check} onRecheck={recheck} />
      {r.error && (
        <div className="error-banner" role="alert">
          Rephrase failed: {r.error}{' '}
          <button type="button" className="btn btn-sm" onClick={r.resetError}>
            Reset
          </button>
        </div>
      )}

      <div className="panes">
        <section className="pane" aria-label="Text to rephrase">
          <div className="pane-head">
            <h2 className="pane-title">Your text</h2>
            {text && !working && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => onText('')}>
                Clear
              </button>
            )}
            {working ? (
              <button type="button" className="btn" onClick={r.cancel}>
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={blocked || !sentences.length}
                onClick={start}
                title={blocked ? 'Rephrase is not available — see the device check above' : undefined}
              >
                ↻ Rephrase
              </button>
            )}
          </div>
          <InputEditor
            label="Text to rephrase"
            value={text}
            onChange={onText}
            placeholder="Paste a sentence or paragraph to rephrase. Tip: fix spelling & grammar first for the best results."
          />
          <div className="pane-foot">
            <span>
              {words} {words === 1 ? 'word' : 'words'} · {sentences.length}{' '}
              {sentences.length === 1 ? 'sentence' : 'sentences'}
            </span>
            <span className="spacer estimate">
              {blocked ? null : estimate ? (
                <>
                  Estimated time: <strong>≈ {formatDuration(estimate.work)}</strong>
                  {sentences.length > 1 && (
                    <> ({estimate.per < 1 ? 'under 1 s' : `~${formatDuration(estimate.per)}`} per sentence)</>
                  )}
                  {estimate.load > 0 && <> + ~{formatDuration(estimate.load)} one-time model load</>}
                  {source === 'benchmark' && (
                    <span className="rough" title="Based on a quick CPU test. It becomes accurate after the first run.">
                      rough
                    </span>
                  )}
                </>
              ) : sentences.length ? (
                'Measuring your CPU speed…'
              ) : null}
            </span>
          </div>
        </section>

        <section className="pane" aria-label="Rephrased text">
          <div className="pane-head">
            <h2 className="pane-title">Rephrased</h2>
            {r.modelReady && !working && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={r.unload}
                title="Free the memory used by the model. It reloads next time."
              >
                Unload model
              </button>
            )}
            <CopyButton text={output} disabled={inProgress} />
            <button
              type="button"
              className="btn"
              disabled={!output.trim() || inProgress}
              onClick={() => onSendToCorrect(output)}
              title="Check the rephrased text for spelling & grammar"
            >
              Check grammar →
            </button>
          </div>
          {job && jobSentences && !inProgress ? (
            <>
              <InputEditor
                label="Rephrased text (editable)"
                value={output}
                onChange={(v) => {
                  setEdited(v);
                  setSelected(null);
                }}
                marks={outputMarks}
                onCaret={onOutputCaret}
                className="editor-output"
              />
              <div className="pane-foot">
                {edited !== null ? (
                  <>
                    <span className="edited-tag">✎ Edited by you</span>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEdited(null)}>
                      Undo my edits
                    </button>
                  </>
                ) : (
                  <span>Click a sentence to see other versions · you can also edit the text directly</span>
                )}
              </div>
            </>
          ) : (
          <div className="output" aria-live="polite">
            {job && jobSentences ? (
              <>
                {jobSentences.leading}
                {jobSentences.list.map((s, i) => {
                  const res = job.results[i];
                  const shown = choices[i] ?? res ?? s.text;
                  return (
                    <span key={i}>
                      <span
                        role="button"
                        tabIndex={res !== null ? 0 : -1}
                        className={`sentence${sel === i ? ' is-active' : ''}${res === null ? ' is-pending' : ''}`}
                        title={res !== null ? 'Click to see other ways to say this' : 'Waiting…'}
                        onClick={() => res !== null && setSelected(i)}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && res !== null) {
                            e.preventDefault();
                            setSelected(i);
                          }
                        }}
                      >
                        {shown}
                      </span>
                      {s.trailing}
                    </span>
                  );
                })}
              </>
            ) : (
              <span className="output-empty">
                The rephrased text will appear here, one sentence at a time. Click any sentence to see other ways to say
                it.
              </span>
            )}
          </div>
          )}

          {sel !== null && job && jobSentences && edited === null && !inProgress && (
            <div className="alts">
              <p className="alts-title">
                Choose a version for sentence {sel + 1}. Small models can change the meaning — pick one that still says
                what you mean.
              </p>
              {[
                { label: 'Original', text: jobSentences.list[sel].text },
                ...(job.results[sel] ? [{ label: 'Rephrased', text: job.results[sel]! }] : []),
                ...(selAlts?.options ?? []).map((t) => ({ label: 'Option', text: t })),
              ]
                .filter((o, k, all) => all.findIndex((x) => x.text.toLowerCase() === o.text.toLowerCase()) === k)
                .map((o, k) => {
                const current = choices[sel] ?? job.results[sel] ?? jobSentences.list[sel].text;
                return (
                  <button
                    key={k}
                    type="button"
                    className="alt"
                    aria-pressed={current === o.text}
                    onClick={() => setChoices((c) => ({ ...c, [sel]: o.text }))}
                  >
                    <span className="issue-kind">{o.label}</span> {o.text}
                  </button>
                );
              })}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={working || blocked}
                  onClick={() => r.requestAlternatives(sel, jobSentences.list[sel].text)}
                >
                  {selAlts?.loading ? 'Generating…' : selAlts?.options.length ? 'More options' : 'Show 3 more options'}
                </button>
                {mpt && (
                  <span className="estimate">
                    ≈ {formatDuration(sentenceSeconds(jobSentences.list[sel].text, mpt) * 1.6)}
                  </span>
                )}
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
            </div>
          )}

          <ProgressStatus
            phase={r.phase}
            load={r.load}
            job={job}
            modelReady={r.modelReady}
            elapsed={elapsed}
            remaining={remaining}
            totalBytes={totalBytes}
          />
        </section>
      </div>
    </>
  );
}
