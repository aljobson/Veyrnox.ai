'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Main } from '../Main';

export function MusicSharedSong({ token }) {
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

  if (state === 'loading') return <Main className="mx-auto max-w-3xl px-4 py-16" aria-busy="true"><div className="vx-shimmer h-80 rounded-3xl bg-vx-panel" /></Main>;
  if (!song) return <Main className="mx-auto max-w-3xl px-4 py-16"><section className="rounded-3xl border border-vx-border bg-vx-panel p-8"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-danger">Private link unavailable</p><h1 className="mt-3 font-vx text-4xl font-black">This listening link is no longer active.</h1><p className="mt-4 text-vx-fg-body">It may have been revoked. Ask the owner for a new private link.</p><Link href="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">Visit Veyrnox</Link></section></Main>;

  return <Main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20"><article className="overflow-hidden rounded-3xl border border-vx-border bg-vx-panel shadow-2xl"><div className="grid min-h-72 place-items-center border-b border-vx-border bg-vx-panel-raised"><span aria-hidden="true" className="font-vx text-8xl font-black text-vx-accent">♪</span></div><div className="p-6 sm:p-8"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Private listening link</p><h1 className="mt-3 break-words font-vx text-4xl font-black">{song.title}</h1><p className="mt-3 text-sm text-vx-fg-muted">Version {song.version_number} · not indexed or published</p><audio controls preload="metadata" src={song.audio_url} className="mt-6 w-full" aria-label={`Play ${song.title}`} /><p className="mt-6 text-xs leading-5 text-vx-fg-faint">This link allows listening only. It does not grant remix, download, ownership, or publication rights.</p></div></article></Main>;
}
