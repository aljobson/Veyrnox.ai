'use client';
import { useEffect, useRef, useState } from 'react';

// One compact chip that shows the current choice and opens a small menu of the others.
// Used in the prompt box toolbar so ratio, size, length and count live beside the prompt.
export function ChipSelect({ label, options, value, onChange, formatOption = (option) => option, formatValue, assistantTarget, disabled = false }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const key = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  const shown = (formatValue || formatOption)(value);
  return (
    <div ref={root} data-assistant-target={assistantTarget} className="relative shrink-0 scroll-mt-24">
      <button type="button" disabled={disabled} aria-haspopup="true" aria-expanded={open} aria-label={`${label}: ${shown}`} onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-vx-border bg-vx-base px-3 font-vx-mono text-[11px] font-bold text-vx-fg transition-colors hover:border-vx-accent disabled:opacity-50 pointer-coarse:h-11">
        <span className="max-w-32 truncate">{shown}</span>
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
      </button>
      {open && (
        <div role="group" aria-label={label} className="absolute bottom-full start-0 z-40 mb-2 flex max-h-72 min-w-44 flex-col gap-1 overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-2 shadow-2xl">
          {options.map((option) => (
            <button key={option} type="button" aria-pressed={value === option} onClick={() => { onChange(option); setOpen(false); }}
              className={`rounded-xl px-3 py-2 text-start font-vx-mono text-[11px] font-bold pointer-coarse:min-h-11 ${value === option ? 'bg-vx-accent/[0.1] text-vx-accent' : 'text-vx-fg-muted hover:bg-vx-fg/[0.05] hover:text-vx-fg'}`}>
              {formatOption(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
