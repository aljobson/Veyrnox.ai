'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getStoredSession, onSessionChange } from '../../lib/authClient';
import { useCatalog } from '../_lib/useCatalog';
import { gatewayFetch } from '../_lib/gateway';
import { REVEAL_SAVED_ODDLING } from '../../../lib/savedOddlingHelp.js';
import { journeyHandoff, publishJourneyView } from '../_lib/veyJourneyStore';
import { Button } from './Button';
import { OddlingExplore, useOddlingExplore } from './OddlingExplore';
import { OddlingMotionPanel } from './OddlingMotionPanel';
import { OddlingSheet } from './OddlingSheet';
import { OddlingTraitSections } from './OddlingTraitSections';
import { chip, field } from './oddlingStyles';
import {
  CHARACTER_GROUPS,
  ODDLING_ARCHETYPES,
  ODDLING_SHOWS,
  ODDLING_TONES,
  writeOddlingDraft,
} from '../_lib/character';
import { writeStudioDraft } from '../_lib/landingDraft';
import { changeCharacterPick } from '../_lib/characterOptions';
import { parseOddlingDeepLink } from '../_lib/oddlingExplore';
import {
  ODDLING_MOTIONS,
  ODDLING_DOLL_FACETS,
  ODDLING_SCENES,
  buildOddlingStudioPrompt,
  buildOddlingAnimationPrompt,
  animationModel,
  oddlingPortrait,
  oddlingCreditState,
  randomizeOddlingAll,
  randomizeOddlingStyle,
  readOddlingLibrary,
  saveOddlingToLibrary,
  toggleOpenSection,
} from '../_lib/oddlingStudio';

const DOLL_DEFAULTS = {
  body_type: 'Pear',
  hair: 'Sculptural Wave Tower',
  wardrobe_style: 'Modern Basics',
};

function DollHair({ hair }) {
  if (hair === 'Sphere Cut') return <circle cx="60" cy="27" r="23" className="fill-vx-accent" />;
  if (hair === 'Sculptural Wave Tower') return <path d="M43 35C39 22 47 17 45 8c10 7 12-7 21-4 8 3 3 12 12 15 8 3 4 14-2 20z" className="fill-vx-accent" />;
  if (hair === 'Shelf Cut') return <path d="M29 16h62v20H74v7H46v-7H29z" className="fill-vx-accent" />;
  return <path d="M42 25c3-19 34-19 37 0l-6 8H47z" className="fill-vx-accent" />;
}

function OddlingDoll({ picks, compact = false }) {
  const body = picks.body_type || DOLL_DEFAULTS.body_type;
  const hair = picks.hair || DOLL_DEFAULTS.hair;
  const outfit = picks.wardrobe_style || DOLL_DEFAULTS.wardrobe_style;
  const shapes = {
    'Very Skinny': { torso: 'M49 58Q60 51 71 58L68 111H52z', leftArm: 'M49 61L38 108l7 2 11-43z', rightArm: 'M71 61l11 47-7 2-11-43z', legW: 7, leftLeg: 52, rightLeg: 63 },
    Pear: { torso: 'M43 58Q60 49 77 58L87 111H33z', leftArm: 'M44 61l-14 45 8 3 15-39z', rightArm: 'M76 61l14 45-8 3-15-39z', legW: 10, leftLeg: 44, rightLeg: 66 },
    Fat: { torso: 'M35 59Q60 45 85 59Q101 83 87 113H33Q19 83 35 59z', leftArm: 'M37 62q-14 17-14 43l10 2 13-36z', rightArm: 'M83 62q14 17 14 43l-10 2-13-36z', legW: 11, leftLeg: 42, rightLeg: 67 },
    'Hyper-Muscular': { torso: 'M34 58Q47 46 60 56Q73 46 86 58L74 112H46z', leftArm: 'M36 59q-13 3-14 19l8 31 11-3-2-32 14-9z', rightArm: 'M84 59q13 3 14 19l-8 31-11-3 2-32-14-9z', legW: 13, leftLeg: 39, rightLeg: 68 },
  };
  const shape = shapes[body] || shapes.Pear;
  const shirt = outfit === 'Office Surrealist' ? 'fill-vx-fg-muted' : outfit === 'Soft Sculpture' ? 'fill-vx-money' : 'fill-vx-accent';
  const bottoms = outfit === 'Modern Basics' ? 'fill-vx-fg-muted' : 'fill-vx-fg';
  return (
    <svg viewBox="0 0 120 160" aria-hidden="true" className={compact ? 'h-24 w-full' : 'h-48 w-full'}>
      <ellipse cx="60" cy="151" rx="34" ry="4" className="fill-vx-fg opacity-10" />
      <DollHair hair={hair} />
      <circle cx="60" cy="35" r="17" className="fill-vx-fg" />
      <circle cx="54" cy="34" r="1.7" className="fill-vx-base" /><circle cx="66" cy="34" r="1.7" className="fill-vx-base" />
      <path d="M56 42q4 4 8 0" fill="none" stroke="rgb(var(--vx-base))" strokeWidth="1.5" strokeLinecap="round" />
      <path d={shape.leftArm} className="fill-vx-fg" /><path d={shape.rightArm} className="fill-vx-fg" />
      <path d={shape.torso} className={shirt} />
      {outfit === 'Soft Sculpture' && <ellipse cx="60" cy="83" rx="43" ry="33" className="fill-vx-money opacity-90" />}
      {outfit === 'Office Surrealist' && <><path d="M42 59l18 26 18-26-7-5-11 12-11-12z" className="fill-vx-panel" /><path d="M60 66l5 9-5 17-5-17z" className="fill-vx-money" /></>}
      {outfit === 'Tiny Formalwear' && <><path d="M45 58h30l-5 27H50z" className="fill-vx-fg-muted" /><path d="M53 61l7 7 7-7v12H53z" className="fill-vx-money" /><circle cx="60" cy="77" r="2" className="fill-vx-base" /></>}
      {outfit === 'Modern Basics' && <path d="M37 96h46l-5 22H42z" className={bottoms} />}
      <rect x={shape.leftLeg} y="108" width={shape.legW} height="38" rx={shape.legW / 2} className={bottoms} />
      <rect x={shape.rightLeg} y="108" width={shape.legW} height="38" rx={shape.legW / 2} className={bottoms} />
      <rect x={shape.leftLeg - 3} y="142" width={shape.legW + 7} height="7" rx="3" className="fill-vx-fg-muted" />
      <rect x={shape.rightLeg - 1} y="142" width={shape.legW + 7} height="7" rx="3" className="fill-vx-fg-muted" />
    </svg>
  );
}

