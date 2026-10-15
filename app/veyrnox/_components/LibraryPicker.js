'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { gatewayFetch } from '../_lib/gateway';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { jobsPagePath } from '../../../lib/jobListCursor';

// "From library": a recent finished image (or, with kind="video", video) of the
// caller's own, used without downloading and re-uploading it. The studio and
// chat send a job id as `source_assets`; the Cinema creator workspace sends it
// to /cinema/uploads/from-library. The gateway checks ownership (get_user_asset)
// and the bytes on its side, as it does an upload (lib/resolveSource.js).

// Each preview costs one asset-link request (120 a minute, 0110).
const SHOWN = 12;
const KINDS = {
  image: { prefix: 'image/', noun: 'image', plural: 'images' },
  video: { prefix: 'video/', noun: 'video', plural: 'videos' },
  audio: { prefix: 'audio/', noun: 'audio', plural: 'audio files' },
};

export function LibraryPicker({ onPick, onClose, kind = 'image', sourceLabel, mimeTypes }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const loadRef = useRef(null);
  const actor = useSyncExternalStore(onSessionChange, getStoredUserId, () => null);
  const { prefix, noun, plural } = KINDS[kind] || KINDS.image;
  const allowed = Array.isArray(mimeTypes) ? mimeTypes.join(',') : '';

  useEffect(() => {
    let cancelled = false;
    let busy = false, started = false, cursor = null;
    const queue = [];
    setItems(null); setHasMore(false); setError(false); setLoading(false);
    const load = async () => {
      if (busy || cancelled || !actor) return;
      busy = true; setLoading(true); setError(false);
      try {
        if (!started || (!queue.length && cursor)) {
          const page = await gatewayFetch(started ? jobsPagePath(cursor, 48) : '/jobs?limit=48');
          if (cancelled) return;
          if (!Array.isArray(page.jobs) || (cursor && page.next && jobsPagePath(cursor) === jobsPagePath(page.next))) throw new Error('invalid_page');
          queue.push(...page.jobs.filter((j) => j.state === 'succeeded' && j.has_asset && !j.held));
          cursor = page.next || null; started = true;
        }
        const found = [];
        let checked = 0;
        while (queue.length && found.length < SHOWN && checked++ < SHOWN * 2 && !cancelled) {
          const j = queue.shift();
          try {
            const a = await gatewayFetch(`/jobs/${j.job_id}/asset`);
            const mimeType = String(a.mime_type);
            if (mimeType.startsWith(prefix) && (!allowed || allowed.split(',').includes(mimeType))) found.push({ id: j.job_id, url: a.url, mimeType, label: j.label || `Library ${noun}` });
          } catch { /* expired or unreadable: leave it out */ }
        }
        if (!cancelled) {
          setItems((prev) => [...new Map([...(prev || []), ...found].map((item) => [item.id, item])).values()]);
          setHasMore(queue.length > 0 || !!cursor);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        busy = false;
        if (!cancelled) setLoading(false);
      }
    };
    loadRef.current = load; load();
    return () => { cancelled = true; loadRef.current = null; };
  }, [prefix, noun, allowed, actor]);

  return (
    <div role="dialog" aria-modal="true" aria-label={sourceLabel ? `Choose ${sourceLabel.toLowerCase()} from your library` : `Choose ${kind === 'video' ? 'a video' : kind === 'audio' ? 'audio' : 'an image'} from your library`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-[720px] max-h-[80dvh] overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-5"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-fg-muted">{sourceLabel ? `${sourceLabel.toUpperCase()} FROM YOUR LIBRARY` : 'FROM YOUR LIBRARY'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-vx-fg-muted hover:text-vx-fg">✕</button>
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-vx-danger">Your library could not be loaded. Try again; the images already shown are unchanged.</p>}
        {!error && items == null && <p className="mt-4 text-sm text-vx-fg-muted">Loading your {plural}…</p>}
        {items && items.length === 0 && <p className="mt-4 text-sm text-vx-fg-muted">{hasMore ? `No matching ${plural} in this page. Load older items to keep looking.` : `No finished ${plural} yet. Generate one, or upload a file.`}</p>}
        {items && items.length > 0 && (
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {items.map((it) => (
              <button key={it.id} type="button" onClick={() => onPick(it)} title={it.label}
                className="aspect-square overflow-hidden rounded-lg border border-vx-border hover:border-vx-accent focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent">
                {kind === 'video'
                  ? <video src={it.url} muted playsInline preload="metadata" aria-label={it.label} className="h-full w-full object-cover" />
                  : kind === 'audio' ? <span className="p-2 text-xs">♫ {it.label}</span> : <img src={it.url} alt={it.label} className="h-full w-full object-cover" />}
              </button>
            ))}
          </div>
        )}
        {(hasMore || error) && <button type="button" disabled={loading} aria-busy={loading} onClick={() => loadRef.current?.()}
          className="mt-4 rounded-full border border-vx-border px-4 py-2 text-sm font-bold text-vx-fg hover:border-vx-accent disabled:opacity-50">
          {loading ? 'Loading older…' : error ? 'Retry Library' : `Load older ${plural}`}
        </button>}
      </div>
    </div>
  );
}
