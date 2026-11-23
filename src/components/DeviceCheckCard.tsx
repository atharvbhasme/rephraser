import type { DeviceCheckResult } from '../lib/deviceCheck';

const ICON = { pass: '✅', warn: '⚠️', fail: '❌' } as const;

export function DeviceCheckCard({ result, onRecheck }: { result: DeviceCheckResult | null; onRecheck: () => void }) {
  if (!result) {
    return (
      <div className="card device-card" aria-live="polite">
        <span className="verdict-icon" aria-hidden="true">
          ⏳
        </span>
        <div>
          <p className="verdict-title">Checking your device…</p>
          <p className="verdict-sub">Making sure Rephrase can run here before anything is loaded.</p>
        </div>
      </div>
    );
  }

  const cls = result.verdict === 'pass' ? 'ok' : result.verdict === 'warn' ? 'slow' : 'no';
  return (
    <div className={`card device-card ${cls}`} aria-live="polite">
      <span className="verdict-icon" aria-hidden="true">
        {ICON[result.verdict]}
      </span>
      <div>
        <p className="verdict-title">{result.title}</p>
        <p className="verdict-sub">{result.detail}</p>
      </div>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onRecheck}>
        Check again
      </button>
      <ul className="checks" aria-label="Device checks">
        {result.items.map((i) => (
          <li key={i.label} className={i.status}>
            {i.label}
          </li>
        ))}
      </ul>
      {!result.modelInstalled && (
        <div className="howto">
          To turn it on, run these on the computer that runs this app (one-time, ~250 MB download):
          <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            <li>
              <code>npm run check:system</code> — tells you whether your computer can run it
            </li>
            <li>
              <code>npm run setup:rephrase</code> — downloads the model, then refresh this page
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
