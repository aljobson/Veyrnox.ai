'use client';
import * as midi from '../../../_lib/music/beat/beatMidiOps.mjs';
import { button, input } from './beatStyles';
export default function BeatPianoToolbar({ doc, region, clip, edit, snap, setSnap, selection, strength, setStrength, close, playback }) {
  const uses = doc.tracks.flatMap((t) => t.regions).filter((r) => r.clipId === region.clipId).length;
  return <div className="flex flex-wrap items-center gap-2 border-b border-vx-border p-2">
    <h2 className="w-full font-bold">Editing clip &quot;{clip.name}&quot; (used by {uses} {uses === 1 ? 'region' : 'regions'})</h2>
    <button className={button} onClick={playback.toggle}>{playback.playing ? 'Stop' : 'Play'}</button>
    <button className={button} onClick={() => edit((d) => midi.makeUnique(d, region.id), { label: 'make clip unique' })}>Make unique</button>
    <label>Snap <select className={input} value={snap} onChange={(e) => setSnap(Number(e.target.value))}>{[[960, '1/4'], [480, '1/8'], [240, '1/16'], [120, '1/32'], [60, '1/64'], [0, 'Off']].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
    <label>Strength <select className={input} value={strength} onChange={(e) => setStrength(Number(e.target.value))}><option value={1}>100 %</option><option value={0.5}>50 %</option></select></label>
    <button className={button} disabled={!snap} onClick={() => edit((d) => midi.quantiseNotes(d, region.clipId, selection, snap, strength), { label: 'quantise notes' })}>Quantise</button>
    <label>Clip bars <input className={`${input} w-20`} type="number" min={0.0625} max={64} step={0.0625} value={clip.lengthTicks / 3840} onChange={(e) => edit((d) => midi.setClipLength(d, region.clipId, Number(e.target.value) * 3840), { label: 'change clip length' })} /></label>
    <button className={`${button} md:hidden`} onClick={close}>Close piano roll</button>
    <p className="w-full text-xs" title="Notes end at region ends and clip loop seams. Split, trim and overlap preserve onsets, but shorten notes crossing a cut. Drum sounds play their natural decay.">Notes end at region boundaries and loop seams; drum sounds decay naturally.</p>
  </div>;
}
