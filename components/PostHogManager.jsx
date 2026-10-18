'use client';
import { rich } from '../lib/i18n/rich';
import { useI18n } from './I18nProvider';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePostHog } from '@posthog/next';
import { getSession, onSessionChange } from '../app/lib/authClient.js';
import { ANALYTICS_ERROR, ANALYTICS_EVENT } from '../app/lib/analyticsClient.js';
import {
  ANALYTICS_PREFERENCE_KEY,
  normaliseReplaySampleRate,
  readAnalyticsPreference,
  replayAllowedOnPath,
  sanitisePostHogEvent,
  setReplayCapture,
  writeAnalyticsPreference,
} from '../app/lib/analyticsPrivacy.js';

const forceConsentedReplay = normaliseReplaySampleRate(process.env.NEXT_PUBLIC_POSTHOG_REPLAY_SAMPLE_RATE) === 1;
const signedInAccount = () => getSession()?.user?.id || null;
const signedOutAccount = () => null;

export default function PostHogManager() {
  const { t } = useI18n();
  const posthog = usePostHog();
  const pathname = usePathname() || '/';
  const accountId = useSyncExternalStore(onSessionChange, signedInAccount, signedOutAccount);
  const [preference, setPreference] = useState(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const previousAccount = useRef(null);

  useEffect(() => {
    const explicit = posthog.get_explicit_consent_status();
    const saved = readAnalyticsPreference(window.localStorage);
    if (saved && ((explicit === 'granted') === saved.analytics)) setPreference(saved);
    else if (explicit === 'granted') setPreference({ analytics: true, replay: false });
    else if (explicit === 'denied') setPreference({ analytics: false, replay: false });
    else setPreference(null);

    const onStorage = (event) => {
      if (event.key !== ANALYTICS_PREFERENCE_KEY && event.key !== null) return;
      const next = readAnalyticsPreference(window.localStorage);
      if (next) setPreference(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [posthog]);

  // Install URL redaction before a visitor can opt in from the banner. No
  // query string, fragment, copied text, DOM text, or element URL is sent.
  useEffect(() => {
    posthog.set_config({
      before_send: (event) => sanitisePostHogEvent(event, window.location.origin),
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      autocapture: {
        dom_event_allowlist: ['click', 'submit'],
        element_allowlist: ['a', 'button', 'form'],
        element_attribute_ignorelist: ['value', 'href', 'src', 'title', 'aria-label'],
      },
      rageclick: { content_ignorelist: true, ignore_text_selection: true },
      capture_performance: { network_timing: false, web_vitals: true },
    });
  }, [posthog]);

  useEffect(() => {
    if (!preference?.analytics) {
      posthog.stopSessionRecording();
      return;
    }

    if (accountId) {
      if (previousAccount.current && previousAccount.current !== accountId) {
        // Never merge two people who used the same browser to switch accounts.
        posthog.stopSessionRecording();
        posthog.reset(true);
        posthog.opt_in_capturing({ captureEventName: false });
      }
      posthog.identify(accountId);
    } else if (previousAccount.current) {
      // reset() deliberately forgets the old account and device identity. It
      // also clears consent, so restore the already-recorded choice at once.
      posthog.stopSessionRecording();
      posthog.reset(true);
      posthog.opt_in_capturing({ captureEventName: false });
    }
    previousAccount.current = accountId;
  }, [accountId, posthog, preference?.analytics]);

  useEffect(() => {
    if (!preference?.analytics) return;
    posthog.capture('$pageview', {
      $current_url: `${window.location.origin}${pathname}`,
      $pathname: pathname,
    });
  }, [pathname, posthog, preference?.analytics]);

  useEffect(() => {
    const shouldRecord = Boolean(preference?.analytics && preference?.replay && replayAllowedOnPath(pathname));
    setReplayCapture(posthog, { enabled: shouldRecord, forceSampling: forceConsentedReplay });
  }, [pathname, posthog, preference?.analytics, preference?.replay]);

  useEffect(() => {
    const captureEvent = (event) => {
      if (!preference?.analytics || !event.detail?.name) return;
      posthog.capture(event.detail.name, event.detail.properties || {});
    };
    const captureError = (event) => {
      if (!preference?.analytics || !event.detail?.name) return;
      const error = new Error(event.detail.name);
      error.name = 'VeyrnoxOperationalError';
      posthog.captureException(error, event.detail.properties || {});
    };
    window.addEventListener(ANALYTICS_EVENT, captureEvent);
    window.addEventListener(ANALYTICS_ERROR, captureError);
    return () => {
      window.removeEventListener(ANALYTICS_EVENT, captureEvent);
      window.removeEventListener(ANALYTICS_ERROR, captureError);
    };
  }, [posthog, preference?.analytics]);

  function choose(next) {
    const saved = writeAnalyticsPreference(window.localStorage, next);
    if (saved.analytics) posthog.opt_in_capturing({ captureEventName: false });
    else {
      posthog.stopSessionRecording();
      posthog.opt_out_capturing();
    }
    setPreference(saved);
    setSettingsOpen(false);
  }

  const bannerOpen = preference === null || settingsOpen;
  if (preference === undefined) return null;

  return (
    <>
      {bannerOpen ? (
        <section
          data-print="hide"
          role="region"
          data-storage-notice="analytics"
          aria-label={t('privacy.choices')}
          className="fixed inset-x-0 bottom-0 z-[70] border-t border-vx-border bg-vx-panel/95 px-4 py-4 shadow-2xl backdrop-blur-sm sm:px-6"
        >
          <div className="mx-auto grid max-w-[1100px] gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-sm font-extrabold text-vx-fg">{t('privacy.title')}</p>
              <p className="mt-1 max-w-3xl text-[13px] leading-[1.55] text-vx-fg-body">
                {rich(t('privacy.body'), {
                  privacy: <Link href="/legal/privacy" className="text-vx-accent underline underline-offset-4">{t('chrome.privacyPolicy')}</Link>,
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 lg:max-w-[390px] lg:justify-end">
              <button type="button" onClick={() => choose({ analytics: true, replay: true })} className="rounded-full bg-vx-accent px-4 py-2 text-[13px] font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover">
                {t('privacy.allow')}</button>
              <button type="button" onClick={() => choose({ analytics: true, replay: false })} className="rounded-full border border-vx-border bg-vx-base px-4 py-2 text-[13px] font-bold text-vx-fg hover:border-vx-accent">
                {t('privacy.analytics')}</button>
              <button type="button" data-storage-decline onClick={() => choose({ analytics: false, replay: false })} className="rounded-full border border-vx-border bg-vx-base px-4 py-2 text-[13px] font-bold text-vx-fg hover:border-vx-accent">
                {t('privacy.decline')}</button>
            </div>
          </div>
        </section>
      ) : (
        <button
          data-print="hide"
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="fixed bottom-4 start-4 z-50 rounded-full border border-vx-border bg-vx-panel px-3 py-2 text-xs font-bold text-vx-fg-body shadow-lg hover:border-vx-accent hover:text-vx-fg sm:bottom-6 sm:start-6"
        >
          {t('privacy.choices')}</button>
      )}
    </>
  );
}
