'use client';
import { automationControl, sendLevelLive } from '../../../_lib/music/beat/beatMixControls.mjs';
import * as mix from '../../../_lib/music/beat/beatMixOps.mjs';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import BeatEffectRack from './BeatEffectRack';
import BeatMeter from './BeatMeter';
import { MixRange } from './BeatMixControl';
import { button, input } from './beatStyles';
export default function BeatChannelStrip({ doc, track, edit, engine, onAutomation, recording = false }) {
  const gain = automationControl(track, 'gain', doc.view, recording), pan = automationControl(track, 'pan', doc.view, recording);
  function change(op, value, label, key) { edit(d => op(d, track.id, value), { label, key: `${track.id}:${key}`, liveMix: true }); }
  return <section aria-label={`${track.name} channel`} className="w-64 shrink-0 space-y-3 rounded-xl border border-vx-border bg-vx-panel p-3">
    <h3 className="truncate font-bold">{track.name}</h3><BeatMeter engine={engine} trackId={track.id} name={track.name} />
    <MixRange liveMix vertical label={`${track.name} gain`} value={track.gain} disabled={gain.disabled} disabledMessage={gain.message}
      onChange={v => change(ops.setTrackGain, v, 'Change gain', 'gain')} />
    <MixRange liveMix label={`${track.name} pan`} min={-1} value={track.pan} disabled={pan.disabled} disabledMessage={pan.message}
      onChange={v => change(ops.setTrackPan, v, 'Change pan', 'pan')} />
    <div className="flex gap-2">{[['Mute', 'mute', ops.setTrackMute], ['Solo', 'solo', ops.setTrackSolo]].map(([name, key, op]) =>
      <button data-beat-live key={key} className={button} aria-label={`${name} ${track.name}`} aria-pressed={track[key]} onClick={() => change(op, !track[key], `${name} ${track.name}`, key)}>{name}</button>)}</div>
    {['reverb', 'delay'].map(bus => <MixRange liveMix={track.sends?.[bus] > 0} key={bus} label={`${track.name} ${bus} send`} value={track.sends?.[bus] || 0}
      onChange={v => edit(d => mix.setSend(d, track.id, bus, v), { label: 'Change send', key: `${track.id}:send:${bus}`, liveMix: sendLevelLive(track, bus, v) })} />)}
    <label className="text-xs">Automation<select className={`${input} w-full`} value="" onChange={e => onAutomation(track.id, e.target.value)}>
      <option value="">Show lane</option><option value="gain">Gain</option><option value="pan">Pan</option>
    </select></label>
    <BeatEffectRack track={track} edit={edit} />
  </section>;
}
