'use client';

// A labelled row of single-choice pills (duration, aspect) in the studio.
export function ControlRow({ label, options, value, onChange }) {
  return (
    <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted mb-3">{label}</div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={`font-vx-mono text-[11px] font-bold rounded-full px-3.5 py-1.5 border ${
              value === o
                ? 'border-vx-accent text-vx-accent bg-vx-accent/[0.07]'
                : 'border-vx-border text-vx-fg-muted hover:text-vx-fg'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
