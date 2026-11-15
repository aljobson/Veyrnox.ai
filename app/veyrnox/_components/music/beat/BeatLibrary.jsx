'use client';
import Link from 'next/link';
import BeatInstrumentLibrary from './BeatInstrumentLibrary';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { gatewayFetch } from '../../../_lib/gateway';
import { BEAT_SOUNDS } from '../../../_lib/music/beat/beatSounds.mjs';
import { librarySongs } from '../../../_lib/music/beat/beatLibrarySongs.mjs';
import { getShelf, getServerShelf, hydrateShelf, subscribeShelf } from '../../../_lib/music/instrumentShelf';
import { prepareAsset, loadAsset } from '../../../_lib/music/beat/beatAssets';
import { createBeatEngine } from '../../../_lib/music/beat/beatEngine';
import BeatLibraryItem from './BeatLibraryItem';
import { button, input } from './beatStyles';
export default function BeatLibrary({ bpm, onAdd, onAddInstrument, announce }) {
  const [tab, setTab] = useState('Sounds'), [mine, setMine] = useState('Takes');
  const [query, setQuery] = useState(''), [category, setCategory] = useState('All');
  const [songs, setSongs] = useState([]), [status, setStatus] = useState('idle'), [retry, setRetry] = useState(0);
  const [active, setActive] = useState(null), [busy, setBusy] = useState(false), [open, setOpen] = useState(false);
  const shelf = useSyncExternalStore(subscribeShelf, getShelf, getServerShelf);
  const dialog = useRef(null), engine = useRef(null), player = useRef(null), token = useRef(0);
  useEffect(() => { void hydrateShelf(); }, []);
  useEffect(() => {
    function close() {
      token.current++; player.current?.stop(); player.current = null;
      engine.current?.close().catch(() => {}); engine.current = null;
      setActive(null);
    }
    window.addEventListener('pagehide', close);
    return () => { window.removeEventListener('pagehide', close); close(); };
  }, []);
  useEffect(() => {
    const changed = () => setRetry((n) => n + 1);
    window.addEventListener('online', changed); window.addEventListener('offline', changed); window.addEventListener('pageshow', changed);
    const unsubscribe = onSessionChange((session) => { if (session) changed(); else { setSongs([]); setStatus('expired'); } });
    return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); window.removeEventListener('pageshow', changed); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (tab !== 'Mine' || mine !== 'Songs') return;
    let live = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    window.addEventListener('pagehide', abort);
    async function read() {
      if (!navigator.onLine) { setStatus('offline'); return; }
      if (!getSession()) { setSongs([]); setStatus('signed-out'); return; }
      setStatus('loading');
      try { const result = await gatewayFetch('/music/songs?limit=50', { signal: controller.signal }); if (live) { setSongs(result.songs || []); setStatus('ready'); } }
      catch (e) { if (live) { setSongs([]); setStatus(e.status === 401 || e.code === 'account_changed' ? 'expired' : 'error'); } }
    }
    void read(); return () => { live = false; controller.abort(); window.removeEventListener('pagehide', abort); };
  }, [tab, mine, retry]);
  function signIn(event) {
    event.preventDefault(); dialog.current?.close();
    window.dispatchEvent(new CustomEvent('veyrnox:auth-required', { detail: { mode: 'sign_in', returnTo: window.location.pathname } }));
  }
  async function audition(item) {
    const request = ++token.current;
    player.current?.stop(); player.current = null;
    if (active === item.id) { setActive(null); return; }
    setActive(item.id);
    try {
      engine.current ||= createBeatEngine(); await engine.current.resume();
      if (request !== token.current) return;
      const asset = await prepareAsset(item, bpm), buffer = await loadAsset(asset, bpm);
      if (request !== token.current || !buffer) return;
      const source = engine.current.context.createBufferSource(); source.buffer = buffer;
      source.connect(engine.current.master); source.start(); player.current = source;
      source.onended = () => { source.disconnect(); if (request === token.current) { setActive(null); player.current = null; } };
    } catch (e) { if (request === token.current) { setActive(null); announce(e.message); } }
  }
  async function add(item) {
    setBusy(true);
    try { await onAdd(item); } finally { setBusy(false); }
  }
  const items = tab === 'Sounds' ? BEAT_SOUNDS.map((s) => ({ ...s, source: 'sound', ref: s.id, bpm: null }))
    : mine === 'Takes' ? shelf.map((t) => ({ id: t.id, source: 'take', ref: t.id, name: t.label, durationSec: t.seconds, bpm: null }))
      : librarySongs(songs);
  const filtered = items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()) && (tab !== 'Sounds' || category === 'All' || i.category === category));
  function contents() {
    return <div className="space-y-3">
      <h2 className="text-lg font-bold">Library</h2>
      <div className="flex gap-2" aria-label="Library tabs">{['Sounds', 'Mine', 'Instruments'].map((name) => <button key={name} className={button} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</div>
      {tab === 'Mine' && <div className="flex gap-2" aria-label="My library">{['Takes', 'Songs'].map((name) => <button key={name} className={button} aria-pressed={mine === name} onClick={() => setMine(name)}>{name}</button>)}</div>}
      <label className="block">Search by name<input className={`${input} w-full`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      {tab === 'Sounds' && <><p className="text-sm">Key: A minor</p><label>Category <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>{['All', 'Bass', 'Keys', 'Synth', 'FX'].map((c) => <option key={c}>{c}</option>)}</select></label></>}
      {tab === 'Mine' && mine === 'Songs' && <div aria-live="polite">
        {status === 'signed-out' && <p><a className="inline-flex min-h-11 items-center underline focus-visible:outline-vx-accent" href="?auth=sign_in" onClick={signIn}>Sign in to use your songs</a></p>}
        {status === 'expired' && <p>Your session expired. <a className="inline-flex min-h-11 items-center underline focus-visible:outline-vx-accent" href="?auth=sign_in" onClick={signIn}>Sign in to use your songs</a></p>}
        {status === 'offline' && <p>You are offline. Your songs need a connection. <button className={button} onClick={() => setRetry((n) => n + 1)}>Retry</button></p>}
        {status === 'error' && <p>Could not load your songs. <button className={button} onClick={() => setRetry((n) => n + 1)}>Retry</button></p>}
        {status === 'loading' && <p>Loading songs…</p>}
        {status === 'ready' && !items.length && <p>No songs yet. <Link className="underline" href="/app/music/create">Create a song</Link></p>}
      </div>}
      {tab === 'Mine' && mine === 'Takes' && !shelf.length && <p>No takes yet. <Link className="underline" href="/app/music/instruments">Open Instruments</Link></p>}
      {!filtered.length && !!items.length && <p>No sounds match &apos;{query}&apos;. <button className={button} onClick={() => { setQuery(''); setCategory('All'); }}>Clear</button> Try a shorter name or another category.</p>}
      {tab === 'Instruments' && <BeatInstrumentLibrary onAdd={onAddInstrument} announce={announce} query={query} />}
      {tab !== 'Instruments' && <ul className="max-h-[60vh] space-y-2 overflow-y-auto">{filtered.map((item) => <BeatLibraryItem key={item.id} item={item} active={active === item.id} audition={audition} add={add} busy={busy} />)}</ul>}
    </div>;
  }
  return <>
    <aside className="hidden min-w-0 rounded-xl border border-vx-border bg-vx-panel p-3 lg:block">{!open && contents()}</aside>
    <div className="lg:hidden"><button className={button} onClick={() => { setOpen(true); dialog.current.showModal(); }}>Library</button></div>
    <dialog ref={dialog} onClose={() => { token.current++; player.current?.stop(); player.current = null; setActive(null); setOpen(false); }}
      aria-label="Sound library" className="m-auto max-h-[90dvh] w-[calc(100%-1rem)] max-w-md overflow-y-auto rounded-xl border border-vx-border bg-vx-panel p-4 text-vx-fg backdrop:bg-vx-base/80">
      <button className={`${button} mb-3`} onClick={() => dialog.current.close()}>Close library</button>{open && contents()}
    </dialog>
  </>;
}
