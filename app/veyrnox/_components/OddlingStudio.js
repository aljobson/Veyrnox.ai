'use client';
import { pluralKey } from '../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { useI18n } from '../../../components/I18nProvider';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getStoredSession, getStoredUserId, onSessionChange } from '../../lib/authClient';
import { useCatalog } from '../_lib/useCatalog';
import { gatewayFetch } from '../_lib/gateway';
import { REVEAL_SAVED_ODDLING } from '../../../lib/savedOddlingHelp.js';
import { beginJourney, journeyHandoff, publishJourneyView } from '../_lib/veyJourneyStore';
import { Button } from './Button';
import { OddlingCatalog } from './OddlingCatalog';
import { OddlingExplore, useOddlingExplore } from './OddlingExplore';
import { OddlingMotionPanel } from './OddlingMotionPanel';
import { OddlingSheet } from './OddlingSheet';
import { chip, field } from './oddlingStyles';
import {
  CHARACTER_GROUPS,
  ODDLING_ARCHETYPES,
  ODDLING_SHOWS,
  ODDLING_TONES,
  writeOddlingDraft,
} from '../_lib/character';
import { writeStudioDraft } from '../_lib/landingDraft';
import { writeOddlingChatHandoff } from '../_lib/oddlingChatHandoff';
import { changeCharacterPick } from '../_lib/characterOptions';
import { parseOddlingDeepLink, withoutDeepLink } from '../_lib/oddlingExplore';
import { blobUrl } from '../_lib/blobUrl';
import {
  ODDLING_MOTIONS,
  ODDLING_SCENES,
  buildOddlingStudioPrompt,
  buildOddlingDirection,
  buildOddlingAnimationPrompt,
  animationModel,
  freshOddlingPicks,
  oddlingPortrait,
  oddlingPortraitModel,
  oddlingCreditState,
  randomizeOddlingAll,
  randomizeOddlingStyle,
  readOddlingLibrary,
  saveOddlingToLibrary,
} from '../_lib/oddlingStudio';

const PORTRAIT_INVALIDATING_KEYS = new Set([...CHARACTER_GROUPS.map((group) => group.id), 'oddling_rule']);

