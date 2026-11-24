'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { getStoredUserId, onSessionChange } from '../../../lib/authClient.js';
import { AUDIO_QUEUE_KEY, audioQueueEntryKey, canPersistAudioQueue, cleanAudioQueueEntry, permittedAudioQueue, privateOwnedAssetPath, publicAudioQueueEntry, readAudioQueue, writeAudioQueue } from '../../_lib/audioQueueStorage.mjs';
import { MusicPrivateAudio } from '../../_lib/useMusicAudioSrc';

const QueueContext = createContext(null);
const currentAccount = () => getStoredUserId() || '';
const serverAccount = () => '';

/** @param {{ publicEnabled?: boolean, ownedEnabled?: boolean, enabled?: boolean, children: import('react').ReactNode }} props */
export function MusicQueueProvider({ publicEnabled: publicFlag, ownedEnabled = false, enabled, children }) {
  const publicEnabled = publicFlag ?? Boolean(enabled);
  const accountId = useSyncExternalStore(onSessionChange, currentAccount, serverAccount);
  const [state, setState] = useState({ version: 2, owner: '', queue: [], index: 0, playing: false });
  const liveOwner = useRef(accountId); liveOwner.current = accountId;
  const loaded = useRef(false);
  const hiddenPublic = useRef([]);

  const load = useCallback(() => {
    const stored = readAudioQueue(window.localStorage, window.sessionStorage, accountId);
    const permitted = permittedAudioQueue(stored, { publicEnabled, ownedEnabled, owner: accountId });
    hiddenPublic.current = publicEnabled ? [] : stored.queue.filter((entry) => entry.type === 'public_slug');
    const needsOwnedPurge = Boolean(stored.owner) || stored.queue.some((entry) => entry.type === 'owned_asset' && (!ownedEnabled || stored.owner !== accountId));
    if (canPersistAudioQueue(true, publicEnabled, ownedEnabled) || needsOwnedPurge) {
      writeAudioQueue(window.localStorage, accountId, { ...permitted, queue: [...permitted.queue, ...hiddenPublic.current] });
    }
    loaded.current = true;
    setState({ ...permitted, playing: false });
  }, [accountId, publicEnabled, ownedEnabled]);

  useEffect(() => {
    loaded.current = false;
    const timer = window.setTimeout(load, 0);
    const storage = (event) => { if (event.key === AUDIO_QUEUE_KEY) load(); };
    window.addEventListener('storage', storage);
    return () => { window.clearTimeout(timer); window.removeEventListener('storage', storage); };
  }, [load, publicEnabled, ownedEnabled]);

  useEffect(() => {
    if (!canPersistAudioQueue(loaded.current, publicEnabled, ownedEnabled)) return;
    const owner = liveOwner.current;
    const permitted = permittedAudioQueue(state, { publicEnabled, ownedEnabled, owner });
    writeAudioQueue(window.localStorage, owner, { ...permitted, queue: [...permitted.queue, ...hiddenPublic.current] });
  }, [accountId, publicEnabled, ownedEnabled, state.owner, state.queue, state.index]);

  const addEntry = useCallback((raw, start = false) => setState((current) => {
    const item = cleanAudioQueueEntry(raw);
    if (!item || (item.type === 'public_slug' ? !publicEnabled : !ownedEnabled || !liveOwner.current)) return current;
    const base = current.owner === liveOwner.current ? current : { ...current, owner: liveOwner.current, queue: current.queue.filter((entry) => entry.type === 'public_slug'), index: 0, playing: false };
    const key = audioQueueEntryKey(item);
    const found = base.queue.findIndex((entry) => audioQueueEntryKey(entry) === key);
    if (found >= 0) return start ? { ...base, index: found, playing: true } : base;
    if (base.queue.length >= 50) return base;
    const queue = [...base.queue, item];
    return { ...base, queue, ...(start ? { index: queue.length - 1, playing: true } : {}) };
  }), [publicEnabled, ownedEnabled]);
  const addPublic = useCallback((track) => addEntry(publicAudioQueueEntry(track)), [addEntry]);
  const addOwned = useCallback((track) => addEntry({ type: 'owned_asset', ...track }), [addEntry]);
  const playOwned = useCallback((track) => addEntry({ type: 'owned_asset', ...track }, true), [addEntry]);
  const playList = useCallback((tracks) => setState(() => {
    if (!publicEnabled) return { version: 2, owner: liveOwner.current, queue: [], index: 0, playing: false };
    const seen = new Set();
    const queue = tracks.map(publicAudioQueueEntry).filter((item) => item && !seen.has(item.slug) && seen.add(item.slug)).slice(0, 50);
    return { version: 2, owner: '', queue, index: 0, playing: queue.length > 0 };
  }), [publicEnabled]);
  const go = useCallback((delta) => setState((current) => {
    const index = current.index + delta;
    return index >= 0 && index < current.queue.length ? { ...current, index, playing: true } : { ...current, playing: false };
  }), []);
  const clear = useCallback(() => setState({ version: 2, owner: liveOwner.current, queue: [], index: 0, playing: false }), []);
  const setPlaying = useCallback((playing) => setState((current) => ({ ...current, playing })), []);
  const visibleState = useMemo(() => state.owner && state.owner !== accountId
    ? { ...state, owner: '', queue: state.queue.filter((entry) => entry.type === 'public_slug'), index: 0, playing: false }
    : state, [accountId, state]);
  const value = useMemo(() => ({ enabled: publicEnabled || ownedEnabled, publicEnabled, ownedEnabled, ...visibleState,
    add: addPublic, addPublic, addOwned, playOwned, playList, go, clear, setPlaying }),
  [publicEnabled, ownedEnabled, visibleState, addPublic, addOwned, playOwned, playList, go, clear, setPlaying]);
  return <QueueContext.Provider value={value}>{children}{value.enabled ? <MusicPlayerBar key={accountId} /> : null}</QueueContext.Provider>;
}

