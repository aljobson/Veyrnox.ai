'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getServerShelf, getShelf, removeShelfTake, subscribeShelf } from '../../_lib/music/instrumentShelf';

export function MusicStudioInstrumentTakes({ sourceAudioRef }) {
  const takes = useSyncExternalStore(subscribeShelf, getShelf, getServerShelf);
  const [offsets, setOffsets] = useState({});
  const [message, setMessage] = useState('');
  const contextRef = useRef(null);
  const activeRef = useRef([]);

  const stopAll = () => { activeRef.current.forEach((source) => { try { source.stop(); } catch {} }); activeRef.current = []; };
  useEffect(() => () => { stopAll(); contextRef.current?.close?.(); }, []);

  async function play(take, withSong) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) { setMessage('This browser has no Web Audio support.'); return; }
    contextRef.current ||= new Context();
    const context = contextRef.current;
    await context.resume?.();
    stopAll();
    const buffer = context.createBuffer(1, take.samples.length, take.sampleRate);
    buffer.copyToChannel(take.samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const delay = withSong ? Math.max(0, Math.min(60, Number(offsets[take.id]) || 0)) : 0;
    if (withSong) { try { await sourceAudioRef.current?.play(); } catch {} }
    source.start(context.currentTime + delay);
    activeRef.current = [source];
    setMessage(withSong ? `Playing with the song from the playhead${delay ? `, take enters after ${delay}s` : ''}.` : 'Playing the take on its own.');
  }

  return (
    <section aria-label="Instrument takes" className="border-t border-vx-border bg-vx-base/80 p-4">
      <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Instrument takes</p>
      <h2 className="mt-1 font-vx text-xl font-black">Audition your playing against this song</h2>
      {takes.length === 0 ? (
        <p className="mt-2 text-sm text-vx-fg-muted">No takes on the shelf. <Link href="/app/music/instruments" className="font-bold text-vx-accent">Play an instrument</Link>, record a take and choose Send to Studio.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {takes.map((take) => (
            <li key={take.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-vx-border bg-vx-panel p-3">
              <div className="mr-auto min-w-0"><strong className="block truncate">{take.label}</strong><span className="font-vx-mono text-xs text-vx-fg-muted">{take.seconds.toFixed(1)}s</span></div>
              <label className="text-xs font-bold text-vx-fg-muted">Enters after (s)<input type="number" min="0" max="60" step="0.1" value={offsets[take.id] ?? 0} onChange={(event) => setOffsets((current) => ({ ...current, [take.id]: event.target.value }))} className="ml-2 min-h-10 w-20 rounded-xl border border-vx-border bg-vx-base px-2 text-vx-fg" /></label>
              <button type="button" onClick={() => play(take, false)} className="min-h-10 rounded-full border border-vx-border px-4 text-sm font-bold">Play take</button>
              <button type="button" onClick={() => play(take, true)} className="min-h-10 rounded-full bg-vx-accent px-4 text-sm font-bold text-vx-accent-ink">Play with song</button>
              <button type="button" onClick={() => removeShelfTake(take.id)} className="min-h-10 rounded-full border border-vx-border px-3 text-sm text-vx-fg-muted">Remove</button>
            </li>
          ))}
        </ol>
      )}
      {message ? <p role="status" className="mt-3 text-xs text-vx-fg-muted">{message}</p> : null}
      <p className="mt-3 text-xs leading-5 text-vx-fg-muted">Auditioning only: takes are held in this tab, are not saved with the song and are not part of any export.</p>
    </section>
  );
}
