'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { MusicStudioClipEditor } from './MusicStudioClipEditor';
import { MusicStudioEffects } from './MusicStudioEffects';
import dynamic from 'next/dynamic';
import { MusicStudioLatencyCalibration } from './MusicStudioLatencyCalibration';
import { MusicStudioMidi } from './MusicStudioMidi';
import { MusicStudioRecorder } from './MusicStudioRecorder';

// Browser-only (Web Audio, IndexedDB): keep it out of the server render and the Worker bundle's size budget.
const MusicStudioInstrumentTakes = dynamic(() => import('./MusicStudioInstrumentTakes').then((module) => module.MusicStudioInstrumentTakes), { ssr: false });

function clock(value) {
  const seconds = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function MusicStudioWorkspace({ id }) {
  const audioRef = useRef(null); const metronomeRef = useRef(null);
  const [song, setSong] = useState(null); const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false); const [current, setCurrent] = useState(0); const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState(false); const [muted, setMuted] = useState(false); const [volume, setVolume] = useState(1);
  const [effectsActive, setEffectsActive] = useState(false);
  const [tempo, setTempo] = useState(120); const [signature, setSignature] = useState('4/4'); const [metronome, setMetronome] = useState(false);
  const [trackVisible, setTrackVisible] = useState(true); const [density, setDensity] = useState('wide'); const [contrast, setContrast] = useState('soft');

  const load = useCallback(async () => {
    setError('');
    try { setSong(await gatewayFetch(`/music/songs/${id}`)); }
    catch { setError('This private song cannot be opened in Studio.'); }
  }, [id]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);

  useEffect(() => {
    if (!playing || !metronome) { window.clearInterval(metronomeRef.current); return undefined; }
    const tick = () => {
      try {
        const Context = window.AudioContext || window.webkitAudioContext; if (!Context) return;
        const context = new Context(); const oscillator = context.createOscillator(); const gain = context.createGain();
        oscillator.frequency.value = 880; gain.gain.setValueAtTime(0.04, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.04);
        oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.05);
        oscillator.onended = () => context.close();
      } catch {}
    };
    tick(); metronomeRef.current = window.setInterval(tick, 60000 / tempo);
    return () => window.clearInterval(metronomeRef.current);
  }, [metronome, playing, tempo]);

  async function togglePlayback() {
    const audio = audioRef.current; if (!audio) return;
    if (audio.paused) { try { await audio.play(); } catch {} } else audio.pause();
  }

  if (error) return <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6"><section role="alert" className="rounded-2xl border border-vx-border bg-vx-panel p-8"><h1 className="font-vx text-3xl font-black">Studio unavailable</h1><p className="mt-3 text-vx-fg-body">{error}</p><button type="button" onClick={load} className="mt-5 min-h-11 rounded-full border border-vx-border px-5 font-bold">Retry</button></section></div>;
  if (!song) return <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6" aria-busy="true"><div className="vx-shimmer h-[36rem] rounded-2xl bg-vx-panel" /></div>;
  const versions = Array.isArray(song.versions) ? song.versions : [];
  return (
    <div className={`mx-auto max-w-7xl px-3 py-6 sm:px-6 ${contrast === 'high' ? 'contrast-125' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><Link href={`/app/music/songs/${song.id}`} className="text-sm font-bold text-vx-fg-muted hover:text-vx-fg">← Song details</Link><p className="mt-3 font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Unsaved local session</p><h1 className="mt-1 font-vx text-3xl font-black sm:text-4xl">{song.title}</h1></div><span className="rounded-full border border-vx-warn/40 bg-vx-warn/[0.07] px-3 py-2 text-xs font-bold text-vx-fg-body">No project save</span></div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-label="Studio timeline" className="min-w-0 overflow-hidden rounded-2xl border border-vx-border bg-vx-panel shadow-2xl">
          <div className="flex flex-wrap items-center gap-2 border-b border-vx-border p-3">
            <button type="button" onClick={() => { if (audioRef.current) audioRef.current.currentTime = 0; }} aria-label="Return to start" className="min-h-11 rounded-full border border-vx-border px-4 font-bold">↤</button>
            <button type="button" onClick={togglePlayback} className="min-h-11 rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">{playing ? 'Pause' : 'Play'}</button>
            <span className="font-vx-mono text-sm" aria-live="polite">{clock(current)} / {clock(duration)}</span>
            <label className="ml-auto flex min-h-11 items-center gap-2 rounded-full border border-vx-border px-3 text-sm font-bold"><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} /> Loop</label>
            <label className="flex min-h-11 items-center gap-2 rounded-full border border-vx-border px-3 text-sm font-bold"><input type="checkbox" checked={metronome} onChange={(event) => setMetronome(event.target.checked)} /> Metronome</label>
          </div>
          <div className="grid gap-3 border-b border-vx-border bg-vx-base p-3 sm:grid-cols-4">
            <label className="text-xs font-bold text-vx-fg-muted">Tempo guide<input aria-label="Tempo guide" type="number" min="40" max="240" value={tempo} onChange={(event) => setTempo(Math.max(40, Math.min(240, Number(event.target.value) || 120)))} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 text-vx-fg" /></label>
            <label className="text-xs font-bold text-vx-fg-muted">Time signature<select value={signature} onChange={(event) => setSignature(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 text-vx-fg"><option>4/4</option><option>3/4</option><option>6/8</option></select></label>
            <label className="text-xs font-bold text-vx-fg-muted">Grid density<select value={density} onChange={(event) => setDensity(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 text-vx-fg"><option value="wide">Wide</option><option value="dense">Dense</option></select></label>
            <label className="text-xs font-bold text-vx-fg-muted">Grid contrast<select value={contrast} onChange={(event) => setContrast(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 text-vx-fg"><option value="soft">Soft</option><option value="high">High</option></select></label>
          </div>
          <div className={`overflow-x-auto p-4 ${density === 'dense' ? 'bg-[linear-gradient(90deg,transparent_23px,rgba(255,255,255,.06)_24px)] bg-[length:24px_100%]' : 'bg-[linear-gradient(90deg,transparent_47px,rgba(255,255,255,.06)_48px)] bg-[length:48px_100%]'}`}>
            <div className="min-w-[42rem]">
              <div className="mb-2 flex h-6 justify-between font-vx-mono text-xs text-vx-fg-faint"><span>0:00</span><span>Project guide · {tempo} BPM · {signature}</span><span>{clock(duration)}</span></div>
              <div className="grid grid-cols-[9rem_minmax(0,1fr)] overflow-hidden rounded-2xl border border-vx-border bg-vx-base">
                <div className="border-r border-vx-border p-3"><div className="flex items-center justify-between gap-2"><strong>Audio 1</strong><button type="button" onClick={() => setTrackVisible((value) => !value)} aria-pressed={!trackVisible} className="rounded-full border border-vx-border px-2 py-1 text-xs font-bold">{trackVisible ? 'Hide' : 'Show'}</button></div><label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={muted} onChange={(event) => setMuted(event.target.checked)} /> Mute</label><label className="mt-3 block text-xs">Volume<input aria-label="Track volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="mt-1 w-full" /></label></div>
                <button type="button" aria-label="Seek within audio clip" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); if (audioRef.current && duration) audioRef.current.currentTime = ((event.clientX - rect.left) / rect.width) * duration; }} className="relative min-h-36 overflow-hidden p-3 text-left">
                  {trackVisible ? <div className="h-full rounded-xl border border-vx-accent/40 bg-vx-accent/15 p-3"><p className="font-bold">Version {song.current_version?.version_number || 1} · full source clip</p><div className="mt-5 flex h-12 items-center gap-1" aria-hidden="true">{Array.from({ length: 48 }, (_, index) => <span key={index} className="w-full rounded-full bg-vx-accent" style={{ height: `${18 + ((index * 17) % 76)}%` }} />)}</div></div> : <div className="grid h-full place-items-center rounded-xl border border-dashed border-vx-border text-sm text-vx-fg-muted">Track hidden from timeline</div>}
                  <span className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${duration ? Math.min(100, (current / duration) * 100) : 0}%` }} />
                </button>
              </div>
            </div>
          </div>
          <audio ref={audioRef} src={song.audio_url} loop={loop} muted={effectsActive ? false : muted} volume={effectsActive ? 1 : volume} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} onEnded={() => setPlaying(false)} className="sr-only" />
          <MusicStudioEffects sourceAudioRef={audioRef} playheadSeconds={current} duration={duration} manualVolume={volume} muted={muted} onActiveChange={setEffectsActive} />
          <MusicStudioClipEditor sourceAudioRef={audioRef} sourceTitle={song.title} duration={duration} />
          <MusicStudioRecorder tempo={tempo} signature={signature} sourceAudioRef={audioRef} />
          <MusicStudioLatencyCalibration />
          <MusicStudioMidi tempo={tempo} playheadSeconds={current} />
          <MusicStudioInstrumentTakes sourceAudioRef={audioRef} />
        </section>
        <aside aria-label="Studio Library dock" className="rounded-2xl border border-vx-border bg-vx-panel p-4">
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Library dock</p><h2 className="mt-2 font-vx text-xl font-black">Owned versions</h2>
          <p className="mt-2 text-xs leading-5 text-vx-fg-muted">Read-only in this slice. Opening a prior version does not change the current song.</p>
          <ol className="mt-4 max-h-72 space-y-2 overflow-y-auto">{versions.map((version) => <li key={version.id} className="rounded-xl border border-vx-border bg-vx-base p-3 text-sm"><strong>Version {version.version_number}</strong><span className="mt-1 block text-xs capitalize text-vx-fg-muted">{String(version.operation || 'generation').replaceAll('_', ' ')}{version.is_current ? ' · current' : ''}</span></li>)}</ol>
          <div className="mt-5 rounded-2xl border border-vx-warn/40 bg-vx-warn/[0.07] p-3 text-xs leading-5 text-vx-fg-body"><strong className="block text-vx-fg">Session-only controls</strong>Tempo and time signature guide the grid and metronome; they do not stretch the source. Local clip renders, microphone takes, measured latency, MIDI notes, effects and automation are unsaved. Calibration reports delay but does not align takes. No pitch-preserving stretch, saved arrangement, custom plugin or Studio mix export is available yet.</div>
        </aside>
      </div>
    </div>
  );
}
