'use client';
import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../../_lib/gateway';
import { MusicPrivateAudio } from '../../../_lib/useMusicAudioSrc';
import { MAGIC_LAYER_LIMIT, MAGIC_PROMPT_MAX, barChoices, magicQuoteBody } from '../../../_lib/music/beat/magicBar.mjs';
import { action, button, input } from './beatStyles';

const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'refunded']);

function friendly(reason) {
  const code = reason?.code;
  if (code === 'plan_unavailable') return 'Magic loops need an active paid plan.';
  if (code === 'insufficient_balance') return 'You do not have enough credits for both loops.';
  if (code === 'prompt_blocked' || code === 'prompt_invalid') return 'Describe the loop differently and try again.';
  if (code === 'rate_limited') return 'Too many requests. Wait a minute and try again.';
  return 'The loop could not be made. Nothing was charged.';
}

/**
 * Magic Bar: describe a part, see the exact price, confirm, then add one of
 * the two results to the beat as a loop layer. Results are also saved as
 * private songs in the Music Library, like every Create pair.
 */
export default function BeatMagicBar({ doc, loops, announce }) {
  const [prompt, setPrompt] = useState('');
  const bars = barChoices(doc.tempo.bpm);
  const [length, setLength] = useState(bars.includes(8) ? 8 : bars[0]);
  const [quote, setQuote] = useState(null);
  const [generation, setGeneration] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef(null);

  async function refresh(id) {
    const next = await gatewayFetch(`/music/generations/${id}`);
    setGeneration(next);
    if (TERMINAL.has(next.state)) announce(next.state === 'succeeded' || next.state === 'partial' ? 'Magic loops are ready' : 'The loops failed and the credits were returned');
    return next;
  }

  const pollingId = generation && !TERMINAL.has(generation.state) ? generation.id : null;
  useEffect(() => {
    if (!pollingId) return undefined;
    const timer = window.setInterval(() => {
      gatewayFetch(`/music/generations/${pollingId}`).then((next) => {
        setGeneration(next);
        if (TERMINAL.has(next.state)) announce(next.state === 'succeeded' || next.state === 'partial' ? 'Magic loops are ready' : 'The loops failed and the credits were returned');
      }).catch(() => {});
    }, 1500);
    return () => window.clearInterval(timer);
  }, [pollingId, announce]);

  const reset = () => { setQuote(null); setError(''); };

  async function price(event) {
    event.preventDefault();
    if (busy || !prompt.trim()) return;
    setBusy(true); setError(''); setQuote(null);
    try {
      setQuote(await gatewayFetch('/music/generation-quotes', { method: 'POST', body: JSON.stringify(magicQuoteBody({ prompt, bpm: doc.tempo.bpm, bars: length, title: `${doc.title} loop` })) }));
    } catch (reason) { setError(friendly(reason)); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (busy || !quote?.quote_id) return;
    setBusy(true); setError('');
    const key = attempt.current || `magic.${crypto.randomUUID()}`;
    attempt.current = key;
    try {
      const accepted = await gatewayFetch('/music/generations', { method: 'POST', body: JSON.stringify({ quote_id: quote.quote_id, idempotency_key: key }) });
      attempt.current = null;
      setGeneration({ id: accepted.generation_id, state: accepted.state, candidates: accepted.candidates });
      announce(`Making two loops for ${quote.total_credits} credits`);
      await refresh(accepted.generation_id);
    } catch (reason) { setError(friendly(reason)); }
    finally { setBusy(false); }
  }

  function addLayer(candidate) {
    loops.add({ songId: candidate.song_id, audioUrl: candidate.audio_url, title: `${prompt.trim().slice(0, 40) || 'Magic loop'} ${candidate.label || candidate.ordinal}`, bars: length, bpm: doc.tempo.bpm, muted: false });
    announce('Loop added to the beat. Press Play to hear them together.');
  }

  const full = loops.layers.length >= MAGIC_LAYER_LIMIT;
  const candidates = generation?.candidates || [];
  const terminal = generation && TERMINAL.has(generation.state);
  return (
    <section aria-labelledby="magic-bar-title" className="space-y-4 rounded-2xl border border-vx-border bg-vx-panel p-4">
      <div><h2 id="magic-bar-title" className="text-lg font-black">Magic Bar</h2><p className="text-sm text-vx-fg-muted">Describe a part and get two loops in time with this beat. You see the price before anything is charged.</p></div>
      {!generation ? (
        <form onSubmit={price} className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-bold">Describe the part<input className={`${input} w-full font-normal`} value={prompt} maxLength={MAGIC_PROMPT_MAX} placeholder="Warm Rhodes chords, laid-back" onChange={(e) => { setPrompt(e.target.value); reset(); }} /></label>
          <label className="flex flex-col gap-1 text-sm font-bold">Length<select className={`${input} font-normal`} value={length} onChange={(e) => { setLength(Number(e.target.value)); reset(); }}>{bars.map((n) => <option key={n} value={n}>{n} bars</option>)}</select></label>
          {!quote ? <button type="submit" className={action} disabled={busy || !prompt.trim() || full}>{busy ? 'Pricing…' : 'Price two loops'}</button> : null}
        </form>
      ) : null}
      {full && !generation ? <p className="text-sm text-vx-fg-muted">This beat has {MAGIC_LAYER_LIMIT} loops. Remove one to add another.</p> : null}
      {quote && !generation ? (
        <div className="rounded-xl border border-vx-accent/40 bg-vx-accent/10 p-3">
          <p className="font-bold">Two loops · <span className="text-vx-money">{quote.total_credits} credits</span></p>
          <p className="text-sm text-vx-fg-muted">Balance {quote.balance} → {quote.balance_after}. A failed loop is refunded.</p>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={action} disabled={busy || !quote.affordable} onClick={confirm}>{busy ? 'Confirming once…' : `Confirm · ${quote.total_credits} credits`}</button><button type="button" className={button} onClick={reset}>Change</button></div>
        </div>
      ) : null}
      {generation ? (
        <div aria-live="polite" className="space-y-3">
          <p className="font-bold">{terminal ? 'Loops finished' : 'Making two loops…'}</p>
          <ul className="grid gap-3 md:grid-cols-2">{candidates.map((candidate) => (
            <li key={candidate.job_id || candidate.ordinal} className="rounded-xl border border-vx-border bg-vx-base p-3">
              <div className="flex items-center justify-between gap-2"><strong>Loop {candidate.label || candidate.ordinal}</strong><span className="text-sm capitalize text-vx-fg-muted">{candidate.state}</span></div>
              {candidate.audio_url ? <><MusicPrivateAudio controls preload="none" src={candidate.audio_url} aria-label={`Preview loop ${candidate.label || candidate.ordinal}`} className="mt-2 w-full" /><button type="button" className={`${action} mt-2`} disabled={full || loops.layers.some((layer) => layer.songId === candidate.song_id)} onClick={() => addLayer(candidate)}>Add to beat</button></> : null}
            </li>
          ))}</ul>
          {terminal ? <button type="button" className={button} onClick={() => { setGeneration(null); setQuote(null); }}>Make another</button> : null}
        </div>
      ) : null}
      {loops.layers.length ? (
        <div><h3 className="text-sm font-bold">Loops in this beat</h3><ul className="mt-2 space-y-2">{loops.layers.map((layer) => (
          <li key={layer.songId} className="flex flex-wrap items-center gap-2 rounded-xl bg-vx-base p-2"><span className="min-w-0 flex-1 truncate text-sm">{layer.title} · {layer.bars} bars</span><button type="button" className={button} aria-pressed={layer.muted} onClick={() => loops.toggleMute(layer.songId)}>{layer.muted ? 'Unmute' : 'Mute'}</button><button type="button" className={button} onClick={() => { loops.remove(layer.songId); announce('Loop removed. The song stays in your Library.'); }}>Remove</button></li>
        ))}</ul></div>
      ) : null}
      {loops.error ? <p role="alert" className="text-sm text-vx-danger">{loops.error}</p> : null}
      {error ? <p role="alert" className="rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
    </section>
  );
}
