'use client';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { pluralKey, tOr } from '../../../lib/i18n/translate.mjs';
import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider';
import { rich } from '../../../lib/i18n/rich';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { getSession, onSessionChange } from '../../lib/authClient';
import { gatewayFetch, notifyBalanceChanged } from '../_lib/gateway';
import {
  subscriptionCheckoutUrl,
  subscriptionReturnFrom,
} from '../_lib/creditSubscriptionUi';
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  trailingZeroDisplay: 'stripIfInteger',
});
const names = {
  'starter-monthly': 'Starter',
  'starter-weekly': 'Starter',
  'plus-monthly': 'Plus',
  'plus-weekly': 'Plus',
  'ultra-monthly': 'Ultra',
  'ultra-weekly': 'Ultra',
};
const intervalName = (value) => (value === 'week' ? 'week' : 'month');
const identity = () => getSession()?.user?.id || '',
  noIdentity = () => '';
function message(code, t) { return tOr(t, `app.credits.subscription.error.${code}`, t('app.credits.subscription.errorFallback')); }
const formatUsd = (value, locale) => locale === 'en' ? usd.format(value) : new Intl.NumberFormat(localeTag(locale, 'en-US'), { style: 'currency', currency: 'USD', trailingZeroDisplay: 'stripIfInteger' }).format(value);
async function publicPlans() {
  const r = await fetch('/api/credit-subscription-plans', {
      cache: 'no-store',
    }),
    b = await r.json();
  if (!r.ok) throw Object.assign(Error('plans unavailable'), { code: b.error });
  return b;
}
async function publicOfferState() {
  try {
    const catalog = await publicPlans();
    return catalog?.plans?.length
      ? { phase: 'open', catalog }
      : { phase: 'unavailable', catalog: null };
  } catch (error) {
    return {
      phase:
        error.code === 'subscriptions_not_open' ? 'closed' : 'unavailable',
      catalog: null,
    };
  }
}
function Plans({ plans, selected, onSelect, publicOnly = false }) {
  const { t, locale } = useI18n();
  return (
    <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {plans.map((p) => (
        <li key={p.id} className="rounded-xl border border-vx-border p-5">
          <h3 className="text-xl font-bold">{tOr(t, `app.credits.subscription.plan.${p.id}`, names[p.id] || p.id)}</h3>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest text-vx-accent">
            {tOr(t, `cinema.pass.${p.billing_interval}ly`, p.billing_interval)}
          </p>
          <p className="mt-3 font-vx-mono text-2xl">
            {publicOnly ? usd.format(p.price_usd_cents / 100) : formatUsd(p.price_usd_cents / 100, locale)} / {tOr(t, `cinema.pass.${p.billing_interval}`, p.billing_interval)}
          </p>
          <p className="mt-2">
            {t('public.subscription.cycle', { credits: p.credits.toLocaleString(localeTag(locale)), interval: tOr(t, `cinema.pass.${p.billing_interval}`, p.billing_interval) })}
          </p>
          <p className="mt-2 text-sm text-vx-fg-muted">
            {t('public.subscription.expiry')}
          </p>
          {publicOnly ? (
            <Link
              href="/app/credits#credit-subscriptions"
              className="mt-4 inline-block underline"
            >
              {t('public.subscription.choose', { plan: tOr(t, `app.credits.subscription.plan.${p.id}`, names[p.id] || p.id) })}
            </Link>
          ) : (
            <button
              className="mt-4 rounded-full border border-vx-border px-4 py-2 font-bold"
              aria-pressed={selected === p.id}
              onClick={() => onSelect(p.id)}
            >
              {selected === p.id ? t('public.subscription.selected') : t('public.subscription.choose', { plan: tOr(t, `app.credits.subscription.plan.${p.id}`, names[p.id] || p.id) })}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
export function CreditSubscriptionOffer() {
  const { t } = useI18n();
  const [offerState, setOfferState] = useState({
    phase: 'loading',
    catalog: null,
  });
  const mounted = useRef(false);
  async function load() {
    setOfferState({ phase: 'loading', catalog: null });
    const nextState = await publicOfferState();
    if (mounted.current) setOfferState(nextState);
  }
  useEffect(() => {
    mounted.current = true;
    publicOfferState().then((nextState) => {
      if (mounted.current) setOfferState(nextState);
    });
    return () => {
      mounted.current = false;
    };
  }, []);
  const catalog = offerState.catalog;
  return (
    <section
      className="mx-auto max-w-[1300px] px-4 pt-24 sm:px-6"
      aria-labelledby="credit-subscription-offer"
    >
      <h2
        id="credit-subscription-offer"
        className="vx-display text-[40px] sm:text-[56px]"
      >
        {t('pricing.subs.title')}
      </h2>
      {offerState.phase === 'loading' && (
        <p role="status" aria-live="polite" className="mt-4">
          {t('pricing.subs.loading')}
        </p>
      )}
      {offerState.phase === 'closed' && (
        <p role="status" className="mt-4">
          {rich(t('pricing.subs.closed'), {
            pack: (
              <Link href="/app/credits#credit-packs" className="underline">
                {t('pricing.subs.buyPack')}
              </Link>
            ),
          })}
        </p>
      )}
      {offerState.phase === 'unavailable' && (
        <p role="alert" className="mt-4">
          {rich(t('pricing.subs.unavailable'), {
            refresh: (
              <button className="underline" onClick={load}>
                {t('pricing.subs.refresh')}
              </button>
            ),
          })}
        </p>
      )}
      {offerState.phase === 'open' && catalog?.plans?.length > 0 && (
        <>
          <p className="mt-4">
            {t('public.subscription.terms')}
          </p>
          <Plans plans={catalog.plans} publicOnly />
          <button className="mt-5 text-sm underline" onClick={load}>
            {t('public.subscription.refresh')}
          </button>
        </>
      )}
    </section>
  );
}
export function CreditSubscriptions() {
  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  const [recovery, setRecovery] = useState(null);
  // Keep only this checkout handoff across sign-in; private billing state remounts per account.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('subscription')) return;
    const info = subscriptionReturnFrom(url);
    for (const key of ['subscription', 'session_id', 'checkout'])
      url.searchParams.delete(key);
    window.history.replaceState(
      window.history.state,
      '',
      url.pathname + url.search + url.hash,
    );
    setRecovery(info || { invalid: true });
  }, []);
  return (
    <Billing
      key={account}
      account={account}
      recovery={recovery}
      setRecovery={setRecovery}
    />
  );
}
function Billing({ account, recovery, setRecovery }) {
  const { t, locale } = useI18n();
  const translation = useRef(t);
  translation.current = t;
  const number = value => locale === 'en' ? String(value) : value.toLocaleString(localeTag(locale));
  const [catalog, setCatalog] = useState(null),
    [sub, setSub] = useState(null),
    [closed, setClosed] = useState(false),
    [loaded, setLoaded] = useState(false),
    [selected, setSelected] = useState(''),
    [agreed, setAgreed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [cancellation, setCancellation] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [refundRetry, setRefundRetry] = useState(null);
  const generation = useRef(0),
    attempt = useRef(null);
  const load = useCallback(async () => {
    const seq = ++generation.current;
    const results = await Promise.allSettled([
      publicPlans(),
      account
        ? gatewayFetch('/subscriptions')
        : Promise.resolve({ subscription: null }),
    ]);
    if (seq !== generation.current) return;
    const [plans, own] = results;
    setClosed(
      plans.status === 'rejected' &&
        plans.reason.code === 'subscriptions_not_open',
    );
    setCatalog(plans.status === 'fulfilled' ? plans.value : null);
    if (own.status === 'fulfilled') setSub(own.value.subscription);
    else {
      setSub(null);
      setError(message(own.reason.code, translation.current));
    }
    if (
      plans.status === 'rejected' &&
      plans.reason.code !== 'subscriptions_not_open'
    )
      setError(
        translation.current("app.credits.subscription.offersUnavailable"),
      );
    setLoaded(true);
  }, [account]);
  useEffect(() => {
    load();
    return () => {
      generation.current++;
    };
  }, [load]);
  const recover = useCallback(
    async (info) => {
      setBusy(true);
      setError('');
      try {
        const r = await gatewayFetch('/subscriptions/return', {
          method: 'POST',
          body: JSON.stringify(info),
        });
        if (r.status === 'flagged')
          setNotice(translation.current("app.credits.subscription.paymentReview"));
        else if (r.status === 'ended')
          setNotice(translation.current("app.credits.subscription.endedNoCredits"));
        else if (r.credited) {
          setNotice(translation.current("app.credits.subscription.confirmed"));
          notifyBalanceChanged();
          setRecovery(null);
        } else
          setNotice(
            translation.current("app.credits.subscription.unconfirmed"),
          );
        await load();
      } catch (e) {
        setError(message(e.code, translation.current));
      } finally {
        setBusy(false);
      }
    },
    [load, setRecovery],
  );
  useEffect(() => {
    if (!recovery) return;
    if (recovery.invalid) {
      setError(
        translation.current("app.credits.subscription.invalidReturn"),
      );
      return;
    }
    if (recovery.cancelled) {
      setNotice(
        translation.current("app.credits.subscription.cancelledCheckout"),
      );
      return;
    }
    if (account) recover(recovery);
  }, [account, recovery, recover]);
  async function checkout() {
    const plan = catalog?.plans.find((p) => p.id === selected);
    if (!account || !plan || !agreed || busy) return;
    const base = {
      plan_id: plan.id,
      consent: true,
      consent_version: catalog.consent_version,
    };
    const signature = JSON.stringify(base);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await gatewayFetch('/subscriptions/checkout', {
        method: 'POST',
        body: JSON.stringify({ ...base, idempotency_key: attempt.current.key }),
      });
      if (r.checkout_url) {
        const destination = subscriptionCheckoutUrl(r.checkout_url);
        if (!destination) throw Error(t('app.credits.subscription.errorFallback'));
        window.location.assign(destination);
      } else {
        setNotice(t("app.credits.subscription.found"));
        await load();
        setBusy(false);
      }
    } catch (e) {
      setError(message(e.code, t));
      setBusy(false);
    }
  }
  async function cancel(id, mode) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await gatewayFetch('/subscriptions/cancel', {
        method: 'POST',
        body: JSON.stringify({ subscription_id: id, mode }),
      });
      if (mode === 'period_end')
        setNotice(
          t("app.credits.subscription.renewalStoppedNotice"),
        );
      else if (r.pending)
        setNotice(
          t("app.credits.subscription.refundPending"),
        );
      else if (r.refunded)
        setNotice(
          t('app.credits.subscription.refunded', { amount: formatUsd(r.refund_usd_cents / 100, locale) }),
        );
      else
        setNotice(
          t("app.credits.subscription.cancellationReceived"),
        );
      setRefundRetry(null);
      setCancellation('');
      setConfirmed(false);
      notifyBalanceChanged();
      await load();
    } catch (e) {
      setError(message(e.code, t));
      if (mode === 'cooling_off') setRefundRetry({ subscription_id: id, mode });
    } finally {
      setBusy(false);
    }
  }
  const current =
      sub && ['pending', 'active', 'past_due', 'flagged'].includes(sub.status),
    plan = catalog?.plans.find((p) => p.id === selected),
    activePlan = catalog?.plans?.find((candidate) => candidate.id === sub?.plan_id),
    activeInterval = activePlan?.billing_interval || (sub?.plan_id?.endsWith('-weekly') ? 'week' : 'month');
  return (
    <section
      id="credit-subscriptions"
      className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8"
      aria-labelledby="credit-subscriptions-heading"
    >
      <h2 id="credit-subscriptions-heading" className="text-3xl font-black">
        {t("app.credits.subscription.title")}</h2>
      {!loaded && (
        <p role="status" className="mt-4">
          {t("app.credits.subscription.loading")}</p>
      )}
      {loaded && closed && !sub && !recovery && (
        <p role="status" className="mt-4">
          {t("app.credits.subscription.closed")}{' '}
          <Link href="#credit-packs" className="underline">
            {t("app.credits.subscription.choosePack")}</Link>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4">
          {error}{' '}
          <button
            className="underline"
            disabled={busy}
            onClick={() => {
              setError('');
              load();
            }}
          >
            {t("app.credits.subscription.refresh")}</button>
        </p>
      )}
      {notice && (
        <p role="status" aria-live="polite" className="mt-4">
          {notice}
        </p>
      )}
      {recovery && account && (
        <button
          className="mt-4 underline"
          disabled={busy}
          onClick={() => recover(recovery)}
        >
          {t("app.credits.subscription.retryCheckout")}</button>
      )}
      {refundRetry && (
        <button
          className="mt-4 underline"
          disabled={busy}
          onClick={() => cancel(refundRetry.subscription_id, refundRetry.mode)}
        >
          {t("app.credits.subscription.retryCoolingOff")}</button>
      )}
      {sub && (
        <article className="mt-6 rounded-xl border border-vx-border p-5">
          <h3 className="font-bold">{tOr(t, `app.credits.subscription.plan.${sub.plan_id}`, names[sub.plan_id] || sub.plan_id)}</h3>
          <p className="mt-2">{t('app.credits.subscription.status', { status: tOr(t, `app.credits.subscription.status.${sub.status}`, sub.status) })}</p>
          <p className="mt-2">
            {formatUsd(sub.price_usd_cents / 100, locale)} / {tOr(t, `cinema.pass.${activeInterval}`, activeInterval)} · {t(pluralKey(t, locale, 'app.credits.subscription.cycle', sub.credits), { count: number(sub.credits) })}
          </p>
          {sub.current_period_end && (
            <p className="mt-2">
              {t('app.credits.subscription.periodEnd', { date: new Date(sub.current_period_end).toLocaleString(localeTag(locale)) })}
            </p>
          )}
          {sub.cancel_at_period_end && (
            <p className="mt-2">{t("app.credits.subscription.stopped")}</p>
          )}
          {['active', 'past_due'].includes(sub.status) && (
            <div className="mt-4 flex flex-wrap gap-4">
              {!sub.cancel_at_period_end && (
                <button
                  className="underline"
                  disabled={busy}
                  onClick={() => {
                    setCancellation('period_end');
                    setConfirmed(false);
                  }}
                >
                  {t("app.credits.subscription.stopRenewal")}</button>
              )}
              <button
                className="underline"
                disabled={busy}
                onClick={() => {
                  setCancellation('cooling_off');
                  setConfirmed(false);
                }}
              >
                {t("app.credits.subscription.cancelUnused")}</button>
            </div>
          )}
          {sub.status === 'ended' && sub.end_reason === 'cooling_off' && (
            <button
              className="mt-4 underline"
              disabled={busy}
              onClick={() => cancel(sub.id, 'cooling_off')}
            >
              {t("app.credits.subscription.checkRefund")}</button>
          )}
          {cancellation && (
            <div className="mt-4 rounded-lg bg-vx-panel p-4">
              <p>
                {cancellation === 'period_end'
                  ? t("app.credits.subscription.stopHelp")
                  : t("app.credits.subscription.coolingHelp")}
              </p>
              <label className="mt-3 flex gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {t("app.credits.subscription.confirmRequest")}</label>
              <button
                className="mt-3 rounded-full border border-vx-border px-4 py-2 font-bold disabled:opacity-50"
                disabled={busy || !confirmed}
                onClick={() => cancel(sub.id, cancellation)}
              >
                {t("app.credits.subscription.confirmCancel")}</button>{' '}
              <button
                className="underline"
                onClick={() => setCancellation('')}
                disabled={busy}
              >
                {t("app.credits.subscription.keep")}</button>
            </div>
          )}
        </article>
      )}
      {!current && !closed && catalog?.plans?.length > 0 && (
        <>
          <p className="mt-4">
            {t("app.credits.subscription.intro")}</p>
          <Plans
            plans={catalog.plans}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setAgreed(false);
            }}
          />
          {!account ? (
            <button
              className="mt-5 underline"
              onClick={() =>
                window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))
              }
            >
              {t("app.credits.subscription.signIn")}</button>
          ) : (
            plan && (
              <div className="mt-5">
                <label lang="en" dir="ltr" className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                  />
                  <span>
                    I agree to {names[plan.id] || plan.id} at{' '}
                    {usd.format(plan.price_usd_cents / 100)} plus applicable tax
                    every {intervalName(plan.billing_interval)} until I cancel. I receive {plan.credits} Credits
                    after each confirmed {intervalName(plan.billing_interval)}ly payment; unused cycle Credits
                    expire without rollover.
                  </span>
                </label>
                <p className="mt-3 text-sm">
                  {t("app.credits.subscription.renewalHelp")}{' '}
                  <Link href="/legal/terms" className="underline">
                    {t("home.publish.terms")}</Link>{' '}
                  ·{' '}
                  <Link href="/legal/privacy" className="underline">
                    {t("cinema.report.privacy")}</Link>
                </p>
                <button
                  className="mt-4 rounded-full bg-vx-accent px-5 py-3 font-bold text-vx-accent-ink disabled:opacity-50"
                  disabled={busy || !agreed}
                  onClick={checkout}
                >
                  {t("app.credits.subscription.checkout")}</button>
              </div>
            )
          )}
        </>
      )}
    </section>
  );
}