function DollLab({ picks, facet, onFacet, onPick }) {
  const active = ODDLING_DOLL_FACETS.find((item) => item.id === facet) || ODDLING_DOLL_FACETS[0];
  return (
    <section data-assistant-target="oddlings.doll-lab" className="mt-5 overflow-hidden rounded-2xl border border-vx-border bg-vx-base">
      <div className="grid grid-cols-[132px_1fr] items-center gap-2 border-b border-vx-border px-3 py-3">
        <div className="rounded-xl border border-vx-border bg-vx-panel px-2 pt-1"><OddlingDoll picks={picks} /></div>
        <div className="min-w-0">
          <span className="font-vx-mono text-[9px] font-bold tracking-[0.14em] text-vx-accent">ODDLING DOLL LAB</span>
          <h2 className="mt-1 text-xl font-extrabold">Build the silhouette first.</h2>
          <p className="mt-1 text-xs leading-relaxed text-vx-fg-muted">Swap the body, hair and outfit like a dress-up doll. Every choice updates the real generation prompt.</p>
          <dl className="mt-3 space-y-1 font-vx-mono text-[9px] text-vx-fg-faint">
            <div className="flex gap-2"><dt>BODY</dt><dd className="truncate text-vx-fg">{picks.body_type || 'Any'}</dd></div>
            <div className="flex gap-2"><dt>HAIR</dt><dd className="truncate text-vx-fg">{picks.hair || 'Any'}</dd></div>
            <div className="flex gap-2"><dt>OUTFIT</dt><dd className="truncate text-vx-fg">{picks.wardrobe_style || 'Any'}</dd></div>
          </dl>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 p-2" role="tablist" aria-label="Doll feature">
        {ODDLING_DOLL_FACETS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={facet === item.id} onClick={() => onFacet(item.id)} className={`rounded-lg px-2 py-2 text-xs font-extrabold ${facet === item.id ? 'bg-vx-panel text-vx-fg' : 'text-vx-fg-muted hover:text-vx-fg'}`}>{item.label}</button>)}
      </div>
      <div className="grid grid-cols-4 gap-2 border-t border-vx-border p-3">
        {active.options.map(([value, label]) => {
          const optionPicks = { ...picks, [active.id]: value };
          const selected = picks[active.id] === value;
          return <button key={value} type="button" aria-pressed={selected} onClick={() => onPick(active.id, value)} className={`min-w-0 overflow-hidden rounded-xl border bg-vx-panel text-center transition-colors ${selected ? 'border-vx-accent ring-2 ring-vx-accent/20' : 'border-vx-border hover:border-vx-fg/30'}`}>
            <OddlingDoll picks={optionPicks} compact />
            <span className={`block truncate border-t px-1 py-2 text-[10px] font-bold ${selected ? 'border-vx-accent/30 text-vx-accent' : 'border-vx-border text-vx-fg-muted'}`}>{label}</span>
          </button>;
        })}
      </div>
      <p className="px-3 pb-3 text-[10px] leading-relaxed text-vx-fg-faint">Quick picks are a starting point. Use Detailed traits below for every shape, size, texture and accessory.</p>
    </section>
  );
}

