'use client';

import { CREATE_GOALS } from '../_lib/starterModels';

export function CreateGoalPicker({ goal, onChange }) {
  return (
    <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">WHAT DO YOU WANT TO MAKE?</div>
      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Creation goal">
        {CREATE_GOALS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={goal === option.id}
            onClick={() => onChange(option.id)}
            className={`min-h-11 rounded-xl border px-3 py-2 text-left text-sm font-bold transition-colors ${
              goal === option.id
                ? 'border-vx-accent bg-vx-accent/[0.07] text-vx-fg'
                : 'border-vx-border text-vx-fg-body hover:border-vx-fg-muted hover:text-vx-fg'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-vx-fg-muted">Free to use — this only narrows the model list and picks its lowest-cost open option.</p>
    </div>
  );
}
