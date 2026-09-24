'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Copy-to-clipboard with an inline confirmation. Used for model ids on the
// pricing table — the one string on this site somebody retypes by hand.
export function CopyButton({ value, label = 'Copy', copiedLabel = 'Copied', title, className = '' }) {
  const [state, setState] = useState('idle'); // idle | copied | failed
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      // Clipboard is permission-gated and absent over plain http; say so
      // rather than flashing a success the visitor did not get.
      setState('failed');
    }
    timer.current = setTimeout(() => setState('idle'), 1800);
  }, [value]);

  return (
    <button
      type="button"
      onClick={copy}
      title={title || `${label} ${value}`}
      data-print="hide"
      className={`inline-flex items-center gap-1 rounded-full border border-vx-border px-2 py-0.5 font-vx-mono text-[9px] tracking-[0.1em] transition-colors hover:border-vx-accent hover:text-vx-fg ${
        state === 'copied' ? 'border-vx-accent text-vx-accent' : state === 'failed' ? 'border-vx-danger text-vx-danger' : 'text-vx-fg-muted'
      } ${className}`}
    >
      <span aria-hidden="true">{state === 'copied' ? '✓' : state === 'failed' ? '✕' : '⧉'}</span>
      <span>{state === 'copied' ? copiedLabel : state === 'failed' ? 'Copy failed' : label}</span>
      <span role="status" aria-live="polite" className="sr-only">
        {state === 'copied' ? `${value} copied to clipboard` : state === 'failed' ? 'Copy to clipboard failed' : ''}
      </span>
    </button>
  );
}
