'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { MusicPrivateAudio, useMusicAudioSrc } from '../../_lib/useMusicAudioSrc';
import { recordMusicListen } from './musicListen';

const BARS = 48;


/** A private image (cover art) through the same signed-URL route as private audio. */
export function MusicPrivateImage({ src, alt, className }) {
  const { url } = useMusicAudioSrc(src);
  if (!url) return <div aria-hidden="true" className={`grid place-items-center bg-vx-panel-raised font-vx text-xl font-black text-vx-accent ${className || ''}`}>♪</div>;
  return <img src={url} alt={alt} className={`object-cover ${className || ''}`} />;
}

function peaksFrom(buffer) {
  const data = buffer.getChannelData(0);
  const size = Math.max(1, Math.floor(data.length / BARS));
  const peaks = [];
  for (let bar = 0; bar < BARS; bar += 1) {
    let peak = 0;
    for (let index = bar * size; index < Math.min(data.length, (bar + 1) * size); index += 64) peak = Math.max(peak, Math.abs(data[index]));
    peaks.push(peak);
  }
  const top = Math.max(...peaks, 0.0001);
  return peaks.map((peak) => peak / top);
}

/** A waveform drawn only once the row scrolls into view, so a long Library does not decode every song. */
export function MusicWaveform({ src, label }) {
  const holder = useRef(null);
  const [visible, setVisible] = useState(false);
  const [peaks, setPeaks] = useState(null);
  const [failed, setFailed] = useState(false);
  const { url } = useMusicAudioSrc(visible ? src : null);

  useEffect(() => {
    const node = holder.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!url || peaks) return undefined;
    let live = true;
    const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Context) return undefined;
    fetch(url)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error('fetch'))))
      .then((bytes) => new Context(1, 1, 8000).decodeAudioData(bytes))
      .then((buffer) => { if (live) setPeaks(peaksFrom(buffer)); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [url, peaks]);

  return (
    <div ref={holder} role="img" aria-label={peaks ? `Waveform of ${label}` : `Waveform of ${label} loading`} className="mt-3 flex h-12 items-center gap-0.5 rounded-xl bg-vx-base px-2">
      {(peaks || Array.from({ length: BARS }, () => (failed ? 0.08 : 0.2))).map((peak, index) => (
        <span key={index} aria-hidden="true" className={`flex-1 rounded-full ${peaks ? 'bg-vx-accent/70' : 'bg-vx-border'}`} style={{ height: `${Math.max(8, Math.round(peak * 100))}%` }} />
      ))}
    </div>
  );
}

function useCollection(path, key, active) {
  const [items, setItems] = useState([]);
  const [state, setState] = useState('idle');
  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await gatewayFetch(path, { promptOnAuth: false });
      setItems(Array.isArray(result[key]) ? result[key] : []);
      setState('ready');
    } catch { setState('error'); }
  }, [path, key]);
  useEffect(() => {
    if (!active || state !== 'idle') return undefined;
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [active, load, state]);
  return { items, state, load, setItems };
}

