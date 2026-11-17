'use client';
import { beatLabel } from '../../../_lib/music/beat/beatLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { button } from './beatStyles';
export default function BeatLibraryItem({ item, active, audition, add, busy }) {
  const { t } = useI18n();
  return <li className="rounded-xl border border-vx-border p-2" draggable={!busy}
    onDragStart={(event) => { event.dataTransfer.setData('application/x-beat-sound', JSON.stringify(item)); event.dataTransfer.effectAllowed = 'copy'; }}>
    <div className="flex min-w-0 items-center gap-2">
      <button className={`${button} min-w-11`} aria-label={t('app.music.beat.labels.l9', { p0: active ? t('app.music.beat.ui.stop') : t('app.music.beat.ui.audition'), p1: item.name })} aria-pressed={active}
        onClick={() => audition(item)}>{active ? '■' : '▶'}</button>
      <div className="min-w-0 flex-1"><p className="break-words font-bold" title={item.name}>{item.name}</p>
        <p className="text-xs text-vx-fg-muted">{item.source === 'sound' ? t('app.music.beat.labels.l20', { p0: beatLabel(item.category, t), p1: item.bars }) : item.durationSec ? t('app.music.beat.labels.l21', { p0: Math.round(item.durationSec) }) : t('app.music.beat.ui.song.version')}</p></div>
      <button className={button} disabled={busy} aria-label={t('app.music.beat.labels.l19', { p0: item.name })} onClick={() => add(item)}>{t('app.music.beat.ui.add')}</button>
    </div>
  </li>;
}
