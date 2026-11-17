'use client';
import { useId } from 'react';
import { input } from './beatStyles';
export function MixRange({ label, value, min = 0, max = 1, step = 0.01, onChange, disabled = false, disabledMessage, liveMix = false, vertical = false }) {
  const descriptionId = useId();
  return <label className="flex min-w-0 flex-col gap-1 text-xs">{label}: {Number(value.toFixed(2))}
    <input data-beat-live={liveMix || undefined} type="range" aria-label={label} aria-describedby={disabled && disabledMessage ? descriptionId : undefined} min={min} max={max} step={step} value={value} disabled={disabled}
      title={disabled ? disabledMessage : undefined}
      className={`min-h-11 min-w-11 accent-vx-accent focus-visible:outline-vx-accent ${vertical ? 'h-40 self-center' : 'w-full'}`}
      style={vertical ? { writingMode: 'vertical-lr', direction: 'rtl' } : undefined}
      onChange={e => onChange(Number(e.target.value))} />
    {disabled && disabledMessage && <span id={descriptionId}>{disabledMessage}</span>}
  </label>;
}
export function RoomSize({ label, value, onChange }) {
  return <label className="flex flex-col gap-1 text-xs">{label}<select className={input} value={value} onChange={e => onChange(Number(e.target.value))}>
    {[['Small', 0.8], ['Room', 1.6], ['Hall', 2.8], ['Large', 4]].map(([name, size]) => <option key={size} value={size}>{name} ({size} s)</option>)}
  </select></label>;
}
