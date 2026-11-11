'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getSession, getStoredUserId, onSessionChange } from '../../../lib/authClient';
import { gatewayFetch } from '../../_lib/gateway';

const PROVIDER_LABELS = Object.freeze({ youtube: 'YouTube', soundcloud: 'SoundCloud' });
const REFERENCE_UNAVAILABLE_CODES = new Set(['references_not_configured', 'references_not_open']);

function safeEmbedUrl(reference) {
  try {
    const url = new URL(reference.embed_url);
    const expectedHost = reference.provider === 'youtube' ? 'www.youtube-nocookie.com' : 'w.soundcloud.com';
    const pathAllowed = reference.provider === 'youtube'
      ? url.pathname.startsWith('/embed/')
      : url.pathname === '/player/';
    return url.protocol === 'https:' && url.hostname === expectedHost && pathAllowed ? url.toString() : '';
  } catch {
    return '';
  }
}

function errorCopy(code) {
  const messages = {
    already_saved: 'That track is already in your reference library.',
    account_not_found: 'Your Music account is not ready yet. Refresh the page and try again.',
    idempotency_conflict: 'This save attempt no longer matches the track form. Edit the link and try again.',
    rate_limited: 'Too many changes at once. Wait a moment, then try again.',
    reference_metadata_invalid: 'The provider did not return usable public track details.',
    reference_not_embeddable: 'That track is private or does not allow embedded playback.',
    reference_not_found: 'That public track could not be found or embedded.',
    reference_provider_not_supported: 'Paste a public YouTube or SoundCloud track link.',
    reference_rights_invalid: 'Choose how you are allowed to use this track.',
    reference_upstream_timeout: 'The provider took too long to respond. Try again.',
    reference_upstream_rate_limited: 'The provider is receiving too many requests. Try again shortly.',
    reference_upstream_unavailable: 'The provider is temporarily unavailable. Try again.',
    reference_url_invalid: 'Paste a standard public YouTube video or SoundCloud track link.',
    rights_confirmation_required: 'Confirm that you own or license both the recording and composition.',
    reference_limit_reached: 'Your reference shelf is full. Remove a link before adding another.',
  };
  return messages[code] || 'The track could not be added. Nothing was downloaded.';
}

function removeErrorCopy(code) {
  return code === 'rate_limited'
    ? 'Too many changes at once. Wait a moment, then try removing it again.'
    : 'The reference could not be removed. Try again.';
}

function ReferenceArtwork({ reference }) {
  if (reference.thumbnail_url) {
    return (
      // Provider-hosted artwork is deliberately not passed through Next Image:
      // Veyrnox must not download, transform, cache or re-host these thumbnails.
      <img
        src={reference.thumbnail_url}
        alt={`${reference.title} official ${PROVIDER_LABELS[reference.provider]} thumbnail`}
        loading="lazy"
        decoding="async"
        referrerPolicy="strict-origin-when-cross-origin"
        className="h-full w-full object-cover"
      />
    );
  }
  return <div className="grid h-full place-items-center bg-gradient-to-br from-vx-panel-raised to-vx-base font-vx text-2xl font-black text-vx-fg-muted">{PROVIDER_LABELS[reference.provider]}</div>;
}

function ReferenceCard({ reference, active, removing, sourcesEnabled, onOpenPlayer, onAskRemove, onRemove, onCancelRemove }) {
  const provider = PROVIDER_LABELS[reference.provider] || 'Source';
  const owned = reference.rights_mode === 'owned_or_licensed';
  const embedUrl = safeEmbedUrl(reference);
  return (
    <article className="overflow-hidden rounded-2xl border border-vx-border bg-vx-panel shadow-xl">
      {active && embedUrl ? (
        <div className="aspect-video bg-black">
          <iframe
            src={embedUrl}
            title={`${reference.title} official ${provider} player`}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full min-h-[200px] w-full border-0"
          />
        </div>
      ) : (
        <div className="relative aspect-video overflow-hidden bg-vx-panel-raised">
          <ReferenceArtwork reference={reference} />
          <button type="button" onClick={onOpenPlayer} className="absolute inset-0 grid place-items-center bg-black/20 transition hover:bg-black/35" aria-label={`Open official ${provider} player for ${reference.title}`}>
            <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full bg-white text-2xl font-black text-black shadow-2xl">▶</span>
          </button>
        </div>
      )}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="truncate font-vx text-xl font-black">{reference.title}</h3><p className="mt-1 truncate text-sm text-vx-fg-muted">{reference.creator}</p></div>
          <span className="shrink-0 rounded-full border border-vx-border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide">{provider}</span>
        </div>
        <p className="mt-4 text-xs leading-5 text-vx-fg-muted">{owned ? sourcesEnabled ? 'You marked this recording and composition as owned or licensed.' : 'Owned-master upload is not available yet; this remains a playback reference.' : 'Saved for inspiration only. This media is never sent to generation.'}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={reference.canonical_url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-full border border-vx-border px-3 text-xs font-bold">Open on {provider}</a>
          {owned && sourcesEnabled ? <Link href="/app/music/create" className="inline-flex min-h-10 items-center rounded-full bg-vx-accent px-3 text-xs font-bold text-vx-accent-ink">Upload owned master</Link> : null}
          {!removing ? <button type="button" onClick={onAskRemove} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold text-vx-fg-muted">Remove</button> : (
            <><button type="button" onClick={onRemove} className="min-h-10 rounded-full border border-vx-danger/60 px-3 text-xs font-bold text-vx-danger">Confirm remove</button><button type="button" onClick={onCancelRemove} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold">Cancel</button></>
          )}
        </div>
      </div>
    </article>
  );
}

