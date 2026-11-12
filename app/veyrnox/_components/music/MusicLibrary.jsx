'use client';

import { useMemo, useState } from 'react';
import { MusicCandidateCard } from './MusicCandidateCard';
import { SavedMusicMixes } from './SavedMusicMixes';
import { useMusicPreviewState } from './useMusicPreviewState';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'mixes', label: 'Saved mixes' },
];

export function MusicLibrary() {
  const { state, rows, storageError } = useMusicPreviewState();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const visible = useMemo(() => rows.filter((song) => {
    const matchesQuery = `${song.title} ${song.prompt} ${song.styles}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesFilter = filter === 'all'
      || (filter === 'ready' && song.status === 'ready')
      || (filter === 'in-progress' && ['queued', 'composing', 'mastering'].includes(song.status))
      || (filter === 'refunded' && song.refunded);
    return matchesQuery && matchesFilter;
  }), [filter, query, rows]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Persistent in this browser</p><h1 className="mt-2 font-vx text-4xl font-black tracking-tight sm:text-5xl">Music Library</h1><p className="mt-3 text-vx-fg-body">Every candidate remains traceable to its original request and charge.</p></div>
        <p className="font-vx-mono text-sm text-vx-money">{state?.credits ?? '—'} preview credits</p>
      </div>

      <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-vx-border bg-vx-panel p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Filter music library">
          {FILTERS.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-bold ${filter === item.value ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted hover:bg-vx-panel-raised hover:text-vx-fg'}`}>{item.label}</button>)}
        </div>
        <label className="sr-only" htmlFor="music-library-search">Search Music Library</label>
        <input id="music-library-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles and directions" className="min-h-11 w-full rounded-xl border border-vx-border-boost bg-vx-base px-4 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none sm:max-w-xs" />
      </div>

      {storageError && <div role="alert" className="mt-5 rounded-2xl border border-vx-danger/50 bg-vx-danger/10 px-4 py-3 text-sm text-vx-danger">{storageError}</div>}

      {filter === 'mixes' ? <section aria-label="Saved sample mixes" className="mt-6"><SavedMusicMixes query={query} /></section> : <section aria-label="Music versions" className="mt-6">
        {!state ? (
          <div aria-busy="true" className="space-y-3"><div className="vx-shimmer h-24 rounded-2xl bg-vx-panel"/><div className="vx-shimmer h-24 rounded-2xl bg-vx-panel"/></div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-vx-border p-10"><h2 className="font-vx text-2xl font-black">No private versions yet.</h2><p className="mt-3 text-vx-fg-muted">Create a pair and both candidates will be stored here, including failures and refunds.</p></div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-vx-border p-10"><h2 className="font-vx text-2xl font-black">Nothing matches this view.</h2><p className="mt-3 text-vx-fg-muted">Clear the search or choose another status.</p></div>
        ) : (
          <div className="space-y-3">{visible.map((song) => <MusicCandidateCard key={song.id} song={song} library />)}</div>
        )}
      </section>}
    </div>
  );
}
