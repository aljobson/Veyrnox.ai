'use client';
import { useState } from 'react';
import * as midi from '../../../_lib/music/beat/beatMidiOps.mjs';
import { clipLengthFromBars } from '../../../_lib/music/beat/beatMidiRules.mjs';
import { button, input } from './beatStyles';
export default function BeatPianoToolbar({ doc, region, clip, edit, snap, setSnap, quantise, strength, setStrength, close, playback }) {
  const [draft, setDraft] = useState(null);
  const [storedLength, setStoredLength] = useState(clip.lengthTicks);
  if (storedLength !== clip.lengthTicks) { setStoredLength(clip.lengthTicks); setDraft(null); }
  function commitLength() {
    if (draft === null) return;
    const length = clipLengthFromBars(draft);
    setDraft(null);
    if (length !== null && length !== clip.lengthTicks) edit((d) => midi.setClipLength(d, region.clipId, length), { key: `clip-length:${region.clipId}`, label: 'change clip length' });
  }
  const uses = doc.tracks.flatMap((t) => t.regions).filter((r) => r.clipId === region.clipId).length;
  return <div className="flex flex-wrap items-center gap-2 border-b border-vx-border p-2">
    <h2 className="w-full font-bold">Editing clip &quot;{clip.name}&quot; (used by {uses} {uses === 1 ? 'region' : 'regions'})</h2>
    <button className={button} onClick={playback.toggle}>{playback.playing ? 'Stop' : 'Play'}</button>
    <button className={button} onClick={() => edit((d) => midi.makeUnique(d, region.id), { label: 'make clip unique' })}>Make unique</button>
    <label>Snap <select className={input} value={snap} onChange={(e) => setSnap(Number(e.target.value))}>{[[960, '1/4'], [480, '1/8'], [240, '1/16'], [120, '1/32'], [60, '1/64'], [0, 'Off']].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
    <label>Strength <select className={input} value={strength} onChange={(e) => setStrength(Number(e.target.value))}><option value={1}>100 %</option><option value={0.5}>50 %</option></select></label>
    <button className={button} disabled={!snap} onClick={quantise}>Quantise</button>
    <label>Clip bars <input className={`${input} w-20`} type="text" inputMode="decimal" value={draft ?? clip.lengthTicks / 3840} onChange={(e) => setDraft(e.target.value)} onBlur={commitLength} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitLength(); } }} /></label>
    <button className={`${button} md:hidden`} onClick={close}>Close piano roll</button>
    <p className="w-full text-xs" title="Notes end at region ends and clip loop seams. Split, trim and overlap preserve onsets, but shorten notes crossing a cut. Drum sounds play their natural decay.">Notes end at region boundaries and loop seams; drum sounds decay naturally.</p>
  </div>;
}
