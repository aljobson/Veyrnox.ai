'use client';
import { beatLabel } from '../../../_lib/music/beat/beatLabels.mjs';
import { beatErrorMessage } from '../../../_lib/music/beat/beatErrors.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import Link from 'next/link';
import BeatLibraryEmpty from './BeatLibraryEmpty';
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
const tabs = ['Sounds', 'Mine', 'Instruments'], shelves = ['Takes', 'Songs'], categories = ['All', 'Bass', 'Keys', 'Synth', 'FX'];
export default function BeatLibrary({ generate, bpm, onAdd, onAddInstrument, announce }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('Sounds'), [mine, setMine] = useState('Takes');
  const [query, setQuery] = useState(''), [category, setCategory] = useState('All');
  const [songs, setSongs] = useState([]), [status, setLoadState] = useState('idle'), [retry, setRetry] = useState(0);
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
    const unsubscribe = onSessionChange((session) => { if (session) changed(); else { setSongs([]); setLoadState('expired'); } });
    return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); window.removeEventListener('pageshow', changed); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (tab !== 'Mine' || mine !== 'Songs') return;
    let live = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    window.addEventListener('pagehide', abort);
    async function read() {
      if (!navigator.onLine) { setLoadState('offline'); return; }
      if (!getSession()) { setSongs([]); setLoadState('signed-out'); return; }
      setLoadState('loading');
      try { const result = await gatewayFetch('/music/songs?limit=50', { signal: controller.signal }); if (live) { setSongs(result.songs || []); setLoadState('ready'); } }
      catch (e) { if (live) { setSongs([]); setLoadState(e.status === 401 || e.code === 'account_changed' ? 'expired' : 'error'); } }
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
    } catch (e) { if (request === token.current) { setActive(null); announce(beatErrorMessage(e, 'playback', t)); } }
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
      <h2 className="text-lg font-bold">{t('app.music.beat.ui.library')}</h2>
      <div className="flex flex-wrap gap-2" aria-label={t('app.music.beat.ui.library.tabs')}>{tabs.map((name) => <button data-beat-tip="library" key={name} className={button} aria-pressed={tab === name} onClick={() => setTab(name)}>{beatLabel(name, t)}</button>)}</div>
      {tab === 'Mine' && <div className="flex flex-wrap gap-2" aria-label={t('app.music.beat.ui.my.library')}>{shelves.map((name) => <button key={name} className={button} aria-pressed={mine === name} onClick={() => setMine(name)}>{beatLabel(name, t)}</button>)}</div>}
      <label className="block">{t('app.music.beat.ui.search.by.name')}<input className={`${input} w-full`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      {tab === 'Sounds' && <><p className="text-sm">{t('app.music.beat.ui.key.a.minor')}</p><label>{t('app.music.beat.ui.category')}<select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c} value={c}>{beatLabel(c, t)}</option>)}</select></label></>}
      {tab === 'Mine' && mine === 'Songs' && <div aria-live="polite">
        {status === 'signed-out' && <p><a className="inline-flex min-h-11 items-center underline focus-visible:outline-vx-accent" href="?auth=sign_in" onClick={signIn}>{t('app.music.beat.ui.sign.in.to.use.your.songs')}</a></p>}
        {status === 'expired' && <p>{t('app.music.beat.ui.your.session.expired')}<a className="inline-flex min-h-11 items-center underline focus-visible:outline-vx-accent" href="?auth=sign_in" onClick={signIn}>{t('app.music.beat.ui.sign.in.to.use.your.songs')}</a></p>}
        {status === 'offline' && <p>{t('app.music.beat.ui.you.are.offline.your.songs.need.a.connection')}<button className={button} onClick={() => setRetry((n) => n + 1)}>{t('app.music.beat.ui.retry')}</button></p>}
        {status === 'error' && <p>{t('app.music.beat.ui.could.not.load.your.songs')}<button className={button} onClick={() => setRetry((n) => n + 1)}>{t('app.music.beat.ui.retry')}</button></p>}
        {status === 'loading' && <p>{t('app.music.beat.ui.loading.songs')}</p>}
        {status === 'ready' && !items.length && <p>{t('app.music.beat.ui.no.songs.yet')}<Link className="underline" href="/app/music/create">{t('app.music.beat.ui.create.a.song')}</Link></p>}
      </div>}
      {tab === 'Mine' && mine === 'Takes' && !shelf.length && <p>{t('app.music.beat.ui.no.takes.yet')}<Link className="underline" href="/app/music/instruments">{t('app.music.beat.ui.open.instruments')}</Link></p>}
      {!filtered.length && !!items.length && <BeatLibraryEmpty query={query} clear={() => { setQuery(''); setCategory('All'); }}
        chooseCategory={category => { setTab('Sounds'); setCategory(category); setQuery(''); }} generate={generate ? () => { dialog.current?.close(); generate(); } : undefined} />}
      {tab === 'Instruments' && <BeatInstrumentLibrary onAdd={onAddInstrument} announce={announce} query={query} />}
      {tab !== 'Instruments' && <ul className="max-h-[60vh] space-y-2 overflow-y-auto">{filtered.map((item) => <BeatLibraryItem key={item.id} item={item} active={active === item.id} audition={audition} add={add} busy={busy} />)}</ul>}
    </div>;
  }
  return <>
    <aside className="hidden min-w-0 rounded-xl border border-vx-border bg-vx-panel p-3 lg:block">{!open && contents()}</aside>
    <div className="lg:hidden"><button data-beat-tip="library" className={button} onClick={() => { setOpen(true); dialog.current.showModal(); }}>{t('app.music.beat.ui.library')}</button></div>
    <dialog ref={dialog} onClose={() => { token.current++; player.current?.stop(); player.current = null; setActive(null); setOpen(false); }}
      aria-label={t('app.music.beat.ui.sound.library')} className="m-auto max-h-[90dvh] w-[calc(100%-1rem)] max-w-md overflow-y-auto rounded-xl border border-vx-border bg-vx-panel p-4 text-vx-fg backdrop:bg-vx-base/80">
      <button className={`${button} mb-3`} onClick={() => dialog.current.close()}>{t('app.music.beat.ui.close.library')}</button>{open && contents()}
    </dialog>
  </>;
}
