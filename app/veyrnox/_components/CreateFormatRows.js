'use client';
import { ControlRow } from './ControlRow';
import { aspectLabel, platformsFor } from '../../../lib/platformFormats.js';

// Aspect pills name the places a ratio is native (TikTok, YouTube, ...); the chosen ratio lists them in full.
export function AspectRow({ assistantTarget, label, options, value, onChange }) {
  const platforms = platformsFor(value);
  return (
    <>
      <ControlRow assistantTarget={assistantTarget} label={label} options={options} value={value} onChange={onChange} formatOption={aspectLabel} />
      {platforms.length > 0 && <p className="-mt-2 text-xs text-vx-fg-muted">{platforms.join(' · ')}</p>}
    </>
  );
}

// Output tier pills (720p … 4K) with the credits each costs, from the multipliers the catalog publishes.
export function ResolutionRow({ assistantTarget, label, tiers, value, onChange, priceFor }) {
  return (
    <ControlRow assistantTarget={assistantTarget} label={label} options={tiers.map((o) => o.id)} value={value} onChange={onChange}
      formatOption={(id) => `${id === '4k' ? '4K' : id} · ${priceFor(tiers.find((o) => o.id === id).multiplier)}`} />
  );
}
