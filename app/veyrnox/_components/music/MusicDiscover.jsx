'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MUSIC_DISCOVER_BEATS,
  MUSIC_DISCOVER_LISTED_BEATS,
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
import { MusicBestOf } from './MusicBestOf';
import { useI18n } from '../../../../components/I18nProvider';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import {
  MUSIC_SAMPLE_PREVIEW_SECONDS as PREVIEW_SECONDS,
  scheduleMusicSamplePreview,
} from '../../_lib/music/samplePreview.js';

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

export function MusicDiscover({ initialSample = null, initialMix = null, initialSavedMixId = '', initialMixName = '', dailyChallenge = null }) {
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
    return MUSIC_DISCOVER_LISTED_BEATS.filter((beat) => (mood === 'All' || beat.mood === mood)
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
      stopRef.current = scheduleMusicSamplePreview(beat, sampleMix, setProgress, () => {
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
        <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-vx-fg-muted"><span className="rounded-full border border-vx-border px-3 py-1.5">{MUSIC_DISCOVER_LISTED_BEATS.length} original samples</span><span className="rounded-full border border-vx-border px-3 py-1.5">{MUSIC_DISCOVER_MOODS.length - 1} genres</span><span className="rounded-full border border-vx-border px-3 py-1.5">Tempo + 3-layer mixer</span></div>
      </header>

      {dailyChallenge ? <section data-testid="music-daily-challenge" aria-labelledby="music-daily-challenge-title" className="mt-8 overflow-hidden rounded-2xl border border-vx-accent/60 bg-vx-panel p-5 shadow-2xl sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{t('music.dailyChallenge.eyebrow')}</p>
            <h2 id="music-daily-challenge-title" className="mt-2 font-vx text-3xl font-black">{t(dailyChallenge.title_key)}</h2>
            <p className="mt-3 leading-7 text-vx-fg-body">{t(dailyChallenge.prompt_key)}</p>
            <p className="mt-3 text-sm font-bold text-vx-fg-muted">{t('music.dailyChallenge.noReward')}</p>
          </div>
          <Link href={{ pathname: '/app/music/create', query: { challenge: dailyChallenge.id } }} className="vx-press inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-vx-accent px-6 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover">
            {t('music.dailyChallenge.cta')}
          </Link>
        </div>
      </section> : null}

      <section aria-label={t('musicDiscover.filters')} className="mt-8 rounded-2xl border border-vx-border bg-vx-panel p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1" role="group" aria-label={t('musicDiscover.filterMood')}>
            {MUSIC_DISCOVER_MOODS.map((item) => <button key={item} type="button" aria-pressed={mood === item} onClick={() => { setMood(item); setVisibleCount(PAGE_SIZE); }} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${mood === item ? 'bg-vx-fg text-vx-base' : 'border border-vx-border text-vx-fg-body hover:border-vx-border-boost'}`}>{tOr(t, moodKey(item), item)}</button>)}
          </div>
          <label className="relative block lg:w-72"><span className="sr-only">{t('musicDiscover.searchLabel')}</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCount(PAGE_SIZE); }} placeholder={t('musicDiscover.searchPlaceholder')} className="min-h-11 w-full rounded-full border border-vx-border-boost bg-vx-base px-4 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" /></label>
        </div>
        <p className="mt-3 font-vx-mono text-[11px] font-bold text-vx-fg-faint">Showing {displayed.length} of {visible.length} matching sample beats · {MUSIC_DISCOVER_LISTED_BEATS.length} total</p>
      </section>

      {audioError ? <p role="alert" className="mt-5 rounded-2xl border border-vx-danger/50 bg-vx-danger/10 px-4 py-3 text-sm text-vx-danger">{audioError}</p> : null}
      {mixingBeat ? <SampleMixLab beat={mixingBeat} mix={mix} mixName={mixName} savedMixId={activeSavedMixId} saveNotice={saveNotice} playing={playingKey === `mix:${mixingBeat.id}`} progress={playingKey === `mix:${mixingBeat.id}` ? progress : 0} onChange={updateMix} onNameChange={(value) => { setMixName(value); setSaveNotice(null); }} onSave={saveMix} onToggle={() => toggle(mixingBeat, mix, `mix:${mixingBeat.id}`)} onClose={() => { stopPlayback(); setMixingId(null); setSaveNotice(null); }} /> : null}

      <MusicBestOf />
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
