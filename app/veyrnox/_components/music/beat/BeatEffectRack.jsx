'use client';
import { beatEnglish } from '../../../_lib/music/beat/beatDisplay.mjs';
import { beatLabel } from '../../../_lib/music/beat/beatLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { effectParamLive } from '../../../_lib/music/beat/beatMixControls.mjs';
import * as ops from '../../../_lib/music/beat/beatMixOps.mjs';
import { DEFAULT_FX_PARAMS, FX_RANGES } from '../../../_lib/music/beat/beatMixRules.mjs';
import { MixRange, RoomSize } from './BeatMixControl';
import { button, input } from './beatStyles';
const names = { eq: 'EQ', compressor: 'Compressor', distortion: 'Distortion', delay: 'Delay', reverb: 'Reverb' };
const units = { low: 'dB', mid: 'dB', high: 'dB', threshold: 'dB', ratio: 'ratio', drive: 'percent', time: 'seconds', feedback: 'level', mix: 'level' };
export default function BeatEffectRack({ track, edit }) {
  const { t } = useI18n();
  const effects = track.fx || [];
  function change(op, args, label, key) { edit(d => op(d, track.id, ...args), { label: beatEnglish(label.key, label.values), key, message: t(label.key, label.display || label.values), liveMix: op === ops.setEffectParam && effectParamLive(args[1]) }); }
  return <div className="space-y-2" aria-label={t('app.music.beat.labels.l11', { p0: track.name })}>
    {!effects.length && <p className="text-xs text-vx-fg-muted">{t('app.music.beat.ui.no.effects.add.one')}</p>}
    <label className="text-xs">{t('app.music.beat.ui.add.effect')}<select className={`${input} w-full`} value="" disabled={effects.length >= 4}
      onChange={e => change(ops.addEffect, [e.target.value], { key: 'app.music.beat.status.s11', values: { p0: names[e.target.value], p1: track.name }, display: { p0: beatLabel(names[e.target.value], t), p1: track.name } })}>
      <option value="">{t('app.music.beat.ui.choose.effect')}</option>{Object.keys(DEFAULT_FX_PARAMS).map(type => <option key={type} value={type}>{beatLabel(names[type], t)}</option>)}
    </select></label>
    <ol className="space-y-2">{effects.map((fx, i) => <li key={fx.id} className="space-y-2 rounded-xl border border-vx-border p-2">
      <strong className="text-sm">{beatLabel(names[fx.type], t)} {i + 1}</strong>
      <div className="flex flex-wrap gap-1">
        <button className={button} aria-label={t('app.music.beat.labels.l12', { p0: beatLabel(names[fx.type], t), p1: i + 1 })} aria-pressed={fx.bypass} onClick={() => change(ops.setEffectBypass, [fx.id, !fx.bypass], { key: 'app.music.beat.status.s12' })}>{t('app.music.beat.ui.bypass')}</button>
        <button className={button} aria-label={t('app.music.beat.labels.l13', { p0: beatLabel(names[fx.type], t), p1: i + 1 })} disabled={i === 0} onClick={() => change(ops.moveEffect, [fx.id, -1], { key: 'app.music.beat.status.s13' })}>↑</button>
        <button className={button} aria-label={t('app.music.beat.labels.l14', { p0: beatLabel(names[fx.type], t), p1: i + 1 })} disabled={i === effects.length - 1} onClick={() => change(ops.moveEffect, [fx.id, 1], { key: 'app.music.beat.status.s14' })}>↓</button>
        <button className={button} aria-label={t('app.music.beat.labels.l15', { p0: beatLabel(names[fx.type], t), p1: i + 1 })} onClick={() => change(ops.removeEffect, [fx.id], { key: 'app.music.beat.status.s15' })}>{t('app.music.beat.ui.remove')}</button>
      </div>
      {Object.entries(fx.params).map(([param, value]) => param === 'size'
        ? <RoomSize key={param} label={t('app.music.beat.labels.l16', { p0: beatLabel(names[fx.type], t), p1: i + 1 })} value={value} onChange={v => change(ops.setEffectParam, [fx.id, param, v], { key: 'app.music.beat.status.s16' })} />
        : <MixRange liveMix={effectParamLive(param)} key={param} label={t('app.music.beat.labels.l17', { p0: beatLabel(names[fx.type], t), p1: i + 1, p2: beatLabel(param, t), p3: beatLabel(units[param], t) })} value={value} min={FX_RANGES[param][0]} max={FX_RANGES[param][1]}
          step={['low', 'mid', 'high', 'threshold', 'ratio', 'drive'].includes(param) ? 1 : 0.01}
          onChange={v => change(ops.setEffectParam, [fx.id, param, v], { key: 'app.music.beat.status.s17', values: { p0: param }, display: { p0: beatLabel(param, t) } }, `${track.id}:fx:${fx.id}:${param}`)} />)}
    </li>)}</ol>
  </div>;
}
