'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { tOr } from '../../../../lib/i18n/translate.mjs';

/**
 * Explore "Best of <genre>" playlists (0535): published tracks only, most
 * reactions first. The route answers 404 while the switch is off, and then
 * nothing renders.
 */
export function MusicBestOf() {
  const { t } = useI18n();
  const [playlists, setPlaylists] = useState(null);
  useEffect(() => {
    let live = true;
    fetch('/api/music/best-of', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => { if (live) setPlaylists(Array.isArray(result?.playlists) ? result.playlists : []); })
      .catch(() => { if (live) setPlaylists([]); });
    return () => { live = false; };
  }, []);
  if (!playlists?.length) return null;
  return (
    <section aria-label={tOr(t, 'music.bestOf.eyebrow', 'Best of')} className="mt-10 space-y-8">
      {playlists.map((playlist) => {
        const genre = tOr(t, `music.bestOf.genre.${playlist.genre}`, playlist.genre);
        const id = `best-of-${playlist.genre}`;
        return (
          <section key={playlist.genre} aria-labelledby={id}>
            <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{tOr(t, 'music.bestOf.eyebrow', 'Best of')}</p>
            <h2 id={id} className="mt-1 font-vx text-3xl font-black">{tOr(t, 'music.bestOf.eyebrow', 'Best of')} {genre}</h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {playlist.tracks.map((track, index) => (
                <li key={track.slug}>
                  <Link href={`/music/tracks/${track.slug}`} className="flex min-h-11 items-center gap-3 rounded-2xl border border-vx-border bg-vx-panel p-3 hover:border-vx-border-boost">
                    <span aria-hidden="true" className="font-vx-mono text-sm text-vx-fg-muted">{index + 1}</span>
                    <span className="min-w-0"><span className="block truncate font-bold text-vx-fg">{track.title}</span><span className="block truncate text-xs text-vx-fg-muted">{track.display_name}</span></span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </section>
  );
}
