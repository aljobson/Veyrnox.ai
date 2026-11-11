'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';

const INSTRUMENTS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'strings', 'synthesizer', 'brass', 'woodwinds'];
const TERMINAL = new Set(['ready', 'failed', 'refunded']);

function requestError(reason) {
  if (reason?.code === 'format_unavailable') return 'Instrument isolation accepts a current MP3 or WAV.';
  if (reason?.code === 'source_duration_unavailable') return 'The source must have a measurable duration of 120 seconds or less.';
  if (reason?.code === 'plan_unavailable') return 'Instrument isolation requires an active paid plan.';
  if (reason?.code === 'model_unavailable') return 'The verified isolation provider is not active yet.';
  if (reason?.code === 'insufficient_balance') return 'There are not enough credits for this isolation.';
  if (reason?.code === 'revision_conflict') return 'The source version changed. Reopen this action from the current version.';
  return 'The isolation request could not be completed. No unconfirmed spend was made.';
}

export function MusicTargetStemDialog({ song, onClose }) {
  const closeRef = useRef(null); const attemptRef = useRef(null);
  const [instrument, setInstrument] = useState('guitar');
  const [rights, setRights] = useState(false); const [quote, setQuote] = useState(null);
  const [request, setRequest] = useState(null); const [assets, setAssets] = useState(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  useEffect(() => {
    closeRef.current?.focus();
    function key(event) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const refresh = useCallback(async (id) => {
    const next = await gatewayFetch(`/music/target-stem-requests/${id}`);
    setRequest(next); return next;
  }, []);
  useEffect(() => {
    if (!request?.id || TERMINAL.has(request.state)) return undefined;
    const timer = window.setInterval(() => { refresh(request.id).catch(() => {}); }, 1200);
    return () => window.clearInterval(timer);
  }, [refresh, request?.id, request?.state]);

  async function review() {
    if (busy) return;
    setBusy(true); setError(''); setQuote(null); setAssets(null);
    try {
      setQuote(await gatewayFetch(`/music/songs/${song.id}/target-stem-quotes`, {
        method: 'POST', body: JSON.stringify({ version_id: song.version_id, instrument, rights_confirmed: rights }),
      }));
    } catch (reason) { setError(requestError(reason)); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (busy || !quote?.quote_id) return;
    setBusy(true); setError('');
    const key = attemptRef.current || `target-stem.${crypto.randomUUID()}`; attemptRef.current = key;
    try {
      const accepted = await gatewayFetch(`/music/songs/${song.id}/target-stems`, {
        method: 'POST', body: JSON.stringify({ quote_id: quote.quote_id, idempotency_key: key }),
      });
      attemptRef.current = null;
      setRequest({ id: accepted.request_id, job_id: accepted.job_id, state: accepted.state });
      await refresh(accepted.request_id);
    } catch (reason) { setError(requestError(reason)); }
    finally { setBusy(false); }
  }

  async function prepare() {
    if (busy || !request?.id) return;
    setBusy(true); setError('');
    try {
      const [target, residual] = await Promise.all([
        gatewayFetch(`/music/target-stem-requests/${request.id}/target`),
        gatewayFetch(`/music/target-stem-requests/${request.id}/residual`),
      ]);
      setAssets({ target, residual });
    } catch (reason) { setError(requestError(reason)); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="target-stem-title" className="w-full max-w-xl rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-2xl sm:p-8">
        <div className="flex items-start gap-4"><div className="min-w-0 flex-1"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Paid target separation</p><h2 id="target-stem-title" className="mt-2 font-vx text-2xl font-black">Isolate one instrument from “{song.title}”</h2></div><button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border">×</button></div>
        <p className="mt-4 text-sm leading-6 text-vx-fg-muted">Create two private WAV files: the isolated target and a residual containing everything else. The original version remains unchanged.</p>
        {!request ? <div className="mt-6 space-y-4">
          <label className="block text-sm font-bold text-vx-fg">Target sound<select value={instrument} onChange={(event) => { setInstrument(event.target.value); setQuote(null); }} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 text-vx-fg">{INSTRUMENTS.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
          <div className="rounded-2xl border border-amber-400/50 bg-amber-400/10 p-4 text-sm leading-6 text-vx-fg-body"><strong className="block text-vx-fg">Separation is descriptive, not guaranteed.</strong>If the target is absent, ambiguous, or heavily blended, either WAV may be quiet or contain bleed and the attempt can still spend the quoted credits.</div>
          <label className="flex items-start gap-3 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm"><input type="checkbox" checked={rights} onChange={(event) => { setRights(event.target.checked); setQuote(null); }} className="mt-1 size-4"/><span><strong className="block text-vx-fg">I own or have permission to separate this recording.</strong><span className="mt-1 block text-vx-fg-muted">This attestation is bound to the exact current version.</span></span></label>
          {!quote ? <button type="button" onClick={review} disabled={busy || !rights} className="min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Measuring source and price…' : 'Review exact isolation quote'}</button> : <div className="rounded-2xl border border-vx-accent/40 bg-vx-accent/10 p-4"><p className="font-bold text-vx-fg">{quote.instrument} + residual WAV · {quote.total_credits} Credits</p><p className="mt-1 text-sm text-vx-fg-muted">{Number(quote.source_duration_seconds).toFixed(1)} seconds · balance {quote.balance} → {quote.balance_after}</p><button type="button" onClick={confirm} disabled={busy || !quote.affordable} className="mt-4 min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Confirming once…' : `Confirm isolation · ${quote.total_credits} Credits`}</button></div>}
        </div> : <section aria-live="polite" className="mt-6 rounded-2xl border border-vx-border bg-vx-base p-4"><div className="flex items-center justify-between gap-3"><strong>{request.instrument || instrument} separation</strong><span className="text-sm capitalize text-vx-fg-muted">{request.state}</span></div>{request.state === 'ready' && !assets ? <button type="button" onClick={prepare} disabled={busy} className="mt-4 min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Signing private WAVs…' : 'Prepare target + residual WAVs'}</button> : null}{assets ? <div className="mt-4 space-y-4"><div><p className="mb-2 text-sm font-bold capitalize">{request.instrument || instrument} target</p><audio controls preload="metadata" src={assets.target.url} className="w-full" /></div><div><p className="mb-2 text-sm font-bold">Everything else</p><audio controls preload="metadata" src={assets.residual.url} className="w-full" /></div><div className="grid gap-2 sm:grid-cols-2"><a href={assets.target.url} className="inline-flex min-h-11 items-center justify-center rounded-full border border-vx-border px-4 text-sm font-bold">Download target WAV</a><a href={assets.residual.url} className="inline-flex min-h-11 items-center justify-center rounded-full border border-vx-border px-4 text-sm font-bold">Download residual WAV</a></div></div> : null}{request.state === 'refunded' ? <p className="mt-3 text-sm text-vx-fg-muted">The provider did not produce both WAV files. The job was refunded.</p> : null}</section>}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
      </section>
    </div>
  );
}