export function MusicReferenceImporter({ referencesEnabled = false, sourcesEnabled = false }) {
  const [sessionUserId, setSessionUserId] = useState(null);
  const [links, setLinks] = useState([]);
  const [linksOwnerId, setLinksOwnerId] = useState(null);
  const [url, setUrl] = useState('');
  const [rightsMode, setRightsMode] = useState('inspiration');
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [removeId, setRemoveId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unavailable, setUnavailable] = useState(!referencesEnabled);
  const attemptRef = useRef(null);
  const signedIn = Boolean(sessionUserId);
  const visibleLinks = linksOwnerId === sessionUserId ? links : [];

  useEffect(() => {
    const update = () => {
      setLinks([]); setLinksOwnerId(null); setError(''); setNotice('');
      setActiveId(''); setRemoveId(''); setUnavailable(!referencesEnabled); attemptRef.current = null;
      setSessionUserId(getStoredUserId());
    };
    queueMicrotask(update);
    return onSessionChange(update);
  }, [referencesEnabled]);

  useEffect(() => {
    if (!sessionUserId || !referencesEnabled) return undefined;
    let active = true;
    gatewayFetch('/music/reference-links', { promptOnAuth: false }).then((result) => {
      if (active) {
        setLinks(Array.isArray(result.links) ? result.links : []);
        setLinksOwnerId(sessionUserId);
      }
    }).catch((reason) => {
      if (!active || ['no_token', 'unauthenticated'].includes(reason?.code)) return;
      if (REFERENCE_UNAVAILABLE_CODES.has(reason?.code)) setUnavailable(true);
      else setError('Your saved track links could not be loaded.');
    });
    return () => { active = false; };
  }, [referencesEnabled, sessionUserId]);

  async function add(event) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || busy || (rightsMode === 'owned_or_licensed' && !rightsConfirmed)) return;
    if (!getSession()?.access_token) {
      window.dispatchEvent(new CustomEvent('veyrnox:auth-required', { detail: { mode: 'sign_in' } }));
      return;
    }
    setBusy('add'); setError(''); setNotice('');
    const fingerprint = `${trimmed}:${rightsMode}`;
    const attempt = attemptRef.current?.fingerprint === fingerprint
      ? attemptRef.current
      : { fingerprint, idempotencyKey: `music-reference.${crypto.randomUUID()}` };
    attemptRef.current = attempt;
    try {
      const result = await gatewayFetch('/music/reference-links', {
        method: 'POST',
        body: JSON.stringify({
          url: trimmed,
          rights_mode: rightsMode,
          rights_confirmed: rightsMode === 'owned_or_licensed' ? rightsConfirmed : false,
          idempotency_key: attempt.idempotencyKey,
        }),
      });
      attemptRef.current = null;
      setLinks((current) => [result.link, ...current.filter((item) => item.id !== result.link.id)]);
      setLinksOwnerId(sessionUserId);
      setUrl(''); setRightsMode('inspiration'); setRightsConfirmed(false);
      setNotice('Track link saved. Playback stays with the original provider.');
    } catch (reason) {
      if (REFERENCE_UNAVAILABLE_CODES.has(reason?.code)) setUnavailable(true);
      else setError(errorCopy(reason?.code));
    } finally { setBusy(''); }
  }

  async function remove(id) {
    if (busy) return;
    setBusy(`remove:${id}`); setError(''); setNotice('');
    try {
      await gatewayFetch('/music/reference-links', { method: 'DELETE', body: JSON.stringify({ id }) });
      setLinks((current) => current.filter((item) => item.id !== id));
      if (activeId === id) setActiveId('');
      setRemoveId(''); setNotice('Reference removed. No provider media was stored by Veyrnox.');
    } catch (reason) {
      if (reason?.code === 'reference_not_found') {
        setLinks((current) => current.filter((item) => item.id !== id));
        setRemoveId(''); setNotice('Reference was already removed.');
      } else {
        setError(removeErrorCopy(reason?.code));
      }
    } finally { setBusy(''); }
  }

  if (!referencesEnabled) return null;

  return (
    <section aria-labelledby="reference-import-title" className="mt-8 rounded-2xl border border-vx-border bg-vx-panel p-5 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)] lg:items-start">
        <div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Your reference shelf</p><h2 id="reference-import-title" className="mt-1 font-vx text-3xl font-black">Bring a YouTube or SoundCloud link</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-vx-fg-body">Save official artwork and playback beside your Veyrnox beats. Audio and thumbnail files stay with the provider; Veyrnox stores only the link and public metadata.</p></div>
        {unavailable ? <div role="status" className="rounded-2xl border border-vx-border bg-vx-base p-5 text-sm text-vx-fg-muted">New reference saves are not available yet. You can still view and remove saved links, and explore Veyrnox beats below.</div> : <form onSubmit={add} className="rounded-2xl border border-vx-border bg-vx-base p-4">
          <label className="block text-sm font-bold">Public track URL<input type="url" required value={url} onChange={(event) => { setUrl(event.target.value); setError(''); }} placeholder="https://youtube.com/watch?v=… or https://soundcloud.com/…" className="mt-2 min-h-11 w-full rounded-xl border border-vx-border-boost bg-vx-panel px-3 text-sm placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" /></label>
          <fieldset className="mt-4"><legend className="text-sm font-bold">How may you use it?</legend><div className="mt-2 space-y-2 text-xs leading-5 text-vx-fg-body">
            <label className="flex items-start gap-2"><input type="radio" name="reference-rights" value="inspiration" checked={rightsMode === 'inspiration'} onChange={() => { setRightsMode('inspiration'); setRightsConfirmed(false); }} className="mt-1 accent-vx-accent" /><span><strong>Inspiration only</strong> — listen here; never send it to generation.</span></label>
            <label className="flex items-start gap-2"><input type="radio" name="reference-rights" value="owned_or_licensed" checked={rightsMode === 'owned_or_licensed'} onChange={() => setRightsMode('owned_or_licensed')} className="mt-1 accent-vx-accent" /><span><strong>I own or license it</strong> — {sourcesEnabled ? 'save the reference, then upload your own master in Create.' : 'save it as a reference; owned-master upload is not available yet.'}</span></label>
          </div></fieldset>
          {rightsMode === 'owned_or_licensed' ? <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-vx-fg-body"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} className="mt-1 accent-vx-accent" /><span>I own or have permission to use both the recording and its underlying composition.</span></label> : null}
          <button type="submit" disabled={!url.trim() || busy === 'add' || (rightsMode === 'owned_or_licensed' && !rightsConfirmed)} className="mt-4 min-h-11 rounded-full bg-vx-accent px-4 text-sm font-extrabold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40">{busy === 'add' ? 'Checking provider…' : signedIn ? 'Add track link' : 'Sign in to save'}</button>
        </form>}
      </div>
      {error ? <p role="alert" className="mt-4 rounded-xl border border-vx-danger/50 bg-vx-danger/10 px-4 py-3 text-sm text-vx-danger">{error}</p> : null}
      {notice ? <p role="status" className="mt-4 text-sm text-vx-fg-body">{notice}</p> : null}
      {signedIn && visibleLinks.length ? <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{visibleLinks.map((reference) => <ReferenceCard key={reference.id} reference={reference} active={activeId === reference.id} removing={removeId === reference.id} sourcesEnabled={sourcesEnabled} onOpenPlayer={() => setActiveId(reference.id)} onAskRemove={() => setRemoveId(reference.id)} onRemove={() => remove(reference.id)} onCancelRemove={() => setRemoveId('')} />)}</div> : <p className="mt-6 rounded-xl border border-dashed border-vx-border px-4 py-5 text-sm text-vx-fg-muted">{signedIn ? unavailable ? 'No saved references are available. New saves are not open yet.' : 'No source links saved yet. Paste one above to start your private reference shelf.' : 'Browse freely. Sign in only when you want to save a private source link.'}</p>}
      <p className="mt-5 text-xs leading-5 text-vx-fg-faint">Showing saved artwork loads it from YouTube or SoundCloud. Opening a player also connects your browser to that provider under its privacy terms. Veyrnox does not download their media. <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" className="underline">YouTube terms</a> · <a href="https://soundcloud.com/terms-of-use" target="_blank" rel="noreferrer" className="underline">SoundCloud terms</a></p>
    </section>
  );
}
