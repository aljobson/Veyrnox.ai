'use client';
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
const message = (code) =>
  ({
    account_frozen: 'Your account is paused. Contact support.',
    subscription_already_active:
      'You already have a current subscription. Refresh its details.',
    credits_spent:
      'Cooling-off cancellation requires this cycle’s Credits to be unspent. You can stop renewal at period end.',
    cooling_off_over:
      'The fourteen-day cooling-off window has ended. You can stop renewal at period end.',
    rate_limited: 'Too many requests. Wait a minute and retry.',
    session_mismatch:
      'This checkout does not belong to the subscription on this account.',
    refund_review_required:
      'Your refund needs operator review. Contact support.',
    invoice_review_required:
      'Payment needs operator review before Credits can be added.',
  })[code] ||
  'The billing request was not confirmed. Retry or contact support.';
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
  return (
    <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {plans.map((p) => (
        <li key={p.id} className="rounded-xl border border-vx-border p-5">
          <h3 className="text-xl font-bold">{names[p.id] || p.id}</h3>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest text-vx-accent">
            {intervalName(p.billing_interval)}ly
          </p>
          <p className="mt-3 font-vx-mono text-2xl">
            {usd.format(p.price_usd_cents / 100)} / {intervalName(p.billing_interval)}
          </p>
          <p className="mt-2">
            {p.credits.toLocaleString()} Credits each paid {intervalName(p.billing_interval)}
          </p>
          <p className="mt-2 text-sm text-vx-fg-muted">
            Plus applicable tax. Cycle Credits expire and do not roll over.
          </p>
          {publicOnly ? (
            <Link
              href="/app/credits#credit-subscriptions"
              className="mt-4 inline-block underline"
            >
              Choose {names[p.id] || p.id}
            </Link>
          ) : (
            <button
              className="mt-4 rounded-full border border-vx-border px-4 py-2 font-bold"
              aria-pressed={selected === p.id}
              onClick={() => onSelect(p.id)}
            >
              {selected === p.id ? 'Selected' : `Choose ${names[p.id] || p.id}`}
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
            Optional weekly and monthly subscriptions renew automatically until cancelled.
            Manage renewal in Credits &amp; billing. Prices are in USD; tax and
            the final total are shown before payment.
          </p>
          <Plans plans={catalog.plans} publicOnly />
          <button className="mt-5 text-sm underline" onClick={load}>
            Refresh prices
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
      setError(message(own.reason.code));
    }
    if (
      plans.status === 'rejected' &&
      plans.reason.code !== 'subscriptions_not_open'
    )
      setError(
        'Subscription offers are unavailable. Retry to refresh billing.',
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
          setNotice('Payment requires operator review. Contact support.');
        else if (r.status === 'ended')
          setNotice('This subscription has ended. No Credits were added.');
        else if (r.credited) {
          setNotice('Payment confirmed. Subscription Credits have been added.');
          notifyBalanceChanged();
          setRecovery(null);
        } else
          setNotice(
            'Checkout returned. Payment and Credits are not confirmed yet. Refresh or retry the checkout confirmation.',
          );
        await load();
      } catch (e) {
        setError(message(e.code));
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
        'Invalid subscription checkout return. Contact support if you paid.',
      );
      return;
    }
    if (recovery.cancelled) {
      setNotice(
        'Checkout was cancelled. No subscription purchase is confirmed.',
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
        if (!destination) throw Error('unsafe checkout');
        window.location.assign(destination);
      } else {
        setNotice('Your current subscription was found. Refresh its details.');
        await load();
        setBusy(false);
      }
    } catch (e) {
      setError(message(e.code));
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
          'Renewal stopped. This cycle’s Credits remain available until the paid period ends.',
        );
      else if (r.pending)
        setNotice(
          'Subscription ended. Your refund is pending; it is not yet complete.',
        );
      else if (r.refunded)
        setNotice(
          `Subscription ended. A refund of ${usd.format(r.refund_usd_cents / 100)} was confirmed.`,
        );
      else
        setNotice(
          'Cancellation received. Contact support to confirm the refund status.',
        );
      setRefundRetry(null);
      setCancellation('');
      setConfirmed(false);
      notifyBalanceChanged();
      await load();
    } catch (e) {
      setError(message(e.code));
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
        Credit Subscriptions
      </h2>
      {!loaded && (
        <p role="status" className="mt-4">
          Loading subscription…
        </p>
      )}
      {loaded && closed && !sub && !recovery && (
        <p role="status" className="mt-4">
          Credit subscriptions aren&apos;t open right now. One-off Credit Packs can be purchased separately when available and do not renew.{' '}
          <Link href="#credit-packs" className="underline">
            Choose a Credit Pack
          </Link>
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
            Refresh billing
          </button>
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
          Retry checkout confirmation
        </button>
      )}
      {refundRetry && (
        <button
          className="mt-4 underline"
          disabled={busy}
          onClick={() => cancel(refundRetry.subscription_id, refundRetry.mode)}
        >
          Retry cooling-off cancellation
        </button>
      )}
      {sub && (
        <article className="mt-6 rounded-xl border border-vx-border p-5">
          <h3 className="font-bold">{names[sub.plan_id] || sub.plan_id}</h3>
          <p className="mt-2">Status: {sub.status}</p>
          <p className="mt-2">
            {usd.format(sub.price_usd_cents / 100)} / {activeInterval} · {sub.credits}{' '}
            Credits per paid cycle
          </p>
          {sub.current_period_end && (
            <p className="mt-2">
              Paid period ends{' '}
              {new Date(sub.current_period_end).toLocaleString()}
            </p>
          )}
          {sub.cancel_at_period_end && (
            <p className="mt-2">Renewal is stopped.</p>
          )}
          {['active', 'past_due'].includes(sub.status) && (
            <div className="mt-4 space-x-4">
              {!sub.cancel_at_period_end && (
                <button
                  className="underline"
                  disabled={busy}
                  onClick={() => {
                    setCancellation('period_end');
                    setConfirmed(false);
                  }}
                >
                  Stop renewal at period end
                </button>
              )}
              <button
                className="underline"
                disabled={busy}
                onClick={() => {
                  setCancellation('cooling_off');
                  setConfirmed(false);
                }}
              >
                Cancel unused subscription within 14 days
              </button>
            </div>
          )}
          {sub.status === 'ended' && sub.end_reason === 'cooling_off' && (
            <button
              className="mt-4 underline"
              disabled={busy}
              onClick={() => cancel(sub.id, 'cooling_off')}
            >
              Check cooling-off refund
            </button>
          )}
          {cancellation && (
            <div className="mt-4 rounded-lg bg-vx-panel p-4">
              <p>
                {cancellation === 'period_end'
                  ? 'Stop the next renewal. This cycle’s Credits expire at the paid period end.'
                  : 'Request cancellation and a full refund within fourteen days of the initial paid cycle, only if this cycle’s Credits are unspent. The server checks eligibility; pending refunds are not complete.'}
              </p>
              <label className="mt-3 flex gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I confirm this cancellation request.
              </label>
              <button
                className="mt-3 rounded-full border border-vx-border px-4 py-2 font-bold disabled:opacity-50"
                disabled={busy || !confirmed}
                onClick={() => cancel(sub.id, cancellation)}
              >
                Confirm cancellation
              </button>{' '}
              <button
                className="underline"
                onClick={() => setCancellation('')}
                disabled={busy}
              >
                Keep subscription
              </button>
            </div>
          )}
        </article>
      )}
      {!current && !closed && catalog?.plans?.length > 0 && (
        <>
          <p className="mt-4">
            Choose an optional weekly or monthly subscription. It renews automatically
            until cancelled. Credits expire at each cycle end and do not roll
            over. Tax and the final total are shown at checkout.
          </p>
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
              Sign in to subscribe
            </button>
          ) : (
            plan && (
              <div className="mt-5">
                <label className="flex items-start gap-3">
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
                  You can stop renewal here. An unused initial cycle may qualify
                  for a full cooling-off refund within fourteen days.{' '}
                  <Link href="/legal/terms" className="underline">
                    Terms
                  </Link>{' '}
                  ·{' '}
                  <Link href="/legal/privacy" className="underline">
                    Privacy
                  </Link>
                </p>
                <button
                  className="mt-4 rounded-full bg-vx-accent px-5 py-3 font-bold text-vx-accent-ink disabled:opacity-50"
                  disabled={busy || !agreed}
                  onClick={checkout}
                >
                  Continue to secure checkout
                </button>
              </div>
            )
          )}
        </>
      )}
    </section>
  );
}
