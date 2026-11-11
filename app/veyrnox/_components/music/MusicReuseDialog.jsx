'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';

function friendlyError(reason) {
  if (reason?.code === 'revision_conflict') return 'Your song or Custom draft changed. Close and reopen Reuse before replacing any fields.';
  if (reason?.code === 'reuse_unavailable') return 'This version has no reusable lyrics or style direction.';
  if (reason?.code === 'model_unavailable') return 'The verified Custom draft target is currently unavailable.';
  return 'The reusable material could not be loaded or applied. Your existing Custom draft is unchanged.';
}

export function MusicReuseDialog({ song, onClose }) {
  const closeRef = useRef(null);
  const keyRef = useRef(null);
  const [context, setContext] = useState(null);
  const [reuseLyrics, setReuseLyrics] = useState(false);
  const [reuseStyles, setReuseStyles] = useState(false);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    closeRef.current?.focus();
    let active = true;
    gatewayFetch(`/music/songs/${song.id}/reuse?version_id=${encodeURIComponent(song.version_id)}`)
      .then((result) => {
        if (!active) return;
        setContext(result);
        setReuseLyrics(result.source?.has_lyrics === true);
        setReuseStyles(result.source?.has_styles === true);
      })
      .catch((reason) => { if (active) setError(friendlyError(reason)); })
      .finally(() => { if (active) setBusy(false); });
    function key(event) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', key);
    return () => { active = false; document.removeEventListener('keydown', key); };
  }, [onClose, song.id, song.version_id]);

  async function applyReuse() {
    if (busy || saved || (!reuseLyrics && !reuseStyles) || !context) return;
    setBusy(true); setError('');
    keyRef.current ||= `reuse.${crypto.randomUUID()}`;
    try {
      const result = await gatewayFetch(`/music/songs/${song.id}/reuse`, {
        method: 'POST',
        body: JSON.stringify({
          version_id: song.version_id,
          draft_revision: context.draft_revision,
          reuse_lyrics: reuseLyrics,
          reuse_styles: reuseStyles,
          idempotency_key: keyRef.current,
        }),
      });
      setSaved(result.draft);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="reuse-title" className="w-full max-w-xl rounded-3xl border border-vx-border bg-vx-panel p-6 shadow-2xl sm:p-8">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Owned material only</p><h2 id="reuse-title" className="mt-2 font-vx text-2xl font-black">Reuse from “{song.title}”</h2></div>
          <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border">×</button>
        </div>
        <p className="mt-4 text-sm leading-6 text-vx-fg-muted">Copy selected material from this exact owned version into your private Custom draft. This creates no audio, spends no credits and does not alter the source song.</p>
        {busy && !context ? <p className="mt-6 text-sm text-vx-fg-muted" aria-live="polite">Loading reusable source material…</p> : null}
        {context && !saved ? (
          <div className="mt-6 space-y-3">
            <label className="flex items-start gap-3 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm"><input type="checkbox" checked={reuseStyles} disabled={!context.source.has_styles} onChange={(event) => setReuseStyles(event.target.checked)} className="mt-1 size-4" /><span><strong className="block text-vx-fg">Reuse style direction</strong><span className="mt-1 block line-clamp-3 text-vx-fg-muted">{context.source.has_styles ? context.source.styles : 'No stored style direction on this version.'}</span></span></label>
            <label className="flex items-start gap-3 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm"><input type="checkbox" checked={reuseLyrics} disabled={!context.source.has_lyrics} onChange={(event) => setReuseLyrics(event.target.checked)} className="mt-1 size-4" /><span><strong className="block text-vx-fg">Reuse owned lyrics</strong><span className="mt-1 block text-vx-fg-muted">{context.source.has_lyrics ? `${context.source.lyrics.length} characters from the source generation.` : 'This version has no stored lyrics.'}</span></span></label>
            <p className="rounded-2xl border border-vx-border bg-vx-panel-raised p-3 text-sm text-vx-fg-muted">Only selected fields are replaced. Your current Custom title and any unselected field stay unchanged. A stale draft revision is refused instead of overwritten.</p>
            <button type="button" onClick={applyReuse} disabled={busy || (!reuseLyrics && !reuseStyles)} className="min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Applying revision-safely…' : 'Apply to private Custom draft'}</button>
          </div>
        ) : null}
        {saved ? <div className="mt-6 rounded-2xl border border-vx-accent/40 bg-vx-accent/10 p-4"><p className="font-bold text-vx-fg">Reusable material saved to Custom.</p><p className="mt-1 text-sm text-vx-fg-muted">Private draft revision {saved.revision} is ready for review. Nothing was generated or charged.</p><Link href="/app/music/create?mode=custom" className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">Open reused Custom draft</Link></div> : null}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
      </section>
    </div>
  );
}
