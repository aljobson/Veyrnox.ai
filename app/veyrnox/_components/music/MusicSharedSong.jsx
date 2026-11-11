'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';

export function MusicSharedSong({ token }) {
  const { t } = useI18n();
  const [song, setSong] = useState(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/music/shared/${encodeURIComponent(token)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        return response.json();
      })
      .then((result) => { setSong(result.song); setState('ready'); })
      .catch((error) => { if (error.name !== 'AbortError') setState('unavailable'); });
    return () => controller.abort();
  }, [token]);

  if (state === 'loading') return <div className="mx-auto max-w-3xl px-4 py-16" aria-busy="true"><div className="vx-shimmer h-80 rounded-2xl bg-vx-panel" /></div>;
  if (!song) return <div className="mx-auto max-w-3xl px-4 py-16"><section className="rounded-2xl border border-vx-border bg-vx-panel p-8"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-danger">{t('music.shared.unavailable')}</p><h1 className="mt-3 font-vx text-4xl font-black">{t('music.shared.inactive')}</h1><p className="mt-4 text-vx-fg-body">{t('music.shared.revoked')}</p><Link href="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">{t('music.shared.visit')}</Link></section></div>;

  return <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20"><article className="overflow-hidden rounded-2xl border border-vx-border bg-vx-panel shadow-2xl"><div className="grid min-h-72 place-items-center border-b border-vx-border bg-vx-panel-raised"><span aria-hidden="true" className="font-vx text-8xl font-black text-vx-accent">♪</span></div><div className="p-6 sm:p-8"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{t('music.shared.eyebrow')}</p><h1 className="mt-3 break-words font-vx text-4xl font-black">{song.title}</h1><p className="mt-3 text-sm text-vx-fg-muted">{t('music.track.version')} {song.version_number} {t('music.shared.notIndexed')}</p><audio controls preload="metadata" src={song.audio_url} className="mt-6 w-full" aria-label={`${t('music.track.play')} ${song.title}`} /><p className="mt-6 text-xs leading-5 text-vx-fg-faint">{t('music.shared.rights')}</p></div></article></div>;
}
