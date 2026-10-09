'use client';
import { seedIsInvalid, SEED_MAX } from '../_lib/generationSettings';

// Seed and negative prompt, for the models whose capability record declares
// them (catalog `capabilities.inputs`). The gateway validates both again
// against the same record (lib/modelCapabilities.js), so this is a form, not
// a guard.

export function GenerationSettings({ model, seed, onSeed, negative, onNegative }) {
  if (!model?.takesSeed && !model?.takesNegative) return null;
  const bad = seedIsInvalid(seed);
  return (
    <details className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <summary className="cursor-pointer font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">SETTINGS</summary>
      {model.takesSeed && (
        <div className="mt-4">
          <label htmlFor="vx-seed" className="block text-[13px] text-vx-fg-body">Seed</label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="vx-seed"
              inputMode="numeric"
              value={seed}
              onChange={(e) => onSeed(e.target.value.trim())}
              placeholder="Random"
              aria-invalid={bad}
              aria-describedby="vx-seed-help"
              className="min-w-0 flex-1 rounded-lg border border-vx-border bg-vx-base px-3 py-2 font-vx-mono text-[13px]"
            />
            <button
              type="button"
              onClick={() => onSeed(String(Math.floor(Math.random() * SEED_MAX)))}
              className="font-vx-mono text-[11px] font-bold rounded-full px-3.5 py-1.5 border border-vx-border text-vx-fg-muted hover:text-vx-fg"
            >
              Roll
            </button>
          </div>
          <p id="vx-seed-help" className={`mt-1.5 text-[12px] ${bad ? 'text-vx-danger' : 'text-vx-fg-muted'}`}>
            {bad ? `A whole number from 0 to ${SEED_MAX}.` : 'The same seed and prompt give a similar result. Leave blank for a new one each time.'}
          </p>
        </div>
      )}
      {model.takesNegative && (
        <div className="mt-4">
          <label htmlFor="vx-negative" className="block text-[13px] text-vx-fg-body">Leave out</label>
          <textarea
            id="vx-negative"
            value={negative}
            onChange={(e) => onNegative(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="e.g. text, watermark, blur-sm"
            className="mt-1.5 w-full rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-[13px]"
          />
        </div>
      )}
    </details>
  );
}
