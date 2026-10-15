'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useCatalog } from '../_lib/useCatalog';
import { REVEAL_SAVED_ODDLING } from '../../../lib/savedOddlingHelp.js';
import { OddlingGalleryPreview, useGalleryMotionAllowed } from './OddlingGalleryPreview';
import {
  CHARACTER_GROUPS,
  ODDLING_ARCHETYPES,
  ODDLING_SHOWS,
  ODDLING_TONES,
  oddlingIdentity,
  writeOddlingDraft,
} from '../_lib/character';
import { writeStudioDraft } from '../_lib/landingDraft';
import { characterOptionLabel, changeCharacterPick } from '../_lib/characterOptions';
import {
  ODDLING_MOTIONS,
  ODDLING_PRESET_SOURCES,
  ODDLING_SCENES,
  ODDLING_STUDIO_SECTIONS,
  buildOddlingStudioPrompt,
  buildOddlingAnimationPrompt,
  animationModel,
  oddlingPortrait,
  gallerySource,
  groupById,
  oddlingsForSource,
  randomizeOddlingStyle,
  readOddlingLibrary,
  saveOddlingToLibrary,
} from '../_lib/oddlingStudio';

const chip = (on) => `rounded-full border px-3 py-1.5 font-vx-mono text-[10px] font-bold transition-colors ${
  on ? 'border-vx-accent bg-vx-accent/[0.09] text-vx-accent' : 'border-vx-border bg-vx-base text-vx-fg-muted hover:border-vx-fg/30 hover:text-vx-fg'
}`;

const field = 'w-full rounded-xl border border-vx-field bg-vx-base px-3 py-2.5 text-sm text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-hidden';

function CharacterPortrait({ oddling, className = '' }) {
  const source = gallerySource(oddling);
  return source ? <Image src={source.image} alt={`${oddling.name} individual portrait`} width={1024} height={1536} sizes="(max-width: 640px) 100vw, 350px" className={`h-full w-full object-contain ${className}`} /> : null;
}

