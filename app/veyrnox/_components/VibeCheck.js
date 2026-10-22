'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { getSession } from '../../lib/authClient.js';
import { saveAccountLanguage } from '../../lib/accountLanguageClient.js';
import { LOCALES } from '../../../lib/i18n/locales.mjs';
import { rememberLocale } from '../../../lib/i18n/localeCookie.mjs';
import { CREATOR_ANSWERS, fetchVibe, saveVibe, skipVibe } from '../_lib/creatorProfile';
import { PRESETS, templateHref } from '../_lib/tokens';
import { archetypeParts } from '../../../lib/creatorArchetype.js';
import { rankByTaste } from '../../../lib/creatorWords.js';
import { CHAOS_MAX, STUDIO_NAME_MAX, cleanCreatorAnswers } from '../../../lib/creatorProfile.js';

// The Vibe Check (ADR-0251): seven taps, one question each, then a creator card. Skippable on every screen, and a skip
// never throws away answers already saved. What is chosen here only reorders templates; nothing is charged.
const STEPS = ['look', 'goal', 'pace', 'chaos', 'destination', 'audience', 'voice'];
const TOTAL = STEPS.length;
const SUBTITLED = new Set(['pace', 'voice']);
// A swatch for each look, so the first question is a picture and not a list.
const LOOK_SWATCH = {
  neon_rain: 'linear-gradient(135deg,#0b1d4a,#e0245e)',
  sunlit_kitchen: 'linear-gradient(135deg,#d99a1f,#c4562c)',
  retro_vhs: 'linear-gradient(135deg,#3a3a8c,#1f8f81)',
  dream_anime: 'linear-gradient(135deg,#b24f8a,#4a6fc4)',
  glossy_product: 'linear-gradient(135deg,#6b7280,#1f2937)',
  doc_grit: 'linear-gradient(135deg,#6b5b45,#1f1a14)',
};

// Set just before the page reloads in a newly chosen language, so the language card is not asked a second time.
const LANGUAGE_DONE_KEY = 'veyrnox_vibe_language';

const primary = 'vx-press rounded-full bg-vx-accent px-6 py-3 text-center font-bold text-vx-base disabled:opacity-40';
const quiet = 'vx-press rounded-full px-3 py-2 text-sm font-semibold text-vx-fg-muted hover:text-vx-fg';

function Choice({ label, sub, on, onPick, swatch }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className="vx-press flex min-h-14 w-full flex-col overflow-hidden rounded-2xl border-2 border-vx-border bg-vx-panel text-start hover:border-vx-fg-muted aria-pressed:border-vx-accent"
    >
      {swatch ? <span aria-hidden="true" className="block h-14 w-full" style={{ background: swatch }} /> : null}
      <span className="px-4 py-3">
        <span className="block font-semibold">{label}</span>
        {sub ? <span className="block text-sm text-vx-fg-muted">{sub}</span> : null}
      </span>
    </button>
  );
}

