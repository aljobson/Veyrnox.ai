'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { getFreshAccessToken, onSessionChange } from '../../lib/authClient.js';
import { saveAccountLanguage } from '../../lib/accountLanguageClient.js';
import { LOCALES } from '../../../lib/i18n/locales.mjs';
import { rememberLocale } from '../../../lib/i18n/localeCookie.mjs';
import { fetchVibe, skipVibe } from '../_lib/creatorProfile';

// The Vibe Check once asked seven questions (look, goal, pace, chaos, destination, audience, voice) and showed a creator
// card. Those are removed: what is left is the language choice and Vey's intro. Continuing records the check as done
// (a skip, which the server accepts without answers) so the Explore banner is not shown again; nothing is charged.

// Set just before the page reloads in a newly chosen language, so the language card is not asked a second time.
const LANGUAGE_DONE_KEY = 'veyrnox_vibe_language';

const primary = 'vx-press rounded-full bg-vx-accent px-6 py-3 text-center font-bold text-vx-base disabled:opacity-40';
const quiet = 'vx-press rounded-full px-3 py-2 text-sm font-semibold text-vx-fg-muted hover:text-vx-fg';

export function VibeCheck({ retake = false }) {
  const { t, locale, languagesEnabled } = useI18n();
  const router = useRouter();
  const heading = useRef(null);
  // The language comes first, in the language the page is showing, with every language listed by its own name and flag.
  // Choosing another one saves it (cookie and account) and reloads the page so the whole experience, this intro
  // included, is in that language. Not asked on a retake, or while languages are off.
  const [language, setLanguage] = useState(retake || !languagesEnabled ? 'done' : 'ask');
  // 0 = intro, -2 = needs sign-in, -3 = off.
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // After a full page load the access token is restored from the HttpOnly cookie, so ask for a fresh one instead of
  // reading memory once: reading it on mount showed "Sign in" to people who were signed in (QA 2026-10-29).
  useEffect(() => {
    let live = true;
    getFreshAccessToken().then((token) => { if (live && !token) setStep(-2); });
    const off = onSessionChange((s) => { if (live) setStep((cur) => (s ? (cur === -2 ? 0 : cur) : -2)); });
    return () => { live = false; off(); };
  }, []);
  useEffect(() => {
    try { if (sessionStorage.getItem(LANGUAGE_DONE_KEY)) { sessionStorage.removeItem(LANGUAGE_DONE_KEY); setLanguage('done'); } } catch { /* ask again */ }
  }, []);
  // A new screen starts at its heading, for keyboard and screen-reader users.
  useEffect(() => { heading.current?.focus(); }, [step, language]);

  async function proceed() {
    setBusy(true);
    const existing = await fetchVibe();
    // A saved choice is left alone.
    if (existing.status === 'completed') { router.push(retake ? '/app/account' : '/app'); return; }
    const r = await skipVibe();
    if (r.ok || r.code === 'unavailable') { router.push(retake ? '/app/account' : '/app'); return; }
    setBusy(false);
    setStep(-3);
  }

  function chooseLanguage(code) {
    if (code === locale) { setLanguage('done'); return; }
    rememberLocale(code);
    saveAccountLanguage(code);
    try { sessionStorage.setItem(LANGUAGE_DONE_KEY, '1'); } catch { /* it will be asked again */ }
    window.location.reload();
  }

  const title = (text) => <h1 ref={heading} tabIndex={-1} className="vx-display text-[32px] outline-none sm:text-[40px]">{text}</h1>;

  if (step === -2) return <div><p className="mb-4 text-vx-fg-body">{t('app.vibe.signIn')}</p><button type="button" className={primary} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t('oauth.signIn')}</button></div>;
  if (step === -3) return <div>{title(t('app.vibe.page.title'))}<p className="mt-3 text-vx-fg-body" role="status">{t('app.vibe.unavailable')}</p><Link href="/app" className={`${primary} mt-6 inline-block`}>{t('app.vibe.card.home')}</Link></div>;
  if (language === 'ask') {
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
  return (
    <div>
      {title(t('app.vibe.intro.title'))}
      <p className="mt-3 max-w-[46ch] text-vx-fg-body">{t('app.vibe.intro.body')}</p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button type="button" className={primary} disabled={busy} onClick={proceed}>{t('app.vibe.start')}</button>
        {retake ? null : <button type="button" className={quiet} disabled={busy} onClick={proceed}>{t('app.vibe.skip')}</button>}
      </div>
    </div>
  );
}
