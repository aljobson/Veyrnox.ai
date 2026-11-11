'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MUSIC_DISCOVER_BEATS, MUSIC_DISCOVER_MOODS } from '../../../../lib/musicDiscover.js';
import { MusicReferenceImporter } from './MusicReferenceImporter.jsx';

const PREVIEW_SECONDS = 12;

function ramp(param, start, peak, end, value) {
  param.setValueAtTime(0.0001, start);
  param.exponentialRampToValueAtTime(Math.max(0.0001, value), peak);
  param.exponentialRampToValueAtTime(0.0001, end);
}

function tone(context, output, frequency, start, length, type, volume) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  ramp(gain.gain, start, start + 0.015, start + length, volume);
  oscillator.connect(gain).connect(output);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}

function kick(context, output, start, volume = 0.5) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.setValueAtTime(145, start);
  oscillator.frequency.exponentialRampToValueAtTime(48, start + 0.12);
  ramp(gain.gain, start, start + 0.005, start + 0.2, volume);
  oscillator.connect(gain).connect(output);
  oscillator.start(start);
  oscillator.stop(start + 0.22);
}

function noiseHit(context, output, buffer, start, length, volume, highpass) {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = 'highpass';
  filter.frequency.value = highpass;
  ramp(gain.gain, start, start + 0.003, start + length, volume);
  source.connect(filter).connect(gain).connect(output);
  source.start(start);
  source.stop(start + length + 0.02);
}

function makeNoise(context) {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

function schedulePreview(beat, onEnded) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw new Error('audio_unavailable');
  const context = new AudioContext();
  const compressor = context.createDynamicsCompressor();
  const master = context.createGain();
  master.gain.value = 0.55;
  master.connect(compressor).connect(context.destination);
  const noise = makeNoise(context);
  const eighth = 30 / beat.bpm;
  const start = context.currentTime + 0.08;
  const stepCount = Math.ceil(PREVIEW_SECONDS / eighth);

  for (let step = 0; step < stepCount; step += 1) {
    const at = start + step * eighth;
    if (step % 4 === 0 || step % 8 === 6) kick(context, master, at, beat.mood === 'Heavy' ? 0.7 : 0.48);
    if (step % 8 === 4) noiseHit(context, master, noise, at, 0.16, 0.22, 900);
    noiseHit(context, master, noise, at, 0.04, step % 2 ? 0.035 : 0.055, 5000);
    if (step % 2 === 0) {
      const interval = beat.bass[(step / 2) % beat.bass.length];
      tone(context, master, beat.root * (2 ** (interval / 12)), at, eighth * 1.65, beat.wave, 0.09);
    }
    if (step % 8 === 0) {
      [0, 3, 7].forEach((interval, chordIndex) => {
        tone(context, master, beat.root * 2 * (2 ** (interval / 12)), at + chordIndex * 0.01, eighth * 6.5, 'sine', 0.025);
      });
    }
  }

  const timeout = window.setTimeout(() => {
    context.close();
    onEnded();
  }, PREVIEW_SECONDS * 1000 + 180);
  return () => {
    window.clearTimeout(timeout);
    context.close();
  };
}

function BeatCard({ beat, playing, onToggle }) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-vx-border bg-vx-panel shadow-xl transition hover:-translate-y-0.5 hover:border-vx-border-boost">
      <div className="relative aspect-square overflow-hidden bg-vx-panel-raised">
        <Image src={beat.artwork} alt={`${beat.title} cover artwork`} fill sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw" className="object-cover transition duration-500 group-hover:scale-[1.03]" />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/80 via-black/20 to-transparent p-4 pt-16 text-white">
          <button type="button" aria-label={`${playing ? 'Pause' : 'Play'} ${beat.title} preview`} aria-pressed={playing} onClick={onToggle} className="grid h-12 w-12 place-items-center rounded-full bg-white text-xl font-black text-black shadow-2xl transition hover:scale-105">
            <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
          </button>
          <span className="rounded-full bg-black/55 px-2.5 py-1 font-vx-mono text-[11px] font-bold">{beat.duration}</span>
        </div>
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0"><h3 className="truncate font-vx text-xl font-black">{beat.title}</h3><p className="mt-1 text-sm text-vx-fg-muted">{beat.creator}</p></div>
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: beat.accent }} aria-hidden="true" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-vx-fg-muted">
          <span className="rounded-full border border-vx-border px-2.5 py-1">{beat.bpm} BPM</span>
          <span className="rounded-full border border-vx-border px-2.5 py-1">{beat.musicalKey}</span>
          <span className="rounded-full border border-vx-border px-2.5 py-1">{beat.mood}</span>
        </div>
        <Link href={{ pathname: '/app/music/create', query: { sample: beat.id } }} className="vx-press mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-vx-accent px-4 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover">
          Sample this beat
        </Link>
      </div>
    </article>
  );
}

