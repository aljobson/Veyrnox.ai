'use client';

import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';

const key = () => `publish.${globalThis.crypto.randomUUID()}`;

export function MusicPublicationDialog({ song, onClose }) {
  const rootRef = useRef(null);
  const closeRef = useRef(null);
  const attemptRef = useRef(null);
  const [publication, setPublication] = useState(null);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [comments, setComments] = useState(false);
  const [remixes, setRemixes] = useState(false);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    closeRef.current?.focus();
    const load = window.setTimeout(async () => {
      try {
        const result = await gatewayFetch(`/music/songs/${song.id}/publication`, { promptOnAuth: false });
        if (result.publication) {
          setPublication(result.publication);
          setHandle(result.publication.handle || '');
          setDisplayName(result.publication.display_name || '');
          setComments(Boolean(result.publication.allow_comments));
          setRemixes(Boolean(result.publication.allow_remixes));
        }
      } catch (reason) {
        if (reason?.code !== 'not_found') setError('Publication status could not be loaded.');
      }
    }, 0);
    function keyboard(event) {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = [...(rootRef.current?.querySelectorAll('a[href],button:not([disabled]),input:not([disabled])') || [])];
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    }
    document.addEventListener('keydown', keyboard);
    return () => { window.clearTimeout(load); document.removeEventListener('keydown', keyboard); };
  }, [onClose, song.id]);

  async function publish() {
    if (!rights || busy) return;
    setBusy(true); setError(''); setNotice('');
    const idempotencyKey = attemptRef.current || key();
    attemptRef.current = idempotencyKey;
    try {
      const result = await gatewayFetch(`/music/songs/${song.id}/publication`, {
        method: 'POST', body: JSON.stringify({
          version_id: song.version_id,
          handle,
          display_name: displayName,
          allow_comments: comments,
          allow_remixes: remixes,
          rights_confirmed: true,
          idempotency_key: idempotencyKey,
        }),
      });
      attemptRef.current = null;
      setPublication(result.publication);
      setNotice('Published. You can unpublish immediately without affecting the private original.');
    } catch (reason) {
      const messages = {
        handle_taken: 'That creator handle is already in use.',
        publication_not_allowed: 'This track did not pass the independent publication policy check.',
        rights_confirmation_required: 'Confirm publication permission before continuing.',
      };
      setError(messages[reason?.code] || 'Publication could not be completed. The track remains private.');
    } finally { setBusy(false); }
  }

  async function unpublish() {
    setBusy(true); setError(''); setNotice('');
    try {
      await gatewayFetch(`/music/songs/${song.id}/publication`, {
        method: 'DELETE', body: JSON.stringify({ idempotency_key: key() }),
      });
      setPublication((current) => ({ ...current, status: 'unpublished' }));
      setNotice('Unpublished. The public track and profile listing now fail closed.');
    } catch { setError('The track could not be unpublished.'); }
    finally { setBusy(false); }
  }

  const live = publication?.status === 'published';
  return <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={rootRef} role="dialog" aria-modal="true" aria-labelledby="publish-title" className="w-full max-w-xl rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-2xl sm:p-8">
      <div className="flex items-start gap-4"><div className="min-w-0 flex-1"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Public release</p><h2 id="publish-title" className="mt-2 break-words font-vx text-2xl font-black">Publish “{song.title}”</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border font-bold">×</button></div>
      {live ? <div className="mt-6 space-y-4"><p className="text-sm leading-6 text-vx-fg-body">This immutable version is publicly listed on <strong>{publication.display_name}</strong>’s creator profile.</p><div className="flex flex-wrap gap-3"><a href={publication.url} className="inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">Open public track</a><a href={publication.profile_url} className="inline-flex min-h-11 items-center rounded-full border border-vx-border px-5 font-bold">Open creator profile</a><button type="button" disabled={busy} onClick={unpublish} className="min-h-11 rounded-full border border-vx-danger/50 px-5 font-bold text-vx-danger">Unpublish</button></div><div className="rounded-2xl border border-vx-border bg-vx-base p-4 text-sm"><strong>Commercial-use status</strong><p className="mt-1 text-vx-fg-muted">{publication.commercial_status === 'plan_eligible_terms_apply' ? 'Plan eligible · applicable terms and third-party rights still apply.' : 'Personal use only on the current entitlement.'}</p></div></div> : <div className="mt-6 space-y-4">
        <p className="text-sm leading-6 text-vx-fg-muted">Publication is separate from private sharing. It runs policy checks, records a rights declaration and creates a revocable public profile listing.</p>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">Creator handle<input aria-label="Creator handle" value={handle} onChange={(event) => setHandle(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} maxLength={30} placeholder="your_name" className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3" /></label><label className="text-sm font-bold">Display name<input aria-label="Creator display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3" /></label></div>
        <fieldset><legend className="text-sm font-bold">Public permissions</legend><div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="flex min-h-11 items-center gap-3 rounded-xl border border-vx-border px-3 text-sm"><input type="checkbox" checked={comments} onChange={(event) => setComments(event.target.checked)} /> Allow comments</label><label className="flex min-h-11 items-center gap-3 rounded-xl border border-vx-border px-3 text-sm"><input type="checkbox" checked={remixes} onChange={(event) => setRemixes(event.target.checked)} /> Allow remixes</label></div></fieldset>
        <label className="flex items-start gap-3 rounded-2xl border border-vx-accent/30 bg-vx-accent/5 p-4 text-xs leading-5"><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} className="mt-1" /><span>I have permission to publish this recording and composition, accept the Music terms, and understand that a plan badge does not clear third-party rights.</span></label>
        <button type="button" onClick={publish} disabled={busy || !rights || !/^[a-z][a-z0-9_]{2,29}$/.test(handle) || !displayName.trim()} className="min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Publishing…' : 'Publish current immutable version'}</button>
      </div>}
      {error ? <p role="alert" className="mt-4 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}{notice ? <p role="status" className="mt-4 rounded-xl border border-vx-accent/30 bg-vx-accent/10 p-3 text-sm">{notice}</p> : null}
    </section>
  </div>;
}
