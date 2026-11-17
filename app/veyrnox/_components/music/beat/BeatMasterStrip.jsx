'use client';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { masterPatchLive } from '../../../_lib/music/beat/beatMixControls.mjs';
import { DEFAULT_MASTER } from '../../../_lib/music/beat/beatMixRules.mjs';
import { setMaster } from '../../../_lib/music/beat/beatMixOps.mjs';
import { MixRange, RoomSize } from './BeatMixControl';
import BeatMeter from './BeatMeter';
import { button } from './beatStyles';
export default function BeatMasterStrip({ doc, edit, engine }) {
  const { t } = useI18n();
  const master = doc.master || DEFAULT_MASTER;
  const change = (patch, key) => edit(d => setMaster(d, patch), { label: BEAT_ACTIONS.a18, key: `master:${key}`, liveMix: masterPatchLive(doc, patch) });
  return <section aria-label={t('app.music.beat.ui.master.channel')} className="w-64 max-w-full shrink-0 space-y-3 rounded-xl border border-vx-border bg-vx-panel p-3">
    <h3 className="font-bold">{t('app.music.beat.ui.master')}</h3><BeatMeter engine={engine} trackId="master" name="Master" />
    <MixRange liveMix={!!doc.master} vertical label={t('app.music.beat.labels.l22')} value={master.gain} onChange={gain => change({ gain }, 'gain')} />
    <button className={button} aria-pressed={master.limiter} onClick={() => change({ limiter: !master.limiter }, 'limiter')}>{t('app.music.beat.ui.limiter')}</button>
    <RoomSize label={t('app.music.beat.labels.l23')} value={master.reverb.size} onChange={size => change({ reverb: { size } }, 'reverb')} />
    <MixRange liveMix={!!doc.master} label={t('app.music.beat.labels.l24')} value={master.delay.time} min={0.02} onChange={time => change({ delay: { time } }, 'delay:time')} />
    <MixRange liveMix={!!doc.master} label={t('app.music.beat.labels.l25')} value={master.delay.feedback} max={0.8} onChange={feedback => change({ delay: { feedback } }, 'delay:feedback')} />
  </section>;
}
