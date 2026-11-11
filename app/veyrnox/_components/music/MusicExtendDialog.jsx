'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';

const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'refunded']);

function friendlyError(reason) {
  if (reason?.code === 'plan_unavailable') return 'Tail extension requires an active paid plan.';
  if (reason?.code === 'model_unavailable') return 'The verified Extend provider is not active yet.';
  if (reason?.code === 'source_duration_invalid') return 'Extend supports owned audio up to two minutes in this staged contract.';
  if (reason?.code === 'revision_conflict' || reason?.code === 'source_changed') return 'The source version changed. Close this dialog and reopen Extend from the current version.';
  if (reason?.code === 'insufficient_balance') return 'There are not enough credits for both continuations.';
  return 'The Extend request could not be completed. No unconfirmed spend was made.';
}

export function MusicExtendDialog({ song, onClose, onSaved }) {
  const closeRef = useRef(null);
  const attemptRef = useRef(null);
  const [prompt, setPrompt] = useState('Continue the instrumental naturally while preserving its tempo, key, and production character');
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

  async function requestQuote(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setQuote(null);
    try {
      const next = await gatewayFetch(`/music/songs/${song.id}/extend-quotes`, {
        method: 'POST',
        body: JSON.stringify({
          version_id: song.version_id,
          prompt: prompt.trim(),
          rights_confirmed: rights,
        }),
      });
      setQuote(next);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (busy || !quote?.quote_id) return;
    setBusy(true); setError('');
    const key = attemptRef.current || `extend.${crypto.randomUUID()}`;
    attemptRef.current = key;
    try {
      const accepted = await gatewayFetch(`/music/songs/${song.id}/extends`, {
        method: 'POST',
        body: JSON.stringify({ quote_id: quote.quote_id, idempotency_key: key }),
      });
      attemptRef.current = null;
      setGeneration({ id: accepted.generation_id, state: accepted.state, candidates: accepted.candidates });
      await refresh(accepted.generation_id);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  async function finish() {
    if (candidates.some((candidate) => candidate.state === 'ready')) await onSaved();
    onClose();
  }

  const candidates = generation?.candidates || [];
  const terminal = generation && TERMINAL.has(generation.state);
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="extend-title" className="w-full max-w-xl rounded-3xl border border-vx-border bg-vx-panel p-6 shadow-2xl sm:p-8">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Tail-only continuation</p><h2 id="extend-title" className="mt-2 font-vx text-2xl font-black">Extend “{song.title}”</h2></div>
          <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border">×</button>
        </div>
        <p className="mt-4 text-sm leading-6 text-vx-fg-muted">Append 30 instrumental seconds to this exact private version. Two continuations are created as separate branches; the source remains recoverable.</p>
        <p className="mt-3 rounded-2xl border border-vx-border bg-vx-base p-3 text-sm text-vx-fg-muted">This contract extends only the tail. It does not replace the ending, prepend audio, or promise a seamless transition before live provider acceptance.</p>
        {!generation ? (
          <form onSubmit={requestQuote} className="mt-6 space-y-5">
            <label className="block text-sm font-bold">Continuation direction<textarea aria-label="Continuation direction" value={prompt} onChange={(event) => { setPrompt(event.target.value); setQuote(null); }} maxLength={500} rows={4} className="mt-2 w-full rounded-2xl border border-vx-border bg-vx-base p-3 font-normal" /></label>
            <label className="flex items-start gap-3 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm"><input type="checkbox" checked={rights} onChange={(event) => { setRights(event.target.checked); setQuote(null); }} className="mt-1 size-4" /><span><strong className="block text-vx-fg">I own or have permission to extend this recording.</strong><span className="mt-1 block leading-5 text-vx-fg-muted">The attestation is frozen with this exact source version and quote.</span></span></label>
            {!quote ? <button type="submit" disabled={busy || !prompt.trim() || !rights} className="min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Measuring source and quoting…' : 'Review exact Extend quote'}</button> : (
              <div className="rounded-2xl border border-vx-accent/40 bg-vx-accent/10 p-4">
                <p className="font-bold text-vx-fg">Two 30-second continuations · {quote.total_credits} Credits total</p>
                <p className="mt-1 text-sm text-vx-fg-muted">{quote.credits_per_candidate} each · balance {quote.balance} → {quote.balance_after} · measured source {Number(quote.source_duration_seconds).toFixed(1)}s</p>
                <button type="button" onClick={confirm} disabled={busy || !quote.affordable} className="mt-4 min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Confirming once…' : `Confirm and extend · ${quote.total_credits} Credits`}</button>
              </div>
            )}
          </form>
        ) : (
          <section aria-live="polite" className="mt-6">
            <p className="font-bold text-vx-fg">{terminal ? 'Extension pair finished' : 'Creating two tail continuations…'}</p>
            <ul className="mt-4 space-y-3">{candidates.map((candidate) => <li key={candidate.job_id || candidate.ordinal} className="rounded-2xl border border-vx-border bg-vx-base p-4"><div className="flex items-center justify-between gap-3"><strong>Continuation {candidate.label || candidate.ordinal}</strong><span className="text-sm capitalize text-vx-fg-muted">{candidate.state}</span></div>{candidate.audio_url ? <audio controls preload="none" src={candidate.audio_url} aria-label={`Play extension ${candidate.label || candidate.ordinal}`} className="mt-3 w-full" /> : null}</li>)}</ul>
            {terminal ? <button type="button" onClick={finish} className="mt-5 min-h-11 w-full rounded-full border border-vx-border px-5 font-bold">Return to version history</button> : null}
          </section>
        )}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
      </section>
    </div>
  );
}
