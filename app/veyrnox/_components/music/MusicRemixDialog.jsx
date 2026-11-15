'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { MusicPrivateAudio } from '../../_lib/useMusicAudioSrc';

const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'refunded']);
const COPY = {
  mashup: {
    eyebrow: 'Two of your songs',
    title: (name) => `Mash up “${name}”`,
    intro: 'Pick a second song of yours. Both are mixed together, then turned into two new songs. Your originals stay as they are.',
    rights: 'I own or have permission to transform both recordings.',
    quote: 'Review the Mashup price',
    working: 'Creating two mashups…',
    done: 'Mashup pair finished',
  },
  sample: {
    eyebrow: 'Start from a moment',
    title: (name) => `Sample “${name}”`,
    intro: 'Choose 5 to 30 seconds of this song. Two new songs grow out of that clip. Your original stays as it is.',
    rights: 'I own or have permission to transform this recording.',
    quote: 'Review the Sample price',
    working: 'Creating two sampled songs…',
    done: 'Sample pair finished',
  },
};

function friendlyError(reason) {
  const code = reason?.code;
  if (code === 'plan_unavailable') return 'Mashup and Sample need an active paid plan.';
  if (code === 'model_unavailable') return 'This provider is not switched on yet. Nothing was charged.';
  if (code === 'format_unavailable') return 'Both songs must be WAV masters. Make a WAV copy from Download first.';
  if (code === 'mix_format_mismatch') return 'These two songs use different audio formats, so they cannot be mixed.';
  if (code === 'source_duration_invalid') return 'Each song must be at least 5 seconds long.';
  if (code === 'sample_range_invalid') return 'Choose a range of 5 to 30 seconds inside the song.';
  if (code === 'revision_conflict' || code === 'source_changed') return 'One of the songs changed. Close this window and open it again.';
  if (code === 'insufficient_balance') return 'You do not have enough credits for both results.';
  return 'This request could not be completed. Nothing was charged.';
}

