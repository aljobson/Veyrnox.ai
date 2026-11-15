'use client';

import { useCallback, useEffect, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';

/**
 * Listen and rank (0538): two published tracks whose creators opted in; pick the
 * one you like more. No credits are paid. A choice counts only after you have
 * had time to listen, so the buttons wait 10 seconds.
 */
export function MusicLabsRank() {
  const [pair, setPair] = useState(undefined);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const next = useCallback(async () => {
    setError(''); setReady(false);
    try {
      const result = await gatewayFetch('/music/labs-rank', { promptOnAuth: false });
      setPair(result.pair || null);
    } catch (reason) {
      setPair(null);
      setError(reason?.status === 429 ? 'That is enough for today. Come back tomorrow.' : 'A pair could not be loaded.');
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(next, 0); return () => window.clearTimeout(timer); }, [next]);
  useEffect(() => {
    if (!pair) return undefined;
    const timer = window.setTimeout(() => setReady(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [pair]);

  async function vote(winner) {
    if (!pair || busy) return;
    setBusy(true); setError('');
    try {
      await gatewayFetch('/music/labs-rank', { method: 'POST', body: JSON.stringify({ action: 'vote', pair_id: pair.id, winner }) });
      setCount((value) => value + 1);
      await next();
    } catch (reason) {
      setError(reason?.code === 'listen_first' ? 'Listen to both for a few seconds first.' : 'Your choice was not saved. Try again.');
    } finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="rank-title" className="mt-6 rounded-2xl border border-vx-border bg-vx-panel p-6 sm:p-8">
      <h2 id="rank-title" className="font-vx text-2xl font-black">Listen and rank</h2>
      <p className="mt-2 text-sm text-vx-fg-muted">Hear two tracks from other creators and pick the one you like more. It helps good music get found. No credits are paid.</p>
      {pair === undefined ? <div aria-busy="true" aria-label="Loading a pair" className="vx-shimmer mt-5 h-40 rounded-2xl bg-vx-base" /> : null}
      {pair === null && !error ? <p className="mt-5 rounded-2xl border border-dashed border-vx-border p-6 text-sm text-vx-fg-muted">No tracks to rank right now. Creators choose whether their tracks appear here.</p> : null}
      {pair ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {['a', 'b'].map((side) => (
            <div key={side} className="rounded-2xl border border-vx-border bg-vx-base p-4">
              <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-fg-muted">Track {side.toUpperCase()}</p>
              <p className="mt-1 break-words font-bold text-vx-fg">{pair[side].title}</p>
              <audio controls preload="none" src={pair[side].audio_url} aria-label={`Play track ${side.toUpperCase()}`} className="mt-3 w-full" />
              <button type="button" disabled={!ready || busy} onClick={() => vote(side)} className="mt-3 min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{ready ? `I prefer ${side.toUpperCase()}` : 'Listen first…'}</button>
            </div>
          ))}
        </div>
      ) : null}
      <p role="status" className="mt-3 min-h-5 text-sm text-vx-fg-muted">{count ? `${count} ranked this visit. Thank you.` : ''}</p>
      {error ? <div role="alert" className="mt-2 flex flex-wrap items-center gap-3 text-sm text-vx-danger"><span>{error}</span><button type="button" onClick={next} className="min-h-11 rounded-full border border-current px-4 font-bold">Try another pair</button></div> : null}
    </section>
  );
}

/** The creator's switch on a published song: may Labs listeners rank it? */
export function MusicRankingOptIn({ songId }) {
  const [allow, setAllow] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    gatewayFetch(`/music/labs-rank?song_id=${encodeURIComponent(songId)}`, { promptOnAuth: false })
      .then((result) => { if (live) setAllow(result.allow_ranking === true); })
      .catch(() => { if (live) setAllow(null); });
    return () => { live = false; };
  }, [songId]);
  if (allow === null && !error) return null;
  async function change(next) {
    setError('');
    try { const result = await gatewayFetch('/music/labs-rank', { method: 'POST', body: JSON.stringify({ action: 'opt_in', song_id: songId, allow: next }) }); setAllow(result.allow_ranking === true); }
    catch { setError('The setting could not be saved.'); }
  }
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-vx-border bg-vx-base p-4 text-sm">
      <input type="checkbox" checked={allow === true} onChange={(event) => change(event.target.checked)} className="mt-1 size-4" />
      <span><strong className="block text-vx-fg">Let listeners rank this track in Labs</strong><span className="mt-1 block leading-5 text-vx-fg-muted">It may be paired with other creators&apos; tracks. Rankings stay inside Veyrnox. Off unless you turn it on.</span>{error ? <span role="alert" className="mt-1 block text-vx-danger">{error}</span> : null}</span>
    </label>
  );
}
