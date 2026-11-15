'use client';
import { useState } from 'react';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import { button, input } from './beatStyles';
function FadeField({ region, which, edit }) {
  const [draft, setDraft] = useState(null);
  const fade = region[which], incoming = which === 'fadeIn';
  const partial = fade && (incoming ? fade.startSec !== 0 : fade.endBeforeEndSec !== 0);
  const value = !fade ? 0 : (incoming ? fade.endSec : fade.startBeforeEndSec) * 1000;
  function commit() {
    if (draft === null) return;
    const seconds = Number(draft) / 1000;
    if (!draft.trim() || !Number.isFinite(seconds) || seconds < 0 || seconds > 10) return;
    edit((d) => ops.setAudioRegion(d, region.id, { [which]: seconds === 0 ? null : incoming ? { startSec: 0, endSec: seconds } : { startBeforeEndSec: seconds, endBeforeEndSec: 0 } }), { label: 'change fade', regionId: region.id });
    setDraft(null);
  }
  return <label className="flex flex-col">Fade {incoming ? 'in' : 'out'} (ms)
    <input className={`${input} w-32`} type="number" min="0" max="10000" step="1" placeholder={partial ? 'Partial fade' : undefined}
      value={draft ?? (partial ? '' : String(Math.round(value)))} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setDraft(null); }} />
    {partial && <span className="text-xs">Partial fade</span>}
    {draft !== null && (!draft.trim() || !Number.isFinite(Number(draft)) || Number(draft) < 0 || Number(draft) > 10000) && <span className="text-xs">Enter 0–10000 ms.</span>}
  </label>;
}
export default function BeatRegionInspector({ region, edit }) {
  const controls = <div className="flex flex-wrap items-end gap-3">
    <label>Gain {region.gainDb} dB<input aria-label="Region gain (dB)" className="block min-h-11 accent-vx-accent focus-visible:outline-vx-accent" type="range" min="-24" max="6" step="1" value={region.gainDb}
      onChange={(e) => edit((d) => ops.setAudioRegion(d, region.id, { gainDb: Number(e.target.value) }), { key: `gain:${region.id}`, label: 'change region gain' })} /></label>
    <FadeField key={`${region.id}:in:${JSON.stringify(region.fadeIn)}`} region={region} which="fadeIn" edit={edit} />
    <FadeField key={`${region.id}:out:${JSON.stringify(region.fadeOut)}`} region={region} which="fadeOut" edit={edit} />
    <button className={button} aria-pressed={region.reverse} onClick={() => edit((d) => ops.setAudioRegion(d, region.id, { reverse: !region.reverse }), { label: 'reverse region' })}>Reverse</button>
    {/* Match-song-tempo is deferred: the Music list payload does not provide tempo. */}
  </div>;
  return <><section className="hidden rounded-xl border border-vx-border p-3 lg:block" aria-label="Audio region inspector">{controls}</section>
    <details className="rounded-xl border border-vx-border p-3 lg:hidden"><summary className="flex min-h-11 cursor-pointer items-center focus-visible:outline-vx-accent">Audio region settings</summary>{controls}</details></>;
}
