'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { MusicPrivateAudio } from '../../_lib/useMusicAudioSrc';

const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'refunded']);

function friendlyError(reason) {
  if (reason?.code === 'plan_unavailable') return 'Replace Section requires an active paid plan.';
  if (reason?.code === 'model_unavailable') return 'The verified inpaint provider is not active yet.';
  if (reason?.code === 'range_invalid') return 'Choose a 1–30 second range fully inside a source no longer than 60 seconds.';
  if (reason?.code === 'revision_conflict' || reason?.code === 'source_changed') return 'The source version changed. Reopen Replace Section from the current version.';
  if (reason?.code === 'take_commit_conflict') return 'A different alternative was already committed from this pair.';
  if (reason?.code === 'insufficient_balance') return 'There are not enough credits for both alternatives.';
  return 'The section replacement could not be completed. No unconfirmed spend was made.';
}

export function MusicReplaceSectionDialog({ song, onClose, onSaved }) {
  const closeRef = useRef(null);
  const attemptRef = useRef(null);
  const [prompt, setPrompt] = useState('Replace this passage with a cohesive instrumental variation that preserves the surrounding tempo and key');
  const [start, setStart] = useState(10);
  const [end, setEnd] = useState(20);
  const [rights, setRights] = useState(false);
  const [quote, setQuote] = useState(null);
  const [generation, setGeneration] = useState(null);
  const [committed, setCommitted] = useState(null);
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
      setQuote(await gatewayFetch(`/music/songs/${song.id}/replace-quotes`, {
        method: 'POST',
        body: JSON.stringify({
          version_id: song.version_id,
          prompt: prompt.trim(),
          start_seconds: Number(start),
          end_seconds: Number(end),
          rights_confirmed: rights,
        }),
      }));
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (busy || !quote?.quote_id) return;
    setBusy(true); setError('');
    const key = attemptRef.current || `replace.${crypto.randomUUID()}`;
    attemptRef.current = key;
    try {
      const accepted = await gatewayFetch(`/music/songs/${song.id}/replacements`, {
        method: 'POST',
        body: JSON.stringify({ quote_id: quote.quote_id, idempotency_key: key }),
      });
      attemptRef.current = null;
      setGeneration({ id: accepted.generation_id, state: accepted.state, candidates: accepted.candidates });
      await refresh(accepted.generation_id);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  async function chooseTake(candidate) {
    if (busy || !generation?.id || !candidate?.version_id) return;
    setBusy(true); setError('');
    try {
      await gatewayFetch(`/music/songs/${song.id}/replacements/commit`, {
        method: 'POST',
        body: JSON.stringify({
          generation_id: generation.id,
          version_id: candidate.version_id,
          idempotency_key: `replace-commit.${generation.id}.${candidate.version_id}`,
        }),
      });
      setCommitted(candidate.label || candidate.ordinal);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  async function openHistory() {
    if (busy) return;
    onClose();
    await onSaved();
  }

  const candidates = generation?.candidates || [];
  const terminal = generation && TERMINAL.has(generation.state);
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="replace-title" className="w-full max-w-xl rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-2xl sm:p-8">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Exact-range inpaint</p><h2 id="replace-title" className="mt-2 font-vx text-2xl font-black">Replace a section of “{song.title}”</h2></div>
          <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border">×</button>
        </div>
        <p className="mt-4 text-sm leading-6 text-vx-fg-muted">Generate two instrumental alternatives for one exact 1–30 second range. Each result is a separate full-song branch and the source stays recoverable.</p>
        <p className="mt-3 rounded-2xl border border-vx-border bg-vx-base p-3 text-sm text-vx-fg-muted">Audition both full-song takes, then commit one as current. The other take and the original remain recoverable in version history.</p>
        {!generation ? (
          <form onSubmit={requestQuote} className="mt-6 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-bold">Start seconds<input aria-label="Start seconds" type="number" min="0" max="59" step="0.1" value={start} onChange={(event) => invalidate(setStart, event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 font-normal" /></label>
              <label className="text-sm font-bold">End seconds<input aria-label="End seconds" type="number" min="1" max="60" step="0.1" value={end} onChange={(event) => invalidate(setEnd, event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 font-normal" /></label>
            </div>
            <label className="block text-sm font-bold">Replacement direction<textarea aria-label="Replacement direction" value={prompt} onChange={(event) => invalidate(setPrompt, event.target.value)} maxLength={500} rows={4} className="mt-2 w-full rounded-2xl border border-vx-border bg-vx-base p-3 font-normal" /></label>
            <label className="flex items-start gap-3 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm"><input type="checkbox" checked={rights} onChange={(event) => invalidate(setRights, event.target.checked)} className="mt-1 size-4" /><span><strong className="block text-vx-fg">I own or have permission to edit this recording.</strong><span className="mt-1 block leading-5 text-vx-fg-muted">The exact source version and range are frozen with the quote.</span></span></label>
            {!quote ? <button type="submit" disabled={busy || !prompt.trim() || !rights} className="min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Measuring source and quoting…' : 'Review exact replacement quote'}</button> : (
              <div className="rounded-2xl border border-vx-accent/40 bg-vx-accent/10 p-4">
                <p className="font-bold text-vx-fg">Two section alternatives · {quote.total_credits} Credits total</p>
                <p className="mt-1 text-sm text-vx-fg-muted">{Number(quote.start_seconds).toFixed(1)}s–{Number(quote.end_seconds).toFixed(1)}s of a measured {Number(quote.source_duration_seconds).toFixed(1)}s source · balance {quote.balance} → {quote.balance_after}</p>
                <button type="button" onClick={confirm} disabled={busy || !quote.affordable} className="mt-4 min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Confirming once…' : `Confirm and generate · ${quote.total_credits} Credits`}</button>
              </div>
            )}
          </form>
        ) : (
          <section aria-live="polite" className="mt-6"><p className="font-bold text-vx-fg">{terminal ? 'Replacement pair finished' : 'Generating two section alternatives…'}</p><ul className="mt-4 space-y-3">{candidates.map((candidate) => <li key={candidate.job_id || candidate.ordinal} className="rounded-2xl border border-vx-border bg-vx-base p-4"><div className="flex items-center justify-between gap-3"><strong>Alternative {candidate.label || candidate.ordinal}</strong><span className="text-sm capitalize text-vx-fg-muted">{candidate.state}</span></div>{candidate.audio_url ? <MusicPrivateAudio controls preload="none" src={candidate.audio_url} aria-label={`Play section alternative ${candidate.label || candidate.ordinal}`} className="mt-3 w-full" /> : null}{terminal && candidate.state === 'ready' ? <button type="button" disabled={busy || committed !== null} onClick={() => chooseTake(candidate)} className="mt-3 min-h-11 w-full rounded-full border border-vx-border px-4 text-sm font-bold disabled:opacity-40">Use alternative {candidate.label || candidate.ordinal} as current</button> : null}</li>)}</ul>{committed ? <div className="mt-5 rounded-2xl border border-vx-accent/40 bg-vx-accent/10 p-4"><p className="font-bold text-vx-fg">Alternative {committed} is now current.</p><p className="mt-1 text-sm text-vx-fg-muted">Both alternatives and the original remain in version history.</p><button type="button" onClick={openHistory} className="mt-4 min-h-11 w-full rounded-full border border-vx-border px-5 font-bold">Open committed version history</button></div> : null}</section>
        )}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
      </section>
    </div>
  );
}