export function MusicRemixDialog({ kind, song, onClose }) {
  const copy = COPY[kind] || COPY.mashup;
  const closeRef = useRef(null);
  const attemptRef = useRef(null);
  const [songs, setSongs] = useState([]);
  const [secondId, setSecondId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [influence, setInfluence] = useState(50);
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(15);
  const [extend, setExtend] = useState(60);
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

  useEffect(() => {
    if (kind !== 'mashup') return undefined;
    let live = true;
    gatewayFetch('/music/songs?limit=50')
      .then((result) => { if (live) setSongs((result.songs || []).filter((item) => item.id !== song.id && item.version_id)); })
      .catch(() => { if (live) setError('Your other songs could not be loaded.'); });
    return () => { live = false; };
  }, [kind, song.id]);

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

  const resetQuote = () => setQuote(null);
  const second = songs.find((item) => item.id === secondId);

  function body() {
    if (kind === 'mashup') {
      return {
        kind, version_id: song.version_id, second_song_id: second?.id, second_version_id: second?.version_id,
        prompt: prompt.trim(), source_influence: influence, rights_confirmed: rights,
      };
    }
    return {
      kind, version_id: song.version_id, start_seconds: start, end_seconds: start + length,
      extend_seconds: extend, prompt: prompt.trim(), rights_confirmed: rights,
    };
  }

  async function requestQuote(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setQuote(null);
    try {
      setQuote(await gatewayFetch(`/music/songs/${song.id}/remix-quotes`, { method: 'POST', body: JSON.stringify(body()) }));
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (busy || !quote?.quote_id) return;
    setBusy(true); setError('');
    const key = attemptRef.current || `${kind}.${crypto.randomUUID()}`;
    attemptRef.current = key;
    try {
      const accepted = await gatewayFetch(`/music/songs/${song.id}/remixes`, {
        method: 'POST', body: JSON.stringify({ quote_id: quote.quote_id, idempotency_key: key }),
      });
      attemptRef.current = null;
      setGeneration({ id: accepted.generation_id, state: accepted.state, candidates: accepted.candidates });
      await refresh(accepted.generation_id);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  const candidates = generation?.candidates || [];
  const terminal = generation && TERMINAL.has(generation.state);
  const ready = prompt.trim() && rights && (kind !== 'mashup' || second);
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="remix-title" className="w-full max-w-xl rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-2xl sm:p-8">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{copy.eyebrow}</p><h2 id="remix-title" className="mt-2 break-words font-vx text-2xl font-black">{copy.title(song.title)}</h2></div>
          <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border">×</button>
        </div>
        <p className="mt-4 text-sm leading-6 text-vx-fg-muted">{copy.intro}</p>
        {!generation ? (
          <form onSubmit={requestQuote} className="mt-6 space-y-5">
            {kind === 'mashup' ? (
              <label className="block text-sm font-bold">Second song
                <select aria-label="Second song" value={secondId} onChange={(event) => { setSecondId(event.target.value); resetQuote(); }} className="mt-2 min-h-11 w-full rounded-2xl border border-vx-border bg-vx-base px-3 font-normal">
                  <option value="">Choose one of your songs</option>
                  {songs.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
              </label>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-sm font-bold">Start (s)<input aria-label="Sample start in seconds" type="number" min="0" step="1" value={start} onChange={(event) => { setStart(Math.max(0, Number(event.target.value) || 0)); resetQuote(); }} className="mt-2 min-h-11 w-full rounded-2xl border border-vx-border bg-vx-base px-3 font-normal" /></label>
                <label className="block text-sm font-bold">Length · {length}s<input aria-label="Sample length in seconds" type="range" min="5" max="30" step="1" value={length} onChange={(event) => { setLength(Number(event.target.value)); resetQuote(); }} className="mt-4 w-full" /></label>
                <label className="block text-sm font-bold">New music · {extend}s<input aria-label="Seconds of new music after the clip" type="range" min="10" max="90" step="5" value={extend} onChange={(event) => { setExtend(Number(event.target.value)); resetQuote(); }} className="mt-4 w-full" /></label>
              </div>
            )}
            <label className="block text-sm font-bold">Musical direction<textarea aria-label="Musical direction" value={prompt} onChange={(event) => { setPrompt(event.target.value); resetQuote(); }} maxLength={500} rows={3} placeholder="For example: upbeat house groove with bright piano" className="mt-2 w-full rounded-2xl border border-vx-border bg-vx-base p-3 font-normal" /></label>
            {kind === 'mashup' ? <label className="block text-sm font-bold">Keep the originals · {influence}%<input aria-label="Keep the originals" type="range" min="10" max="90" step="10" value={influence} onChange={(event) => { setInfluence(Number(event.target.value)); resetQuote(); }} className="mt-3 w-full" /><span className="mt-1 flex justify-between text-xs font-normal text-vx-fg-muted"><span>More new</span><span>Closer to the originals</span></span></label> : null}
            <label className="flex items-start gap-3 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm"><input type="checkbox" checked={rights} onChange={(event) => { setRights(event.target.checked); resetQuote(); }} className="mt-1 size-4" /><span><strong className="block text-vx-fg">{copy.rights}</strong><span className="mt-1 block leading-5 text-vx-fg-muted">This confirmation is saved with the request.</span></span></label>
            {!quote ? <button type="submit" disabled={busy || !ready} className="min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Measuring and pricing…' : copy.quote}</button> : (
              <div className="rounded-2xl border border-vx-accent/40 bg-vx-accent/10 p-4">
                <p className="font-bold text-vx-fg">Two results · {quote.total_credits} credits total</p>
                <p className="mt-1 text-sm text-vx-fg-muted">{quote.credits_per_candidate} each · balance {quote.balance} → {quote.balance_after} · source {Number(quote.source_duration_seconds).toFixed(1)}s · a failed result is refunded</p>
                <button type="button" onClick={confirm} disabled={busy || !quote.affordable} className="mt-4 min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Confirming once…' : `Confirm and create · ${quote.total_credits} credits`}</button>
              </div>
            )}
          </form>
        ) : (
          <section aria-live="polite" className="mt-6">
            <p className="font-bold text-vx-fg">{terminal ? copy.done : copy.working}</p>
            <ul className="mt-4 space-y-3">{candidates.map((candidate) => <li key={candidate.job_id || candidate.ordinal} className="rounded-2xl border border-vx-border bg-vx-base p-4"><div className="flex items-center justify-between gap-3"><strong>Result {candidate.label || candidate.ordinal}</strong><span className="text-sm capitalize text-vx-fg-muted">{candidate.state}</span></div>{candidate.audio_url ? <MusicPrivateAudio controls preload="none" src={candidate.audio_url} aria-label={`Play result ${candidate.label || candidate.ordinal}`} className="mt-3 w-full" /> : null}</li>)}</ul>
            {terminal ? <p className="mt-4 text-sm text-vx-fg-muted">New songs appear in your Music Library.</p> : null}
            {terminal ? <button type="button" onClick={onClose} className="mt-5 min-h-11 w-full rounded-full border border-vx-border px-5 font-bold">Close</button> : null}
          </section>
        )}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
      </section>
    </div>
  );
}
