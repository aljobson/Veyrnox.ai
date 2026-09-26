'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '../../_components/Button';
import { getSession, onSessionChange } from '../../../lib/authClient';
import { gatewayFetch, makeIdempotencyKey } from '../../_lib/gateway';

const identity = () => getSession()?.user?.id || '';
const noIdentity = () => '';
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const INTERVAL = { week: 'week', month: 'month', year: 'year' };
// The wording the consent version stands for. A change needs a new version on both sides.
const CONSENT_TEXT = 'Start my Cinema Pass now. I understand it renews automatically until I cancel, and that if I cancel within 14 days I get back the unused share of what I paid.';

export function PassPanel() {
  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    try { setPreview(localStorage.getItem('veyrnox_social_cinema') === 'true'); } catch {}
  }, []);
  return <main id="main" className="mx-auto max-w-[900px] px-4 py-10 pb-40 sm:px-8 sm:py-16 sm:pb-32">
    <header className="max-w-2xl">
      <p className="mb-4 font-vx-mono text-xs tracking-widest text-vx-accent">SOCIAL CINEMA · CINEMA PASS</p>
      <h1 className="text-4xl font-black leading-tight sm:text-5xl">Every story, one Pass.</h1>
      <p className="mt-6 text-lg leading-relaxed text-vx-fg-body">A Cinema Pass unlocks every published episode and film while it is active. It adds no credits; your credits stay yours for the Studio.</p>
      <p className="mt-3 text-sm text-vx-fg-muted"><Link href="/social-cinema" className="underline">Back to Social Cinema</Link></p>
    </header>
    {!preview ? <p className="mt-10 text-vx-fg-muted">Cinema Pass is not open yet.</p>
      : !account ? <div className="mt-10"><p className="mb-4 text-vx-fg-body">Use your Veyrnox.ai account to continue.</p><Button onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</Button></div>
        : <Pass key={account} />}
  </main>;
}

