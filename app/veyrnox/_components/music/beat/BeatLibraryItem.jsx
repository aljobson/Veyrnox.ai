'use client';
import { beatLabel } from '../../../_lib/music/beat/beatLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { button } from './beatStyles';
export default function BeatLibraryItem({ item, active, audition, add, busy, compact = false }) {
  const { t } = useI18n();
  return <li className="rounded-xl border border-vx-border p-2" draggable={!busy}
    onDragStart={(event) => { event.dataTransfer.setData('application/x-beat-sound', JSON.stringify(item)); event.dataTransfer.effectAllowed = 'copy'; }}>
    <div className="flex min-w-0 items-center gap-2">
      <button className={`${button} grid min-w-11 place-items-center px-0`} aria-label={t('app.music.beat.labels.l9', { p0: active ? t('app.music.beat.ui.stop') : t('app.music.beat.ui.audition'), p1: item.name })} aria-pressed={active}
        onClick={() => audition(item)}>{active ? <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1" /></svg> : <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}</button>
      <div className="min-w-0 flex-1"><p className="break-words font-bold" title={item.name}>{item.name}</p>
        <p className="text-xs text-vx-fg-muted">{item.source === 'sound' ? t('app.music.beat.labels.l20', { p0: beatLabel(item.category, t), p1: item.bars }) : item.durationSec ? t('app.music.beat.labels.l21', { p0: Math.round(item.durationSec) }) : t('app.music.beat.ui.song.version')}</p></div>
      <button className={`${button} ${compact ? 'grid place-items-center px-0' : ''}`} title={compact ? t('app.music.beat.labels.l19', { p0: item.name }) : undefined} disabled={busy} aria-label={t('app.music.beat.labels.l19', { p0: item.name })} onClick={() => add(item)}>{compact ? <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14 M5 12h14" /></svg> : t('app.music.beat.ui.add')}</button>
    </div>
  </li>;
}