export default function OddlingStudio() {
  const { t, locale } = useI18n();
  const translation = useRef(t);
  translation.current = t;
  const number = value => locale === 'en' ? value : Number(value).toLocaleString(localeTag(locale));
  const router = useRouter();
  const explore = useOddlingExplore();
  const { models, live: catalogLive } = useCatalog();
  const videoModel = animationModel(models);
  const [portraitId, setPortraitId] = useState('');
  const portrait = oddlingPortrait(portraitId);
  const [mode, setMode] = useState('portrait');
  const [picks, setPicks] = useState(freshOddlingPicks);
  const [motionId, setMotionId] = useState(ODDLING_MOTIONS[0].id);
  const [scene, setScene] = useState(ODDLING_SCENES[0]);
  const [reference, setReference] = useState(null);
  const [referenceNote, setReferenceNote] = useState('');
  const [workspace, setWorkspace] = useState('explore');
  const [library, setLibrary] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [notice, setNotice] = useState('');
  const [highlightedPassportId, setHighlightedPassportId] = useState(null);
  const [loadedPassportId, setLoadedPassportId] = useState(null);
  const [session, setSession] = useState(null);
  const [balance, setBalance] = useState(null);
  const [handingOff, setHandingOff] = useState(null);
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
  // Only a built-in id counts, and the page shows the character's own name,
  // never the parameter. The link is applied once: the parameter is then taken
  // out of the address (same entry, no navigation), so a remount, a reload or
  // Back from Create does not open the sheet over the builder again.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const linked = parseOddlingDeepLink(window.location.search);
      if (!linked) return;
      setPicks({ ...linked.picks });
      setPortraitId(linked.id);
      setNotice(translation.current('app.oddlings.loaded',{name:linked.name}));
      setSheet(linked);
      try { window.history.replaceState(window.history.state, '', withoutDeepLink(window.location)); } catch { /* the sheet is open; the address keeps the parameter */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => {
    if (reference?.url) URL.revokeObjectURL(reference.url);
  }, [reference]);

  const promptPreview = mode === 'motion'
    ? buildOddlingAnimationPrompt(portraitId, motionId)
    : buildOddlingStudioPrompt({ picks, mode, motionId, scene, referenceNote, hasReference: !!reference });
  const selectedTraits = CHARACTER_GROUPS.filter((group) => picks[group.id]).length;
  const portraitModel = oddlingPortraitModel(models, { reference: !!reference });
  const generationModel = mode === 'motion' ? videoModel : portraitModel;
  const generationCost = catalogLive && typeof generationModel?.credits === 'number' ? generationModel.credits : null;
  const creditState = session ? oddlingCreditState(balance, generationCost) : null;
  const lowCredits = creditState?.low;
  const insufficientCredits = creditState?.insufficient;

  function setPick(key, value) {
    setPicks((current) => changeCharacterPick(current, key, value));
    if (PORTRAIT_INVALIDATING_KEYS.has(key)) setPortraitId('');
    setNotice('');
  }

  // Clears the look (every character choice) and keeps the name, voice and show the person typed.
  function clearLook() {
    const ids = new Set(CHARACTER_GROUPS.map((group) => group.id));
    setPicks((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !ids.has(key))));
    setPortraitId('');
    setNotice('');
  }

  function startFresh() {
    if (reference?.url) URL.revokeObjectURL(reference.url);
    setPicks(freshOddlingPicks());
    setPortraitId('');
    setLoadedPassportId(null);
    setReference(null);
    setReferenceNote('');
    setMode('portrait');
    setMotionId(ODDLING_MOTIONS[0].id);
    setScene(ODDLING_SCENES[0]);
    setSheet(null);
    setNotice(t('app.oddlings.freshStarted'));
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
  }

  function loadOddling(oddling) {
    setLoadedPassportId(null);
    setPicks({ ...oddling.picks });
    setPortraitId(oddling.id || '');
    setSheet(null);
    setNotice(t('app.oddlings.loaded',{name:oddling.name}));
    // The sheet's dialog hands focus back to its card as it closes, which scrolls
    // the card into view; scroll to the builder after that has happened.
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
  }

  function animateOddling(oddling) {
    loadOddling(oddling);
    setMode('motion');
    setNotice(t('app.oddlings.animateNotice',{name:oddling.name}));
  }

  function randomize() {
    setPicks((current) => randomizeOddlingStyle(current));
    setPortraitId('');
    setNotice(t("app.oddlings.remixed"));
  }

  function surprise() {
    setPicks((current) => randomizeOddlingAll(current));
    setPortraitId('');
    setNotice(t("app.oddlings.randomized"));
  }

  function save() {
    const savedAt = Date.now();
    writeOddlingDraft(window.localStorage, picks, savedAt);
    const result = saveOddlingToLibrary(window.localStorage, picks, motionId, savedAt);
    if (result.ok) {
      setLibrary(result.items);
      setNotice(t("app.oddlings.saved"));
    } else {
      setNotice(t("app.oddlings.saveBlocked"));
    }
  }

  function uploadReference(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) { setNotice(t("app.oddlings.imageTypes")); return; }
    if (file.size > 2 * 1024 * 1024) { setNotice(t("app.oddlings.referenceLimit")); return; }
    if (reference?.url) URL.revokeObjectURL(reference.url);
    setReference({ file, name: file.name, mimeType: file.type, url: URL.createObjectURL(file) });
    setNotice(t("app.oddlings.referenceAdded"));
  }

  function removeReference() {
    if (reference?.url) URL.revokeObjectURL(reference.url);
    setReference(null);
    setReferenceNote('');
    setNotice('');
  }

  async function uploadReferenceSource(file) {
    const upload = await gatewayFetch('/uploads', {
      method: 'POST',
      body: JSON.stringify({ content_type: file.type, size_bytes: file.size }),
    });
    const response = await fetch(upload.upload_url, {
      method: 'PUT',
      headers: upload.headers || { 'Content-Type': upload.content_type },
      body: file,
    });
    if (!response.ok) throw new Error('upload_failed');
    return upload.key;
  }

  async function continueToCreate() {
    if (!generationModel || !catalogLive || generationCost == null) {
      setNotice(t("app.oddlings.waitPrice")); return;
    }
    if (mode === 'motion' && !portrait) {
      setNotice(t("app.oddlings.chooseCharacter")); return;
    }
    if (reference && !session) {
      setNotice(t('app.oddlings.signInForUpload'));
      window.dispatchEvent(new CustomEvent('veyrnox:auth-required'));
      return;
    }
    setHandingOff('create');
    const model = generationModel.id;
    const prompt = mode === 'motion'
      ? buildOddlingAnimationPrompt(portraitId, motionId)
      : buildOddlingDirection({ mode, motionId, scene, referenceNote, hasReference: !!reference });
    try {
      const sourceKey = reference ? await uploadReferenceSource(reference.file) : '';
      writeOddlingDraft(window.localStorage, picks);
      const result = saveOddlingToLibrary(window.localStorage, picks, motionId);
      if (result.ok) setLibrary(result.items);
      const written = writeStudioDraft(window.sessionStorage, {
        prompt, model, aspect: '9:16', oddlingPicks: picks,
        ...(sourceKey ? { sources: { image: { sourceKey, mimeType: reference.mimeType, label: reference.name } } } : {}),
        ...(mode === 'motion' ? { durationSeconds: 5 } : {}),
      });
      if (!written) { setNotice(t("app.oddlings.handoffFailed")); setHandingOff(null); return; }
      if (mode !== 'motion' && result.ok) {
        beginJourney(result.item.id);
        journeyHandoff(result.item.id);
      } else if (mode !== 'motion') journeyHandoff(loadedPassportId);
      let destination = `/app/create?model=${encodeURIComponent(model)}&oddling=1&passport=1`;
      if (mode === 'motion' && portraitId) destination += '&oddlingPhoto=' + encodeURIComponent(portraitId) + '&motion=' + encodeURIComponent(motionId);
      router.push(destination);
    } catch {
      setHandingOff(null);
      setNotice(t('app.oddlings.uploadFailed'));
    }
  }

  function continueToChat() {
    const ownerId = getStoredUserId();
    if (!ownerId) { window.dispatchEvent(new CustomEvent('veyrnox:auth-required')); return; }
    writeOddlingDraft(window.localStorage, picks);
    const result = saveOddlingToLibrary(window.localStorage, picks, motionId);
    if (result.ok) setLibrary(result.items);
    const launchId = writeOddlingChatHandoff(window.sessionStorage, {
      ownerId, picks, mode, scene, referenceNote, portraitId, motionId,
    });
    if (!launchId) { setNotice(t('app.oddlings.chatHandoffFailed')); return; }
    setHandingOff('chat');
    router.push(`/app/chat?skill=oddling-continuity&skill=storyboard&skill=prompt-writer&skill=bring-to-life&oddling=${encodeURIComponent(launchId)}`);
  }

  return (
    <>
      <div data-oddling-studio className="min-h-[calc(100dvh-4rem)]">
      <header className="border-b border-vx-border bg-vx-panel px-5 py-5 sm:px-7 xl:px-10">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <span className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-vx-accent">{t("app.oddlings.eyebrow")}</span>
            <h1 data-testid="oddling-title" className="vx-display mt-2 text-3xl sm:text-4xl">{t("app.oddlings.title")}</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-vx-fg-body">{t("app.oddlings.intro")}</p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-3 sm:w-auto">
            <button type="button" onClick={startFresh} className={chip(false)}>{t('app.oddlings.startFresh')}</button>
            <span className="rounded-full border border-vx-border px-2.5 py-1 font-vx-mono text-[9px] text-vx-fg-muted">{t(pluralKey(t,locale,'app.oddlings.traits',selectedTraits),{count:number(selectedTraits)})}</span>
            <div className="grid min-w-0 flex-1 grid-cols-2 rounded-xl border border-vx-border bg-vx-base p-1 sm:w-72 sm:flex-none" role="tablist" aria-label={t("app.oddlings.creationMode")}>
              <button type="button" role="tab" aria-selected={mode === 'portrait'} onClick={() => setMode('portrait')} className={`rounded-lg px-3 py-2.5 text-sm font-bold ${mode === 'portrait' ? 'bg-vx-panel text-vx-fg shadow-sm' : 'text-vx-fg-muted'}`}>{t("app.oddlings.create")}</button>
              <button type="button" role="tab" aria-selected={mode === 'motion'} onClick={() => setMode('motion')} className={`rounded-lg px-3 py-2.5 text-sm font-bold ${mode === 'motion' ? 'bg-vx-panel text-vx-fg shadow-sm' : 'text-vx-fg-muted'}`}>{t("app.oddlings.motion")}</button>
            </div>
          </div>
        </div>
      </header>
      {mode === 'portrait' && <OddlingCatalog picks={picks} onPick={setPick} onClear={clearLook} />}
      <div className="grid xl:grid-cols-[430px_minmax(0,1fr)]">
        <aside data-assistant-target="oddlings.builder" data-assistant-loaded-passport={loadedPassportId || undefined} className="min-w-0 border-b border-vx-border bg-vx-panel xl:border-b-0 xl:border-e">
          <div className="sticky top-16 max-h-[calc(100dvh-4rem)] overflow-y-auto scroll-pb-60 p-5 pb-60 sm:p-7 sm:pb-60">

            <div data-assistant-target="oddlings.reference" className="mt-5 rounded-2xl border border-vx-border bg-vx-base p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-muted">{t("app.oddlings.optionalReference")}</span>
                  <p className="mt-1 text-xs text-vx-fg-faint">{t("app.oddlings.moodboard")}</p>
                </div>
                <label className={chip(!!reference)}>
                  {reference ? t("app.oddlings.replace") : t("app.oddlings.uploadPhoto")}
                  <input data-testid="oddling-reference-file" type="file" accept="image/*" onChange={uploadReference} className="sr-only" />
                </label>
              </div>
              {reference && <img data-testid="oddling-reference-image" src={blobUrl(reference.url)} alt={t('app.oddlings.referenceAlt',{name:reference.name})} className="mt-3 max-h-48 w-full rounded-xl object-cover" />}
              {reference && <button type="button" onClick={removeReference} className="mt-2 font-vx-mono text-[9px] font-bold text-vx-fg-muted underline">{t('app.oddlings.removeReference')}</button>}
              <input value={referenceNote} onChange={(event) => setReferenceNote(event.target.value)} maxLength={180} className={`${field} mt-3`} placeholder={t("app.oddlings.referencePlaceholder")} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <label>
                <span className="mb-1 block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">{t("app.oddlings.name")}</span>
                <input value={picks.oddling_name || ''} onChange={(event) => setPick('oddling_name', event.target.value)} maxLength={40} className={field} />
              </label>
              <label>
                <span className="mb-1 block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">{t("app.oddlings.voice")}</span>
                <select value={picks.oddling_voice || ''} onChange={(event) => setPick('oddling_voice', event.target.value)} className={field}>
                  <option value="">{t("app.oddlings.choose")}</option>
                  {ODDLING_TONES.map(([label]) => <option key={label}>{label}</option>)}
                </select>
              </label>
            </div>
            <label className="mt-3 block">
              <span className="mb-1 block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">{t("app.oddlings.followReason")}</span>
              <input value={picks.oddling_obsession || ''} onChange={(event) => setPick('oddling_obsession', event.target.value)} maxLength={140} className={field} />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">{t("app.oddlings.show")}</span>
              <select value={picks.oddling_show || ''} onChange={(event) => setPick('oddling_show', event.target.value)} className={field}>
                <option value="">{t("app.oddlings.chooseFormat")}</option>
                {ODDLING_SHOWS.map(([label]) => <option key={label}>{label}</option>)}
              </select>
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">{t("app.oddlings.canon")}</span>
              <textarea value={picks.oddling_rule || ''} onChange={(event) => setPick('oddling_rule', event.target.value)} maxLength={160} rows={2} className={`${field} resize-none`} />
            </label>

            {mode === 'motion' && (
              <OddlingMotionPanel portrait={portrait} motionId={motionId} onMotion={setMotionId}
                priceLine={catalogLive && videoModel ? t('app.oddlings.priceLine',{model:videoModel.name,credits:t(pluralKey(t,locale,'app.editor.generation.credits',videoModel.credits),{count:number(videoModel.credits)})}) : t('app.oddlings.loadingPrice')} />
            )}

            <label className="mt-5 block">
              <span className="mb-1 block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">{mode === 'motion' ? t("app.oddlings.portraitScene") : t("app.oddlings.firstScene")}</span>
              <textarea value={scene} onChange={(event) => setScene(event.target.value)} maxLength={300} rows={3} className={`${field} resize-none`} />
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ODDLING_SCENES.slice(0, 3).map((item, index) => <button key={item} type="button" onClick={() => setScene(item)} className={chip(scene === item)}>{t('app.oddlings.scene',{count:number(index+1)})}</button>)}
            </div>

            <details data-assistant-target="oddlings.prompt" className="mt-5 rounded-xl border border-vx-border bg-vx-base p-3">
              <summary className="cursor-pointer font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-muted">{t("app.oddlings.promptPreview")}</summary>
              <p className="mt-3 break-words text-xs leading-relaxed text-vx-fg-body">{promptPreview}</p>
            </details>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={randomize} className={chip(false)}>{t("app.oddlings.randomize")}</button>
              <button type="button" onClick={save} className={chip(true)}>{t("app.oddlings.save")}</button>
            </div>
          </div>
        </aside>

        <section aria-label={t("app.oddlings.library")} className="min-w-0 bg-vx-base p-5 sm:p-8 lg:p-10">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div>
                <span className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-vx-accent">{t(pluralKey(t,locale,'app.oddlings.humans',ODDLING_ARCHETYPES.filter((item) => item.kind === 'human').length),{count:number(ODDLING_ARCHETYPES.filter((item) => item.kind === 'human').length)})} · {t(pluralKey(t,locale,'app.oddlings.beings',ODDLING_ARCHETYPES.filter((item) => item.kind === 'creature').length),{count:number(ODDLING_ARCHETYPES.filter((item) => item.kind === 'creature').length)})}</span>
                <h2 className="vx-display mt-2 text-5xl sm:text-6xl">{t("app.oddlings.libraryTitle")}</h2>
                <p className="mt-3 max-w-2xl text-vx-fg-body">{t("app.oddlings.exploreIntro")}</p>
              </div>
              <div className="flex rounded-xl border border-vx-border bg-vx-panel p-1" role="tablist" aria-label={t("app.oddlings.workspace")}>
                <button type="button" role="tab" aria-selected={workspace === 'explore'} onClick={() => setWorkspace('explore')} className={`rounded-lg px-4 py-2 text-sm font-bold ${workspace === 'explore' ? 'bg-vx-base text-vx-fg' : 'text-vx-fg-muted'}`}>{t("label.Explore")}</button>
                <button type="button" role="tab" data-assistant-target="oddlings.history" aria-selected={workspace === 'history'} onClick={() => setWorkspace('history')} className={`rounded-lg px-4 py-2 text-sm font-bold ${workspace === 'history' ? 'bg-vx-base text-vx-fg' : 'text-vx-fg-muted'}`}>{t('app.oddlings.history',{count:number(library.length)})}</button>
              </div>
            </div>

            {workspace === 'explore' ? (
              <OddlingExplore explore={explore} onSheet={setSheet} onRecreate={loadOddling} onAnimate={animateOddling} />
            ) : library.length ? (
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {library.map((item) => (
                  <article key={item.id} data-saved-passport-id={item.id} data-assistant-target={highlightedPassportId === item.id ? 'oddlings.saved' : undefined} className="scroll-mt-24 rounded-2xl border border-vx-border bg-vx-panel p-5">
                    <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-accent">{t("app.oddlings.savedPassport")}</span>
                    <h3 className="mt-2 text-xl font-extrabold">{item.name}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-vx-fg-muted">{item.picks.oddling_obsession || t("app.oddlings.noPremise")}</p>
                    <p className="mt-4 font-vx-mono text-[9px] text-vx-fg-faint">{new Intl.DateTimeFormat(localeTag(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(item.savedAt)}</p>
                    <button type="button" onClick={() => {
                      loadOddling({ name: item.name, hook: item.picks.oddling_obsession || t("app.oddlings.savedOddling"), picks: item.picks });
                      setMode('portrait');
                      setMotionId(item.motionId || ODDLING_MOTIONS[0].id);
                      setLoadedPassportId(item.id);
                    }} className={`${chip(true)} mt-4`}>{t("app.oddlings.loadEdit")}</button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-8 rounded-2xl border border-dashed border-vx-border p-12 text-center">
                <h3 className="text-xl font-extrabold">{t("app.oddlings.noPassports")}</h3>
                <p className="mt-2 text-sm text-vx-fg-muted">{t("app.oddlings.saveHelp")}</p>
              </div>
            )}
          </div>
        </section>
      </div>
            <div className="sticky bottom-0 z-20 border-t border-vx-border bg-vx-panel/95 px-4 py-2 backdrop-blur-sm sm:px-7 xl:px-10"><div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2">
              {lowCredits && (
                <div role="status" className="flex min-w-0 flex-1 basis-full items-center justify-between gap-3 rounded-lg border border-vx-money/40 bg-vx-money/[0.08] px-3 py-1.5 sm:basis-0">
                  <p className="text-xs leading-snug text-vx-fg-body">
                    <strong className="text-vx-money">{insufficientCredits ? t("app.oddlings.insufficient") : t("app.oddlings.low")}</strong>{' '}
                    {t(mode==='motion'?'app.oddlings.balanceAnimation':'app.oddlings.balancePortrait',{balance:number(balance),cost:number(generationCost)})}
                  </p>
                  <Link href="/app/credits" className="shrink-0 rounded-full bg-vx-money px-3 py-1.5 text-[11px] font-extrabold text-vx-money-ink hover:brightness-110">{t("app.oddlings.getCredits")}</Link>
                </div>
              )}
              {!lowCredits && <p className="hidden min-w-0 flex-1 font-vx-mono text-[10px] text-vx-fg-faint sm:block">{generationModel ? t('app.oddlings.selectedPipeline',{model:generationModel.name}) : t("app.oddlings.opensCreate")}{generationCost != null && <> · <span className="font-bold text-vx-money">{t('app.oddlings.livePrice',{count:number(generationCost)})}</span></>}</p>}
              <div className="ms-auto grid w-full gap-2 sm:flex sm:w-auto sm:items-center sm:justify-end">
                {mode === 'portrait' && (
                  <button type="button" onClick={surprise} className="w-full rounded-full border border-vx-border bg-vx-base px-4 py-2 text-xs font-extrabold text-vx-fg transition-colors hover:border-vx-accent sm:w-auto">{t("app.oddlings.surprise")}</button>
                )}
                <button type="button" disabled={!!handingOff} data-assistant-target="oddlings.chat" onClick={continueToChat} className="w-full whitespace-normal rounded-full border border-vx-accent px-4 py-2 text-xs font-extrabold text-vx-accent transition-colors hover:bg-vx-accent/10 disabled:opacity-50 sm:w-auto">
                  {handingOff === 'chat' ? t('app.oddlings.openingChat') : t('app.oddlings.refineChat')}
                </button>
                <Button type="button" size="md" cost={generationCost} disabled={generationCost == null || !!handingOff} aria-busy={!!handingOff} data-assistant-target="oddlings.continue" onClick={continueToCreate} className="w-full min-w-0 justify-between sm:w-auto">
                  {handingOff === 'create' ? t("app.oddlings.opening") : generationCost == null ? t("app.oddlings.checkingPrice") : mode === 'motion' ? t("app.oddlings.animate") : t("app.oddlings.generatePortrait")}
                </Button>
              </div>
              {notice && <p data-testid="oddling-notice" role="status" className="basis-full rounded-lg border border-vx-accent/30 bg-vx-accent/[0.06] px-3 py-1.5 text-xs text-vx-accent">{notice}</p>}
            </div>
            </div>
      </div>
      {sheet && <OddlingSheet oddling={sheet} onClose={() => setSheet(null)} onRecreate={loadOddling} onAnimate={animateOddling} />}
    </>
  );
}