function Pass() {
  const [plans, setPlans] = useState(null);
  const [consentVersion, setConsentVersion] = useState(null);
  const [pass, setPass] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, own] = await Promise.all([gatewayFetch('/cinema/pass/plans'), gatewayFetch('/cinema/pass')]);
      setPlans(p.plans); setConsentVersion(p.consent_version); setPass(own.pass);
    } catch (err) {
      setNotice(err?.code === 'pass_not_open' || err?.status === 503 ? 'Cinema Pass is not open yet.' : 'Could not load your Pass right now.');
    }
  }, []);

  // Back from checkout: record the session so a lost webhook cannot lose the Pass.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const passId = params.get('pass'), sessionId = params.get('session_id');
    if (params.get('checkout') === 'done' && passId && sessionId) {
      window.history.replaceState(null, '', window.location.pathname);
      gatewayFetch('/cinema/pass/return', { method: 'POST', body: JSON.stringify({ pass_id: passId, session_id: sessionId }) })
        .then((r) => setNotice(r.status === 'active' ? 'Your Cinema Pass is active.' : 'Payment received. Your Pass will activate in a moment.'))
        .catch(() => setNotice('We could not confirm your checkout yet. Refresh in a minute; do not pay again.'))
        .finally(load);
    } else if (params.get('checkout') === 'cancelled') {
      window.history.replaceState(null, '', window.location.pathname);
      setNotice('Checkout cancelled. Nothing was charged.');
      load();
    } else load();
  }, [load]);

  const start = async (planId) => {
    setBusy(true); setNotice('');
    try {
      const r = await gatewayFetch('/cinema/pass', { method: 'POST', body: JSON.stringify({ plan_id: planId, idempotency_key: makeIdempotencyKey(), consent: true, consent_version: consentVersion }) });
      if (r.checkout_url) window.location.assign(r.checkout_url);
      else { setNotice('You already have a Cinema Pass.'); await load(); }
    } catch (err) {
      setNotice(err?.code === 'pass_already_active' ? 'You already have a Cinema Pass.' : err?.code === 'account_frozen' ? 'Your account is paused. Contact support.' : 'Could not start checkout. Try again in a moment.');
    } finally { setBusy(false); }
  };
  const cancel = async () => {
    const coolingOff = pass?.within_cooling_off;
    if (!window.confirm(coolingOff ? 'Cancel now? Your Pass ends today and the unused share of this period is refunded.' : 'Stop renewing? Your Pass stays active until the end of the paid period.')) return;
    setBusy(true); setNotice('');
    try {
      const r = await gatewayFetch('/cinema/pass/cancel', { method: 'POST', body: '{}' });
      setNotice(r.mode === 'cooling_off' ? `Your Pass has ended. ${r.refund_usd_cents > 0 ? `${usd.format(r.refund_usd_cents / 100)} is on its way back to your card.` : ''}` : `Your Pass will not renew after ${when(r.current_period_end)}.`);
      await load();
    } catch { setNotice('Could not cancel right now. Try again in a moment.'); } finally { setBusy(false); }
  };
  const portal = async () => {
    setBusy(true);
    try { const r = await gatewayFetch('/cinema/pass/portal', { method: 'POST', body: '{}' }); window.location.assign(r.url); }
    catch { setNotice('Could not open your billing page.'); setBusy(false); }
  };

  const live = pass && ['active', 'past_due'].includes(pass.status);
  return <div className="mt-10 space-y-10">
    {notice && <p role="status" aria-live="polite" className="rounded-lg border border-vx-border bg-vx-base/60 px-4 py-3 text-sm text-vx-fg-body">{notice}</p>}
    {live && <section aria-labelledby="own-pass" className="rounded-2xl border border-vx-money/40 bg-vx-money/[0.07] p-6">
      <h2 id="own-pass" className="text-xl font-extrabold">Your Cinema Pass</h2>
      <p className="mt-2 text-vx-fg-body">{pass.status === 'past_due' ? 'Payment is overdue; update your card to keep watching.' : pass.cancel_at_period_end ? `Ends ${when(pass.current_period_end)}.` : `Renews ${when(pass.current_period_end)} at ${usd.format(pass.price_usd_cents / 100)} plus tax.`}</p>
      {pass.within_cooling_off && !pass.cancel_at_period_end && <p className="mt-2 text-sm text-vx-fg-muted">Cancel before {when(pass.cooling_off_until)} for a pro-rata refund.</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" disabled={busy} onClick={portal}>Manage billing ↗</Button>
        {!pass.cancel_at_period_end && <Button variant="secondary" disabled={busy} onClick={cancel}>Cancel Pass</Button>}
      </div>
    </section>}
    {!live && plans && <section aria-labelledby="plans">
      <h2 id="plans" className="text-xl font-extrabold">Choose a Pass</h2>
      <p className="mt-2 text-sm text-vx-fg-muted">Prices in USD, tax added at checkout. Cancel any time.</p>
      <label className="mt-4 flex items-start gap-3 text-sm text-vx-fg-body">
        <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>{CONSENT_TEXT}</span>
      </label>
      <ul className="mt-6 grid gap-4 sm:grid-cols-3">
        {plans.map((p) => <li key={p.id} className="flex flex-col rounded-2xl border border-vx-border bg-vx-base/60 p-5">
          <p className="font-vx-mono text-xs tracking-widest text-vx-accent uppercase">{INTERVAL[p.billing_interval]}ly</p>
          <p className="mt-3 text-3xl font-black">{usd.format(p.price_usd_cents / 100)}<span className="text-base font-normal text-vx-fg-muted"> / {INTERVAL[p.billing_interval]}</span></p>
          {p.intro_price_usd_cents != null && <p className="mt-1 text-sm text-vx-money">First {INTERVAL[p.billing_interval]} {usd.format(p.intro_price_usd_cents / 100)} for new Pass holders.</p>}
          <Button className="mt-5" disabled={busy || !agreed} onClick={() => start(p.id)}>Start {INTERVAL[p.billing_interval]}ly Pass</Button>
        </li>)}
      </ul>
    </section>}
  </div>;
}
