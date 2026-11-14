'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MUSIC_DISCOVER_BEATS,
  MUSIC_DISCOVER_MOODS,
  MUSIC_DISCOVER_SECTIONS,
  normalizeMusicSampleMix,
} from '../../../../lib/musicDiscover.js';
import { getStoredUserId } from '../../../lib/authClient.js';
import {
  MUSIC_SAVED_MIXES_CHANGED,
  saveMusicSavedMix,
} from '../../_lib/music/savedMixes.js';
import { LicensedMusicLibrary } from './LicensedMusicLibrary.jsx';
import { useI18n } from '../../../../components/I18nProvider';
import { tOr } from '../../../../lib/i18n/translate.mjs';

const PREVIEW_SECONDS = 12;
const PAGE_SIZE = 24;
const DEFAULT_MIX = Object.freeze({ tempo: 1, drums: 100, bass: 100, melody: 100 });
const moodKey = (mood) => `musicDiscover.mood.${mood.replace(/\s|&/g, '')}`;
const SECTION_KEYS = {
  'For you': 'forYou',
  'Fresh signal': 'freshSignal',
  'Slow burn': 'slowBurn',
  'Fast lane': 'fastLane',
  'Cinematic worlds': 'cinematicWorlds',
};

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

function schedulePreview(beat, rawMix, onProgress, onEnded) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw new Error('audio_unavailable');
  const mix = normalizeMusicSampleMix(rawMix);
  const context = new AudioContext();
  const compressor = context.createDynamicsCompressor();
  const master = context.createGain();
  const drums = context.createGain();
  const bass = context.createGain();
  const melody = context.createGain();
  master.gain.value = 0.55;
  drums.gain.value = mix.drums / 100;
  bass.gain.value = mix.bass / 100;
  melody.gain.value = mix.melody / 100;
  drums.connect(master);
  bass.connect(master);
  melody.connect(master);
  master.connect(compressor).connect(context.destination);
  const noise = makeNoise(context);
  const eighth = 30 / (beat.bpm * mix.tempo);
  const start = context.currentTime + 0.08;
  const stepCount = Math.ceil(PREVIEW_SECONDS / eighth);

  for (let step = 0; step < stepCount; step += 1) {
    const at = start + step * eighth;
    if (step % 4 === 0 || step % 8 === 6) kick(context, drums, at, ['Rock', 'Trap', 'Drum & Bass'].includes(beat.mood) ? 0.7 : 0.48);
    if (step % 8 === 4) noiseHit(context, drums, noise, at, 0.16, 0.22, 900);
    noiseHit(context, drums, noise, at, 0.04, step % 2 ? 0.035 : 0.055, 5000);
    if (step % 2 === 0) {
      const interval = beat.bass[(step / 2) % beat.bass.length];
      tone(context, bass, beat.root * (2 ** (interval / 12)), at, eighth * 1.65, beat.wave, 0.09);
    }
    if (step % 4 === 2) {
      const interval = beat.lead[(step / 2) % beat.lead.length];
      tone(context, melody, beat.root * 2 * (2 ** (interval / 12)), at, eighth * 1.4, beat.wave === 'square' ? 'triangle' : 'sine', 0.035);
    }
    if (step % 8 === 0) {
      [0, 3, 7].forEach((interval, chordIndex) => {
        tone(context, melody, beat.root * 2 * (2 ** (interval / 12)), at + chordIndex * 0.01, eighth * 6.5, 'sine', 0.025);
      });
    }
  }

  const startedAt = window.performance.now();
  const progressTimer = window.setInterval(() => {
    onProgress(Math.min(1, (window.performance.now() - startedAt) / (PREVIEW_SECONDS * 1000)));
  }, 100);
  const endTimer = window.setTimeout(() => {
    window.clearInterval(progressTimer);
    context.close().catch(() => {});
    onProgress(1);
    onEnded();
  }, PREVIEW_SECONDS * 1000 + 180);
  return () => {
    window.clearInterval(progressTimer);
    window.clearTimeout(endTimer);
    context.close().catch(() => {});
  };
}

