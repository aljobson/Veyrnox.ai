'use client';

import Link from 'next/link';
import { useI18n } from '../../../../components/I18nProvider';
import { useMusicQueue } from './MusicQueue';

function Rail({ title, rows, onAdd, t }) {
  if (!rows.length) return null;
  return (
    <section className="mt-8">
      <h2 className="font-vx text-xl font-black">{title}</h2>
      <ul className="mt-3 divide-y divide-vx-border rounded-2xl border border-vx-border bg-vx-panel">
        {rows.map((row) => (
          <li key={row.slug} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link href={`/music/tracks/${row.slug}`} className="block truncate font-bold text-vx-fg underline-offset-4 hover:underline">{row.title}</Link>
              <Link href={`/music/creators/${row.handle}`} className="block truncate text-sm text-vx-fg-muted hover:underline">{row.display_name}</Link>
            </div>
            {onAdd ? <button type="button" onClick={() => onAdd(row)} className="min-h-11 shrink-0 rounded-full border border-vx-border px-4 text-sm font-bold hover:border-vx-accent">{t('music.queue.add')}</button> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Queue buttons for the current track and its two rails (0516). Renders nothing
 * while the rails switch is off (no `rails` from the route, no queue provider).
 * @param {{ track: { slug: string, title: string, display_name: string }, rails?: { by_creator: object[], similar: object[] } | null }} props
 */
export function MusicTrackRails({ track, rails }) {
  const { t } = useI18n();
  const queue = useMusicQueue();
  if (!rails && !queue) return null;
  const byCreator = rails?.by_creator || [];
  const similar = rails?.similar || [];
  return (
    <div className="mt-6">
      {queue ? (
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => queue.add(track)} className="min-h-11 rounded-full border border-vx-border px-5 text-sm font-bold hover:border-vx-accent">{t('music.queue.add')}</button>
          {similar.length ? <button type="button" onClick={() => queue.playList([track, ...similar])} className="min-h-11 rounded-full bg-vx-accent px-5 text-sm font-bold text-vx-accent-ink">{t('music.queue.radio')}</button> : null}
        </div>
      ) : null}
      <Rail title={t('music.rails.byCreator', { name: track.display_name })} rows={byCreator} onAdd={queue?.add} t={t} />
      <Rail title={t('music.rails.similar')} rows={similar} onAdd={queue?.add} t={t} />
    </div>
  );
}