function TraitGroup({ group, value, onChange }) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-vx-fg-muted">{group.label}</legend>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onChange(group.id, '')} aria-pressed={!value} className={chip(!value)}>Any</button>
        {group.options.map(([label]) => (
          <button key={label} type="button" onClick={() => onChange(group.id, label)} aria-pressed={value === label} className={chip(value === label)}>
            {characterOptionLabel(group.id, label)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
function CharacterSheet({ oddling, onClose, onRecreate, onAnimate }) {
  if (!oddling) return null;
  const picks = oddling.picks;
  const traits = CHARACTER_GROUPS.flatMap((group) => picks[group.id] ? [`${group.label}: ${characterOptionLabel(group.id, picks[group.id])}`] : []);
  const identity = oddlingIdentity(picks);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="character-sheet-title" className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel shadow-2xl">
        <div className="grid md:grid-cols-[.8fr_1.2fr] md:items-start">
          <div className="flex items-start justify-center bg-vx-base p-3 sm:p-4">
            <div className="w-full max-w-72"><CharacterPortrait oddling={oddling} /></div>
          </div>
          <div className="p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-vx-mono text-[9px] font-bold tracking-[0.15em] text-vx-accent">CHARACTER SHEET</span>
                <h2 id="character-sheet-title" className="vx-display mt-2 text-4xl">{oddling.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-vx-fg-body">{oddling.hook}</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close character sheet" className={chip(false)}>Close</button>
            </div>
            <div className="mt-6 space-y-4">
              <div>
                <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-muted">CREATOR PREMISE</span>
                <ul className="mt-2 space-y-1.5 text-sm text-vx-fg-body">
                  {identity.map((line) => <li key={line}>— {line}</li>)}
                </ul>
              </div>
              <div>
                <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-muted">VISIBLE CANON</span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {traits.map((line) => <span key={line} className="rounded-full bg-vx-fg/[0.06] px-2.5 py-1 text-[11px] text-vx-fg-muted">{line}</span>)}
                </div>
              </div>
            </div>
            <button type="button" onClick={() => onRecreate(oddling)} className="mt-7 w-full rounded-xl bg-vx-accent px-4 py-3 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover">
              Recreate as my own →
            </button>
            <button type="button" onClick={() => onAnimate(oddling)} className={`${chip(true)} mt-3 w-full`}>Animate this character</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function GalleryCard({ oddling, onSheet, onRecreate, onAnimate, previewsPlaying }) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
      <OddlingGalleryPreview id={oddling.id} playing={previewsPlaying}>
        <CharacterPortrait oddling={oddling} />
      </OddlingGalleryPreview>
      <div className="p-4">
        <span className="font-vx-mono text-[8px] font-bold tracking-[0.14em] text-vx-accent">{oddling.accent}</span>
        <h3 className="mt-1 text-lg font-extrabold">{oddling.name}</h3>
        <p className="mt-1 min-h-10 text-xs leading-relaxed text-vx-fg-muted">{oddling.hook}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onSheet(oddling)} className={chip(false)}>Character sheet</button>
          <button type="button" onClick={() => onRecreate(oddling)} className={chip(true)}>Recreate</button>
        </div>
        <button type="button" onClick={() => onAnimate(oddling)} className={`${chip(true)} mt-2 w-full`}>Animate this character</button>
      </div>
    </article>
  );
}

export default function OddlingStudio() {
  const router = useRouter();
  const [previewsPlaying, setPreviewsPlaying] = useState(true);
  const motionAllowed = useGalleryMotionAllowed();
  const { models, live: catalogLive } = useCatalog();
  const videoModel = animationModel(models);
  const [portraitId, setPortraitId] = useState(ODDLING_ARCHETYPES[0].id);
  const portrait = oddlingPortrait(portraitId);
  const [mode, setMode] = useState('portrait');
  const [picks, setPicks] = useState({ ...ODDLING_ARCHETYPES[0].picks });
  const [motionId, setMotionId] = useState(ODDLING_MOTIONS[0].id);
  const [scene, setScene] = useState(ODDLING_SCENES[0]);
  const [reference, setReference] = useState(null);
  const [referenceNote, setReferenceNote] = useState('');
  const [openSection, setOpenSection] = useState('build');
  const [workspace, setWorkspace] = useState('explore');
  const [source, setSource] = useState('torsos');
  const [library, setLibrary] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [notice, setNotice] = useState('');
  const [highlightedPassportId, setHighlightedPassportId] = useState(null);
  const [loadedPassportId, setLoadedPassportId] = useState(null);

  useEffect(() => {
    const reveal = (event) => {
      const items = readOddlingLibrary(window.localStorage);
      if (!items.some(({ id }) => id === event.detail?.id)) return;
      setLibrary(items);
      setWorkspace('history');
      setHighlightedPassportId(event.detail.id);
    };
    window.addEventListener(REVEAL_SAVED_ODDLING, reveal);
    return () => window.removeEventListener(REVEAL_SAVED_ODDLING, reveal);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setLibrary(readOddlingLibrary(window.localStorage)), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => {
    if (reference?.url) URL.revokeObjectURL(reference.url);
  }, [reference]);

  const gallery = useMemo(() => oddlingsForSource(source), [source]);

  const promptPreview = mode === 'motion'
    ? buildOddlingAnimationPrompt(portraitId, motionId)
    : buildOddlingStudioPrompt({ picks, mode, motionId, scene, referenceNote });
  const selectedTraits = CHARACTER_GROUPS.filter((group) => picks[group.id]).length;

  function setPick(key, value) {
    setPicks((current) => changeCharacterPick(current, key, value));
    setNotice('');
  }

  function loadOddling(oddling) {
    setLoadedPassportId(null);
    setPicks({ ...oddling.picks });
    setPortraitId(oddling.id || '');
    setSheet(null);
    setNotice(`${oddling.name} loaded. Every detail is editable.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function animateOddling(oddling) {
    loadOddling(oddling);
    setMode('motion');
    setNotice(`Animate ${oddling.name}'s exact portrait. Choose a movement below; Create confirms the price before generating.`);
  }

  function randomize() {
    setPicks((current) => randomizeOddlingStyle(current));
    setNotice('Styling remixed. Body, identity and creator premise stayed locked.');
  }

  function save() {
    const savedAt = Date.now();
    writeOddlingDraft(window.localStorage, picks, savedAt);
    const result = saveOddlingToLibrary(window.localStorage, picks, motionId, savedAt);
    if (result.ok) {
      setLibrary(result.items);
      setNotice('Passport saved to History on this browser.');
    } else {
      setNotice('This browser blocked saving. Your current character is still here.');
    }
  }

  function uploadReference(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setNotice('Choose an image file.'); return; }
    if (file.size > 2 * 1024 * 1024) { setNotice('Keep the local reference under 2 MB.'); return; }
    setReference({ name: file.name, url: URL.createObjectURL(file) });
    setNotice('Reference added locally. Describe what to borrow so it carries into the prompt.');
  }

  function continueToCreate() {
    if (mode === 'motion' && (!portrait || !videoModel || !catalogLive)) {
      setNotice('Choose an original character and wait for live animation pricing.'); return;
    }
    const model = mode === 'motion' ? videoModel.id : 'flux-2-pro';
    const prompt = mode === 'motion'
      ? buildOddlingAnimationPrompt(portraitId, motionId)
      : [referenceNote.trim() ? `Visual reference direction: ${referenceNote.trim()}.` : '', scene].filter(Boolean).join(' ');
    writeOddlingDraft(window.localStorage, picks);
    const result = saveOddlingToLibrary(window.localStorage, picks, motionId);
    if (result.ok) setLibrary(result.items);
    const written = writeStudioDraft(window.sessionStorage, { prompt, model, aspect: '9:16', ...(mode === 'motion' ? { durationSeconds: 5 } : {}) });
    if (!written) { setNotice('The Create draft could not be handed off. Copy the prompt preview and paste it into Create.'); return; }
    router.push(`/app/create?model=${encodeURIComponent(model)}&oddling=1&passport=1${mode === 'motion' ? `&oddlingPhoto=${encodeURIComponent(portraitId)}&motion=${encodeURIComponent(motionId)}` : ''}`);
  }

  return (
    <>
      <div className="grid min-h-[calc(100dvh-4rem)] xl:grid-cols-[430px_minmax(0,1fr)]">
        <aside data-assistant-target="oddlings.builder" data-assistant-loaded-passport={loadedPassportId || undefined} className="border-b border-vx-border bg-vx-panel xl:border-b-0 xl:border-r">
          <div className="sticky top-16 max-h-[calc(100dvh-4rem)] overflow-y-auto p-5 sm:p-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <span className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-vx-accent">ODDLING STUDIO · FULL BUILD</span>
                <h1 className="vx-display mt-2 text-4xl">Design the whole character.</h1>
              </div>
              <span className="rounded-full border border-vx-border px-2.5 py-1 font-vx-mono text-[9px] text-vx-fg-muted">{selectedTraits} TRAITS</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-vx-fg-body">Build a fictional adult creator with a repeatable silhouette, worldview and show—then hand the finished draft to Create.</p>

            <div className="mt-5 grid grid-cols-2 rounded-xl border border-vx-border bg-vx-base p-1" role="tablist" aria-label="Creation mode">
              <button type="button" role="tab" aria-selected={mode === 'portrait'} onClick={() => setMode('portrait')} className={`rounded-lg px-3 py-2.5 text-sm font-bold ${mode === 'portrait' ? 'bg-vx-panel text-vx-fg shadow-sm' : 'text-vx-fg-muted'}`}>Create Oddling</button>
              <button type="button" role="tab" aria-selected={mode === 'motion'} onClick={() => setMode('motion')} className={`rounded-lg px-3 py-2.5 text-sm font-bold ${mode === 'motion' ? 'bg-vx-panel text-vx-fg shadow-sm' : 'text-vx-fg-muted'}`}>Motion</button>
            </div>

            <div data-assistant-target="oddlings.reference" className="mt-5 rounded-2xl border border-vx-border bg-vx-base p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-muted">OPTIONAL REFERENCE</span>
                  <p className="mt-1 text-xs text-vx-fg-faint">Local moodboard preview; describe what to borrow below.</p>
                </div>
                <label className={chip(!!reference)}>
                  {reference ? 'Replace' : 'Upload photo'}
                  <input type="file" accept="image/*" onChange={uploadReference} className="sr-only" />
                </label>
              </div>
              {reference && <img src={reference.url} alt={`Local reference ${reference.name}`} className="mt-3 max-h-48 w-full rounded-xl object-cover" />}
              <input value={referenceNote} onChange={(event) => setReferenceNote(event.target.value)} maxLength={180} className={`${field} mt-3`} placeholder="Borrow the checkerboard makeup and high collar—not the identity" />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <label>
                <span className="mb-1 block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">NAME</span>
                <input value={picks.oddling_name || ''} onChange={(event) => setPick('oddling_name', event.target.value)} maxLength={40} className={field} />
              </label>
              <label>
                <span className="mb-1 block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">VOICE</span>
                <select value={picks.oddling_voice || ''} onChange={(event) => setPick('oddling_voice', event.target.value)} className={field}>
                  <option value="">Choose</option>
                  {ODDLING_TONES.map(([label]) => <option key={label}>{label}</option>)}
                </select>
              </label>
            </div>
            <label className="mt-3 block">
              <span className="mb-1 block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">WHY PEOPLE FOLLOW</span>
              <input value={picks.oddling_obsession || ''} onChange={(event) => setPick('oddling_obsession', event.target.value)} maxLength={140} className={field} />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">RECURRING SHOW</span>
              <select value={picks.oddling_show || ''} onChange={(event) => setPick('oddling_show', event.target.value)} className={field}>
                <option value="">Choose a format</option>
                {ODDLING_SHOWS.map(([label]) => <option key={label}>{label}</option>)}
              </select>
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">NEVER DRIFT · VISUAL CANON</span>
              <textarea value={picks.oddling_rule || ''} onChange={(event) => setPick('oddling_rule', event.target.value)} maxLength={160} rows={2} className={`${field} resize-none`} />
            </label>

            {mode === 'motion' && (
              <section className="mt-5 rounded-2xl border border-vx-accent/30 bg-vx-accent/[0.04] p-4">
                {portrait && <><Image src={portrait.image} alt={`${portrait.name} animation start frame`} width={1024} height={1536} className="mx-auto mb-3 h-56 w-full object-contain" /><p className="mb-3 text-xs text-vx-fg-body">Animating {portrait.name}&apos;s photo. To change the outfit or body, generate a new portrait first.</p></>}
                <p className="mb-3 text-xs text-vx-accent">{catalogLive && videoModel ? `${videoModel.name} · 5 seconds · ${videoModel.credits} credits` : 'Loading live animation pricing…'}</p>
                <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-accent">MOTION PRESET</span>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {ODDLING_MOTIONS.map((motion) => (
                    <button key={motion.id} type="button" onClick={() => setMotionId(motion.id)} aria-pressed={motionId === motion.id} className={`${chip(motionId === motion.id)} text-left`}>{motion.name}</button>
                  ))}
                </div>
              </section>
            )}

            <div className="mt-5 divide-y divide-vx-border overflow-hidden rounded-2xl border border-vx-border">
              {ODDLING_STUDIO_SECTIONS.map((section) => {
                const open = openSection === section.id;
                return (
                  <section key={section.id}>
                    <button type="button" onClick={() => setOpenSection(open ? '' : section.id)} aria-expanded={open} className="flex w-full items-center justify-between gap-4 bg-vx-base px-4 py-3.5 text-left">
                      <span>
                        <span className="block text-sm font-extrabold">{section.label}</span>
                        <span className="mt-0.5 block text-[11px] text-vx-fg-faint">{section.hint}</span>
                      </span>
                      <span aria-hidden="true" className="text-vx-accent">{open ? '−' : '+'}</span>
                    </button>
                    {open && (
                      <div className="space-y-5 bg-vx-panel p-4">
                        {section.groupIds.map(groupById).filter(Boolean).map((group) => <TraitGroup key={group.id} group={group} value={picks[group.id] || ''} onChange={setPick} />)}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>

            <label className="mt-5 block">
              <span className="mb-1 block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">{mode === 'motion' ? 'PORTRAIT SCENE · NOT USED FOR PHOTO ANIMATION' : 'FIRST SCENE'}</span>
              <textarea value={scene} onChange={(event) => setScene(event.target.value)} maxLength={300} rows={3} className={`${field} resize-none`} />
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ODDLING_SCENES.slice(0, 3).map((item, index) => <button key={item} type="button" onClick={() => setScene(item)} className={chip(scene === item)}>Scene {index + 1}</button>)}
            </div>

            <details data-assistant-target="oddlings.prompt" className="mt-5 rounded-xl border border-vx-border bg-vx-base p-3">
              <summary className="cursor-pointer font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-muted">GENERATION PROMPT PREVIEW</summary>
              <p className="mt-3 break-words text-xs leading-relaxed text-vx-fg-body">{promptPreview}</p>
            </details>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={randomize} className={chip(false)}>Randomize styling</button>
              <button type="button" onClick={save} className={chip(true)}>Save passport</button>
            </div>
            <button type="button" data-assistant-target="oddlings.continue" onClick={continueToCreate} className="mt-3 w-full rounded-xl bg-vx-accent px-5 py-3.5 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover">
              {mode === 'motion' ? 'Continue to motion generation →' : 'Continue to portrait generation →'}
            </button>
            <p className="mt-2 text-center font-vx-mono text-[9px] text-vx-fg-faint">NO CHARGE HERE · CREATE SHOWS THE EXACT PRICE</p>
            {notice && <p role="status" className="mt-3 rounded-xl border border-vx-accent/30 bg-vx-accent/[0.06] px-3 py-2 text-xs text-vx-accent">{notice}</p>}
          </div>
        </aside>

        <section aria-label="Oddling library" className="min-w-0 bg-vx-base p-5 sm:p-8 lg:p-10">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div>
                <span className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-vx-accent">{ODDLING_ARCHETYPES.filter((item) => item.kind === 'human').length} HUMAN ORIGINALS · {ODDLING_ARCHETYPES.filter((item) => item.kind === 'creature').length} OTHER BEINGS</span>
                <h2 className="vx-display mt-2 text-5xl sm:text-6xl">Your original character, your recurring hit.</h2>
                <p className="mt-3 max-w-2xl text-vx-fg-body">Explore expressive silhouettes, statement fashion, sculptural hair and contemporary basics. Choose head, body and individual feature sizes independently, then refine your character for portraits and motion.</p>
              </div>
              <div className="flex rounded-xl border border-vx-border bg-vx-panel p-1" role="tablist" aria-label="Workspace view">
                <button type="button" role="tab" aria-selected={workspace === 'explore'} onClick={() => setWorkspace('explore')} className={`rounded-lg px-4 py-2 text-sm font-bold ${workspace === 'explore' ? 'bg-vx-base text-vx-fg' : 'text-vx-fg-muted'}`}>Explore</button>
                <button type="button" role="tab" data-assistant-target="oddlings.history" aria-selected={workspace === 'history'} onClick={() => setWorkspace('history')} className={`rounded-lg px-4 py-2 text-sm font-bold ${workspace === 'history' ? 'bg-vx-base text-vx-fg' : 'text-vx-fg-muted'}`}>History · {library.length}</button>
              </div>
            </div>

            {workspace === 'explore' ? (
              <>
                <div className="mt-8 flex flex-wrap gap-2" role="tablist" aria-label="Preset source">
                  {ODDLING_PRESET_SOURCES.map(({ id, label }) => <button key={id} type="button" role="tab" aria-selected={source === id} onClick={() => setSource(id)} className={chip(source === id)}>{label}</button>)}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-faint">{gallery.length} ORIGINAL CHARACTER{gallery.length === 1 ? '' : 'S'}</p>
                  <button type="button" aria-pressed={previewsPlaying} onClick={() => setPreviewsPlaying((current) => !current)} className={chip(previewsPlaying)}>{previewsPlaying ? 'Pause previews' : 'Play previews'}</button>
                </div>
                <p className="mt-2 text-xs text-vx-fg-muted">Free puppet previews · blinks, breathing and head movement with still backgrounds · no generation or credits. Covered eyes use stylized shutters. Reduced-motion settings respected. For generated action videos, use Animate this character (paid).</p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {gallery.map((oddling) => <GalleryCard key={oddling.id} oddling={oddling} onSheet={setSheet} onRecreate={loadOddling} onAnimate={animateOddling} previewsPlaying={previewsPlaying && motionAllowed} />)}
                </div>
              </>
            ) : library.length ? (
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {library.map((item) => (
                  <article key={item.id} data-saved-passport-id={item.id} data-assistant-target={highlightedPassportId === item.id ? 'oddlings.saved' : undefined} className="scroll-mt-24 rounded-2xl border border-vx-border bg-vx-panel p-5">
                    <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-accent">SAVED PASSPORT</span>
                    <h3 className="mt-2 text-xl font-extrabold">{item.name}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-vx-fg-muted">{item.picks.oddling_obsession || 'No creator premise yet.'}</p>
                    <p className="mt-4 font-vx-mono text-[9px] text-vx-fg-faint">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(item.savedAt)}</p>
                    <button type="button" onClick={() => {
                      loadOddling({ name: item.name, hook: item.picks.oddling_obsession || 'Saved Oddling', picks: item.picks });
                      setMode('portrait');
                      setMotionId(item.motionId || ODDLING_MOTIONS[0].id);
                      setLoadedPassportId(item.id);
                    }} className={`${chip(true)} mt-4`}>Load and edit</button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-8 rounded-2xl border border-dashed border-vx-border p-12 text-center">
                <h3 className="text-xl font-extrabold">No saved passports yet.</h3>
                <p className="mt-2 text-sm text-vx-fg-muted">Save a character on the left and it will appear here on this browser.</p>
              </div>
            )}
          </div>
        </section>
      </div>
      <CharacterSheet oddling={sheet} onClose={() => setSheet(null)} onRecreate={loadOddling} onAnimate={animateOddling} />
    </>
  );
}
