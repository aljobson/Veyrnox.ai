'use client';
import { useEffect, useState } from 'react';
import { gatewayFetch } from '../_lib/gateway';

// "From library": a recent finished image of the caller's own, used as a
// start image without downloading and re-uploading it. The studio sends its
// job id as `source_assets`; the gateway checks ownership (get_user_asset)
// and the bytes, as it does an upload (lib/resolveSource.js).

// Each preview costs one asset-link request (120 a minute, 0110).
const SHOWN = 12;

export function LibraryPicker({ onPick, onClose }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await gatewayFetch('/jobs?limit=48');
        const done = (page.jobs || []).filter((j) => j.state === 'succeeded' && j.has_asset).slice(0, SHOWN * 2);
        const found = [];
        for (const j of done) {
          if (found.length >= SHOWN || cancelled) break;
          try {
            const a = await gatewayFetch(`/jobs/${j.job_id}/asset`);
            if (String(a.mime_type).startsWith('image/')) found.push({ id: j.job_id, url: a.url, label: j.label || 'Library image' });
          } catch { /* expired or unreadable: leave it out */ }
        }
        if (!cancelled) setItems(found);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label="Choose an image from your library"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-[720px] max-h-[80dvh] overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-5"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-fg-muted">FROM YOUR LIBRARY</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-vx-fg-muted hover:text-vx-fg">✕</button>
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-vx-danger">Your library could not be loaded. Upload a file instead.</p>}
        {!error && items == null && <p className="mt-4 text-sm text-vx-fg-muted">Loading your images…</p>}
        {items && items.length === 0 && <p className="mt-4 text-sm text-vx-fg-muted">No finished images yet. Generate one, or upload a file.</p>}
        {items && items.length > 0 && (
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {items.map((it) => (
              <button key={it.id} type="button" onClick={() => onPick(it)} title={it.label}
                className="aspect-square overflow-hidden rounded-lg border border-vx-border hover:border-vx-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent">
                {/* eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, not optimisable */}
                <img src={it.url} alt={it.label} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