function PreviewProgress({ title, progress }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between font-vx-mono text-[10px] font-bold text-vx-fg-faint">
        <span>{progress > 0 ? `${Math.min(PREVIEW_SECONDS, Math.max(1, Math.ceil(progress * PREVIEW_SECONDS)))} sec` : 'Ready to preview'}</span>
        <span>12 sec</span>
      </div>
      <div role="progressbar" aria-label={`${title} preview progress`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)} className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-vx-base">
        <span className="block h-full rounded-full bg-vx-accent transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

function BeatCard({ beat, playing, progress, onToggle, onMix }) {
  const { t } = useI18n();
  return (
    <article className="group rounded-2xl border border-vx-border bg-vx-panel p-4 shadow-xl transition motion-safe:hover:-translate-y-0.5 hover:border-vx-border-boost sm:p-5">
      <div className="flex items-start gap-4">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-vx-panel-raised sm:h-20 sm:w-20">
          <Image src={beat.artwork} alt={t('musicDiscover.cover', { title: beat.title })} fill sizes="80px" className="object-cover transition duration-500 motion-safe:group-hover:scale-[1.03]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="font-vx-mono text-[10px] font-bold uppercase tracking-widest text-vx-accent">{beat.mood}</p><h3 className="mt-1 truncate font-vx text-xl font-black">{beat.title}</h3><p className="mt-1 text-sm text-vx-fg-muted">{beat.creator}</p></div>
            <span className="rounded-full border border-vx-border px-2 py-1 font-vx-mono text-[10px] font-bold text-vx-fg-muted">{beat.duration}</span>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-vx-fg-muted">
        <span className="rounded-full border border-vx-border px-2.5 py-1">{beat.bpm} BPM</span>
        <span className="rounded-full border border-vx-border px-2.5 py-1">{beat.musicalKey}</span>
      </div>
      <PreviewProgress title={beat.title} progress={progress} />
      <button type="button" aria-label={t(playing ? 'musicDiscover.pause' : 'musicDiscover.play', { title: beat.title })} aria-pressed={playing} onClick={onToggle} className="vx-press mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-vx-fg px-4 text-sm font-extrabold text-vx-base hover:opacity-90">
        <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span><span>{playing ? 'Pause preview' : 'Listen · 12 sec'}</span>
      </button>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={onMix} className="min-h-10 rounded-full border border-vx-border px-3 text-sm font-bold text-vx-fg-body hover:border-vx-accent hover:text-vx-accent">Mix &amp; tempo</button>
        <Link href={{ pathname: '/app/music/create', query: { sample: beat.id } }} className="vx-press inline-flex min-h-10 items-center justify-center rounded-full bg-vx-accent px-3 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover">
          {t('musicDiscover.sample')}
        </Link>
      </div>
    </article>
  );
}

function MixControl({ id, label, value, onChange }) {
  return (
    <label htmlFor={id} className="block rounded-xl border border-vx-border bg-vx-base px-3 py-3 text-sm font-bold text-vx-fg-body">
      <span className="flex items-center justify-between gap-3"><span>{label}</span><output htmlFor={id} className="font-vx-mono text-xs text-vx-accent">{value}%</output></span>
      <input id={id} type="range" min="0" max="100" step="5" value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-3 w-full accent-vx-accent" />
    </label>
  );
}

