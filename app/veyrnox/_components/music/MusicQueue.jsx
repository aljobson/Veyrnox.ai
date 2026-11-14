'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';

// A listening queue for public Music tracks that keeps playing across pages
// (song page parity slice 2). It lives in the Veyrnox layout, so client-side
// navigation keeps the same <audio>. The queue is this tab's only (sessionStorage);
// nothing is stored on the server. Off unless the rails switch is on.

const QueueContext = createContext(null);
const STORAGE_KEY = 'veyrnox_music_queue_v1';
const SLUG_RE = /^[a-f0-9]{24}$/;
const MAX = 50;

const clean = (track) => (track && SLUG_RE.test(track.slug || '')
  ? { slug: track.slug, title: String(track.title || '').slice(0, 120), display_name: String(track.display_name || '').slice(0, 80) }
  : null);

function readStored() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    const queue = Array.isArray(saved?.queue) ? saved.queue.map(clean).filter(Boolean).slice(0, MAX) : [];
    const index = Number.isInteger(saved?.index) && saved.index >= 0 && saved.index < queue.length ? saved.index : 0;
    return { queue, index };
  } catch {
    return { queue: [], index: 0 };
  }
}

/** @param {{ enabled: boolean, children: import('react').ReactNode }} props */
export function MusicQueueProvider({ enabled, children }) {
  const [state, setState] = useState({ queue: [], index: 0, playing: false });

  useEffect(() => {
    if (!enabled) return;
    const stored = readStored();
    if (stored.queue.length) setState({ ...stored, playing: false });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ queue: state.queue, index: state.index })); } catch { /* private mode */ }
  }, [enabled, state.queue, state.index]);

  const add = useCallback((track) => setState((s) => {
    const item = clean(track);
    if (!item || s.queue.some((q) => q.slug === item.slug) || s.queue.length >= MAX) return s;
    return { ...s, queue: [...s.queue, item] };
  }), []);
  const playList = useCallback((tracks) => setState(() => {
    const seen = new Set();
    const queue = tracks.map(clean).filter((t) => t && !seen.has(t.slug) && seen.add(t.slug)).slice(0, MAX);
    return { queue, index: 0, playing: queue.length > 0 };
  }), []);
  const go = useCallback((delta) => setState((s) => {
    const index = s.index + delta;
    return index >= 0 && index < s.queue.length ? { ...s, index, playing: true } : { ...s, playing: false };
  }), []);
  const clear = useCallback(() => setState({ queue: [], index: 0, playing: false }), []);
  const setPlaying = useCallback((playing) => setState((s) => ({ ...s, playing })), []);

  const value = useMemo(() => ({ enabled, ...state, add, playList, go, clear, setPlaying }), [enabled, state, add, playList, go, clear, setPlaying]);
  return <QueueContext.Provider value={value}>{children}{enabled ? <MusicPlayerBar /> : null}</QueueContext.Provider>;
}

/** The queue, or null outside the provider or while the switch is off. */
export function useMusicQueue() {
  const value = useContext(QueueContext);
  return value?.enabled ? value : null;
}

function MusicPlayerBar() {
  const { t } = useI18n();
  const q = useContext(QueueContext);
  const audioRef = useRef(null);
  const current = q.queue[q.index];

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (q.playing) audio.play().catch(() => q.setPlaying(false));
    else audio.pause();
  }, [current, q.playing, q]);

  if (!current) return null;
  return (
    <div role="region" aria-label={t('music.queue.label')} className="fixed inset-x-0 bottom-0 z-[70] border-t border-vx-border bg-vx-panel/95 px-4 py-3 shadow-2xl backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <div className="min-w-0 flex-1">
          <a href={`/music/tracks/${current.slug}`} className="block truncate font-bold text-vx-fg underline-offset-4 hover:underline">{current.title}</a>
          <p className="truncate text-xs text-vx-fg-muted">{current.display_name} · {t('music.queue.position', { position: q.index + 1, total: q.queue.length })}</p>
        </div>
        <button type="button" onClick={() => q.go(-1)} disabled={q.index === 0} aria-label={t('music.queue.previous')} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border disabled:opacity-40">⏮</button>
        <button type="button" onClick={() => q.setPlaying(!q.playing)} aria-label={q.playing ? t('music.queue.pause') : t('music.queue.play')} className="grid min-h-11 min-w-11 place-items-center rounded-full bg-vx-accent font-bold text-vx-accent-ink">{q.playing ? '❚❚' : '▶'}</button>
        <button type="button" onClick={() => q.go(1)} disabled={q.index >= q.queue.length - 1} aria-label={t('music.queue.next')} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border disabled:opacity-40">⏭</button>
        <button type="button" onClick={q.clear} aria-label={t('music.queue.close')} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border">×</button>
        <audio ref={audioRef} src={`/api/music/public/${current.slug}/asset`} preload="metadata" onEnded={() => q.go(1)} onPause={() => q.setPlaying(false)} onPlay={() => q.setPlaying(true)} className="hidden" />
      </div>
    </div>
  );
}
