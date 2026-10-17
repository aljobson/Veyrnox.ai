'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { cancelPublishPlan, getPublishPlan, openPublishBilling, recoverPublishPlan, startPublishPlan } from '../../../../lib/publishPlanClient';

const currentAccount = () => getSession()?.user?.id || '';
const noAccount = () => '';
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const date = (value) => value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const button = 'rounded-full border border-vx-border px-5 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50';
const intervalName = (value) => ({ week: 'week', month: 'month', year: 'year' }[value] || 'month');

export default function PublishPlanPanel() {
  const account = useSyncExternalStore(onSessionChange, currentAccount, noAccount);
  if (!account) return <div className="rounded-2xl border border-vx-border p-6">
    <p className="mb-4 text-vx-fg-body">Sign in to view your Publish plan.</p>
    <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button>
  </div>;
  return <Plan key={account} />;
}

function Plan() {
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
        ? 'Publish plans are not open yet.' : 'Could not load your plan. Try again.');
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const subscriptionId = query.get('subscription');
    const sessionId = query.get('session_id');
    if (query.get('checkout') === 'done' && subscriptionId && sessionId) {
      window.history.replaceState(null, '', window.location.pathname);
      recoverPublishPlan(subscriptionId, sessionId)
        .then((result) => setNotice(result.status === 'active'
          ? 'Your Publish Plan is active.'
          : 'Payment received. Your Plan will activate in a moment.'))
        .catch(() => setNotice('We could not confirm checkout yet. Refresh in a minute; do not pay again.'))
        .finally(load);
    } else if (query.get('checkout') === 'cancelled') {
      window.history.replaceState(null, '', window.location.pathname);
      queueMicrotask(() => setNotice('Checkout cancelled. Nothing was charged.'));
      void Promise.resolve().then(load);
    } else void Promise.resolve().then(load);
  }, [load]);

  async function start(planId) {
    setBusy(true); setNotice('');
    try {
      const result = await startPublishPlan(planId, data.consent_version);
      if (result.checkout_url) window.location.assign(result.checkout_url);
      else { setNotice('Your Publish Plan is already active.'); await load(); }
    } catch (error) {
      setNotice(error?.code === 'subscription_already_active'
        ? 'Your Publish Plan is already active.' : 'Could not start checkout. Try again.');
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm('Stop renewing? Your advanced features stay active until the end of the paid period.')) return;
    setBusy(true); setNotice('');
    try {
      const result = await cancelPublishPlan();
      setNotice(`Your Plan will not renew after ${date(result.current_period_end)}.`);
      await load();
    } catch { setNotice('Could not cancel right now. Try again.'); }
    finally { setBusy(false); }
  }

  async function portal() {
    setBusy(true); setNotice('');
    try { window.location.assign((await openPublishBilling()).url); }
    catch { setNotice('Could not open billing. Try again.'); setBusy(false); }
  }

  const entitlement = data?.entitlement;
  const subscription = entitlement?.subscription;
  const paid = entitlement?.tier === 'publish';
  const selectedPlan = data?.plans?.find((plan) => plan.id === selectedPlanId);
  const currentPlan = data?.plans?.find((plan) => plan.id === subscription?.plan_id);
  const currentInterval = currentPlan?.billing_interval
    || ({ 'publish-weekly': 'week', 'publish-annual': 'year' }[subscription?.plan_id] || 'month');

  if (!data) return <div role="status" aria-live="polite" className="rounded-2xl border border-vx-border p-6">
    <p className="text-sm text-vx-fg-muted">{loading ? 'Loading your Publish plan…' : notice}</p>
    {!loading && <button type="button" className={`${button} mt-4`} onClick={load}>Try again</button>}
  </div>;

  return <div className="space-y-6">
    {notice && <p role="status" aria-live="polite" className="rounded-xl border border-vx-border p-4 text-sm text-vx-fg-body">{notice}</p>}

    <section aria-labelledby="current-plan" className="rounded-2xl border border-vx-border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-vx-accent">Current plan</p>
          <h2 id="current-plan" className="mt-2 text-2xl font-black">{paid ? 'Publish Plan' : 'Free'}</h2>
          <p className="mt-2 text-sm text-vx-fg-muted">{paid
            ? `Up to ${entitlement?.account_limit || 5} connected accounts, scheduling and analytics are included.`
            : 'One connected account and Post now are included.'}</p>
        </div>
        <span className="rounded-full border border-vx-border px-3 py-1 text-xs font-bold">{paid ? 'Active' : 'Free'}</span>
      </div>
      {paid && <div className="mt-5 border-t border-vx-border pt-5">
        <p className="text-sm text-vx-fg-body">{subscription.cancel_at_period_end
          ? `Ends ${date(subscription.current_period_end)}.`
          : `Renews ${date(subscription.current_period_end)} at ${money.format(subscription.price_usd_cents / 100)} per ${currentInterval}, plus tax.`}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" disabled={busy} className={button} onClick={portal}>Manage billing ↗</button>
          {!subscription.cancel_at_period_end && <button type="button" disabled={busy} className={button} onClick={cancel}>Cancel plan</button>}
        </div>
      </div>}
    </section>

    {!paid && data.plans?.length > 0 && <section aria-labelledby="choose-plan" className="rounded-2xl border border-vx-accent/50 bg-vx-accent/[0.06] p-6">
      <p className="text-xs font-bold uppercase tracking-widest text-vx-accent">Advanced publishing</p>
      <h2 id="choose-plan" className="mt-2 text-2xl font-black">Publish Plan</h2>
      <ul className="mt-5 space-y-2 text-sm text-vx-fg-body">
        <li>✓ Up to 5 connected accounts</li>
        <li>✓ Multi-account publishing</li>
        <li>✓ Unlimited fair-use scheduling</li>
        <li>✓ Calendar and post rescheduling</li>
        <li>✓ Cross-account analytics and 12 months of history</li>
        <li>✓ CSV analytics exports</li>
        <li>✓ Best-time and posting-frequency recommendations</li>
        <li>✓ Unified and per-account social inbox</li>
        <li>✓ Comment replies where the platform grants access</li>
      </ul>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.plans.map((plan) => <li key={plan.id} className="rounded-xl border border-vx-border bg-vx-base/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-widest text-vx-accent">{intervalName(plan.billing_interval)}ly</p>
            {plan.billing_interval === 'year' && <span className="rounded-full bg-vx-accent px-2.5 py-1 text-[0.65rem] font-black uppercase tracking-wide text-black">Save 30%</span>}
          </div>
          <p className="mt-3 text-3xl font-black">{money.format(plan.price_usd_cents / 100)}<span className="text-base font-normal text-vx-fg-muted"> / {intervalName(plan.billing_interval)}</span></p>
          {plan.billing_interval === 'year' && <p className="mt-2 text-xs text-vx-fg-muted">{money.format(plan.price_usd_cents / 1200)} per month equivalent</p>}
          <button type="button" aria-pressed={selectedPlanId === plan.id} className={`${button} mt-4`} onClick={() => { setSelectedPlanId(plan.id); setAgreed(false); }}>
            {selectedPlanId === plan.id ? 'Selected' : `Choose ${intervalName(plan.billing_interval)}ly`}
          </button>
        </li>)}
      </ul>
      <p className="mt-5 text-xs text-vx-fg-muted">Billing in USD. Tax is calculated at checkout. Cancel any time.</p>
      {selectedPlan && <>
        <label className="mt-4 flex items-start gap-3 text-sm text-vx-fg-body">
          <input type="checkbox" className="mt-1" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
          <span>Start my Publish Plan at {money.format(selectedPlan.price_usd_cents / 100)} plus tax every {intervalName(selectedPlan.billing_interval)}. I understand it renews automatically until I cancel.</span>
        </label>
        <button type="button" disabled={busy || !agreed} className={`${button} mt-5 border-vx-accent bg-vx-accent text-black`} onClick={() => start(selectedPlan.id)}>
          {busy ? 'Opening checkout…' : 'Upgrade with Stripe'}
        </button>
      </>}
    </section>}

    <p className="text-sm text-vx-fg-muted"><Link href="/app/publish" className="underline">Back to Veyrnox Publish</Link></p>
  </div>;
}
