'use client';
import { effectParamLive } from '../../../_lib/music/beat/beatMixControls.mjs';
import * as ops from '../../../_lib/music/beat/beatMixOps.mjs';
import { DEFAULT_FX_PARAMS, FX_RANGES } from '../../../_lib/music/beat/beatMixRules.mjs';
import { MixRange, RoomSize } from './BeatMixControl';
import { button, input } from './beatStyles';
const names = { eq: 'EQ', compressor: 'Compressor', distortion: 'Distortion', delay: 'Delay', reverb: 'Reverb' };
const units = { low: 'dB', mid: 'dB', high: 'dB', threshold: 'dB', ratio: 'ratio', drive: 'percent', time: 'seconds', feedback: 'level', mix: 'level' };
export default function BeatEffectRack({ track, edit }) {
  const effects = track.fx || [];
  function change(op, args, label, key) { edit(d => op(d, track.id, ...args), { label, key, message: label, liveMix: op === ops.setEffectParam && effectParamLive(args[1]) }); }
  return <div className="space-y-2" aria-label={`${track.name} effects`}>
    {!effects.length && <p className="text-xs text-vx-fg-muted">No effects. Add one.</p>}
    <label className="text-xs">Add effect<select className={`${input} w-full`} value="" disabled={effects.length >= 4}
      onChange={e => change(ops.addEffect, [e.target.value], `${names[e.target.value]} added to ${track.name}`)}>
      <option value="">Choose effect</option>{Object.keys(DEFAULT_FX_PARAMS).map(type => <option key={type} value={type}>{names[type]}</option>)}
    </select></label>
    <ol className="space-y-2">{effects.map((fx, i) => <li key={fx.id} className="space-y-2 rounded-xl border border-vx-border p-2">
      <strong className="text-sm">{names[fx.type]} {i + 1}</strong>
      <div className="flex flex-wrap gap-1">
        <button className={button} aria-label={`Bypass ${names[fx.type]} ${i + 1}`} aria-pressed={fx.bypass} onClick={() => change(ops.setEffectBypass, [fx.id, !fx.bypass], 'Effect bypass changed')}>Bypass</button>
        <button className={button} aria-label={`Move ${names[fx.type]} ${i + 1} up`} disabled={i === 0} onClick={() => change(ops.moveEffect, [fx.id, -1], 'Effect moved up')}>↑</button>
        <button className={button} aria-label={`Move ${names[fx.type]} ${i + 1} down`} disabled={i === effects.length - 1} onClick={() => change(ops.moveEffect, [fx.id, 1], 'Effect moved down')}>↓</button>
        <button className={button} aria-label={`Remove ${names[fx.type]} ${i + 1}`} onClick={() => change(ops.removeEffect, [fx.id], 'Effect removed')}>Remove</button>
      </div>
      {Object.entries(fx.params).map(([param, value]) => param === 'size'
        ? <RoomSize key={param} label={`${names[fx.type]} ${i + 1} size`} value={value} onChange={v => change(ops.setEffectParam, [fx.id, param, v], 'Reverb size changed')} />
        : <MixRange liveMix={effectParamLive(param)} key={param} label={`${names[fx.type]} ${i + 1} ${param} (${units[param]})`} value={value} min={FX_RANGES[param][0]} max={FX_RANGES[param][1]}
          step={['low', 'mid', 'high', 'threshold', 'ratio', 'drive'].includes(param) ? 1 : 0.01}
          onChange={v => change(ops.setEffectParam, [fx.id, param, v], `${param} changed`, `${track.id}:fx:${fx.id}:${param}`)} />)}
    </li>)}</ol>
  </div>;
}
