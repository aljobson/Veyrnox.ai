'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';

const TERMINAL = new Set(['ready', 'failed', 'refunded']);

function trackError(reason) {
  if (reason?.code === 'format_unavailable') return 'This workflow accepts a current MP3 no larger than 10 MB.';
  if (reason?.code === 'source_duration_unavailable') return 'The source must have a measurable duration of 120 seconds or less.';
  if (reason?.code === 'plan_unavailable') return 'Adding a part requires an active paid plan.';
  if (reason?.code === 'model_unavailable') return 'The verified upload and track providers are not active yet.';
  if (reason?.code === 'insufficient_balance') return 'There are not enough credits for both stages.';
  if (reason?.code === 'revision_conflict') return 'The source version changed. Reopen this action from the current version.';
  return 'The track request could not be completed. No unconfirmed spend was made.';
}

export function MusicTrackAddDialog({ song, onClose }) {
  const closeRef = useRef(null); const attemptRef = useRef(null);
  const [mode, setMode] = useState('vocals'); const [prompt, setPrompt] = useState('');
  const [vocalGender, setVocalGender] = useState('auto');
  const [lyrics, setLyrics] = useState(''); const [rights, setRights] = useState(false);
  const [lyricsRights, setLyricsRights] = useState(false); const [quote, setQuote] = useState(null);
  const [request, setRequest] = useState(null); const [asset, setAsset] = useState(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  useEffect(() => {
    closeRef.current?.focus();
    function key(event) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const refresh = useCallback(async (id) => {
    const next = await gatewayFetch(`/music/track-add-requests/${id}`); setRequest(next); return next;
  }, []);
  useEffect(() => {
    if (!request?.id || TERMINAL.has(request.state)) return undefined;
    const timer = window.setInterval(() => { refresh(request.id).catch(() => {}); }, 1200);
    return () => window.clearInterval(timer);
  }, [refresh, request?.id, request?.state]);

  function choose(next) {
    setMode(next); setQuote(null); setAsset(null);
    if (next === 'instrumental') { setLyrics(''); setLyricsRights(false); setVocalGender('auto'); }
  }

  async function review() {
    if (busy) return;
    setBusy(true); setError(''); setQuote(null);
    try {
      setQuote(await gatewayFetch(`/music/songs/${song.id}/track-add-quotes`, {
        method: 'POST', body: JSON.stringify({
          version_id: song.version_id, mode, prompt, lyrics: mode === 'vocals' ? lyrics : '',
          vocal_gender: mode === 'vocals' ? vocalGender : 'auto',
          rights_confirmed: rights, lyrics_rights_confirmed: mode === 'vocals' ? lyricsRights : false,
        }),
      }));
    } catch (reason) { setError(trackError(reason)); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (busy || !quote?.quote_id) return;
    setBusy(true); setError('');
    const key = attemptRef.current || `track-add.${crypto.randomUUID()}`; attemptRef.current = key;
    try {
      const accepted = await gatewayFetch(`/music/songs/${song.id}/track-adds`, {
        method: 'POST', body: JSON.stringify({ quote_id: quote.quote_id, idempotency_key: key }),
      });
      attemptRef.current = null;
      setRequest({ id: accepted.request_id, state: accepted.state, mode });
      await refresh(accepted.request_id);
    } catch (reason) { setError(trackError(reason)); }
    finally { setBusy(false); }
  }

  async function prepare() {
    if (busy || !request?.id) return;
    setBusy(true); setError('');
    try { setAsset(await gatewayFetch(`/music/track-add-requests/${request.id}/audio`)); }
    catch (reason) { setError(trackError(reason)); }
    finally { setBusy(false); }
  }

  const readyToQuote = rights && prompt.trim() && (mode === 'instrumental' || (lyrics.trim() && lyricsRights));
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="track-add-title" className="w-full max-w-xl rounded-3xl border border-vx-border bg-vx-panel p-6 shadow-2xl sm:p-8">
        <div className="flex items-start gap-4"><div className="min-w-0 flex-1"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Two-stage paid generation</p><h2 id="track-add-title" className="mt-2 font-vx text-2xl font-black">Add a part to “{song.title}”</h2></div><button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border">×</button></div>
        <p className="mt-4 text-sm leading-6 text-vx-fg-muted">Generate a matching vocal or instrumental part from the exact current MP3. The result is a separate private track—Veyrnox does not mix it into the source automatically.</p>
        {!request ? <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Part type"><button type="button" aria-pressed={mode === 'vocals'} onClick={() => choose('vocals')} className={`min-h-11 rounded-full border px-4 font-bold ${mode === 'vocals' ? 'border-vx-accent bg-vx-accent/15 text-vx-accent' : 'border-vx-border'}`}>Add vocals</button><button type="button" aria-pressed={mode === 'instrumental'} onClick={() => choose('instrumental')} className={`min-h-11 rounded-full border px-4 font-bold ${mode === 'instrumental' ? 'border-vx-accent bg-vx-accent/15 text-vx-accent' : 'border-vx-border'}`}>Add instrumental</button></div>
          <label className="block text-sm font-bold text-vx-fg">Direction<textarea value={prompt} maxLength={500} onChange={(event) => { setPrompt(event.target.value); setQuote(null); }} placeholder={mode === 'vocals' ? 'Warm intimate lead vocal, restrained delivery' : 'Bright indie-rock guitar and live drums'} className="mt-2 min-h-24 w-full rounded-xl border border-vx-border bg-vx-base p-3 text-vx-fg" /></label>
          {mode === 'vocals' ? <><label className="block text-sm font-bold text-vx-fg">Vocal range preference<select value={vocalGender} onChange={(event) => { setVocalGender(event.target.value); setQuote(null); }} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 text-vx-fg"><option value="auto">Automatic</option><option value="female">Female range</option><option value="male">Male range</option></select><span className="mt-1 block text-xs font-normal text-vx-fg-muted">This shapes the generated vocal range; it does not select or clone a person&apos;s voice.</span></label><label className="block text-sm font-bold text-vx-fg">Exact lyrics<textarea value={lyrics} maxLength={3000} onChange={(event) => { setLyrics(event.target.value); setQuote(null); }} className="mt-2 min-h-32 w-full rounded-xl border border-vx-border bg-vx-base p-3 font-vx-mono text-sm text-vx-fg" /></label><label className="flex items-start gap-3 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm"><input type="checkbox" checked={lyricsRights} onChange={(event) => { setLyricsRights(event.target.checked); setQuote(null); }} className="mt-1 size-4"/><span><strong className="block text-vx-fg">I own or have permission to use these lyrics.</strong><span className="mt-1 block text-vx-fg-muted">This attestation is frozen with the exact lyric text.</span></span></label></> : null}
          <label className="flex items-start gap-3 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm"><input type="checkbox" checked={rights} onChange={(event) => { setRights(event.target.checked); setQuote(null); }} className="mt-1 size-4"/><span><strong className="block text-vx-fg">I own or have permission to use this recording.</strong><span className="mt-1 block text-vx-fg-muted">The source attestation is bound to the exact current version.</span></span></label>
          <div className="rounded-2xl border border-amber-400/50 bg-amber-400/10 p-4 text-sm leading-6 text-vx-fg-body"><strong className="block text-vx-fg">The quote covers two provider stages.</strong>The 1-credit upload is followed by a 6-credit generation. If upload fails, both refund. If generation fails, its 6 credits refund; the completed upload may retain 1 credit.</div>
          {!quote ? <button type="button" onClick={review} disabled={busy || !readyToQuote} className="min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Measuring source and price…' : 'Review exact two-stage quote'}</button> : <div className="rounded-2xl border border-vx-accent/40 bg-vx-accent/10 p-4"><p className="font-bold text-vx-fg">{mode === 'vocals' ? 'Vocal' : 'Instrumental'} part · {quote.total_credits} Credits</p><p className="mt-1 text-sm text-vx-fg-muted">Upload {quote.upload_credits} + generation {quote.track_credits} · balance {quote.balance} → {quote.balance_after}</p><button type="button" onClick={confirm} disabled={busy || !quote.affordable} className="mt-4 min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Confirming once…' : `Confirm both stages · ${quote.total_credits} Credits`}</button></div>}
        </div> : <section aria-live="polite" className="mt-6 rounded-2xl border border-vx-border bg-vx-base p-4"><div className="flex items-center justify-between gap-3"><strong>{request.mode === 'instrumental' ? 'Instrumental' : 'Vocal'} part</strong><span className="text-sm capitalize text-vx-fg-muted">{request.state}</span></div>{request.stage ? <p className="mt-2 text-sm text-vx-fg-muted">Stage: {String(request.stage).replace('_', ' ')}</p> : null}{request.state === 'ready' && !asset ? <button type="button" onClick={prepare} disabled={busy} className="mt-4 min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Signing private audio…' : 'Prepare generated part'}</button> : null}{asset?.url ? <div className="mt-4"><audio controls preload="metadata" src={asset.url} className="w-full"/><a href={asset.url} className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-vx-border px-4 font-bold">Download separate generated part</a></div> : null}{request.state === 'refunded' ? <p className="mt-3 text-sm text-vx-fg-muted">The failed stage was refunded according to the two-stage quote.</p> : null}</section>}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
      </section>
    </div>
  );
}
