'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '../../../components/I18nProvider';
import LegalLink from '../../../components/LegalLink';
import { getStoredUserId, onSessionChange, signOut } from '../../lib/authClient';
import { gatewayFetch } from '../_lib/gateway';
import { useLockWhileMounted } from '../_lib/hardPaywallLock';
import { HARD_PAYWALL_STARTER_CREDITS, hardPaywallState, hasIntroSteps, isHardPaywallExempt } from '../_lib/hardPaywall.mjs';
import { PaywallStepHeader, initialStep, useTrialDays } from './HardPaywallSteps';
import { Main } from './Main';
import { CreditSubscriptions } from './CreditSubscriptions';
import { DeleteAccountPanel } from './DeleteAccountPanel';
import { HardPaywallFlagProvider } from './HardPaywallFlag';

// The stored identity outlives an expired access token and a cookie restore; gatewayFetch refreshes behind the check.
const account = () => getStoredUserId() || '';
const noAccount = () => '';
const subscribeReady = () => () => {};
const ready = () => true;
const notReady = () => false;
const link = 'underline';

// ADR-0314: with the flag on, a signed-in account with no paid plan sees the paywall and nothing else in the app.
// UI-level only; the server enforces nothing on this flag.
export function HardPaywallGate({ enabled, children }) {
  return <HardPaywallFlagProvider enabled={enabled}>
    {enabled ? <Gate>{children}</Gate> : children}
  </HardPaywallFlagProvider>;
}

function Gate({ children }) {
  const hydrated = useSyncExternalStore(subscribeReady, ready, notReady);
  const id = useSyncExternalStore(onSessionChange, account, noAccount);
  const pathname = usePathname();
  if (!hydrated) return <Checking />;
  if (!id || isHardPaywallExempt(pathname)) return children;
  // Keyed by account so a different sign-in never inherits the last account's plan.
  return <Plans key={id} account={id}>{children}</Plans>;
}

function Plans({ account: id, children }) {
  const [reads, setReads] = useState({ generation: undefined, publish: undefined, failed: false });
  const live = useRef(true);
  const latest = useRef(0);
  const check = useCallback(async () => {
    const seq = ++latest.current;
    const [generation, publish] = await Promise.allSettled([gatewayFetch('/subscriptions'), gatewayFetch('/social/plan')]);
    // Overlapping checks (focus, checkout, retry): only the newest answer counts.
    if (!live.current || seq !== latest.current) return;
    setReads({
      generation: generation.status === 'fulfilled' ? generation.value.subscription ?? null : undefined,
      // Publish plans may be closed (503) or unreadable: that only means no Publish plan.
      publish: publish.status === 'fulfilled' ? publish.value.entitlement?.subscription ?? null : null,
      failed: generation.status === 'rejected',
    });
  }, []);
  useEffect(() => {
    live.current = true;
    check();
    // A finished checkout, a cancellation and a return to the tab all re-read the plan.
    window.addEventListener('veyrnox:balance-changed', check);
    window.addEventListener('focus', check);
    return () => {
      live.current = false;
      window.removeEventListener('veyrnox:balance-changed', check);
      window.removeEventListener('focus', check);
    };
  }, [check]);
  const state = hardPaywallState({ enabled: true, signedIn: Boolean(id), ...reads });
  if (state === 'open') return children;
  if (state === 'checking') return <Checking />;
  return <Locked unknown={state === 'unknown'} onRetry={() => { setReads({ generation: undefined, publish: undefined, failed: false }); check(); }} />;
}

function Checking() {
  const { t } = useI18n();
  useLockWhileMounted();
  return <Main className="grid min-h-dvh place-items-center px-4">
    <p role="status" aria-live="polite" className="text-vx-fg-muted">{t('app.hardPaywall.checking')}</p>
  </Main>;
}

function Locked({ unknown, onRetry }) {
  const { t } = useI18n();
  useLockWhileMounted();
  const [leaving, setLeaving] = useState(false);
  const trialDays = useTrialDays();
  const [step, setStep] = useState(initialStep);
  async function leave() {
    setLeaving(true);
    try { await signOut(); } finally { window.location.assign('/'); }
  }
  // The server says whether a trial exists; until it answers, nothing about plans or a trial is shown.
  if (!unknown && trialDays === undefined) return <Checking />;
  const trial = !unknown && trialDays > 0;
  return <Main className="min-h-dvh py-10">
    {trial
      ? <PaywallStepHeader step={step} days={trialDays} onNext={() => setStep((n) => n + 1)} onBack={() => setStep((n) => Math.max(1, n - 1))} />
      : <div className="mx-auto max-w-[1200px] px-4 sm:px-8">
        <h1 className="vx-display text-[32px] sm:text-[44px]">{t('app.hardPaywall.title')}</h1>
        <p className="mt-3 max-w-2xl text-vx-fg-body">{t('app.hardPaywall.body', { count: HARD_PAYWALL_STARTER_CREDITS })}</p>
        {unknown && <p role="alert" className="mt-4">
          {t('app.hardPaywall.unavailable')}{' '}
          <button type="button" className={link} onClick={onRetry}>{t('app.hardPaywall.retry')}</button>
        </p>}
      </div>}
    {!unknown && !hasIntroSteps(trialDays, step) && <CreditSubscriptions />}
    <div className="mx-auto max-w-[1200px] px-4 sm:px-8">
      <nav aria-label={t('app.hardPaywall.links')} className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <LegalLink element="a" href="/legal/terms" className={link}>{t('label.Terms of Service')}</LegalLink>
        <LegalLink element="a" href="/legal/privacy" className={link}>{t('label.Privacy Policy')}</LegalLink>
        <button type="button" className={link} disabled={leaving} onClick={leave}>{t('public.account.signOut')}</button>
      </nav>
      <div className="mt-10 max-w-2xl"><DeleteAccountPanel /></div>
    </div>
  </Main>;
}
