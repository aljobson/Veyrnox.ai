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
const CONSENT = 'Start my Publish Plan now. I understand it renews monthly until I cancel.';

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

  const load = useCallback(async () => {
    try { setData(await getPublishPlan()); }
    catch (error) {
      setNotice(error?.code === 'publish_plans_not_open' || error?.status === 503
        ? 'Publish plans are not open yet.' : 'Could not load your plan. Try again.');
    }
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
      load();
    } else load();
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
  const plan = data?.plans?.[0];

  return <div className="space-y-6">
    {notice && <p role="status" aria-live="polite" className="rounded-xl border border-vx-border p-4 text-sm text-vx-fg-body">{notice}</p>}

    <section aria-labelledby="current-plan" className="rounded-2xl border border-vx-border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-vx-accent">Current plan</p>
          <h2 id="current-plan" className="mt-2 text-2xl font-black">{paid ? 'Publish Plan' : 'Free'}</h2>
          <p className="mt-2 text-sm text-vx-fg-muted">{entitlement?.account_limit || 5} connected accounts and basic scheduling are included.</p>
        </div>
        <span className="rounded-full border border-vx-border px-3 py-1 text-xs font-bold">{paid ? 'Active' : 'Free'}</span>
      </div>
      {paid && <div className="mt-5 border-t border-vx-border pt-5">
        <p className="text-sm text-vx-fg-body">{subscription.cancel_at_period_end
          ? `Ends ${date(subscription.current_period_end)}.`
          : `Renews ${date(subscription.current_period_end)} at ${money.format(subscription.price_usd_cents / 100)} plus tax.`}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" disabled={busy} className={button} onClick={portal}>Manage billing ↗</button>
          {!subscription.cancel_at_period_end && <button type="button" disabled={busy} className={button} onClick={cancel}>Cancel plan</button>}
        </div>
      </div>}
    </section>

    {!paid && plan && <section aria-labelledby="choose-plan" className="rounded-2xl border border-vx-accent/50 bg-vx-accent/[0.06] p-6">
      <p className="text-xs font-bold uppercase tracking-widest text-vx-accent">Advanced publishing</p>
      <h2 id="choose-plan" className="mt-2 text-2xl font-black">Publish Plan</h2>
      <p className="mt-3 text-4xl font-black">{money.format(plan.price_usd_cents / 100)}<span className="text-base font-normal text-vx-fg-muted"> / month</span></p>
      <ul className="mt-5 space-y-2 text-sm text-vx-fg-body">
        <li>✓ 12 months of analytics history</li>
        <li>✓ Best-time recommendations from your posting history</li>
        <li>✓ {entitlement?.account_limit || 5} connected accounts and unlimited fair-use scheduling</li>
      </ul>
      <p className="mt-5 text-xs text-vx-fg-muted">Monthly billing in USD. Tax is calculated at checkout. Cancel any time.</p>
      <label className="mt-4 flex items-start gap-3 text-sm text-vx-fg-body">
        <input type="checkbox" className="mt-1" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
        <span>{CONSENT}</span>
      </label>
      <button type="button" disabled={busy || !agreed} className={`${button} mt-5 border-vx-accent bg-vx-accent text-black`} onClick={() => start(plan.id)}>
        {busy ? 'Opening checkout…' : 'Upgrade with Stripe'}
      </button>
    </section>}

    <p className="text-sm text-vx-fg-muted"><Link href="/app/publish" className="underline">Back to Veyrnox Publish</Link></p>
  </div>;
}
