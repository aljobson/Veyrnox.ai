'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getStoredUserId, onSessionChange } from '../../../lib/authClient.js';
import { getMusicDiscoverSeed } from '../../../../lib/musicDiscover.js';
import {
  MUSIC_SAVED_MIXES_CHANGED,
  readMusicSavedMixes,
} from '../../_lib/music/savedMixes.js';

const ownerNow = () => getStoredUserId() || 'signed-out';

function mixQuery(item) {
  return {
    sample: item.beatId,
    tempo: item.mix.tempo.toFixed(2),
    drums: item.mix.drums,
    bass: item.mix.bass,
    melody: item.mix.melody,
  };
}

export function SavedMusicMixes({ query = '' }) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const load = () => {
      setItems(readMusicSavedMixes(window.localStorage, ownerNow()));
      setReady(true);
    };
    load();
    const unsubscribe = onSessionChange(load);
    window.addEventListener('storage', load);
    window.addEventListener(MUSIC_SAVED_MIXES_CHANGED, load);
    return () => {
      unsubscribe?.();
      window.removeEventListener('storage', load);
      window.removeEventListener(MUSIC_SAVED_MIXES_CHANGED, load);
    };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => {
      const beat = getMusicDiscoverSeed(item.beatId);
      return `${item.name} ${beat?.title || ''} ${beat?.mood || ''}`.toLowerCase().includes(needle);
    });
  }, [items, query]);

  if (!ready) return <div aria-busy="true" aria-label="Loading saved mixes" className="space-y-3"><div className="vx-shimmer h-28 rounded-2xl bg-vx-panel"/><div className="vx-shimmer h-28 rounded-2xl bg-vx-panel"/></div>;
  if (!items.length) return (
    <div className="rounded-2xl border border-dashed border-vx-border p-10">
      <h2 className="font-vx text-2xl font-black">No saved mixes yet.</h2>
      <p className="mt-3 max-w-2xl text-vx-fg-muted">Open a sample, change its speed or layers, then save the recipe here. The original sample always stays unchanged.</p>
      <Link href="/app/music/discover" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">Explore sample beats</Link>
    </div>
  );
  if (!visible.length) return <div className="rounded-2xl border border-dashed border-vx-border p-10"><h2 className="font-vx text-2xl font-black">No saved mixes match.</h2><p className="mt-3 text-vx-fg-muted">Clear the search to see all {items.length} saved mixes.</p></div>;

  return (
    <div data-testid="music-saved-mixes" className="space-y-3">
      {visible.map((item) => {
        const beat = getMusicDiscoverSeed(item.beatId);
        if (!beat) return null;
        const queryValues = mixQuery(item);
        return (
          <article key={item.id} className="rounded-2xl border border-vx-border bg-vx-panel p-4 shadow-lg">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-vx-panel-raised sm:h-20 sm:w-20"><Image src={beat.artwork} alt="" fill sizes="80px" className="object-cover" /></div>
                <div className="min-w-0">
                  <p className="font-vx-mono text-[10px] font-bold uppercase tracking-widest text-vx-accent">Saved mix · {beat.mood}</p>
                  <h3 className="mt-1 truncate font-vx text-xl font-black text-vx-fg">{item.name}</h3>
                  <p className="mt-1 text-sm text-vx-fg-muted">{beat.title} · {Math.round(beat.bpm * item.mix.tempo)} BPM · {Math.round(item.mix.tempo * 100)}% speed</p>
                  <p className="mt-2 font-vx-mono text-[10px] text-vx-fg-faint">Drums {item.mix.drums}% · Bass {item.mix.bass}% · Melody {item.mix.melody}%</p>
                </div>
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                <Link href={{ pathname: '/app/music/discover', query: { ...queryValues, savedMix: item.id, mixName: item.name } }} className="inline-flex min-h-11 items-center justify-center rounded-full border border-vx-border px-4 text-sm font-bold text-vx-fg-body hover:border-vx-accent hover:text-vx-accent">Edit &amp; listen</Link>
                <Link href={{ pathname: '/app/music/create', query: queryValues }} className="vx-press inline-flex min-h-11 items-center justify-center rounded-full bg-vx-accent px-4 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover">Use in Create</Link>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
