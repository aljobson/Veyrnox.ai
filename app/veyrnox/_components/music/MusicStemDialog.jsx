'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';

const TERMINAL = new Set(['ready', 'failed', 'refunded']);

function stemError(reason) {
  if (reason?.code === 'format_unavailable') return 'Stem separation currently accepts a current MP3 up to 10 MB.';
  if (reason?.code === 'plan_unavailable') return 'Stem separation requires an active paid plan.';
  if (reason?.code === 'model_unavailable') return 'The verified stem provider is not active yet.';
  if (reason?.code === 'insufficient_balance') return 'There are not enough credits for this separation.';
  if (reason?.code === 'revision_conflict') return 'The source version changed. Reopen stems from the current version.';
  return 'The stem request could not be completed. No unconfirmed spend was made.';
}

export function MusicStemDialog({ song, onClose }) {
  const closeRef = useRef(null);
  const attemptRef = useRef(null);
  const [rights, setRights] = useState(false);
  const [quote, setQuote] = useState(null);
  const [request, setRequest] = useState(null);
  const [archive, setArchive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    closeRef.current?.focus();
    function key(event) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const refresh = useCallback(async (id) => {
    const next = await gatewayFetch(`/music/stem-requests/${id}`);
    setRequest(next);
    return next;
  }, []);

  useEffect(() => {
    if (!request?.id || TERMINAL.has(request.state)) return undefined;
    const timer = window.setInterval(() => { refresh(request.id).catch(() => {}); }, 1200);
    return () => window.clearInterval(timer);
  }, [refresh, request?.id, request?.state]);

  async function review() {
    if (busy) return;
    setBusy(true); setError(''); setQuote(null);
    try {
      setQuote(await gatewayFetch(`/music/songs/${song.id}/stem-quotes`, {
        method: 'POST',
        body: JSON.stringify({ version_id: song.version_id, rights_confirmed: rights }),
      }));
    } catch (reason) { setError(stemError(reason)); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (busy || !quote?.quote_id) return;
    setBusy(true); setError('');
    const key = attemptRef.current || `stems.${crypto.randomUUID()}`;
    attemptRef.current = key;
    try {
      const accepted = await gatewayFetch(`/music/songs/${song.id}/stems`, {
        method: 'POST',
        body: JSON.stringify({ quote_id: quote.quote_id, idempotency_key: key }),
      });
      attemptRef.current = null;
      setRequest({ id: accepted.request_id, job_id: accepted.job_id, state: accepted.state });
      await refresh(accepted.request_id);
    } catch (reason) { setError(stemError(reason)); }
    finally { setBusy(false); }
  }

  async function prepareArchive() {
    if (busy || !request?.id) return;
    setBusy(true); setError('');
    try { setArchive(await gatewayFetch(`/music/stem-requests/${request.id}/archive`)); }
    catch (reason) { setError(stemError(reason)); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="stems-title" className="w-full max-w-lg rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-2xl sm:p-8">
        <div className="flex items-start gap-4"><div className="min-w-0 flex-1"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Paid audio separation</p><h2 id="stems-title" className="mt-2 font-vx text-2xl font-black">Get stems for “{song.title}”</h2></div><button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border">×</button></div>
        <p className="mt-4 text-sm leading-6 text-vx-fg-muted">Separate the exact current MP3 into a ZIP containing vocal and instrumental audio. The original version remains unchanged.</p>
        {!request ? <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-amber-400/50 bg-amber-400/10 p-4 text-sm leading-6 text-vx-fg-body"><strong className="block text-vx-fg">Credits are charged for the separation attempt.</strong>If vocals or a clear instrumental part are absent, the result may be silent or limited and the request can still spend the quoted credits.</div>
          <label className="flex items-start gap-3 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm"><input type="checkbox" checked={rights} onChange={(event) => { setRights(event.target.checked); setQuote(null); }} className="mt-1 size-4"/><span><strong className="block text-vx-fg">I own or have permission to separate this recording.</strong><span className="mt-1 block text-vx-fg-muted">The attestation is bound to this source version.</span></span></label>
          {!quote ? <button type="button" onClick={review} disabled={busy || !rights} className="min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Checking source and price…' : 'Review exact stem quote'}</button> : <div className="rounded-2xl border border-vx-accent/40 bg-vx-accent/10 p-4"><p className="font-bold text-vx-fg">Vocals + instrumental archive · {quote.total_credits} Credits</p><p className="mt-1 text-sm text-vx-fg-muted">Balance {quote.balance} → {quote.balance_after} · one separation job</p><button type="button" onClick={confirm} disabled={busy || !quote.affordable} className="mt-4 min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Confirming once…' : `Confirm separation · ${quote.total_credits} Credits`}</button></div>}
        </div> : <section aria-live="polite" className="mt-6 rounded-2xl border border-vx-border bg-vx-base p-4"><div className="flex items-center justify-between gap-3"><strong>Stem archive</strong><span className="text-sm capitalize text-vx-fg-muted">{request.state}</span></div>{request.state === 'ready' && !archive ? <button type="button" onClick={prepareArchive} disabled={busy} className="mt-4 min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Signing download…' : 'Prepare private ZIP download'}</button> : null}{archive?.url ? <a href={archive.url} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">Download vocals + instrumental ZIP</a> : null}{request.state === 'refunded' ? <p className="mt-3 text-sm text-vx-fg-muted">The provider did not produce an archive. The job was refunded.</p> : null}</section>}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
      </section>
    </div>
  );
}