export function VibeCheck({ retake = false }) {
  const { t, locale, languagesEnabled } = useI18n();
  const router = useRouter();
  const heading = useRef(null);
  // The language comes first, in the language the page is showing, with every language listed by its own name and flag.
  // Choosing another one saves it (cookie and account) and reloads the page so the whole experience, this interview
  // included, is in that language. Not asked on a retake, or while languages are off.
  const [language, setLanguage] = useState(retake || !languagesEnabled ? 'done' : 'ask');
  // 0 = intro, 1..7 = questions, 8 = card, -1 = skipped, -2 = needs sign-in, -3 = off.
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState({ chaos: 2 });
  const [studio, setStudio] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(null);

  useEffect(() => { if (!getSession()) setStep(-2); }, []);
  useEffect(() => {
    try { if (sessionStorage.getItem(LANGUAGE_DONE_KEY)) { sessionStorage.removeItem(LANGUAGE_DONE_KEY); setLanguage('done'); } } catch { /* ask again */ }
  }, []);
  // A new screen starts at its heading, for keyboard and screen-reader users.
  useEffect(() => { heading.current?.focus(); }, [step]);

  const key = step >= 1 && step <= TOTAL ? STEPS[step - 1] : null;
  const choose = (field, value) => { setDraft((d) => ({ ...d, [field]: value })); setStep((s) => s + 1); };

  async function skip() {
    const existing = await fetchVibe();
    // Retaking and backing out leaves the saved answers alone.
    if (existing.status === 'completed') { router.push('/app/account'); return; }
    const r = await skipVibe();
    setStep(r.ok || r.code === 'unavailable' ? -1 : -3);
  }

  async function finish() {
    const name = studio.trim();
    const clean = cleanCreatorAnswers({ ...draft, ...(name ? { studio_name: name } : {}) });
    if (!clean.ok) return;
    setSaving(true);
    setFailed(false);
    const r = await saveVibe(clean.answers);
    setSaving(false);
    if (!r.ok) { if (r.code === 'unavailable') setStep(-3); else setFailed(true); return; }
    setSaved(clean.answers);
    setStep(TOTAL + 1);
  }

  function chooseLanguage(code) {
    if (code === locale) { setLanguage('done'); return; }
    rememberLocale(code);
    saveAccountLanguage(code);
    try { sessionStorage.setItem(LANGUAGE_DONE_KEY, '1'); } catch { /* it will be asked again */ }
    window.location.reload();
  }

  function makeFirst() {
    const ranked = rankByTaste(PRESETS, saved, (p) => `${p.name} ${p.category} ${p.prompt}`);
    router.push(ranked[0] ? templateHref(ranked[0]) : '/app');
  }

  const title = (text) => <h1 ref={heading} tabIndex={-1} className="vx-display text-[32px] outline-none sm:text-[40px]">{text}</h1>;
  const progress = (n) => (
    <div className="mb-6 flex gap-1" role="img" aria-label={t('app.vibe.step', { n, total: TOTAL })}>
      {STEPS.map((s, i) => <span key={s} className={`h-1 flex-1 rounded-full ${i < n ? 'bg-vx-accent' : 'bg-vx-border'}`} />)}
    </div>
  );

  if (step === -2) return <div><p className="mb-4 text-vx-fg-body">{t('app.vibe.signIn')}</p><button type="button" className={primary} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t('oauth.signIn')}</button></div>;
  if (step === -3) return <div>{title(t('app.vibe.page.title'))}<p className="mt-3 text-vx-fg-body" role="status">{t('app.vibe.unavailable')}</p><Link href="/app" className={`${primary} mt-6 inline-block`}>{t('app.vibe.card.home')}</Link></div>;
  if (step === -1) {
    return <div>{title(t('app.vibe.skipped.title'))}<p className="mt-3 text-vx-fg-body">{t('app.vibe.skipped.body')}</p><Link href="/app" className={`${primary} mt-6 inline-block`}>{t('app.vibe.skipped.go')}</Link></div>;
  }
  if (step === 0 && language === 'ask') {
    return (
      <div>
        {title(t('app.vibe.language.title'))}
        <p className="mt-3 max-w-[46ch] text-vx-fg-body">{t('app.vibe.language.hint')}</p>
        <ul className="mt-6 grid gap-2 sm:grid-cols-2">
          {LOCALES.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                lang={l.hreflang}
                aria-pressed={l.code === locale}
                data-locale={l.code}
                onClick={() => chooseLanguage(l.code)}
                className="vx-press flex min-h-12 w-full items-center gap-3 rounded-2xl border-2 border-vx-border bg-vx-panel px-4 py-2 text-start font-semibold hover:border-vx-fg-muted aria-pressed:border-vx-accent"
              >
                <span aria-hidden="true" className="text-[22px] leading-none">{l.flag}</span>
                <span>{l.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <button type="button" className={primary} onClick={() => setLanguage('done')}>{t('app.vibe.language.continue')}</button>
        </div>
      </div>
    );
  }
  if (step === 0) {
    return (
      <div>
        {progress(0)}
        {title(t('app.vibe.intro.title'))}
        <p className="mt-3 max-w-[46ch] text-vx-fg-body">{t('app.vibe.intro.body')}</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button type="button" className={primary} onClick={() => setStep(1)}>{t('app.vibe.start')}</button>
          {retake ? null : <button type="button" className={quiet} onClick={skip}>{t('app.vibe.skip')}</button>}
        </div>
      </div>
    );
  }
  if (step === TOTAL + 1 && saved) {
    const parts = archetypeParts(saved);
    const card = {
      studio: parts.studio,
      name: t('app.vibe.card.name', { adjective: t(`app.vibe.card.adj.${parts.adjective}`), noun: t(`app.vibe.card.noun.${parts.pace ?? 'maker'}`) }),
      traits: [parts.look && t(`app.vibe.look.${parts.look}`), t(`app.vibe.chaos.${parts.chaos}`), parts.destination && t(`app.vibe.destination.${parts.destination}`)].filter(Boolean),
    };
    const swatch = LOOK_SWATCH[saved.look] || LOOK_SWATCH.neon_rain;
    return (
      <div>
        {progress(TOTAL)}
        <p className="sr-only" ref={heading} tabIndex={-1}>{t('app.vibe.card.kicker')}</p>
        <div className="flex min-h-[220px] flex-col justify-end gap-2 rounded-2xl p-6 text-white" style={{ background: swatch }}>
          <span className="text-xs font-bold uppercase tracking-[0.16em] opacity-90">{card.studio ?? t('app.vibe.card.kicker')}</span>
          <span className="vx-display text-[34px] leading-[1.05]">{card.name}</span>
          <span className="mt-1 flex flex-wrap gap-2">
            {card.traits.map((trait) => <span key={trait} className="rounded-full bg-black/35 px-3 py-1 text-[13px] font-semibold">{trait}</span>)}
          </span>
        </div>
        <p className="mt-4 text-vx-fg-body">{t('app.vibe.card.leads')}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" className={primary} onClick={makeFirst}>{t('app.vibe.card.first')}</button>
          <Link href="/app" className={quiet}>{t('app.vibe.card.home')}</Link>
        </div>
      </div>
    );
  }
  if (!key) return null;

  return (
    <div>
      {progress(step)}
      <p className="mb-2 text-sm text-vx-fg-muted">{t('app.vibe.step', { n: step, total: TOTAL })}</p>
      {title(t(`app.vibe.${key}.title`))}
      <div className="mt-6 grid gap-3">
        {key === 'chaos' ? (
          <>
            <p className="text-center text-xl font-bold" aria-live="polite">{t(`app.vibe.chaos.${draft.chaos ?? 2}`)}</p>
            <div className="flex gap-2" role="group" aria-label={t('app.vibe.chaos.title')}>
              {Array.from({ length: CHAOS_MAX + 1 }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={draft.chaos === i}
                  aria-label={t(`app.vibe.chaos.${i}`)}
                  onClick={() => setDraft((d) => ({ ...d, chaos: i }))}
                  className="vx-press h-12 flex-1 rounded-xl border-2 border-vx-border bg-vx-panel aria-pressed:border-vx-accent aria-pressed:bg-vx-accent"
                />
              ))}
            </div>
            <div className="flex justify-between text-sm text-vx-fg-muted"><span>{t('app.vibe.chaos.less')}</span><span>{t('app.vibe.chaos.more')}</span></div>
            <p className="text-vx-fg-body">{t('app.vibe.chaos.hint')}</p>
          </>
        ) : key === 'voice' ? (
          <>
            <input
              type="text"
              value={studio}
              maxLength={STUDIO_NAME_MAX}
              onChange={(e) => setStudio(e.target.value)}
              placeholder={t('app.vibe.voice.studio')}
              aria-label={t('app.vibe.voice.studio')}
              className="rounded-xl border-2 border-vx-border bg-vx-panel px-4 py-3"
            />
            {CREATOR_ANSWERS.voice.map((v) => (
              <Choice key={v} label={t(`app.vibe.voice.${v}`)} sub={t(`app.vibe.voice.${v}.sub`)} on={draft.voice === v} onPick={() => setDraft((d) => ({ ...d, voice: v }))} />
            ))}
          </>
        ) : (
          <div className={key === 'look' ? 'grid grid-cols-2 gap-3' : 'grid gap-3'}>
            {CREATOR_ANSWERS[key].map((v) => (
              <Choice
                key={v}
                label={t(`app.vibe.${key}.${v}`)}
                sub={SUBTITLED.has(key) ? t(`app.vibe.${key}.${v}.sub`) : null}
                swatch={key === 'look' ? LOOK_SWATCH[v] : null}
                on={draft[key] === v}
                onPick={() => choose(key, v)}
              />
            ))}
          </div>
        )}
      </div>
      {failed ? <p role="alert" className="mt-4 text-sm text-vx-danger">{t('app.vibe.error')}</p> : null}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {step > 1 ? <button type="button" className={quiet} onClick={() => setStep(step - 1)}>{t('app.vibe.back')}</button> : null}
          <button type="button" className={quiet} onClick={skip}>{t('app.vibe.skip')}</button>
        </div>
        {key === 'chaos' ? <button type="button" className={primary} onClick={() => setStep(step + 1)}>{t('app.vibe.next')}</button> : null}
        {key === 'voice' ? <button type="button" className={primary} disabled={!draft.voice || saving} onClick={finish}>{saving ? t('app.vibe.saving') : t('app.vibe.voice.done')}</button> : null}
      </div>
    </div>
  );
}
