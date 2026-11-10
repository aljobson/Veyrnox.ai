'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_TTS_SETTINGS,
  TTS_EMOTIONS,
  TTS_EXAMPLES,
  TTS_INTERJECTIONS,
  TTS_LANGUAGES,
  TTS_PAUSES,
  TTS_SCRIPT_LIMIT,
  TTS_VOICES,
  appendSpeechCue,
  pauseCue,
  voiceAuditionScript,
} from '../_lib/textToSpeech';
import { readVoiceFavourites, toggleVoiceFavourite } from '../_lib/voiceFavourites';
import {
  BUILTIN_VOICE_PALETTES,
  VOICE_PALETTE_CATEGORIES,
  readVoicePalettes,
  removeVoicePalette,
  saveVoicePalette,
} from '../_lib/voicePalettes';
import { VOICE_TEMPLATE_LANGUAGES, voiceTemplateSample } from '../_lib/voiceTemplateSamples';
import { MAX_AUDITION_VOICES, toggleAuditionVoice } from '../_lib/voiceAuditions';

const pressable = 'transition-[border-color,background-color,color,transform] duration-150 active:scale-[0.96]';
const selectClass = 'min-h-11 rounded-xl border border-vx-border bg-vx-panel px-3 text-sm font-semibold text-vx-fg outline-hidden transition-[border-color,box-shadow] focus:border-vx-accent focus:shadow-[0_0_0_3px_rgba(102,232,207,0.12)]';
const pillClass = `${pressable} min-h-10 rounded-full border border-vx-border bg-vx-panel px-3 py-2 text-[11px] font-bold text-vx-fg-muted hover:border-vx-accent hover:text-vx-fg`;