export function MusicDiscover({ referencesEnabled = false, sourcesEnabled = false }) {
  const [mood, setMood] = useState('All');
  const [search, setSearch] = useState('');
  const [playingId, setPlayingId] = useState(null);
  const [audioError, setAudioError] = useState('');
  const stopRef = useRef(null);

  useEffect(() => () => stopRef.current?.(), []);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return MUSIC_DISCOVER_BEATS.filter((beat) => (mood === 'All' || beat.mood === mood)
      && (!query || [beat.title, beat.creator, beat.mood, beat.musicalKey].some((value) => value.toLowerCase().includes(query))));
  }, [mood, search]);

  function toggle(beat) {
    stopRef.current?.();
    stopRef.current = null;
    setAudioError('');
    if (playingId === beat.id) {
      setPlayingId(null);
      return;
    }
    try {
      setPlayingId(beat.id);
      stopRef.current = schedulePreview(beat, () => {
        stopRef.current = null;
        setPlayingId(null);
      });
    } catch {
      setPlayingId(null);
      setAudioError('Audio preview is not available in this browser. You can still open the seed in Create.');
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="max-w-3xl">
        <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Original seeds · ready to shape</p>
        <h1 className="mt-2 font-vx text-4xl font-black tracking-tight sm:text-6xl">Find a beat. Make it yours.</h1>
        <p className="mt-4 text-lg leading-8 text-vx-fg-body">Preview original Veyrnox beat sketches, then carry one production recipe into Create and add your own direction before reviewing the exact credit quote.</p>
      </header>

      <MusicReferenceImporter referencesEnabled={referencesEnabled} sourcesEnabled={sourcesEnabled} />

      <section aria-label="Discover filters" className="mt-8 rounded-2xl border border-vx-border bg-vx-panel p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by mood">
            {MUSIC_DISCOVER_MOODS.map((item) => <button key={item} type="button" aria-pressed={mood === item} onClick={() => setMood(item)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${mood === item ? 'bg-vx-fg text-vx-base' : 'border border-vx-border text-vx-fg-body hover:border-vx-border-boost'}`}>{item}</button>)}
          </div>
          <label className="relative block lg:w-72"><span className="sr-only">Search beats</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search beats, moods or keys" className="min-h-11 w-full rounded-full border border-vx-border-boost bg-vx-base px-4 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" /></label>
        </div>
      </section>

      {audioError ? <p role="alert" className="mt-5 rounded-2xl border border-vx-danger/50 bg-vx-danger/10 px-4 py-3 text-sm text-vx-danger">{audioError}</p> : null}

      {['For you', 'Fresh signal'].map((section) => {
        const beats = visible.filter((beat) => beat.section === section);
        if (!beats.length) return null;
        return <section key={section} aria-labelledby={`discover-${section.replace(/\s/g, '-').toLowerCase()}`} className="mt-10"><div className="mb-5 flex items-end justify-between gap-4"><div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Curated by Veyrnox</p><h2 id={`discover-${section.replace(/\s/g, '-').toLowerCase()}`} className="mt-1 font-vx text-3xl font-black">{section}</h2></div><p className="hidden text-sm text-vx-fg-muted sm:block">Playable 12-second sketches</p></div><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{beats.map((beat) => <BeatCard key={beat.id} beat={beat} playing={playingId === beat.id} onToggle={() => toggle(beat)} />)}</div></section>;
      })}

      {!visible.length ? <section className="mt-10 rounded-2xl border border-dashed border-vx-border p-10 text-center"><h2 className="font-vx text-2xl font-black">No beats match that filter.</h2><button type="button" onClick={() => { setMood('All'); setSearch(''); }} className="mt-4 min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold">Show every beat</button></section> : null}

      <p className="mt-10 text-xs leading-5 text-vx-fg-faint">Previews are original procedural sketches rendered in your browser. “Sample” carries the musical recipe—not a copied recording—into a new private generation, where you can change the direction before any credits move.</p>
    </div>
  );
}
