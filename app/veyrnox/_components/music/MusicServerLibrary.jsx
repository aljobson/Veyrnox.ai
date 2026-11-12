'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { MusicSongActions } from './MusicSongActions';
import { SavedMusicMixes } from './SavedMusicMixes';
import { MusicWorkspaceCollaboration } from './MusicWorkspaceCollaboration';
import { useMusicLibraryState } from './useMusicLibraryState';

function ServerSongRow({ song, checked, onToggle, onFeedback, onTrash, busy }) {
  return (
    <article className="rounded-2xl border border-vx-border bg-vx-panel p-4 shadow-lg">
      <div className="flex min-w-0 items-start gap-3">
        <input type="checkbox" checked={checked} onChange={() => onToggle(song.id)} aria-label={`Select ${song.title}`} className="mt-3 h-5 w-5 shrink-0 accent-vx-accent" />
        <div aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-vx-border bg-vx-panel-raised font-vx text-xl font-black text-vx-accent">♪</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/app/music/songs/${song.id}`} className="break-words font-bold text-vx-fg underline-offset-4 hover:underline">{song.title}</Link>
            <span className="rounded-full bg-vx-accent/15 px-2 py-1 text-xs font-bold text-vx-accent">Ready</span>
            <span className="rounded-full border border-vx-border px-2 py-1 text-xs text-vx-fg-muted">Private</span>
            <MusicSongActions songId={song.id} title={song.title} />
          </div>
          <p className="mt-2 text-sm text-vx-fg-muted">{song.workspace_name}</p>
          {song.audio_url ? <audio className="mt-3 w-full" controls preload="none" src={song.audio_url} aria-label={`Play ${song.title}`} /> : null}
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Feedback for ${song.title}`}>
            <button type="button" aria-pressed={song.feedback === 'like'} onClick={() => onFeedback(song.id, song.feedback === 'like' ? null : 'like')} className={`min-h-10 rounded-full border px-4 text-sm font-bold ${song.feedback === 'like' ? 'border-vx-accent bg-vx-accent/15 text-vx-accent' : 'border-vx-border text-vx-fg-body'}`}>Like</button>
            <button type="button" aria-pressed={song.feedback === 'dislike'} onClick={() => onFeedback(song.id, song.feedback === 'dislike' ? null : 'dislike')} className={`min-h-10 rounded-full border px-4 text-sm font-bold ${song.feedback === 'dislike' ? 'border-vx-danger bg-vx-danger/10 text-vx-danger' : 'border-vx-border text-vx-fg-body'}`}>Dislike</button>
            <button type="button" onClick={() => onTrash(song)} disabled={busy} className="min-h-10 rounded-full border border-vx-border px-4 text-sm font-bold text-vx-fg-muted disabled:opacity-40">Move to Trash</button>
          </div>
        </div>
      </div>
    </article>
  );
}

function TrashedSongRow({ song, onRestore, busy }) {
  return (
    <article className="rounded-2xl border border-vx-border bg-vx-panel p-4 shadow-lg">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-bold text-vx-fg">{song.title}</h3><span className="rounded-full border border-vx-border px-2 py-1 text-xs text-vx-fg-muted">Trash</span></div><p className="mt-2 text-sm text-vx-fg-muted">{song.workspace_name} · original audio retained privately</p></div>
        <button type="button" onClick={() => onRestore(song)} disabled={busy} className="min-h-11 shrink-0 rounded-full bg-vx-accent px-5 text-sm font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Restoring…' : 'Restore'}</button>
      </div>
    </article>
  );
}

function sourceDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function sourceSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  return value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(value / 1024))} KB`;
}

function MusicUploadsCollection({ active }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await gatewayFetch('/music/sources', { promptOnAuth: false });
      setSources(Array.isArray(result.sources) ? result.sources : []);
      setLoaded(true);
    } catch (reason) {
      setError(reason?.code === 'sources_not_open'
        ? 'Owned uploads are not enabled in this environment.'
        : 'Owned uploads could not be loaded. Your private files were not changed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active || loaded || loading) return undefined;
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [active, load, loaded, loading]);

  if (!active) return null;
  return (
    <section aria-labelledby="music-uploads-title" className="mt-6">
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-vx-border bg-vx-panel p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="music-uploads-title" className="font-vx text-xl font-black">Owned uploads</h2>
          <p className="mt-1 text-sm text-vx-fg-muted">Private source recordings you verified for use in Create.</p>
        </div>
        <Link href="/app/music/create" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-vx-accent px-5 text-sm font-bold text-vx-accent-ink">Add in Create</Link>
      </div>
      <div className="mb-4 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm text-vx-fg-muted">
        Stems are not available yet. These are original uploaded files, not separated vocal or instrumental tracks.
      </div>
      {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-vx-danger/50 bg-vx-danger/10 p-4 text-sm text-vx-danger"><span>{error}</span><button type="button" onClick={load} className="min-h-10 rounded-full border border-current px-4 font-bold">Retry uploads</button></div> : null}
      {loading ? <div aria-busy="true" aria-label="Loading owned uploads" className="space-y-3"><div className="vx-shimmer h-32 rounded-2xl bg-vx-panel"/><div className="vx-shimmer h-32 rounded-2xl bg-vx-panel"/></div> : null}
      {!loading && !error && loaded && sources.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-vx-border p-10"><h3 className="font-vx text-2xl font-black">No verified uploads yet.</h3><p className="mt-3 text-vx-fg-muted">Add an owned MP3, WAV, or microphone recording in Create. Rights confirmation and server-side inspection happen before it appears here.</p></div>
      ) : null}
      {!loading && !error && sources.length ? <div data-testid="music-upload-items" className="grid gap-3 md:grid-cols-2">{sources.map((source) => (
        <article key={source.id} className="min-w-0 rounded-2xl border border-vx-border bg-vx-panel p-4 shadow-lg">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-bold text-vx-fg">{source.filename}</h3><p className="mt-1 text-xs text-vx-fg-muted">{sourceDuration(source.duration_seconds)} · {sourceSize(source.size_bytes)} · rights verified</p></div><span className="rounded-full bg-vx-accent/15 px-2 py-1 text-xs font-bold text-vx-accent">Private</span></div>
          {source.preview_url ? <audio className="mt-4 w-full" controls preload="none" src={source.preview_url} aria-label={`Play owned upload ${source.filename}`} /> : <p className="mt-4 text-xs text-vx-fg-muted">Preview is temporarily unavailable.</p>}
          <p className="mt-3 text-xs text-vx-fg-muted">Original {source.mime_type === 'audio/wav' ? 'WAV' : 'MP3'} · immutable rights record</p>
        </article>
      ))}</div> : null}
    </section>
  );
}

export function MusicServerLibrary({ workspaceView = false, sourcesEnabled = false, collaborationEnabled = false }) {
  const library = useMusicLibraryState();
  const [query, setQuery] = useState('');
  const [workspaceId, setWorkspaceId] = useState(workspaceView ? '' : 'all');
  const [newName, setNewName] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [collection, setCollection] = useState('all');
  const [view, setView] = useState('list');

  const activeWorkspaceId = workspaceView && !workspaceId
    ? library.workspaces[0]?.id || ''
    : workspaceId;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const candidates = collection === 'trash' ? library.trashedSongs : library.songs;
    return candidates.filter((song) => {
      const inWorkspace = activeWorkspaceId === 'all' || !activeWorkspaceId || song.workspace_id === activeWorkspaceId;
      const inCollection = collection !== 'liked' || song.feedback === 'like';
      return (collection === 'trash' || inWorkspace) && inCollection && (!needle || song.title.toLowerCase().includes(needle));
    });
  }, [activeWorkspaceId, collection, library.songs, library.trashedSongs, query]);
  const allVisibleSelected = visible.length > 0 && visible.every((song) => library.selectedIds.includes(song.id));
  const selectedWorkspace = library.workspaces.find((workspace) => workspace.id === activeWorkspaceId);

  async function create(event) {
    event.preventDefault();
    const created = await library.createWorkspace(newName.trim());
    if (!created) return;
    setNewName('');
    setWorkspaceId(created.id);
  }

  async function move(event) {
    event.preventDefault();
    if (await library.moveSelected(destinationId)) setDestinationId('');
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Private server Library</p>
          <h1 className="mt-2 font-vx text-4xl font-black tracking-tight sm:text-5xl">{workspaceView ? 'Personal workspaces' : 'Music Library'}</h1>
          <p className="mt-3 max-w-2xl text-vx-fg-body">{workspaceView ? 'Group owned versions without changing their audio or visibility.' : 'Find, play and organize every completed private version.'}</p>
        </div>
        <p className="font-vx-mono text-sm text-vx-fg-muted">{library.songs.length} owned {library.songs.length === 1 ? 'version' : 'versions'}</p>
      </header>

      {library.error ? <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-vx-danger/50 bg-vx-danger/10 px-4 py-3 text-sm text-vx-danger"><span>{library.error}</span><button type="button" onClick={library.load} className="min-h-10 rounded-full border border-current px-4 font-bold">Reload Library</button></div> : null}

      {!['uploads', 'trash', 'mixes'].includes(collection) ? <section aria-label="Private workspaces" className="mt-8 rounded-2xl border border-vx-border bg-vx-panel p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="font-vx text-xl font-black">Choose a workspace</h2>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by workspace">
              {!workspaceView ? <button type="button" aria-pressed={activeWorkspaceId === 'all'} onClick={() => setWorkspaceId('all')} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-bold ${activeWorkspaceId === 'all' ? 'bg-vx-fg text-vx-base' : 'border border-vx-border text-vx-fg-body'}`}>All versions</button> : null}
              {library.workspaces.map((workspace) => <button key={workspace.id} type="button" aria-pressed={activeWorkspaceId === workspace.id} onClick={() => setWorkspaceId(workspace.id)} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-bold ${activeWorkspaceId === workspace.id ? 'bg-vx-fg text-vx-base' : 'border border-vx-border text-vx-fg-body'}`}>{workspace.name} · {workspace.song_count}</button>)}
            </div>
          </div>
          <form onSubmit={create} className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-md">
            <label className="sr-only" htmlFor="music-workspace-name">New workspace name</label>
            <input id="music-workspace-name" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={80} placeholder="New private workspace" className="min-h-11 min-w-0 flex-1 rounded-xl border border-vx-border-boost bg-vx-base px-4 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" />
            <button type="submit" disabled={!newName.trim() || library.busy === 'creating'} className="min-h-11 rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40">{library.busy === 'creating' ? 'Creating…' : 'Create workspace'}</button>
          </form>
        </div>
      </section> : null}

      <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-vx-border bg-vx-panel p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold text-vx-fg">{collection === 'uploads' ? 'Owned source recordings' : collection === 'trash' ? 'Recently removed versions' : collection === 'mixes' ? 'Saved sample mixes' : selectedWorkspace?.name || 'All private versions'}</p>
          <p className="text-xs text-vx-fg-muted">{collection === 'uploads' ? 'Original files only' : collection === 'mixes' ? 'Editable speed and layer recipes' : `${visible.length} shown`}</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:justify-end">
          <div role="group" aria-label="Library collection" className="flex rounded-full border border-vx-border bg-vx-base p-1 text-sm font-bold">
            <button type="button" aria-pressed={collection === 'all'} onClick={() => setCollection('all')} className={`rounded-full px-3 py-2 ${collection === 'all' ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted'}`}>All</button>
            <button type="button" aria-pressed={collection === 'liked'} onClick={() => setCollection('liked')} className={`rounded-full px-3 py-2 ${collection === 'liked' ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted'}`}>Liked</button>
            <button type="button" aria-pressed={collection === 'mixes'} onClick={() => setCollection('mixes')} className={`rounded-full px-3 py-2 ${collection === 'mixes' ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted'}`}>Saved mixes</button>
            {sourcesEnabled ? <button type="button" aria-pressed={collection === 'uploads'} onClick={() => setCollection('uploads')} className={`rounded-full px-3 py-2 ${collection === 'uploads' ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted'}`}>Uploads</button> : null}
            <button type="button" aria-pressed={collection === 'trash'} onClick={() => { setCollection('trash'); if (!library.trashLoaded) library.loadTrash(); }} className={`rounded-full px-3 py-2 ${collection === 'trash' ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted'}`}>Trash</button>
          </div>
          {!['uploads', 'mixes'].includes(collection) ? <div role="group" aria-label="Library view" className="flex rounded-full border border-vx-border bg-vx-base p-1 text-sm font-bold">
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`rounded-full px-3 py-2 ${view === 'list' ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted'}`}>List</button>
            <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')} className={`rounded-full px-3 py-2 ${view === 'grid' ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted'}`}>Grid</button>
          </div> : null}
          {collection !== 'uploads' ? <><label className="sr-only" htmlFor="server-music-library-search">Search Music Library</label><input id="server-music-library-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={collection === 'mixes' ? 'Search saved mixes' : 'Search owned titles'} className="min-h-11 w-full rounded-xl border border-vx-border-boost bg-vx-base px-4 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none sm:max-w-xs" /></> : null}
        </div>
      </div>

      {!['uploads', 'trash', 'mixes'].includes(collection) && library.selectedSongs.length ? (
        <form onSubmit={move} className="mt-4 flex flex-col gap-3 rounded-2xl border border-vx-accent/50 bg-vx-accent/10 p-4 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-sm font-bold text-vx-fg-body">Move {library.selectedSongs.length} selected {library.selectedSongs.length === 1 ? 'version' : 'versions'} to
            <select value={destinationId} onChange={(event) => setDestinationId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border-boost bg-vx-base px-4 text-vx-fg focus:border-vx-accent focus:outline-none">
              <option value="">Choose destination</option>
              {library.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={!destinationId || library.busy === 'moving'} className="min-h-11 rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40">{library.busy === 'moving' ? 'Moving atomically…' : 'Move selected'}</button>
        </form>
      ) : null}

      {sourcesEnabled ? <MusicUploadsCollection active={collection === 'uploads'} /> : null}

      {collection === 'mixes' ? <section aria-label="Saved sample mixes" className="mt-6"><SavedMusicMixes query={query} /></section> : null}

      {collection === 'trash' ? <div className="mt-6 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm text-vx-fg-muted">Restore is available immediately. Permanent deletion remains unavailable while private asset cleanup is being validated.</div> : null}

      {workspaceView && collaborationEnabled ? <MusicWorkspaceCollaboration /> : null}

      {!['uploads', 'mixes'].includes(collection) ? <section aria-label={collection === 'trash' ? 'Trashed music versions' : 'Owned music versions'} className="mt-6">
        {collection === 'trash' && library.trashLoading ? (
          <div aria-busy="true" className="space-y-3"><div className="vx-shimmer h-24 rounded-2xl bg-vx-panel"/><div className="vx-shimmer h-24 rounded-2xl bg-vx-panel"/></div>
        ) : library.loading ? (
          <div aria-busy="true" className="space-y-3"><div className="vx-shimmer h-28 rounded-2xl bg-vx-panel"/><div className="vx-shimmer h-28 rounded-2xl bg-vx-panel"/></div>
        ) : collection === 'trash' && visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-vx-border p-10"><h2 className="font-vx text-2xl font-black">Trash is empty.</h2><p className="mt-3 text-vx-fg-muted">Versions moved here can be restored. Permanent deletion remains unavailable while private asset cleanup is being validated.</p></div>
        ) : collection !== 'trash' && library.songs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-vx-border p-10"><h2 className="font-vx text-2xl font-black">No completed private versions yet.</h2><p className="mt-3 text-vx-fg-muted">Create an instrumental pair and completed versions will appear here.</p><Link href="/app/music/create" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">Open Create</Link></div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-vx-border p-10"><h2 className="font-vx text-2xl font-black">Nothing matches this private view.</h2><p className="mt-3 text-vx-fg-muted">Clear the search or choose another workspace.</p></div>
        ) : (
          <>
            {collection !== 'trash' ? <label className="mb-3 flex min-h-10 items-center gap-3 text-sm font-bold text-vx-fg-body"><input type="checkbox" checked={allVisibleSelected} onChange={() => library.selectVisible(visible.map((song) => song.id))} className="h-5 w-5 accent-vx-accent" />Select all shown</label> : null}
            <div data-testid="music-library-items" data-view={view} className={view === 'grid' ? 'grid gap-3 md:grid-cols-2' : 'space-y-3'}>{collection === 'trash' ? visible.map((song) => <TrashedSongRow key={song.id} song={song} onRestore={(item) => library.setSongLifecycle(item, 'restore')} busy={library.busy === `restore:${song.id}`} />) : visible.map((song) => <ServerSongRow key={song.id} song={song} checked={library.selectedIds.includes(song.id)} onToggle={library.toggle} onFeedback={library.setFeedback} onTrash={(item) => library.setSongLifecycle(item, 'trash')} busy={library.busy === `trash:${song.id}`} />)}</div>
          </>
        )}
      </section> : null}
    </div>
  );
}