export default function OddlingStudio() {
  const router = useRouter();
  const explore = useOddlingExplore();
  const { models, live: catalogLive } = useCatalog();
  const videoModel = animationModel(models);
  const [portraitId, setPortraitId] = useState(ODDLING_ARCHETYPES[0].id);
  const portrait = oddlingPortrait(portraitId);
  const [mode, setMode] = useState('portrait');
  const [picks, setPicks] = useState({ ...ODDLING_ARCHETYPES[0].picks });
  const [dollFacet, setDollFacet] = useState('body_type');
  const [motionId, setMotionId] = useState(ODDLING_MOTIONS[0].id);
  const [scene, setScene] = useState(ODDLING_SCENES[0]);
  const [reference, setReference] = useState(null);
  const [referenceNote, setReferenceNote] = useState('');
  const [openSections, setOpenSections] = useState(['build']);
  const [workspace, setWorkspace] = useState('explore');
  const [library, setLibrary] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [notice, setNotice] = useState('');
  const [highlightedPassportId, setHighlightedPassportId] = useState(null);
  const [loadedPassportId, setLoadedPassportId] = useState(null);
  const [session, setSession] = useState(null);
  const [balance, setBalance] = useState(null);
  const [handingOff, setHandingOff] = useState(false);
  useEffect(() => { publishJourneyView({ route: '/app/oddlings', loadedId: loadedPassportId }); }, [loadedPassportId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSession(getStoredSession()), 0);
    const unsubscribe = onSessionChange(setSession);
    return () => { window.clearTimeout(timer); unsubscribe(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadBalance() {
      if (!session) { setBalance(null); return; }
      try {
        const result = await gatewayFetch('/balance');
        if (!cancelled) setBalance(typeof result?.balance === 'number' ? result.balance : null);
      } catch {
        if (!cancelled) setBalance(null);
      }
    }
    loadBalance();
    window.addEventListener('veyrnox:balance-changed', loadBalance);
    return () => { cancelled = true; window.removeEventListener('veyrnox:balance-changed', loadBalance); };
  }, [session]);

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

  // /app/oddlings?oddling=<cast id> loads that character and opens its sheet.
  // Only a built-in id counts, the address bar is left alone, and the page
  // shows the character's own name, never the parameter.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const linked = parseOddlingDeepLink(window.location.search);
      if (!linked) return;
      setPicks({ ...linked.picks });
      setPortraitId(linked.id);
      setNotice(`${linked.name} loaded. Every detail is editable.`);
      setSheet(linked);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => {
    if (reference?.url) URL.revokeObjectURL(reference.url);
  }, [reference]);

  const promptPreview = mode === 'motion'
    ? buildOddlingAnimationPrompt(portraitId, motionId)
    : buildOddlingStudioPrompt({ picks, mode, motionId, scene, referenceNote });
  const selectedTraits = CHARACTER_GROUPS.filter((group) => picks[group.id]).length;
  const portraitModel = models.find((model) => model.id === 'flux-2-pro' && !model.gated);
  const generationModel = mode === 'motion' ? videoModel : portraitModel;
  const generationCost = catalogLive && typeof generationModel?.credits === 'number' ? generationModel.credits : null;
  const creditState = session ? oddlingCreditState(balance, generationCost) : null;
  const lowCredits = creditState?.low;
  const insufficientCredits = creditState?.insufficient;

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
    // The sheet's dialog hands focus back to its card as it closes, which scrolls
    // the card into view; scroll to the builder after that has happened.
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
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

  function surprise() {
    setPicks((current) => randomizeOddlingAll(current));
    setNotice('Every trait rolled. Your name, premise, voice, show and canon stayed yours.');
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
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) { setNotice('Choose a JPEG, PNG, WebP or AVIF image.'); return; }
    if (file.size > 2 * 1024 * 1024) { setNotice('Keep the local reference under 2 MB.'); return; }
    setReference({ name: file.name, url: URL.createObjectURL(file) });
    setNotice('Reference added locally. Describe what to borrow so it carries into the prompt.');
  }

  function continueToCreate() {
    if (!generationModel || !catalogLive || generationCost == null) {
      setNotice('Wait for the live price before continuing to Create.'); return;
    }
    if (mode === 'motion' && !portrait) {
      setNotice('Choose an original character to animate.'); return;
    }
    const model = mode === 'motion' ? videoModel.id : 'flux-2-pro';
    const prompt = mode === 'motion'
      ? buildOddlingAnimationPrompt(portraitId, motionId)
      : [referenceNote.trim() ? `Visual reference direction: ${referenceNote.trim()}.` : '', scene].filter(Boolean).join(' ');
    writeOddlingDraft(window.localStorage, picks);
    const result = saveOddlingToLibrary(window.localStorage, picks, motionId);
    if (result.ok) setLibrary(result.items);
    const written = writeStudioDraft(window.sessionStorage, {
      prompt, model, aspect: '9:16', oddlingPicks: picks,
      ...(mode === 'motion' ? { durationSeconds: 5 } : {}),
    });
    if (!written) { setNotice('The Create draft could not be handed off. Copy the prompt preview and paste it into Create.'); return; }
    if (mode !== 'motion') journeyHandoff(loadedPassportId);
    setHandingOff(true);
    const destination = `/app/create?model=${encodeURIComponent(model)}&oddling=1&passport=1${mode === 'motion' ? `&oddlingPhoto=${encodeURIComponent(portraitId)}&motion=${encodeURIComponent(motionId)}` : ''}`;
    router.push(destination);
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

            {mode === 'portrait' && <DollLab picks={picks} facet={dollFacet} onFacet={setDollFacet} onPick={setPick} />}

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
              <OddlingMotionPanel portrait={portrait} motionId={motionId} onMotion={setMotionId}
                priceLine={catalogLive && videoModel ? `${videoModel.name} · 5 seconds · ${videoModel.credits} credits` : 'Loading live animation pricing…'} />
            )}

            <div className="mt-5">
              <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-muted">DETAILED TRAITS</span>
              <p className="mt-1 text-xs text-vx-fg-faint">Fine-tune every part after choosing your doll.</p>
            </div>
            <OddlingTraitSections picks={picks} openSections={openSections} onToggle={(id) => setOpenSections((current) => toggleOpenSection(current, id))} onPick={setPick} />

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
            <div className="sticky bottom-0 z-10 -mx-5 mt-5 border-t border-vx-border bg-vx-panel/95 px-5 pb-2 pt-4 backdrop-blur-sm sm:-mx-7 sm:px-7">
              {lowCredits && (
                <div role="status" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-vx-money/40 bg-vx-money/[0.08] px-3 py-2.5">
                  <p className="text-xs leading-relaxed text-vx-fg-body">
                    <strong className="text-vx-money">{insufficientCredits ? 'Not enough credits.' : 'Credits are running low.'}</strong>{' '}
                    You have {balance} cr; this {mode === 'motion' ? 'animation' : 'portrait'} costs {generationCost} cr.
                  </p>
                  <Link href="/app/credits" className="shrink-0 rounded-full bg-vx-money px-3 py-2 text-[11px] font-extrabold text-vx-money-ink hover:brightness-110">Get credits</Link>
                </div>
              )}
              <div className="flex items-stretch gap-2">
                {mode === 'portrait' && (
                  <button type="button" onClick={surprise} className="w-[76px] shrink-0 rounded-xl border border-vx-border bg-vx-base px-2 text-center text-[11px] font-extrabold leading-tight text-vx-fg transition-colors hover:border-vx-accent">Surprise me</button>
                )}
                <Button type="button" size="lg" cost={generationCost} disabled={generationCost == null || handingOff} aria-busy={handingOff} data-assistant-target="oddlings.continue" onClick={continueToCreate} className="min-w-0 flex-1 justify-between rounded-xl py-5 text-lg shadow-[0_0_28px_rgb(var(--vx-accent)/0.16)]">
                  {handingOff ? 'Opening Create…' : generationCost == null ? 'Checking live price…' : mode === 'motion' ? 'Animate character' : 'Generate portrait'}
                </Button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 font-vx-mono text-[9px]">
                <span className="text-vx-fg-faint">OPENS CREATE · NO CHARGE UNTIL CONFIRMED</span>
                {generationCost != null && <span className="font-bold text-vx-money">LIVE PRICE · {generationCost} CR</span>}
              </div>
              {notice && <p role="status" className="mt-3 rounded-xl border border-vx-accent/30 bg-vx-accent/[0.06] px-3 py-2 text-xs text-vx-accent">{notice}</p>}
            </div>
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
              <OddlingExplore explore={explore} onSheet={setSheet} onRecreate={loadOddling} onAnimate={animateOddling} />
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
      {sheet && <OddlingSheet oddling={sheet} onClose={() => setSheet(null)} onRecreate={loadOddling} onAnimate={animateOddling} />}
    </>
  );
}
