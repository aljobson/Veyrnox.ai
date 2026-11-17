'use client';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import { button } from './beatStyles';

export default function BeatRegionActions({ region, track, movePlayhead, snap, edit, tracks = [] }) {
  const { t } = useI18n();
  const run = (change, label) => edit(change, { label, regionId: region?.id });
  return <>
    {region && <div className="flex flex-wrap gap-2">
      {[-1, 1].map(delta => <button key={delta} className={button} onClick={() => run(d => ops.moveRegion(d, region.id, region.start, tracks[Math.max(0, Math.min(tracks.length - 1, tracks.findIndex(item => item.id === track.id) + delta))]?.id || track.id), BEAT_ACTIONS.a42)}>{t(delta < 0 ? 'app.music.beat.control.previousTrack' : 'app.music.beat.control.nextTrack')}</button>)}
      <button className={button} onClick={() => run(d => ops.trimRegionStart(d, region.id, region.start - snap), BEAT_ACTIONS.a43)}>{t('app.music.beat.control.extendStart')}</button>
    </div>}
    <div className="flex flex-wrap gap-2 rounded-xl border border-vx-border bg-vx-panel p-2 lg:hidden"
    role="group" aria-label={t('app.music.beat.ui.region.actions')}>
    <button className={button} aria-label={t('app.music.beat.ui.move.playhead.left')} onClick={() => movePlayhead(-snap)}>{t('app.music.beat.ui.playhead.2')}</button>
    <button className={button} aria-label={t('app.music.beat.ui.move.playhead.right')} onClick={() => movePlayhead(snap)}>{t('app.music.beat.ui.playhead.3')}</button>
    {region && <>
      <button className={button} onClick={() => run((d) => ops.moveRegion(d, region.id,
        Math.max(0, region.start - snap), track.id), BEAT_ACTIONS.a42)}>{t('app.music.beat.ui.move')}</button>
      <button className={button} onClick={() => run((d) => ops.moveRegion(d, region.id,
        region.start + snap, track.id), BEAT_ACTIONS.a42)}>{t('app.music.beat.ui.move.2')}</button>
      <button className={button} onClick={() => run((d) => ops.resizeRegion(d, region.id, region.length - snap), BEAT_ACTIONS.a44)}>{t('app.music.beat.ui.shorter')}</button>
      <button className={button} onClick={() => run((d) => ops.resizeRegion(d, region.id, region.length + snap), BEAT_ACTIONS.a44)}>{t('app.music.beat.ui.longer')}</button>
      <button className={button} onClick={() => run((d) => ops.trimRegionStart(d, region.id, region.start + snap), BEAT_ACTIONS.a43)}>{t('app.music.beat.ui.trim.start')}</button>
    </>}
  </div></>;
}
