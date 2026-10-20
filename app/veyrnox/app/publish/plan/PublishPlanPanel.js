'use client';
import BindingText from '../../../../../components/BindingText';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { cancelPublishPlan, getPublishPlan, openPublishBilling, recoverPublishPlan, startPublishPlan } from '../../../../lib/publishPlanClient';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const legalMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const date = (value, locale = 'en') => value ? new Date(value).toLocaleDateString(localeTag(locale, 'en-GB'), { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const button = 'rounded-full border border-vx-border px-5 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50';
const intervalName = (value) => ({ week: 'week', month: 'month', year: 'year' }[value] || 'month');

export default function PublishPlanPanel() {
  const { t } = useI18n();
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  if (!account) return <div className="rounded-2xl border border-vx-border p-6">
    <p className="mb-4 text-vx-fg-body">{t("app.publish.plan.signIn")}</p>
    <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</button>
  </div>;
  return <Plan key={account} />;
}

function Plan() {
  const { t, locale } = useI18n();
  const money = new Intl.NumberFormat(localeTag(locale, 'en-US'), { style: 'currency', currency: 'USD' });
  const interval = value => tOr(t, `app.publish.plan.interval.${value}`, intervalName(value));
  const cadence = value => tOr(t, `app.publish.plan.cadence.${value}`, `${intervalName(value)}ly`);
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getPublishPlan()); }
    catch (error) {
      setNotice(error?.code === 'publish_plans_not_open' || error?.status === 503
        ? t("app.publish.plan.notOpen") : t("app.publish.plan.loadFailed"));
    }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const subscriptionId = query.get('subscription');
    const sessionId = query.get('session_id');
    if (query.get('checkout') === 'done' && subscriptionId && sessionId) {
      window.history.replaceState(null, '', window.location.pathname);
      recoverPublishPlan(subscriptionId, sessionId)
        .then((result) => setNotice(result.status === 'active'
          ? t("app.publish.plan.activated")
          : t("app.publish.plan.paymentReceived")))
        .catch(() => setNotice(t("app.publish.plan.checkoutUnconfirmed")))
        .finally(load);
    } else if (query.get('checkout') === 'cancelled') {
      window.history.replaceState(null, '', window.location.pathname);
      queueMicrotask(() => setNotice(t("cinema.passPanel.checkoutCancelledNothingWasCharged")));
      void Promise.resolve().then(load);
    } else void Promise.resolve().then(load);
  }, [load, t]);

  async function start(planId) {
    setBusy(true); setNotice('');
    try {
      const result = await startPublishPlan(planId, data.consent_version);
      if (result.checkout_url) window.location.assign(result.checkout_url);
      else { setNotice(t("app.publish.plan.alreadyActive")); await load(); }
    } catch (error) {
      setNotice(error?.code === 'subscription_already_active'
        ? t("app.publish.plan.alreadyActive") : t("app.publish.plan.checkoutFailed"));
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm(t("app.publish.plan.cancelConfirm"))) return;
    setBusy(true); setNotice('');
    try {
      const result = await cancelPublishPlan();
      setNotice(t('app.publish.plan.noRenewal', { date: date(result.current_period_end, locale) }));
      await load();
    } catch { setNotice(t("app.publish.plan.cancelFailed")); }
    finally { setBusy(false); }
  }

  async function portal() {
    setBusy(true); setNotice('');
    try { window.location.assign((await openPublishBilling()).url); }
    catch { setNotice(t("app.publish.plan.billingFailed")); setBusy(false); }
  }

  const entitlement = data?.entitlement;
  const subscription = entitlement?.subscription;
  const paid = entitlement?.tier === 'publish';
  const selectedPlan = data?.plans?.find((plan) => plan.id === selectedPlanId);
  const currentPlan = data?.plans?.find((plan) => plan.id === subscription?.plan_id);
  const currentInterval = currentPlan?.billing_interval
    || ({ 'publish-weekly': 'week', 'publish-annual': 'year' }[subscription?.plan_id] || 'month');

  if (!data) return <div role="status" aria-live="polite" className="rounded-2xl border border-vx-border p-6">
    <p className="text-sm text-vx-fg-muted">{loading ? t("app.publish.plan.loading") : notice}</p>
    {!loading && <button type="button" className={`${button} mt-4`} onClick={load}>{t("recovery.retry")}</button>}
  </div>;

  return <div className="space-y-6">
    {notice && <p role="status" aria-live="polite" className="rounded-xl border border-vx-border p-4 text-sm text-vx-fg-body">{notice}</p>}

    <section aria-labelledby="current-plan" className="rounded-2xl border border-vx-border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-vx-accent">{t("app.publish.plan.current")}</p>
          <h2 id="current-plan" className="mt-2 text-2xl font-black">{paid ? t("publish.plan.colPlan") : t("publish.plan.colFree")}</h2>
          <p className="mt-2 text-sm text-vx-fg-muted">{paid
            ? t('app.publish.plan.included', { count: locale === 'en' ? entitlement?.account_limit || 5 : (entitlement?.account_limit || 5).toLocaleString(localeTag(locale)) })
            : t("app.publish.plan.freeIncluded")}</p>
        </div>
        <span className="rounded-full border border-vx-border px-3 py-1 text-xs font-bold">{paid ? t("app.publish.plan.active") : t("publish.plan.colFree")}</span>
      </div>
      {paid && <div className="mt-5 border-t border-vx-border pt-5">
        <p className="text-sm text-vx-fg-body">{subscription.cancel_at_period_end
          ? t('app.publish.plan.ends', { date: date(subscription.current_period_end, locale) })
          : t('app.publish.plan.renews', { date: date(subscription.current_period_end, locale), price: money.format(subscription.price_usd_cents / 100), interval: interval(currentInterval) })}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" disabled={busy} className={button} onClick={portal}>{t("cinema.passPanel.manageBilling")}</button>
          {!subscription.cancel_at_period_end && <button type="button" disabled={busy} className={button} onClick={cancel}>{t("app.publish.plan.cancel")}</button>}
        </div>
      </div>}
    </section>

    {!paid && data.plans?.length > 0 && <section aria-labelledby="choose-plan" className="rounded-2xl border border-vx-accent/50 bg-vx-accent/[0.06] p-6">
      <p className="text-xs font-bold uppercase tracking-widest text-vx-accent">{t("app.publish.plan.advanced")}</p>
      <h2 id="choose-plan" className="mt-2 text-2xl font-black">{t("publish.plan.colPlan")}</h2>
      <ul className="mt-5 space-y-2 text-sm text-vx-fg-body">
        <li>{t("app.publish.plan.accountsFeature")}</li>
        <li>{t("app.publish.plan.multiFeature")}</li>
        <li>{t("app.publish.plan.fairFeature")}</li>
        <li>{t("app.publish.plan.calendarFeature")}</li>
        <li>{t("app.publish.plan.historyFeature")}</li>
        <li>{t("app.publish.plan.csvFeature")}</li>
        <li>{t("app.publish.plan.recommendFeature")}</li>
        <li>{t("app.publish.plan.inboxFeature")}</li>
        <li>{t("app.publish.plan.commentsFeature")}</li>
      </ul>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.plans.map((plan) => <li key={plan.id} className="rounded-xl border border-vx-border bg-vx-base/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-widest text-vx-accent">{cadence(plan.billing_interval)}</p>
            {plan.billing_interval === 'year' && <span className="rounded-full bg-vx-accent px-2.5 py-1 text-[0.65rem] font-black uppercase tracking-wide text-black">{t("app.publish.plan.save")}</span>}
          </div>
          <p className="mt-3 text-3xl font-black">{money.format(plan.price_usd_cents / 100)}<span className="text-base font-normal text-vx-fg-muted"> / {interval(plan.billing_interval)}</span></p>
          {plan.billing_interval === 'year' && <p className="mt-2 text-xs text-vx-fg-muted">{t('app.publish.plan.equivalent', { price: money.format(plan.price_usd_cents / 1200) })}</p>}
          <button type="button" aria-pressed={selectedPlanId === plan.id} className={`${button} mt-4`} onClick={() => { setSelectedPlanId(plan.id); setAgreed(false); }}>
            {selectedPlanId === plan.id ? t("public.subscription.selected") : t('app.publish.plan.choose', { interval: cadence(plan.billing_interval) })}
          </button>
        </li>)}
      </ul>
      <p className="mt-5 text-xs text-vx-fg-muted">{t("app.publish.plan.billing")}</p>
      {selectedPlan && <>
        <BindingText id="publish" values={{ price: legalMoney.format(selectedPlan.price_usd_cents / 100), interval: intervalName(selectedPlan.billing_interval) }} ><label className="mt-4 flex items-start gap-3 text-sm text-vx-fg-body">
          <input type="checkbox" className="mt-1" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
          <span lang="en" dir="ltr">Start my Publish Plan at {legalMoney.format(selectedPlan.price_usd_cents / 100)} plus tax every {intervalName(selectedPlan.billing_interval)}. I understand it renews automatically until I cancel.</span>
        </label></BindingText>
        <button type="button" disabled={busy || !agreed} className={`${button} mt-5 border-vx-accent bg-vx-accent text-black`} onClick={() => start(selectedPlan.id)}>
          {busy ? t("app.publish.plan.opening") : t("app.publish.plan.upgrade")}
        </button>
      </>}
    </section>}

    <p className="text-sm text-vx-fg-muted"><Link href="/app/publish" className="underline">{t("social.connect.back")}</Link></p>
  </div>;
}
