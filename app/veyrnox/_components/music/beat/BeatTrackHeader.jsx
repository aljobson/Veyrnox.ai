'use client';
import { useState } from 'react';
import { PRESETS } from '../../../../../lib/musicInstruments.js';
import { addMidiRegion } from '../../../_lib/music/beat/beatMidiOps.mjs';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import { button, input } from './beatStyles';

export default function BeatTrackHeader({ track, edit, locator, last, selected, onSelect }) {
  const [nameDraft, setNameDraft] = useState(null);
  function field(op, value, label, key) {
    edit((d) => op(d, track.id, value), { liveMix: [ops.setTrackMute, ops.setTrackSolo, ops.setTrackGain, ops.setTrackPan].includes(op), label, trackId: track.id, key: key && `${track.id}:${key}` });
  }
  function commitName() {
    if (nameDraft === null) return;
    field(ops.renameTrack, nameDraft.trim(), 'rename track', 'name');
    setNameDraft(null);
  }
  function settings() {
    return <div className="grid min-w-0 grid-cols-2 gap-1">
      <label className="col-span-2 text-xs">Name
        <input aria-label={`Track name for ${track.name}`} className={`${input} w-full`} maxLength={40}
          value={nameDraft ?? track.name} onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName} onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitName(); }
          }} />
      </label>
      {track.kind === 'drums' && <label className="col-span-2 text-xs">Kit
        <select className={`${input} w-full`} value={track.kit}
          onChange={(e) => field(ops.setTrackKit, e.target.value, 'change track kit')}>
          {PRESETS.drums.map((kit) => <option key={kit.id} value={kit.id}>{kit.label}</option>)}
        </select>
      </label>}
      <label data-beat-live className="min-w-0 text-xs">Gain {Math.round(track.gain * 100)}%
        <input aria-label={`${track.name} gain`} type="range" min="0" max="100" value={track.gain * 100}
          className="min-h-11 w-full accent-vx-accent focus-visible:outline-vx-accent"
          onChange={(e) => field(ops.setTrackGain, Number(e.target.value) / 100, 'change track gain', 'gain')} />
      </label>
      <label data-beat-live className="min-w-0 text-xs">Pan L–R
        <input aria-label={`${track.name} pan`} type="range" min="-100" max="100" value={track.pan * 100}
          className="min-h-11 w-full accent-vx-accent focus-visible:outline-vx-accent"
          onChange={(e) => field(ops.setTrackPan, Number(e.target.value) / 100, 'change track pan', 'pan')} />
      </label>
      {track.kind !== 'audio' && <button className={button} onClick={() => edit((d) => track.kind === 'midi' ? addMidiRegion(d, track.id, locator) : ops.addRegion(d, track.id, locator, d.currentPattern),
        { label: 'add region', trackId: track.id, start: locator })}>Add region</button>}
      <button className={button} disabled={last} title={last ? 'Keep at least one track.' : undefined}
        onClick={() => { if (window.confirm(`Delete ${track.name} and its regions?`)) {
          edit((d) => ops.removeTrack(d, track.id), { label: 'delete track', trackId: track.id });
        } }}>Delete track</button>
    </div>;
  }
  return <div className={`relative h-48 border-b border-vx-border md:h-80 ${selected ? 'bg-vx-accent/10' : 'bg-vx-panel'}`}>
    <div className="flex flex-wrap items-center justify-center gap-1 md:justify-start md:px-2">
      <button className="min-h-11 w-full truncate text-xs font-bold focus-visible:outline-vx-accent md:w-auto md:flex-1"
        aria-pressed={selected} onClick={onSelect} title={track.name}>{track.name}</button>
      <button className={`${button} px-2 max-md:w-11 ${track.mute ? 'bg-vx-accent text-vx-accent-ink' : ''}`}
        data-beat-live aria-label={`Mute ${track.name}`}
        aria-pressed={track.mute} onClick={() => field(ops.setTrackMute, !track.mute,
          `${track.mute ? 'unmute' : 'mute'} ${track.name}`)}>M</button>
      <button className={`${button} px-2 max-md:w-11 ${track.solo ? 'bg-vx-accent text-vx-accent-ink' : ''}`}
        data-beat-live aria-label={`Solo ${track.name}`}
        aria-pressed={track.solo} onClick={() => field(ops.setTrackSolo, !track.solo,
          `${track.solo ? 'unsolo' : 'solo'} ${track.name}`)}>S</button>
    </div>
    <div className="hidden p-2 md:block">{settings()}</div>
    <details className="md:hidden">
      <summary data-beat-live aria-label={`Track settings for ${track.name}`}
        className="relative z-10 flex min-h-11 cursor-pointer items-center text-center text-xs focus-visible:outline-vx-accent">
        Track settings
      </summary>
      <div className="absolute left-0 top-full z-30 w-64 rounded-xl border border-vx-border bg-vx-panel p-2 shadow-lg">
        {settings()}
      </div>
    </details>
  </div>;
}
