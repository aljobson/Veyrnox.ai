'use client';

import Link from 'next/link';
import { MusicAudioPlayer } from './MusicAudioPlayer';
import { useMusicPreviewState } from './useMusicPreviewState';

export function MusicSongDetail({ id }) {
  const { state, find } = useMusicPreviewState();
  const song = find(id);

  if (!state) return <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6" aria-busy="true"><div className="vx-shimmer h-96 rounded-3xl bg-vx-panel" /></div>;
  if (!song) return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <section className="rounded-3xl border border-vx-border bg-vx-panel p-8"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-danger">Not found</p><h1 className="mt-3 font-vx text-4xl font-black">This version is not in this browser.</h1><p className="mt-4 text-vx-fg-body">Preview songs are local to the browser that created them.</p><Link href="/app/music/library" className="mt-6 inline-flex min-h-12 items-center rounded-full bg-vx-accent px-6 font-extrabold text-vx-accent-ink">Open Music Library</Link></section>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/app/music/library" className="text-sm font-bold text-vx-fg-muted underline-offset-4 hover:text-vx-fg hover:underline">← Music Library</Link>
      <article className="mt-6 overflow-hidden rounded-3xl border border-vx-border bg-vx-panel shadow-2xl">
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-2">
          <div className="grid min-h-72 place-items-center rounded-3xl border border-vx-border bg-vx-panel-raised">
            <div className="text-center"><span aria-hidden="true" className="font-vx text-8xl font-black text-vx-accent">{song.label}</span><p className="mt-3 font-vx-mono text-xs uppercase tracking-widest text-vx-fg-muted">Private version</p></div>
          </div>
          <div className="min-w-0 self-center">
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-vx-accent/15 px-3 py-1 text-xs font-bold text-vx-accent">Ready</span><span className="text-xs text-vx-fg-muted">Version {song.label}</span></div>
            <h1 className="mt-4 break-words font-vx text-4xl font-black tracking-tight sm:text-5xl">{song.title}</h1>
            <p className="mt-4 break-words leading-7 text-vx-fg-body">{song.prompt}</p>
            {song.styles ? <p className="mt-3 text-sm text-vx-fg-muted"><strong className="text-vx-fg-body">Style:</strong> {song.styles}</p> : null}
            <dl className="mt-6 grid grid-cols-2 gap-3 text-sm"><div className="rounded-2xl bg-vx-base p-3"><dt className="text-vx-fg-muted">Duration</dt><dd className="mt-1 font-vx-mono text-vx-fg">0:{song.duration}</dd></div><div className="rounded-2xl bg-vx-base p-3"><dt className="text-vx-fg-muted">Charge</dt><dd className="mt-1 font-vx-mono text-vx-money">5 credits</dd></div></dl>
          </div>
        </div>
        <div className="border-t border-vx-border p-6 sm:p-8"><MusicAudioPlayer songId={song.id} title={`${song.title}, version ${song.label}`} /></div>
      </article>
    </div>
  );
}