function SpeakerIcon({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}

function Chevron({ open }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 transition-transform duration-150 group-open:rotate-180 ${open ? 'rotate-180' : ''}`} aria-hidden="true">
      <path d="m6 8 4 4 4-4" />
    </svg>
  );
}

function Range({ label, value, min, max, step, onChange, suffix = '' }) {
  return (
    <label className="block rounded-xl border border-vx-border bg-vx-base/70 p-4">
      <span className="flex items-center justify-between gap-3 text-xs font-extrabold">
        <span>{label}</span><span className="vx-num min-w-10 text-right font-vx-mono text-vx-accent">{value}{suffix}</span>
      </span>
      <input aria-label={label} type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} className="mt-4 w-full accent-vx-accent" />
      <span className="vx-num mt-1.5 flex justify-between font-vx-mono text-[9px] text-vx-fg-faint"><span>{min}</span><span>{max}</span></span>
    </label>
  );
}

export function TextToSpeechControls({
  recipeId,
  script,
  settings = DEFAULT_TTS_SETTINGS,
  onSettings,
  onScript,
  scriptLimit = TTS_SCRIPT_LIMIT,
  showExamples = true,
  auditionVoices = [],
  onAuditionVoices,
}) {
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [templateLanguage, setTemplateLanguage] = useState('English');
  const [gender, setGender] = useState('all');
  const [age, setAge] = useState('all');
  const [query, setQuery] = useState('');
  const [favouriteOnly, setFavouriteOnly] = useState(false);
  const [favourites, setFavourites] = useState([]);
  const [personalPalettes, setPersonalPalettes] = useState([]);
  const [paletteName, setPaletteName] = useState('');
  const [customPause, setCustomPause] = useState('1');
  const selectedVoice = TTS_VOICES.find((voice) => voice.id === settings.voice) || TTS_VOICES[0];
  const voices = useMemo(() => {
    const search = query.trim().toLowerCase();
    return TTS_VOICES.filter((voice) => (
      (gender === 'all' || voice.gender === gender)
      && (age === 'all' || voice.age === age)
      && (!favouriteOnly || favourites.includes(voice.id))
      && (!search || `${voice.label} ${voice.tone}`.toLowerCase().includes(search))
    ));
  }, [age, favouriteOnly, favourites, gender, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFavourites(readVoiceFavourites(window.localStorage));
      setPersonalPalettes(readVoicePalettes(window.localStorage));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  if (recipeId !== 'stock-voice') return null;

  function patchSetting(key, value) {
    onSettings({ ...settings, [key]: value });
  }

  function insert(cue) {
    onScript(appendSpeechCue(script, cue, scriptLimit));
  }

  function toggleFavourite(voiceId) {
    setFavourites(toggleVoiceFavourite(window.localStorage, voiceId));
  }

  function prepareAudition(voiceId) {
    patchSetting('voice', voiceId);
    onScript(voiceAuditionScript(scriptLimit));
    setVoiceOpen(false);
  }

  function applyPalette(palette) {
    const keepLanguage = VOICE_TEMPLATE_LANGUAGES.includes(templateLanguage) && !palette.id.startsWith('personal-');
    onSettings({ ...settings, ...palette.settings, ...(keepLanguage ? { language: templateLanguage } : {}) });
  }

  function applySampleLine(category) {
    const text = voiceTemplateSample(templateLanguage, category).slice(0, scriptLimit);
    if (!text) return;
    patchSetting('language', templateLanguage);
    onScript(text);
  }

  function saveCurrentPalette(event) {
    event.preventDefault();
    if (!paletteName.trim()) return;
    setPersonalPalettes(saveVoicePalette(window.localStorage, paletteName, settings));
    setPaletteName('');
  }

  function toggleAudition(voiceId) {
    onAuditionVoices?.(toggleAuditionVoice(auditionVoices, voiceId));
  }

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-vx-border bg-vx-panel shadow-[0_18px_48px_rgba(0,0,0,0.16)]" aria-labelledby="speech-controls-title">
      <div className="border-b border-vx-border px-4 py-5 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-vx-accent/[0.1] text-vx-accent"><SpeakerIcon /></span>
          <div>
            <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">Voice &amp; delivery</p>
            <h2 id="speech-controls-title" className="mt-1 text-lg font-black text-balance">Shape the performance</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-vx-fg-muted text-pretty">Choose a stock voice, tune how it speaks, then add timing and natural vocal cues to your script.</p>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <button type="button" onClick={() => setVoiceOpen((open) => !open)} aria-expanded={voiceOpen} className={`${pressable} flex min-h-16 w-full items-center gap-3 rounded-xl border border-vx-border bg-vx-base/70 p-3 text-left hover:border-vx-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent`}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-vx-accent/30 bg-vx-accent/[0.08] font-vx-mono text-xs font-black text-vx-accent">{selectedVoice.label.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-vx-fg-faint">Selected stock voice</span>
            <span className="mt-0.5 block truncate text-sm font-extrabold text-vx-fg">{selectedVoice.label}</span>
            <span className="mt-0.5 block text-xs text-vx-fg-muted">{selectedVoice.tone} · {settings.language === 'auto' ? 'Auto-detect language' : settings.language}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs font-bold text-vx-accent"><span className="hidden sm:inline">Browse voices</span><Chevron open={voiceOpen} /></span>
        </button>

        {voiceOpen && (
          <div className="mt-3 rounded-2xl border border-vx-border bg-vx-base p-3 sm:p-4" aria-label="Stock voice library">
            <div className="flex flex-col gap-2 lg:flex-row">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Search stock voices</span>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-vx-fg-faint" aria-hidden="true"><circle cx="9" cy="9" r="5.5" /><path d="m13 13 4 4" /></svg>
                <input aria-label="Search stock voices" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search voice or tone" className="min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel pl-10 pr-3 text-sm text-vx-fg outline-hidden transition-[border-color,box-shadow] placeholder:text-vx-fg-faint focus:border-vx-accent focus:shadow-[0_0_0_3px_rgba(102,232,207,0.12)]" />
              </label>
              <select aria-label="Speech language" value={settings.language} onChange={(event) => patchSetting('language', event.target.value)} className={`${selectClass} lg:w-44`}>
                {TTS_LANGUAGES.map((language) => <option key={language} value={language}>{language === 'auto' ? 'Auto language' : language}</option>)}
              </select>
              <select aria-label="Voice presentation" value={gender} onChange={(event) => setGender(event.target.value)} className={`${selectClass} lg:w-40`}>
                <option value="all">All voices</option><option value="female">Female</option><option value="male">Male</option><option value="neutral">Neutral</option>
              </select>
              <select aria-label="Voice age" value={age} onChange={(event) => setAge(event.target.value)} className={`${selectClass} lg:w-40`}>
                <option value="all">All ages</option><option value="young">Young</option><option value="middle">Middle-aged</option><option value="older">Older</option>
              </select>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-bold text-vx-fg-muted"><span className="vx-num text-vx-fg">{voices.length}</span> stock voices</p>
                <button type="button" aria-pressed={favouriteOnly} onClick={() => setFavouriteOnly((value) => !value)} className={`${pillClass} min-h-8 py-1 aria-pressed:border-vx-accent aria-pressed:bg-vx-accent/[0.08] aria-pressed:text-vx-accent`}>★ Favourites <span className="vx-num">{favourites.length}</span></button>
              </div>
              {(query || gender !== 'all' || age !== 'all' || favouriteOnly) && <button type="button" onClick={() => { setQuery(''); setGender('all'); setAge('all'); setFavouriteOnly(false); }} className={`${pressable} min-h-10 px-2 text-xs font-bold text-vx-accent`}>Clear filters</button>}
            </div>
            {voices.length ? (
              <div className="mt-2 grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                {voices.map((voice) => (
                  <div key={voice.id} className="flex min-h-16 overflow-hidden rounded-xl border border-vx-border bg-vx-panel hover:border-vx-accent">
                    <button type="button" aria-pressed={settings.voice === voice.id} onClick={() => { patchSetting('voice', voice.id); setVoiceOpen(false); }} className={`${pressable} group flex min-w-0 flex-1 items-center gap-3 p-3 text-left aria-pressed:bg-vx-accent/[0.08]`}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-vx-border bg-vx-base font-vx-mono text-[10px] font-black text-vx-fg-muted group-aria-pressed:border-vx-accent/40 group-aria-pressed:text-vx-accent">{voice.label.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>
                      <span className="min-w-0"><span className="block truncate text-sm font-extrabold">{voice.label}</span><span className="mt-0.5 block text-xs text-vx-fg-muted">{voice.tone}</span></span>
                      <span aria-hidden="true" className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full border border-vx-fg-faint group-aria-pressed:border-vx-accent group-aria-pressed:bg-vx-accent" />
                    </button>
                    <div className={`grid w-14 shrink-0 border-l border-vx-border ${onAuditionVoices ? 'grid-rows-3' : 'grid-rows-2'}`}>
                      <button type="button" aria-label={`Prepare ${voice.label} audition`} onClick={() => prepareAudition(voice.id)} className={`${pressable} border-b border-vx-border text-[10px] font-black text-vx-fg-faint hover:text-vx-accent`}>TEST</button>
                      {onAuditionVoices && <button type="button" aria-pressed={auditionVoices.includes(voice.id)} disabled={auditionVoices.length >= MAX_AUDITION_VOICES && !auditionVoices.includes(voice.id)} aria-label={auditionVoices.includes(voice.id) ? `Remove ${voice.label} from Audition Board` : `Add ${voice.label} to Audition Board`} onClick={() => toggleAudition(voice.id)} className={`${pressable} border-b border-vx-border text-[9px] font-black text-vx-fg-faint hover:text-vx-accent aria-pressed:bg-vx-accent/[0.08] aria-pressed:text-vx-accent disabled:cursor-not-allowed disabled:opacity-30`}>BOARD</button>}
                      <button type="button" aria-pressed={favourites.includes(voice.id)} aria-label={favourites.includes(voice.id) ? `Remove ${voice.label} from favourite voices` : `Add ${voice.label} to favourite voices`} onClick={() => toggleFavourite(voice.id)} className={`${pressable} text-lg text-vx-fg-faint hover:text-vx-accent aria-pressed:text-vx-accent`}>★</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="mt-3 rounded-xl border border-dashed border-vx-border p-6 text-center text-sm text-vx-fg-muted">{favouriteOnly ? 'No favourite voices match those filters. Star a stock voice to build your shortlist.' : 'No stock voices match those filters.'}</p>}
            <p className="mt-3 text-[10px] leading-4 text-vx-fg-faint">Favourite stock voices are remembered only in this browser. No voice sample, script, or cloned identity is stored.</p>
            <p className="mt-1 text-[10px] leading-4 text-vx-fg-faint">Test prepares the same original audition script for a fair comparison. It does not play a substitute voice or spend credits; the selected provider voice is heard only after you approve Generate.</p>
          </div>
        )}

        {onAuditionVoices && (
          <section className="mt-3 rounded-xl border border-vx-border bg-vx-base/70 p-4" aria-labelledby="audition-board-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-vx-accent">Fair comparison</p>
                <h3 id="audition-board-title" className="mt-1 text-sm font-extrabold">Audition Board <span className="vx-num text-vx-fg-muted">{auditionVoices.length}/{MAX_AUDITION_VOICES}</span></h3>
              </div>
              {auditionVoices.length > 0 && <button type="button" onClick={() => onAuditionVoices([])} className={`${pressable} min-h-10 px-2 text-xs font-bold text-vx-accent`}>Clear board</button>}
            </div>
            {auditionVoices.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {auditionVoices.map((voiceId) => {
                  const voice = TTS_VOICES.find((item) => item.id === voiceId);
                  return <button key={voiceId} type="button" aria-label={`Remove ${voice?.label || 'voice'} from Audition Board`} onClick={() => toggleAudition(voiceId)} className={`${pillClass} border-vx-accent/40 bg-vx-accent/[0.06] text-vx-accent`}>{voice?.label || 'Stock voice'} <span aria-hidden="true">×</span></button>;
                })}
              </div>
            ) : <p className="mt-3 text-xs leading-5 text-vx-fg-muted">Open the voice library and add two or three stock voices to compare.</p>}
            <p className="mt-3 text-[10px] leading-4 text-vx-fg-faint">Every board voice reads the exact current script with the same language and delivery controls. Each is a separate priced provider job with its own Library result and refund path.</p>
          </section>
        )}

        <details className="group mt-3 rounded-xl border border-vx-border bg-vx-base/70 p-4">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 text-xs font-extrabold">
            <span>Voice Palettes <span className="vx-num ml-1 text-vx-fg-muted">{BUILTIN_VOICE_PALETTES.length + personalPalettes.length}</span></span>
            <Chevron open={false} />
          </summary>
          <p className="mt-1 max-w-2xl text-[11px] leading-4 text-vx-fg-muted">Start from a Veyrnox delivery recipe or save your current stock voice, language and performance controls as a personal palette.</p>
          <label className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-extrabold text-vx-fg">Template language
            <select aria-label="Template language" value={templateLanguage} onChange={(event) => setTemplateLanguage(event.target.value)} className={selectClass}>
              {VOICE_TEMPLATE_LANGUAGES.map((language) => <option key={language} value={language}>{language}</option>)}
            </select>
          </label>
          {VOICE_PALETTE_CATEGORIES.map((category) => (
            <div key={category} className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.1em] text-vx-fg-faint">{category}</p>
                <button type="button" onClick={() => applySampleLine(category)} className={`${pressable} min-h-8 rounded-lg border border-vx-border px-2.5 text-[10px] font-extrabold text-vx-accent hover:border-vx-accent`}>Use {templateLanguage} sample line</button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {BUILTIN_VOICE_PALETTES.filter((palette) => palette.category === category).map((palette) => {
                  const voice = TTS_VOICES.find((item) => item.id === palette.settings.voice);
                  return (
                    <div key={palette.id} className="flex min-h-20 overflow-hidden rounded-xl border border-vx-border bg-vx-panel hover:border-vx-accent">
                      <button type="button" onClick={() => applyPalette(palette)} className={`${pressable} min-w-0 flex-1 p-3 text-left`}>
                        <span className="block text-sm font-extrabold text-vx-fg">{palette.name}</span>
                        <span className="mt-1 block text-[11px] leading-4 text-vx-fg-muted">{palette.description}</span>
                        <span className="mt-1.5 block font-vx-mono text-[9px] font-bold uppercase tracking-[0.08em] text-vx-accent">{voice?.label || 'Stock voice'} · {palette.settings.speed}× · Apply</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {personalPalettes.length > 0 && <div className="mt-4">
            <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.1em] text-vx-fg-faint">Personal</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {personalPalettes.map((palette) => {
                const voice = TTS_VOICES.find((item) => item.id === palette.settings.voice);
                return (
                  <div key={palette.id} className="flex min-h-20 overflow-hidden rounded-xl border border-vx-border bg-vx-panel hover:border-vx-accent">
                    <button type="button" onClick={() => applyPalette(palette)} className={`${pressable} min-w-0 flex-1 p-3 text-left`}>
                      <span className="block text-sm font-extrabold text-vx-fg">{palette.name}</span>
                      <span className="mt-1 block text-[11px] leading-4 text-vx-fg-muted">{`${voice?.label || 'Stock voice'} · ${palette.settings.emotion} · ${palette.settings.speed}×`}</span>
                      <span className="mt-1.5 block font-vx-mono text-[9px] font-bold uppercase tracking-[0.08em] text-vx-accent">Personal · Apply</span>
                    </button>
                    <button type="button" aria-label={`Delete ${palette.name} voice palette`} onClick={() => setPersonalPalettes(removeVoicePalette(window.localStorage, palette.id))} className={`${pressable} w-11 shrink-0 border-l border-vx-border text-lg text-vx-fg-faint hover:text-red-300`}>×</button>
                  </div>
                );
              })}
            </div>
          </div>}
          <form onSubmit={saveCurrentPalette} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Personal voice palette name</span>
              <input aria-label="Personal voice palette name" value={paletteName} maxLength={40} onChange={(event) => setPaletteName(event.target.value)} placeholder="Name this delivery, e.g. Weekly update" className="min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 text-sm text-vx-fg outline-hidden transition-[border-color,box-shadow] placeholder:text-vx-fg-faint focus:border-vx-accent focus:shadow-[0_0_0_3px_rgba(102,232,207,0.12)]" />
            </label>
            <button type="submit" disabled={!paletteName.trim()} className={`${pressable} min-h-11 rounded-xl border border-vx-accent/40 bg-vx-accent/[0.08] px-4 text-xs font-extrabold text-vx-accent disabled:cursor-not-allowed disabled:opacity-40`}>Save current palette</button>
          </form>
          <p className="mt-2 text-[10px] leading-4 text-vx-fg-faint">Personal palettes stay in this browser and contain settings only—never your script, audio, or a cloned identity.</p>
        </details>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid rounded-xl border border-vx-border bg-vx-base/70 p-4 text-xs font-extrabold">Delivery style
            <span className="mt-1 text-[11px] font-normal leading-4 text-vx-fg-muted">Set the emotional direction for the whole read.</span>
            <select aria-label="Speaking style" value={settings.emotion} onChange={(event) => patchSetting('emotion', event.target.value)} className={`${selectClass} mt-3`}>
              {TTS_EMOTIONS.map((emotion) => <option key={emotion} value={emotion}>{emotion[0].toUpperCase() + emotion.slice(1)}</option>)}
            </select>
          </label>
          <Range label="Speed" value={settings.speed} min={0.5} max={2} step={0.1} onChange={(value) => patchSetting('speed', value)} suffix="×" />
          <Range label="Volume" value={settings.volume} min={0} max={10} step={1} onChange={(value) => patchSetting('volume', value)} />
          <Range label="Pitch" value={settings.pitch} min={-12} max={12} step={1} onChange={(value) => patchSetting('pitch', value)} />
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-vx-border bg-vx-base/70 p-4">
            <div className="flex items-center justify-between gap-3"><p className="text-xs font-extrabold">Insert a pause</p><span className="font-vx-mono text-[9px] uppercase tracking-[0.1em] text-vx-fg-faint">At script end</span></div>
            <div className="mt-3 flex flex-wrap gap-2">
              {TTS_PAUSES.map((seconds) => <button key={seconds} type="button" onClick={() => insert(pauseCue(seconds))} className={pillClass}>{seconds}s</button>)}
            </div>
            <div className="mt-3 flex gap-2">
              <label className="sr-only" htmlFor="custom-speech-pause">Custom pause in seconds</label>
              <input id="custom-speech-pause" inputMode="decimal" value={customPause} onChange={(event) => setCustomPause(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-vx-border bg-vx-panel px-3 font-vx-mono text-sm text-vx-fg outline-hidden transition-[border-color,box-shadow] focus:border-vx-accent focus:shadow-[0_0_0_3px_rgba(102,232,207,0.12)]" />
              <button type="button" onClick={() => insert(pauseCue(customPause))} className={`${pressable} min-h-11 rounded-xl border border-vx-border px-4 text-xs font-bold hover:border-vx-accent`}>Insert</button>
            </div>
          </div>
          <details className="group rounded-xl border border-vx-border bg-vx-base/70 p-4">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 text-xs font-extrabold"><span>Insert an interjection <span className="vx-num ml-1 text-vx-fg-muted">{TTS_INTERJECTIONS.length}</span></span><Chevron open={false} /></summary>
            <p className="mt-1 text-[11px] leading-4 text-vx-fg-muted">Add a natural vocal cue at the end of the script.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {TTS_INTERJECTIONS.map(([label, cue]) => <button key={label} type="button" onClick={() => insert(cue)} className={pillClass}>{label}</button>)}
            </div>
          </details>
        </div>

        {showExamples && <div className="mt-5 border-t border-vx-border pt-5">
          <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-extrabold">Example scripts</p><p className="mt-1 text-[11px] text-vx-fg-muted">Replace the current script with an original starting point.</p></div><span className="font-vx-mono text-[9px] uppercase tracking-[0.12em] text-vx-fg-faint">Optional</span></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {TTS_EXAMPLES.map((example, index) => (
              <button key={example.title} type="button" onClick={() => onScript(example.text)} className={`${pressable} group rounded-xl border border-vx-border bg-vx-base/70 p-3 text-left hover:border-vx-accent`}>
                <span className="font-vx-mono text-[9px] font-bold text-vx-accent">0{index + 1}</span><span className="mt-2 block text-xs font-extrabold text-vx-fg">{example.title}</span><span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-vx-fg-muted">{example.text}</span>
              </button>
            ))}
          </div>
        </div>}
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-vx-accent/[0.06] px-3 py-2.5 text-[11px] leading-5 text-vx-fg-muted"><span aria-hidden="true" className="text-vx-accent">✓</span>Stock voices only. This workflow does not copy or clone a real person&apos;s voice.</p>
      </div>
    </section>
  );
}
