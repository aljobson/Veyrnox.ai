'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { MusicPrivateAudio } from '../../_lib/useMusicAudioSrc';

const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'refunded']);

function friendlyError(reason) {
  if (reason?.code === 'plan_unavailable') return 'Add Section requires an active paid plan.';
  if (reason?.code === 'model_unavailable') return 'The verified outpaint provider is not active yet.';
  if (reason?.code === 'source_duration_invalid') return 'Add Section supports an owned source up to two minutes in this staged contract.';
  if (reason?.code === 'revision_conflict' || reason?.code === 'source_changed') return 'The source version changed. Reopen Add Section from the current version.';
  if (reason?.code === 'insufficient_balance') return 'There are not enough credits for both section alternatives.';
  return 'The new section could not be created. No unconfirmed spend was made.';
}

export function MusicAddSectionDialog({ song, onClose, onSaved }) {
  const closeRef = useRef(null);
  const attemptRef = useRef(null);
  const [position, setPosition] = useState('end');
  const [duration, setDuration] = useState(20);
  const [styles, setStyles] = useState('A cohesive bridge that preserves the source tempo, key, voices, and production character');
  const [lyrics, setLyrics] = useState('[Bridge]\n');
  const [rights, setRights] = useState(false);
  const [quote, setQuote] = useState(null);
  const [generation, setGeneration] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    closeRef.current?.focus();
    function key(event) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const refresh = useCallback(async (id) => {
    const next = await gatewayFetch(`/music/generations/${id}`);
    setGeneration(next);
    return next;
  }, []);

  useEffect(() => {
    if (!generation?.id || TERMINAL.has(generation.state)) return undefined;
    const timer = window.setInterval(() => { refresh(generation.id).catch(() => {}); }, 1000);
    return () => window.clearInterval(timer);
  }, [generation?.id, generation?.state, refresh]);

  function invalidate(setter, value) { setter(value); setQuote(null); }

  async function requestQuote(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setQuote(null);
    try {
      setQuote(await gatewayFetch(`/music/songs/${song.id}/add-section-quotes`, {
        method: 'POST',
        body: JSON.stringify({
          version_id: song.version_id, position, duration_seconds: duration,
          lyrics: lyrics.trim(), styles: styles.trim(), rights_confirmed: rights,
        }),
      }));
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (busy || !quote?.quote_id) return;
    setBusy(true); setError('');
    const key = attemptRef.current || `add-section.${crypto.randomUUID()}`;
    attemptRef.current = key;
    try {
      const accepted = await gatewayFetch(`/music/songs/${song.id}/sections`, {
        method: 'POST', body: JSON.stringify({ quote_id: quote.quote_id, idempotency_key: key }),
      });
      attemptRef.current = null;
      setGeneration({ id: accepted.generation_id, state: accepted.state, candidates: accepted.candidates });
      await refresh(accepted.generation_id);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  async function finish() {
    if ((generation?.candidates || []).some((candidate) => candidate.state === 'ready')) await onSaved();
    onClose();
  }

  const candidates = generation?.candidates || [];
  const terminal = generation && TERMINAL.has(generation.state);
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="add-section-title" className="w-full max-w-xl rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-2xl sm:p-8">
        <div className="flex items-start gap-4"><div className="min-w-0 flex-1"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Structured audio outpaint</p><h2 id="add-section-title" className="mt-2 font-vx text-2xl font-black">Add a section to “{song.title}”</h2></div><button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border">×</button></div>
        <p className="mt-4 text-sm leading-6 text-vx-fg-muted">Create two 10, 20, or 30 second alternatives at the beginning or end. Style and optional structured lyrics are frozen with the exact source; each result is a separate recoverable branch.</p>
        <p className="mt-3 rounded-2xl border border-vx-border bg-vx-base p-3 text-sm text-vx-fg-muted">This adds at an edge; it does not insert into the middle, count beats, replace an existing passage, or promise a seamless join before live provider acceptance.</p>
        {!generation ? (
          <form onSubmit={requestQuote} className="mt-6 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-bold">Position<select aria-label="Section position" value={position} onChange={(event) => invalidate(setPosition, event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 font-normal"><option value="beginning">Beginning</option><option value="end">End</option></select></label>
              <label className="text-sm font-bold">Length<select aria-label="Section length" value={duration} onChange={(event) => invalidate(setDuration, Number(event.target.value))} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 font-normal"><option value={10}>10 seconds</option><option value={20}>20 seconds</option><option value={30}>30 seconds</option></select></label>
            </div>
            <label className="block text-sm font-bold">Section style<textarea aria-label="Section style" value={styles} onChange={(event) => invalidate(setStyles, event.target.value)} maxLength={500} rows={3} className="mt-2 w-full rounded-2xl border border-vx-border bg-vx-base p-3 font-normal" /></label>
            <label className="block text-sm font-bold">Section lyrics <span className="font-normal text-vx-fg-muted">(optional)</span><textarea aria-label="Section lyrics" value={lyrics} onChange={(event) => invalidate(setLyrics, event.target.value)} maxLength={3000} rows={5} placeholder="Leave empty for an instrumental section. You may use [Verse], [Chorus], or [Bridge]." className="mt-2 w-full rounded-2xl border border-vx-border bg-vx-base p-3 font-normal" /></label>
            <label className="flex items-start gap-3 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm"><input type="checkbox" checked={rights} onChange={(event) => invalidate(setRights, event.target.checked)} className="mt-1 size-4" /><span><strong className="block text-vx-fg">I own or have permission to extend this recording and use these lyrics.</strong><span className="mt-1 block leading-5 text-vx-fg-muted">The attestation, exact source, position, duration, style, and lyrics are frozen with the quote.</span></span></label>
            {!quote ? <button type="submit" disabled={busy || !styles.trim() || !rights} className="min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Measuring source and quoting…' : 'Review exact Add Section quote'}</button> : (
              <div className="rounded-2xl border border-vx-accent/40 bg-vx-accent/10 p-4"><p className="font-bold text-vx-fg">Two {quote.duration_seconds}-second {quote.position} sections · {quote.total_credits} Credits total</p><p className="mt-1 text-sm text-vx-fg-muted">{quote.instrumental ? 'Instrumental' : 'Structured lyrics'} · measured source {Number(quote.source_duration_seconds).toFixed(1)}s · balance {quote.balance} → {quote.balance_after}</p><button type="button" onClick={confirm} disabled={busy || !quote.affordable} className="mt-4 min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Confirming once…' : `Confirm and add section · ${quote.total_credits} Credits`}</button></div>
            )}
          </form>
        ) : (
          <section aria-live="polite" className="mt-6"><p className="font-bold text-vx-fg">{terminal ? 'Section pair finished' : 'Creating two section alternatives…'}</p><ul className="mt-4 space-y-3">{candidates.map((candidate) => <li key={candidate.job_id || candidate.ordinal} className="rounded-2xl border border-vx-border bg-vx-base p-4"><div className="flex items-center justify-between gap-3"><strong>Section {candidate.label || candidate.ordinal}</strong><span className="text-sm capitalize text-vx-fg-muted">{candidate.state}</span></div>{candidate.audio_url ? <MusicPrivateAudio controls preload="none" src={candidate.audio_url} aria-label={`Play added section ${candidate.label || candidate.ordinal}`} className="mt-3 w-full" /> : null}</li>)}</ul>{terminal ? <button type="button" onClick={finish} className="mt-5 min-h-11 w-full rounded-full border border-vx-border px-5 font-bold">Return to version history</button> : null}</section>
        )}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
      </section>
    </div>
  );
}