export function useMusicQueue() {
  const value = useContext(QueueContext);
  return value?.enabled ? value : null;
}

function MusicPlayerBar() {
  const { t } = useI18n();
  const q = useContext(QueueContext);
  const audioRef = useRef(null);
  const resumePosition = useRef(null);
  const current = q.queue[q.index];
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (!q.playing) { audio.pause(); return; }
    const play = () => {
      if (resumePosition.current !== null) {
        try { audio.currentTime = resumePosition.current; } catch { /* metadata may not be ready yet */ }
        resumePosition.current = null;
      }
      audio.play().catch((error) => { if (error?.name !== 'AbortError' && audio.currentSrc) q.setPlaying(false); });
    };
    if (audio.readyState >= 2) play();
    else { audio.addEventListener('canplay', play, { once: true }); return () => audio.removeEventListener('canplay', play); }
  }, [current, q.playing, q.setPlaying]);
  if (!current) return null;
  const publicTrack = current.type === 'public_slug';
  const href = publicTrack ? `/music/tracks/${current.slug}` : current.song_id ? `/app/music/${current.song_id}` : null;
  const src = publicTrack ? `/api/music/public/${current.slug}/asset` : privateOwnedAssetPath(current);
  return <div role="region" aria-label={t('music.queue.label')} data-testid="persistent-audio-queue" className="fixed inset-x-0 bottom-0 z-[70] border-t border-vx-border bg-vx-panel/95 px-4 py-3 shadow-2xl backdrop-blur">
    <div className="mx-auto flex max-w-5xl items-center gap-3">
      <div className="min-w-0 flex-1">{href ? <a href={href} className="block truncate font-bold text-vx-fg hover:underline">{current.title}</a> : <p className="truncate font-bold text-vx-fg">{current.title}</p>}
        <p aria-live="polite" className="truncate text-xs text-vx-fg-muted">{publicTrack ? current.display_name : 'Your audio'} · {t('music.queue.position', { position: q.index + 1, total: q.queue.length })}</p></div>
      <button type="button" onClick={() => q.go(-1)} disabled={q.index === 0} aria-label={t('music.queue.previous')} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border disabled:opacity-40">⏮</button>
      <button type="button" onClick={() => q.setPlaying(!q.playing)} aria-label={q.playing ? t('music.queue.pause') : t('music.queue.play')} className="grid min-h-11 min-w-11 place-items-center rounded-full bg-vx-accent font-bold text-vx-accent-ink">{q.playing ? '❚❚' : '▶'}</button>
      <button type="button" onClick={() => q.go(1)} disabled={q.index >= q.queue.length - 1} aria-label={t('music.queue.next')} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border disabled:opacity-40">⏭</button>
      <button type="button" onClick={q.clear} aria-label={t('music.queue.close')} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border">×</button>
      <MusicPrivateAudio ref={audioRef} src={src} preload="metadata" onEnded={() => q.go(1)}
        onError={() => { resumePosition.current = audioRef.current?.currentTime || 0; }}
        onPause={() => { if (resumePosition.current === null) q.setPlaying(false); }} onPlay={() => q.setPlaying(true)} className="hidden" />
    </div>
  </div>;
}