function Shell({ id, title, intro, action, children }) {
  return (
    <section aria-labelledby={id} className="mt-6">
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-vx-border bg-vx-panel p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 id={id} className="font-vx text-xl font-black">{title}</h2><p className="mt-1 text-sm text-vx-fg-muted">{intro}</p></div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Failure({ what, onRetry }) {
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-vx-danger/50 bg-vx-danger/10 p-4 text-sm text-vx-danger"><span>{what} could not be loaded. Nothing was changed.</span><button type="button" onClick={onRetry} className="min-h-11 rounded-full border border-current px-4 font-bold">Retry</button></div>;
}

const Loading = ({ label }) => <div aria-busy="true" aria-label={label} className="space-y-3"><div className="vx-shimmer h-24 rounded-2xl bg-vx-panel" /><div className="vx-shimmer h-24 rounded-2xl bg-vx-panel" /></div>;

export function MusicHistoryCollection({ active }) {
  const { items, state, load } = useCollection('/music/history', 'songs', active);
  if (!active) return null;
  return (
    <Shell id="music-history-title" title="History" intro="Songs you played most recently. Only you can see this.">
      {state === 'error' ? <Failure what="History" onRetry={load} /> : null}
      {state === 'loading' || state === 'idle' ? <Loading label="Loading History" /> : null}
      {state === 'ready' && items.length === 0 ? <div className="rounded-2xl border border-dashed border-vx-border p-10"><h3 className="font-vx text-2xl font-black">Nothing played yet.</h3><p className="mt-3 text-vx-fg-muted">Play any song in your Library and it will show here.</p></div> : null}
      {state === 'ready' && items.length ? <ol className="space-y-3">{items.map((song) => (
        <li key={song.id} className="flex min-w-0 items-start gap-3 rounded-2xl border border-vx-border bg-vx-panel p-4">
          <MusicPrivateImage src={song.cover_url} alt="" className="h-14 w-14 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Link href={`/app/music/songs/${song.id}`} className="break-words font-bold text-vx-fg underline-offset-4 hover:underline">{song.title}</Link>
            <p className="mt-1 text-xs text-vx-fg-muted">Played {song.play_count} {song.play_count === 1 ? 'time' : 'times'} · last {new Date(song.last_played_at).toLocaleString()}</p>
            <MusicPrivateAudio className="mt-3 w-full" controls preload="none" src={song.audio_url} aria-label={`Play ${song.title}`} onPlay={() => recordMusicListen(song.id)} />
          </div>
        </li>
      ))}</ol> : null}
    </Shell>
  );
}

export function MusicHooksCollection({ active, songs }) {
  const { items, state, load } = useCollection('/music/hooks', 'hooks', active);
  const [songId, setSongId] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(15);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!active) return null;
  const song = songs.find((item) => item.id === songId);

  async function create(event) {
    event.preventDefault();
    if (!song || busy) return;
    setBusy('create'); setError('');
    try {
      await gatewayFetch('/music/hooks', { method: 'POST', body: JSON.stringify({ song_id: song.id, version_id: song.version_id, title: title.trim() || `${song.title} hook`, start_seconds: start, end_seconds: start + length }) });
      setTitle(''); await load();
    } catch (reason) {
      setError(reason?.code === 'hook_range_invalid' ? 'That range is past the end of the song. Choose an earlier start.'
        : reason?.code === 'limit_reached' ? 'You have 100 hooks. Delete one to save another.' : 'The hook could not be saved.');
    } finally { setBusy(''); }
  }

  async function remove(id) {
    setBusy(id); setError('');
    try { await gatewayFetch(`/music/hooks/${id}`, { method: 'DELETE' }); await load(); }
    catch { setError('The hook could not be deleted.'); }
    finally { setBusy(''); }
  }

  return (
    <Shell id="music-hooks-title" title="Hooks" intro="Short 5 to 30 second clips of your songs. Saving a hook costs nothing and does not change the song.">
      <form onSubmit={create} className="mb-4 grid gap-3 rounded-2xl border border-vx-border bg-vx-base p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm font-bold">Song<select aria-label="Song for the hook" value={songId} onChange={(event) => setSongId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 font-normal"><option value="">Choose a song</option>{songs.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label className="block text-sm font-bold">Name<input aria-label="Hook name" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="Chorus" className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 font-normal" /></label>
        <label className="block text-sm font-bold">Start (s)<input aria-label="Hook start in seconds" type="number" min="0" step="1" value={start} onChange={(event) => setStart(Math.max(0, Number(event.target.value) || 0))} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 font-normal" /></label>
        <label className="block text-sm font-bold">Length · {length}s<input aria-label="Hook length in seconds" type="range" min="5" max="30" step="1" value={length} onChange={(event) => setLength(Number(event.target.value))} className="mt-4 w-full" /></label>
        <button type="submit" disabled={!song || busy === 'create'} className="min-h-11 rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40 sm:col-span-2 lg:col-span-4">{busy === 'create' ? 'Saving…' : 'Save hook'}</button>
      </form>
      {error ? <p role="alert" className="mb-4 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
      {state === 'error' ? <Failure what="Hooks" onRetry={load} /> : null}
      {state === 'loading' || state === 'idle' ? <Loading label="Loading hooks" /> : null}
      {state === 'ready' && items.length === 0 ? <div className="rounded-2xl border border-dashed border-vx-border p-10"><h3 className="font-vx text-2xl font-black">No hooks yet.</h3><p className="mt-3 text-vx-fg-muted">Pick a song above and save its best moment.</p></div> : null}
      {state === 'ready' && items.length ? <ul className="grid gap-3 md:grid-cols-2">{items.map((hook) => (
        <li key={hook.id} className="rounded-2xl border border-vx-border bg-vx-panel p-4">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-bold text-vx-fg">{hook.title}</h3><p className="mt-1 text-xs text-vx-fg-muted">{hook.song_title} · {Number(hook.start_seconds).toFixed(0)}s–{Number(hook.end_seconds).toFixed(0)}s</p></div>
            <button type="button" onClick={() => remove(hook.id)} disabled={busy === hook.id} className="min-h-11 shrink-0 rounded-full border border-vx-border px-4 text-sm font-bold text-vx-fg-muted disabled:opacity-40">{busy === hook.id ? 'Deleting…' : 'Delete'}</button></div>
          <MusicPrivateAudio className="mt-3 w-full" controls preload="none" src={`${hook.audio_url}#t=${Number(hook.start_seconds)},${Number(hook.end_seconds)}`} aria-label={`Play hook ${hook.title}`} />
        </li>
      ))}</ul> : null}
    </Shell>
  );
}

export function MusicCoverArtCollection({ active, songs, onChanged }) {
  const { items: images, state, load } = useCollection('/music/cover-art', 'images', active);
  const [covers, setCovers] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active || state !== 'ready') return undefined;
    let live = true;
    gatewayFetch('/music/cover-art', { promptOnAuth: false })
      .then((result) => { if (live) setCovers(Object.fromEntries((result.covers || []).map((cover) => [cover.song_id, cover]))); })
      .catch(() => {});
    return () => { live = false; };
  }, [active, state]);

  if (!active) return null;

  async function choose(songId, jobId) {
    setBusy(songId); setError('');
    try {
      const result = await gatewayFetch(`/music/songs/${songId}/cover`, { method: 'PUT', body: JSON.stringify({ job_id: jobId || null }) });
      setCovers((current) => {
        const next = { ...current };
        if (result.cover_url) next[songId] = { song_id: songId, job_id: jobId, image_url: result.cover_url };
        else delete next[songId];
        return next;
      });
      onChanged?.();
    } catch { setError('The cover could not be changed. The song is unchanged.'); }
    finally { setBusy(''); }
  }

  return (
    <Shell id="music-covers-title" title="Cover Art" intro="Give each song a cover from your own finished images." action={<Link href="/app/create" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-vx-accent px-5 text-sm font-bold text-vx-accent-ink">Make new artwork</Link>}>
      <p className="mb-4 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm text-vx-fg-muted">New artwork is made in Create with any image model, at that model&apos;s usual price. Choosing a cover here is free.</p>
      {error ? <p role="alert" className="mb-4 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
      {state === 'error' ? <Failure what="Cover art" onRetry={load} /> : null}
      {state === 'loading' || state === 'idle' ? <Loading label="Loading cover art" /> : null}
      {state === 'ready' && songs.length === 0 ? <div className="rounded-2xl border border-dashed border-vx-border p-10"><h3 className="font-vx text-2xl font-black">No songs to dress yet.</h3><p className="mt-3 text-vx-fg-muted">Create a song first, then come back to give it a cover.</p></div> : null}
      {state === 'ready' && songs.length ? <ul className="grid gap-3 md:grid-cols-2">{songs.map((song) => (
        <li key={song.id} className="flex min-w-0 gap-4 rounded-2xl border border-vx-border bg-vx-panel p-4">
          <MusicPrivateImage src={covers[song.id]?.image_url} alt={`Cover of ${song.title}`} className="h-24 w-24 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <h3 className="break-words font-bold text-vx-fg">{song.title}</h3>
            {images.length ? (
              <label className="mt-2 block text-sm font-bold">Cover<select aria-label={`Cover for ${song.title}`} value={covers[song.id]?.job_id || ''} disabled={busy === song.id} onChange={(event) => choose(song.id, event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 font-normal">
                <option value="">No cover</option>
                {images.map((image, index) => <option key={image.job_id} value={image.job_id}>Image {index + 1} · {new Date(image.created_at).toLocaleDateString()}</option>)}
              </select></label>
            ) : <p className="mt-2 text-sm text-vx-fg-muted">You have no finished images yet. Use Make new artwork.</p>}
          </div>
        </li>
      ))}</ul> : null}
      {state === 'ready' && images.length ? <div className="mt-6"><h3 className="font-vx text-lg font-black">Your recent images</h3><ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">{images.map((image, index) => <li key={image.job_id}><MusicPrivateImage src={image.image_url} alt={`Image ${index + 1}`} className="aspect-square w-full rounded-xl" /></li>)}</ul></div> : null}
    </Shell>
  );
}
