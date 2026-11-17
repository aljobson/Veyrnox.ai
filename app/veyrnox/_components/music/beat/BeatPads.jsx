'use client';
import { useI18n } from '../../../../../components/I18nProvider';

import { DRUM_PADS } from '../../../../../lib/musicInstruments.js';
import { button } from './beatStyles';
export default function BeatPads({ hit, record, setRecord }) {
  const { t } = useI18n();
  return <section aria-label={t('app.music.beat.ui.drum.pads')} className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">{t('app.music.beat.ui.play.the.pads')}</h2><button className={`${button} ${record ? 'bg-vx-accent text-vx-accent-ink' : ''}`} aria-pressed={record} onClick={() => setRecord(!record)}>{t('app.music.beat.ui.record.2')}{record ? t('app.music.beat.ui.on') : t('app.music.beat.ui.off')}</button></div>
    <div className="grid grid-cols-4 gap-2 md:grid-cols-8">{DRUM_PADS.map((pad) => <button key={pad.id} className={`${button} min-h-20 bg-vx-panel active:bg-vx-accent/20`} onPointerDown={(e) => { if (e.button === 0) hit(pad.id); }} onClick={(e) => { if (e.detail === 0) hit(pad.id); }}><span className="block">{pad.label}</span><kbd className="text-xs text-vx-fg-muted">{pad.key}</kbd></button>)}</div>
    <p className="text-sm text-vx-fg-muted">{t('app.music.beat.ui.record.adds.pad.hits.to.the.nearest.step.while.playing')}</p>
  </section>;
}
