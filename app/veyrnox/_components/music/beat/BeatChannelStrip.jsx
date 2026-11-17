'use client';
import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { beatLabel } from '../../../_lib/music/beat/beatLabels.mjs';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { automationControl, sendLevelLive } from '../../../_lib/music/beat/beatMixControls.mjs';
import * as mix from '../../../_lib/music/beat/beatMixOps.mjs';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import BeatEffectRack from './BeatEffectRack';
import BeatMeter from './BeatMeter';
import { MixRange } from './BeatMixControl';
import { button, input } from './beatStyles';
const channelActions = [['Mute', 'mute', ops.setTrackMute], ['Solo', 'solo', ops.setTrackSolo]], buses = ['reverb', 'delay'];
export default function BeatChannelStrip({ doc, track, edit, engine, onAutomation, recording = false }) {
  const { t } = useI18n();
  const gain = automationControl(track, 'gain', doc.view, recording), pan = automationControl(track, 'pan', doc.view, recording);
  function change(op, value, label, key) { edit(d => op(d, track.id, value), { label, key: `${track.id}:${key}`, liveMix: true }); }
  return <section aria-label={t('app.music.beat.labels.l6', { p0: track.name })} className="w-64 max-w-full shrink-0 space-y-3 rounded-xl border border-vx-border bg-vx-panel p-3">
    <h3 className="break-words font-bold">{track.name}</h3><BeatMeter engine={engine} trackId={track.id} name={track.name} />
    <MixRange liveMix vertical label={t('app.music.beat.labels.l7', { p0: track.name })} value={track.gain} disabled={gain.disabled} disabledMessage={tOr(t, 'app.music.beat.control.gainHelp', gain.message)}
      onChange={v => change(ops.setTrackGain, v, BEAT_ACTIONS.a57, 'gain')} />
    <MixRange liveMix label={t('app.music.beat.labels.l8', { p0: track.name })} min={-1} value={track.pan} disabled={pan.disabled} disabledMessage={tOr(t, 'app.music.beat.control.panHelp', pan.message)}
      onChange={v => change(ops.setTrackPan, v, BEAT_ACTIONS.a58, 'pan')} />
    <div className="flex gap-2">{channelActions.map(([name, key, op]) =>
      <button data-beat-live key={key} className={button} aria-label={t('app.music.beat.labels.l9', { p0: beatLabel(name, t), p1: track.name })} aria-pressed={track[key]} onClick={() => change(op, !track[key], `${name} ${track.name}`, key)}>{beatLabel(name, t)}</button>)}</div>
    {buses.map(bus => <MixRange liveMix={track.sends?.[bus] > 0} key={bus} label={t('app.music.beat.labels.l10', { p0: track.name, p1: beatLabel(bus, t) })} value={track.sends?.[bus] || 0}
      onChange={v => edit(d => mix.setSend(d, track.id, bus, v), { label: BEAT_ACTIONS.a14, key: `${track.id}:send:${bus}`, liveMix: sendLevelLive(track, bus, v) })} />)}
    <label className="text-xs">{t('app.music.beat.ui.automation')}<select className={`${input} w-full`} value="" onChange={e => onAutomation(track.id, e.target.value)}>
      <option value="">{t('app.music.beat.ui.show.lane')}</option><option value="gain">{t('app.music.beat.ui.gain')}</option><option value="pan">{t('app.music.beat.ui.pan')}</option>
    </select></label>
    <BeatEffectRack track={track} edit={edit} />
  </section>;
}
