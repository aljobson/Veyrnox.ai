'use client';

import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';

export function MusicRenderDialog({ song, onClose, onSaved }) {
  const closeRef = useRef(null);
  const attemptRef = useRef(null);
  const [operation, setOperation] = useState('fade');
  const [duration, setDuration] = useState(0);
  const [fadeIn, setFadeIn] = useState(1);
  const [fadeOut, setFadeOut] = useState(1);
  const [speed, setSpeed] = useState(1.1);
  const [splitAt, setSplitAt] = useState(0);
  const [targetPeak, setTargetPeak] = useState(-2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    closeRef.current?.focus();
    function key(event) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const parameters = operation === 'fade'
    ? { fade_in_seconds: fadeIn, fade_out_seconds: fadeOut }
    : operation === 'speed' ? { speed_ratio: speed }
      : operation === 'reorder' ? { split_seconds: splitAt, order: [2, 1] }
        : { target_peak_dbfs: targetPeak };
  const signature = JSON.stringify({ operation, ...parameters, version_id: song.version_id });
  const fadeInvalid = !duration || fadeIn < 0 || fadeOut < 0 || fadeIn + fadeOut <= 0
    || fadeIn + fadeOut > duration || fadeIn > 30 || fadeOut > 30;
  const speedInvalid = Math.abs(speed - 1) < 0.000001;
  const reorderInvalid = duration < 2 || splitAt < 1 || splitAt > duration - 1;
  const operationInvalid = operation === 'fade' ? fadeInvalid
    : operation === 'speed' ? speedInvalid
      : operation === 'reorder' ? reorderInvalid : ![-3, -2, -1].includes(targetPeak);

  async function save() {
    if (busy || operationInvalid) return;
    setBusy(true);
    setError('');
    if (!attemptRef.current || attemptRef.current.signature !== signature) {
      attemptRef.current = { signature, key: `render.${crypto.randomUUID()}` };
    }
    try {
      await gatewayFetch(`/music/songs/${song.id}/render`, {
        method: 'POST',
        body: JSON.stringify({ operation, version_id: song.version_id, ...parameters, idempotency_key: attemptRef.current.key }),
      });
      attemptRef.current = null;
      await onSaved();
      onClose();
    } catch (reason) {
      const copy = {
        render_format_unsupported: 'Fade and speed rendering currently require a fixed-frame PCM WAV master.',
        fade_range_invalid: 'The fades must fit inside the measured recording.',
        speed_ratio_invalid: 'Choose a speed from 0.5× to 2×, other than the original 1×.',
        reorder_range_invalid: 'Choose a split that leaves at least one second in each section.',
        remaster_target_invalid: 'Choose one of the three bounded remaster ceilings.',
        remaster_silence: 'This recording is silent after DC correction, so it cannot be remastered.',
      };
      setError(copy[reason?.code] || 'The new master could not be saved. The original version is unchanged.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="render-title" className="w-full max-w-lg rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-2xl sm:p-8">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Rendered WAV edit</p><h2 id="render-title" className="mt-2 font-vx text-2xl font-black">Edit “{song.title}”</h2></div>
          <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border">×</button>
        </div>
        <p className="mt-4 text-sm leading-6 text-vx-fg-muted">Create a new exportable PCM WAV master. The source stays intact in version history. Reorder swaps two sections; speed changes duration and pitch together; Remaster removes channel DC bias and applies linked peak normalization without inventing spectral detail.</p>
        <audio controls preload="metadata" src={song.audio_url} aria-label={`Preview original ${song.title}`} className="mt-5 w-full" onLoadedMetadata={(event) => { const value = event.currentTarget.duration; if (Number.isFinite(value)) { setDuration(value); setSplitAt(Math.max(1, Math.min(value - 1, value / 2))); } }} />
        <div role="tablist" aria-label="Rendered edit" className="mt-5 flex rounded-full border border-vx-border bg-vx-base p-1 text-sm font-bold">
          <button type="button" role="tab" aria-selected={operation === 'fade'} onClick={() => { setOperation('fade'); setError(''); }} className={`min-h-10 flex-1 rounded-full px-4 ${operation === 'fade' ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted'}`}>Fade</button>
          <button type="button" role="tab" aria-selected={operation === 'speed'} onClick={() => { setOperation('speed'); setError(''); }} className={`min-h-10 flex-1 rounded-full px-4 ${operation === 'speed' ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted'}`}>Speed</button>
          <button type="button" role="tab" aria-selected={operation === 'reorder'} onClick={() => { setOperation('reorder'); setError(''); }} className={`min-h-10 flex-1 rounded-full px-4 ${operation === 'reorder' ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted'}`}>Reorder</button>
          <button type="button" role="tab" aria-selected={operation === 'remaster'} onClick={() => { setOperation('remaster'); setError(''); }} className={`min-h-10 flex-1 rounded-full px-4 ${operation === 'remaster' ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted'}`}>Remaster</button>
        </div>
        {operation === 'fade' ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-bold">Fade in seconds<input aria-label="Fade in seconds" type="number" min="0" max={Math.min(30, duration || 30)} step="0.1" value={fadeIn} onChange={(event) => setFadeIn(Number(event.target.value))} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3" /></label>
            <label className="text-sm font-bold">Fade out seconds<input aria-label="Fade out seconds" type="number" min="0" max={Math.min(30, duration || 30)} step="0.1" value={fadeOut} onChange={(event) => setFadeOut(Number(event.target.value))} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3" /></label>
            {fadeInvalid && duration ? <p role="status" className="text-sm text-vx-danger sm:col-span-2">Use at least one fade and keep their combined length within {duration.toFixed(1)} seconds.</p> : null}
          </div>
        ) : operation === 'speed' ? (
          <label className="mt-5 block text-sm font-bold">Speed <span className="font-vx-mono text-vx-accent">{speed.toFixed(2)}×</span><input aria-label="Speed ratio" type="range" min="0.5" max="2" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="mt-3 w-full accent-vx-accent" /><span className="mt-2 flex justify-between text-xs font-normal text-vx-fg-muted"><span>0.5× slower</span><span>2× faster</span></span></label>
        ) : operation === 'reorder' ? (
          <div className="mt-5">
            <label className="block text-sm font-bold">Split after <span className="font-vx-mono text-vx-accent">{splitAt.toFixed(1)}s</span><input aria-label="Section split time" type="range" min="1" max={Math.max(1, duration - 1)} step="0.1" value={splitAt} onChange={(event) => setSplitAt(Number(event.target.value))} className="mt-3 w-full accent-vx-accent" /></label>
            <p className="mt-3 rounded-xl border border-vx-border bg-vx-base p-3 text-sm text-vx-fg-muted">New order: section 2 ({splitAt.toFixed(1)}s–{duration.toFixed(1)}s), then section 1 (0–{splitAt.toFixed(1)}s).</p>
          </div>
        ) : (
          <div className="mt-5">
            <label className="block text-sm font-bold">Remaster character<select aria-label="Remaster character" value={targetPeak} onChange={(event) => setTargetPeak(Number(event.target.value))} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 font-normal"><option value={-3}>Gentle · −3 dBFS peak</option><option value={-2}>Balanced · −2 dBFS peak</option><option value={-1}>Forward · −1 dBFS peak</option></select></label>
            <p className="mt-3 rounded-xl border border-vx-border bg-vx-base p-3 text-sm text-vx-fg-muted">All channels keep one linked gain, preserving the stereo image. This is deterministic level cleanup—not AI mastering, compression, EQ, or loudness matching.</p>
          </div>
        )}
        <button type="button" onClick={save} disabled={busy || operationInvalid} className="mt-6 min-h-11 w-full rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">{busy ? 'Rendering new master…' : operation === 'fade' ? 'Save faded WAV as new version' : operation === 'speed' ? 'Save speed-adjusted WAV as new version' : operation === 'reorder' ? 'Save reordered WAV as new version' : 'Save remastered WAV as new version'}</button>
        {error ? <p role="alert" className="mt-4 rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
      </section>
    </div>
  );
}