function SampleMixLab({ beat, mix, mixName, savedMixId, saveNotice, playing, progress, onChange, onNameChange, onSave, onToggle, onClose }) {
  const effectiveBpm = Math.round(beat.bpm * mix.tempo);
  const query = { sample: beat.id, tempo: mix.tempo.toFixed(2), drums: mix.drums, bass: mix.bass, melody: mix.melody };
  return (
    <section aria-label={`Mix ${beat.title}`} className="mt-8 rounded-2xl border border-vx-accent/60 bg-vx-panel p-4 shadow-2xl sm:p-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-vx-panel-raised"><Image src={beat.artwork} alt="" fill sizes="80px" className="object-cover" /></div>
          <div className="min-w-0"><p className="font-vx-mono text-[10px] font-bold uppercase tracking-widest text-vx-accent">Sample mixer</p><h2 className="mt-1 truncate font-vx text-2xl font-black">Shape {beat.title}</h2><p className="mt-1 text-sm text-vx-fg-muted">Hear every change before carrying the recipe into Create.</p></div>
        </div>
        <button type="button" onClick={onClose} className="min-h-10 self-start rounded-full border border-vx-border px-4 text-sm font-bold text-vx-fg-muted hover:border-vx-border-boost hover:text-vx-fg">Close mixer</button>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="rounded-2xl border border-vx-border bg-vx-base p-4">
          <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-bold text-vx-fg">Tempo</p><p className="mt-1 text-xs text-vx-fg-muted">{effectiveBpm} BPM · {Math.round(mix.tempo * 100)}% speed</p></div><button type="button" onClick={() => onChange(DEFAULT_MIX)} className="min-h-9 rounded-full border border-vx-border px-3 text-xs font-bold text-vx-fg-muted hover:text-vx-fg">Reset mix</button></div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[0.75, 1, 1.25].map((rate) => <button key={rate} type="button" aria-pressed={mix.tempo === rate} onClick={() => onChange({ ...mix, tempo: rate })} className={`min-h-10 rounded-full text-sm font-bold ${mix.tempo === rate ? 'bg-vx-fg text-vx-base' : 'border border-vx-border text-vx-fg-body hover:border-vx-accent'}`}>{rate === 0.75 ? 'Slow' : rate === 1 ? 'Original' : 'Fast'} · {rate}×</button>)}
          </div>
          <label htmlFor="sample-tempo" className="mt-4 block text-xs font-bold text-vx-fg-muted">Fine tempo · 75% to 125%</label>
          <input id="sample-tempo" aria-label="Sample tempo" type="range" min="0.75" max="1.25" step="0.05" value={mix.tempo} onChange={(event) => onChange({ ...mix, tempo: Number(event.target.value) })} className="mt-2 w-full accent-vx-accent" />
          <PreviewProgress title={`${beat.title} mix`} progress={progress} />
          <button type="button" aria-pressed={playing} onClick={onToggle} className="vx-press mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-vx-fg px-5 font-extrabold text-vx-base"><span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>{playing ? 'Pause this mix' : 'Listen to this mix'}</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <MixControl id="sample-drums" label="Drums" value={mix.drums} onChange={(drums) => onChange({ ...mix, drums })} />
          <MixControl id="sample-bass" label="Bass" value={mix.bass} onChange={(bass) => onChange({ ...mix, bass })} />
          <MixControl id="sample-melody" label="Melody" value={mix.melody} onChange={(melody) => onChange({ ...mix, melody })} />
        </div>
      </div>
      <div className="mt-5 border-t border-vx-border pt-5">
        <p className="max-w-3xl text-xs leading-5 text-vx-fg-muted">This saves an editable recipe, not copied audio. “Use this mix” carries the speed and layer balance into a new generation. A single generated track is currently limited to 60 seconds; longer videos need an extended or timeline-fitted soundtrack.</p>
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end">
          <label htmlFor="sample-mix-name" className="min-w-0 flex-1 text-xs font-bold text-vx-fg-muted">Mix name
            <input id="sample-mix-name" value={mixName} onChange={(event) => onNameChange(event.target.value)} maxLength={64} placeholder={`${beat.title} mix`} className="mt-2 min-h-12 w-full rounded-xl border border-vx-border-boost bg-vx-base px-4 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" />
          </label>
          <button type="button" onClick={onSave} className="min-h-12 shrink-0 rounded-full border border-vx-accent px-5 font-extrabold text-vx-accent hover:bg-vx-accent/10">{savedMixId ? 'Update saved mix' : 'Save to Music Library'}</button>
          <Link href={{ pathname: '/app/music/create', query }} className="vx-press inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-vx-accent px-6 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover">Use this mix</Link>
        </div>
        {saveNotice ? <p role={saveNotice.kind === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm font-bold ${saveNotice.kind === 'error' ? 'text-vx-danger' : 'text-vx-accent'}`}>{saveNotice.text}{saveNotice.kind === 'success' ? <> · <Link href="/app/music/library" className="underline underline-offset-4">Open Music Library</Link></> : null}</p> : null}
      </div>
    </section>
  );
}

export function MusicDiscover({ initialSample = null, initialMix = null, initialSavedMixId = '', initialMixName = '' }) {
  const { t } = useI18n();
  const [mood, setMood] = useState('All');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [playingKey, setPlayingKey] = useState(null);
  const [progress, setProgress] = useState(0);
  const [mixingId, setMixingId] = useState(initialSample?.id || null);
  const [mix, setMix] = useState(initialMix || DEFAULT_MIX);
  const [activeSavedMixId, setActiveSavedMixId] = useState(initialSavedMixId);
  const [mixName, setMixName] = useState(initialMixName || (initialSample ? `${initialSample.title} mix` : ''));
  const [saveNotice, setSaveNotice] = useState(null);
  const [audioError, setAudioError] = useState('');
  const stopRef = useRef(null);

  useEffect(() => () => stopRef.current?.(), []);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return MUSIC_DISCOVER_BEATS.filter((beat) => (mood === 'All' || beat.mood === mood)
      && (!query || [beat.title, beat.creator, beat.mood, beat.musicalKey].some((value) => value.toLowerCase().includes(query))));
  }, [mood, search]);
  const displayed = visible.slice(0, visibleCount);
  const mixingBeat = mixingId ? MUSIC_DISCOVER_BEATS.find((beat) => beat.id === mixingId) : null;

  function stopPlayback() {
    stopRef.current?.();
    stopRef.current = null;
    setPlayingKey(null);
    setProgress(0);
  }

  function toggle(beat, sampleMix, key) {
    if (playingKey === key) {
      stopPlayback();
      return;
    }
    stopPlayback();
    setAudioError('');
    try {
      setPlayingKey(key);
      setProgress(0);
      stopRef.current = schedulePreview(beat, sampleMix, setProgress, () => {
        stopRef.current = null;
        setPlayingKey(null);
        setProgress(0);
      });
    } catch {
      setPlayingKey(null);
      setAudioError(t('musicDiscover.audioError'));
    }
  }

  function openMixer(beat) {
    stopPlayback();
    setMixingId(beat.id);
    setMix(DEFAULT_MIX);
    setActiveSavedMixId('');
    setMixName(`${beat.title} mix`);
    setSaveNotice(null);
    window.requestAnimationFrame(() => document.querySelector('[aria-label^="Mix "]')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }));
  }

  function updateMix(next) {
    if (playingKey?.startsWith('mix:')) stopPlayback();
    setMix(normalizeMusicSampleMix(next));
    setSaveNotice(null);
  }

  function saveMix() {
    if (!mixingBeat) return;
    try {
      const saved = saveMusicSavedMix(window.localStorage, getStoredUserId() || 'signed-out', {
        id: activeSavedMixId,
        name: mixName,
        beatId: mixingBeat.id,
        mix,
      });
      if (!saved) throw new Error('invalid_mix');
      setActiveSavedMixId(saved.id);
      setMixName(saved.name);
      setSaveNotice({ kind: 'success', text: 'Saved. You can reopen, edit, or use this recipe from Music Library' });
      window.dispatchEvent(new Event(MUSIC_SAVED_MIXES_CHANGED));
    } catch {
      setSaveNotice({ kind: 'error', text: 'This mix could not be saved in this browser. Your current settings are still here.' });
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="max-w-3xl">
        <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{t('musicDiscover.eyebrow')}</p>
        <h1 className="mt-2 font-vx text-4xl font-black tracking-tight sm:text-6xl">{t('musicDiscover.title')}</h1>
        <p className="mt-4 text-lg leading-8 text-vx-fg-body">{t('musicDiscover.lead')}</p>
        <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-vx-fg-muted"><span className="rounded-full border border-vx-border px-3 py-1.5">100 original samples</span><span className="rounded-full border border-vx-border px-3 py-1.5">20 genres</span><span className="rounded-full border border-vx-border px-3 py-1.5">Tempo + 3-layer mixer</span></div>
      </header>

      <section aria-label={t('musicDiscover.filters')} className="mt-8 rounded-2xl border border-vx-border bg-vx-panel p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1" role="group" aria-label={t('musicDiscover.filterMood')}>
            {MUSIC_DISCOVER_MOODS.map((item) => <button key={item} type="button" aria-pressed={mood === item} onClick={() => { setMood(item); setVisibleCount(PAGE_SIZE); }} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${mood === item ? 'bg-vx-fg text-vx-base' : 'border border-vx-border text-vx-fg-body hover:border-vx-border-boost'}`}>{tOr(t, moodKey(item), item)}</button>)}
          </div>
          <label className="relative block lg:w-72"><span className="sr-only">{t('musicDiscover.searchLabel')}</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCount(PAGE_SIZE); }} placeholder={t('musicDiscover.searchPlaceholder')} className="min-h-11 w-full rounded-full border border-vx-border-boost bg-vx-base px-4 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" /></label>
        </div>
        <p className="mt-3 font-vx-mono text-[11px] font-bold text-vx-fg-faint">Showing {displayed.length} of {visible.length} matching sample beats · 100 total</p>
      </section>

      {audioError ? <p role="alert" className="mt-5 rounded-2xl border border-vx-danger/50 bg-vx-danger/10 px-4 py-3 text-sm text-vx-danger">{audioError}</p> : null}
      {mixingBeat ? <SampleMixLab beat={mixingBeat} mix={mix} mixName={mixName} savedMixId={activeSavedMixId} saveNotice={saveNotice} playing={playingKey === `mix:${mixingBeat.id}`} progress={playingKey === `mix:${mixingBeat.id}` ? progress : 0} onChange={updateMix} onNameChange={(value) => { setMixName(value); setSaveNotice(null); }} onSave={saveMix} onToggle={() => toggle(mixingBeat, mix, `mix:${mixingBeat.id}`)} onClose={() => { stopPlayback(); setMixingId(null); setSaveNotice(null); }} /> : null}

      {MUSIC_DISCOVER_SECTIONS.map((section) => {
        const beats = displayed.filter((beat) => beat.section === section);
        if (!beats.length) return null;
        return <section key={section} aria-labelledby={`discover-${section.replace(/\s/g, '-').toLowerCase()}`} className="mt-10"><div className="mb-5 flex items-end justify-between gap-4"><div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{t('musicDiscover.curated')}</p><h2 id={`discover-${section.replace(/\s/g, '-').toLowerCase()}`} className="mt-1 font-vx text-3xl font-black">{tOr(t, `musicDiscover.section.${SECTION_KEYS[section]}`, section)}</h2></div><p className="hidden text-sm text-vx-fg-muted sm:block">{t('musicDiscover.sketches')}</p></div><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{beats.map((beat) => <BeatCard key={beat.id} beat={beat} playing={playingKey === beat.id} progress={playingKey === beat.id ? progress : 0} onToggle={() => toggle(beat, DEFAULT_MIX, beat.id)} onMix={() => openMixer(beat)} />)}</div></section>;
      })}

      {displayed.length < visible.length ? <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="mx-auto mt-8 block min-h-11 rounded-full border border-vx-border-boost px-6 text-sm font-extrabold text-vx-fg hover:border-vx-accent hover:text-vx-accent">Show {Math.min(PAGE_SIZE, visible.length - displayed.length)} more sample beats</button> : null}
      {!visible.length ? <section className="mt-10 rounded-2xl border border-dashed border-vx-border p-10 text-center"><h2 className="font-vx text-2xl font-black">{t('musicDiscover.empty')}</h2><button type="button" onClick={() => { setMood('All'); setSearch(''); }} className="mt-4 min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold">{t('musicDiscover.showAll')}</button></section> : null}

      <p className="mt-10 text-xs leading-5 text-vx-fg-faint">{t('musicDiscover.note')}</p>
      <LicensedMusicLibrary />
    </div>
  );
}
