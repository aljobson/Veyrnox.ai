'use client';

import Link from 'next/link';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { LAB_GENRES, spinGenre } from '../../_lib/music/labs.mjs';

const MusicLabsRank = dynamic(() => import('./MusicLabsRank').then((module) => module.MusicLabsRank), { ssr: false });

/**
 * Labs (Suno parity S-U3): small experiments that cost nothing to try. The genre
 * wheel only opens Create with a starting idea; Create still shows the price
 * before anything is charged.
 */
export function MusicLabs({ beatsEnabled = false, rankingEnabled = false }) {
  const [pick, setPick] = useState(null);

  function spin() {
    setPick(spinGenre());
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Labs</p>
      <h1 className="mt-2 font-vx text-4xl font-black tracking-tight sm:text-5xl">Try something new</h1>
      <p className="mt-3 max-w-2xl text-vx-fg-body">Small experiments. Nothing here spends credits.</p>

      <section aria-labelledby="genre-wheel-title" className="mt-8 rounded-2xl border border-vx-border bg-vx-panel p-6 sm:p-8">
        <h2 id="genre-wheel-title" className="font-vx text-2xl font-black">Genre wheel</h2>
        <p className="mt-2 text-sm text-vx-fg-muted">Spin for one of {LAB_GENRES.length} genres and a starting idea, then shape it in Create. You see the price there before anything is made.</p>
        <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row">
          <div aria-hidden="true" className="grid h-40 w-40 shrink-0 place-items-center rounded-full border-4 border-vx-accent/60 bg-vx-base">
            <span className="font-vx text-5xl font-black text-vx-accent">♪</span>
          </div>
          <div className="min-w-0 flex-1" aria-live="polite">
            {pick ? (
              <>
                <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-fg-muted">{pick.genre}</p>
                <p className="mt-1 break-words font-vx text-3xl font-black">{pick.seed.title}</p>
                <p className="mt-2 text-sm text-vx-fg-muted">{pick.seed.bpm} BPM · {pick.seed.musicalKey}</p>
              </>
            ) : <p className="text-vx-fg-muted">Press Spin to get a genre.</p>}
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={spin} className="min-h-11 rounded-full border border-vx-border px-5 font-bold">{pick ? 'Spin again' : 'Spin'}</button>
              {pick ? <Link href={`/app/music/create?sample=${encodeURIComponent(pick.seed.id)}`} className="inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">Open in Create</Link> : null}
            </div>
          </div>
        </div>
      </section>

      {rankingEnabled ? <MusicLabsRank /> : null}

      {beatsEnabled ? (
        <section aria-labelledby="sequencer-title" className="mt-6 rounded-2xl border border-vx-border bg-vx-panel p-6 sm:p-8">
          <h2 id="sequencer-title" className="font-vx text-2xl font-black">Step sequencer</h2>
          <p className="mt-2 text-sm text-vx-fg-muted">Program a drum pattern on a grid and play it back. It runs in your browser and costs nothing.</p>
          <a href="/app/music/beats" className="mt-4 inline-flex min-h-11 items-center rounded-full border border-vx-border px-5 font-bold">Open Beats</a>
        </section>
      ) : null}
    </div>
  );
}
