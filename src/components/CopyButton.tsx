import { useState } from 'react';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts (e.g. http://192.168.x.x on a LAN).
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <button
      type="button"
      className="btn"
      disabled={disabled || !text}
      onClick={async () => {
        setState((await copyText(text)) ? 'ok' : 'fail');
        setTimeout(() => setState('idle'), 1500);
      }}
    >
      {state === 'ok' ? 'Copied ✓' : state === 'fail' ? 'Copy failed' : 'Copy'}
    </button>
  );
}
