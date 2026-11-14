'use client';

import { MUSIC_BPM_MAX, MUSIC_BPM_MIN, MUSIC_KEY_SCALES, MUSIC_TIME_SIGNATURES } from '../../../../lib/musicTempoControls.js';

const field = 'mt-2 min-h-12 w-full rounded-xl border border-vx-border-boost bg-vx-panel px-4 font-normal text-vx-fg focus:border-vx-accent focus:outline-none focus:ring-2 focus:ring-vx-accent/30';

/**
 * Tempo, key and time signature for ACE-Step 1.5 (0514). An empty value means the
 * provider chooses, which is today's behaviour.
 * @param {{ value: { bpm: string, keyScale: string, timeSignature: string }, onChange: (next: { bpm: string, keyScale: string, timeSignature: string }) => void }} props
 */
export function MusicTempoKeyControls({ value, onChange }) {
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value });
  const bpm = value.bpm === '' ? null : Number(value.bpm);
  const bpmInvalid = bpm !== null && (!Number.isInteger(bpm) || bpm < MUSIC_BPM_MIN || bpm > MUSIC_BPM_MAX);
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="block font-bold">
        <span>Tempo (BPM)</span>
        <input type="number" inputMode="numeric" min={MUSIC_BPM_MIN} max={MUSIC_BPM_MAX} step="1" value={value.bpm} onChange={set('bpm')} placeholder="Auto" aria-invalid={bpmInvalid || undefined} aria-describedby="music-bpm-help" className={field} />
        <span id="music-bpm-help" className={`mt-2 block font-normal leading-5 ${bpmInvalid ? 'text-vx-danger' : 'text-vx-fg-muted'}`}>{bpmInvalid ? `Use a whole number from ${MUSIC_BPM_MIN} to ${MUSIC_BPM_MAX}, or leave it empty.` : 'Empty lets the model choose.'}</span>
      </label>
      <label className="block font-bold">
        <span>Key</span>
        <select value={value.keyScale} onChange={set('keyScale')} className={field}>
          <option value="">Auto</option>
          {MUSIC_KEY_SCALES.map((key) => <option key={key} value={key}>{key}</option>)}
        </select>
      </label>
      <label className="block font-bold">
        <span>Time signature</span>
        <select value={value.timeSignature} onChange={set('timeSignature')} className={field}>
          <option value="">Auto</option>
          {MUSIC_TIME_SIGNATURES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
    </div>
  );
}

/** The quote fields for the current value; empty fields are left out. */
export function tempoKeyQuoteFields(value) {
  const bpm = value.bpm === '' ? null : Number(value.bpm);
  return {
    ...(bpm !== null && Number.isInteger(bpm) ? { bpm } : {}),
    ...(value.keyScale ? { key_scale: value.keyScale } : {}),
    ...(value.timeSignature ? { time_signature: value.timeSignature } : {}),
  };
}
