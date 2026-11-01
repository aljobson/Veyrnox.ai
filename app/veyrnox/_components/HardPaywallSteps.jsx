'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { HARD_PAYWALL_STARTER_CREDITS, TRIAL_REMINDER_DAYS, STEP_COUNT } from '../_lib/hardPaywall.mjs';

// ADR-0316: with a trial on offer the paywall is three screens, each answering one worry before the price is shown:
// the trial exists and costs nothing now, a reminder comes before any charge, then the plans.
// The trial length comes from the server (the plans endpoint), so no screen can promise a trial Stripe will not give.

/** Trial days the plans endpoint offers right now; undefined while loading, 0 when none (or the read fails). */
export function useTrialDays() {
  const [days, setDays] = useState(undefined);
  useEffect(() => {
    let live = true;
    fetch('/api/credit-subscription-plans', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => { if (live) setDays(Number.isSafeInteger(b?.trial_days) && b.trial_days > 0 ? b.trial_days : 0); })
      .catch(() => { if (live) setDays(0); });
    return () => { live = false; };
  }, []);
  return days;
}

/** A checkout that was started and came back lands on the plans, not the introduction. */
export const initialStep = () => (typeof window !== 'undefined' && /[?&](checkout|subscription)=/.test(window.location.search) ? STEP_COUNT : 1);

export function PaywallStepHeader({ step, onNext, onBack, days }) {
  const { t } = useI18n();
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const values = { days, count: HARD_PAYWALL_STARTER_CREDITS, reminder: TRIAL_REMINDER_DAYS };
  const points = step === 1 ? ['p1', 'p2', 'p3'] : step === 2 ? ['p1', 'p2'] : [];
  return <div className="mx-auto max-w-[1200px] px-4 sm:px-8">
    <p className="text-sm text-vx-fg-muted" aria-live="polite">{t('app.hardPaywall.step', { current: step, total: STEP_COUNT })}</p>
    <div className="mt-2 flex gap-2" aria-hidden="true">
      {Array.from({ length: STEP_COUNT }, (_, i) => <span key={i} className={`h-1.5 w-12 rounded-full ${i < step ? 'bg-vx-accent' : 'bg-vx-border'}`} />)}
    </div>
    <h1 ref={heading} tabIndex={-1} className="vx-display mt-4 text-[32px] outline-none sm:text-[44px]">{t(`app.hardPaywall.step${step}.title`, values)}</h1>
    <p className="mt-3 max-w-2xl text-vx-fg-body">{t(`app.hardPaywall.step${step}.body`, values)}</p>
    {points.length > 0 && <ul className="mt-5 max-w-2xl space-y-2">
      {points.map((p) => <li key={p} className="flex items-start gap-3"><span aria-hidden="true" className="mt-1 text-vx-accent">✓</span>{t(`app.hardPaywall.step${step}.${p}`, values)}</li>)}
    </ul>}
    {step < STEP_COUNT && <div className="mt-7 flex flex-wrap items-center gap-4">
      <button type="button" onClick={onNext} className="rounded-full bg-vx-accent px-6 py-3 font-bold text-vx-accent-ink">{t('app.hardPaywall.continue')}</button>
      {step > 1 && <button type="button" onClick={onBack} className="underline">{t('app.hardPaywall.back')}</button>}
    </div>}
    {step === STEP_COUNT && <div className="mt-4"><button type="button" onClick={onBack} className="underline">{t('app.hardPaywall.back')}</button></div>}
  </div>;
}
