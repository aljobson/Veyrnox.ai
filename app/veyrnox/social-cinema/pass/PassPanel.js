'use client';
import BindingText from '../../../../components/BindingText';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider.jsx';

import Link from 'next/link';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '../../_components/Button';
import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { getSession, onSessionChange } from '../../../lib/authClient';
import { gatewayFetch, makeIdempotencyKey } from '../../_lib/gateway';
import { useCinemaPreview } from '../preview';

const identity = () => getSession()?.user?.id || '';
const noIdentity = () => '';
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const when = (iso, locale) => (iso ? new Date(iso).toLocaleDateString(localeTag(locale, 'en-GB'), { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// The wording the consent version stands for. A change needs a new version on both sides.
const CONSENT_TEXT = 'Start my Cinema Pass now. I understand it renews automatically until I cancel, and that if I cancel within 14 days I get back the unused share of what I paid.';

export function PassPanel() {
  const { t, href: localize } = useI18n();

  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  const preview = useCinemaPreview();
  const [salesOpen, setSalesOpen] = useState(null);
  const effectiveSalesOpen = preview || salesOpen === true;

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    fetch('/api/cinema-pass-plans', { cache: 'no-store', signal: controller.signal })
      .then((response) => setSalesOpen(response.ok))
      .catch((error) => { if (error?.name !== 'AbortError') setSalesOpen(false); });
    return () => controller.abort();
  }, [preview]);

  return <div className="mx-auto max-w-[1300px] px-4 py-10 pb-40 sm:px-6 sm:py-16 sm:pb-32"><div className="max-w-[852px]">
    <header className="max-w-2xl">
      <p className="mb-4 font-vx-mono text-xs tracking-widest text-vx-accent">{t('cinema.pass.kicker')}</p>
      <h1 className="vx-display vx-title-detail">{t("cinema.passPanel.everyStoryOnePass")}</h1>
      <p className="mt-6 text-lg leading-relaxed text-vx-fg-body">{t("cinema.passPanel.aCinemaPassUnlocksEveryPublished")}</p>
      <p className="mt-3 text-sm text-vx-fg-muted"><Link href={localize("/social-cinema")} className="underline">{t("cinema.back")}</Link></p>
    </header>
    {!account && !preview && salesOpen === null ? <p className="mt-10 text-vx-fg-muted" role="status">{t("cinema.passPanel.checkingPassAvailability")}</p>
      : !account && !effectiveSalesOpen ? <p className="mt-10 text-vx-fg-muted">{t("cinema.passPanel.cinemaPassIsNotOpenYet")}</p>
      : !account ? <div className="mt-10"><p className="mb-4 text-vx-fg-body">{t("cinema.passPanel.useYourVeyrnoxAiAccountTo")}</p><Button onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</Button></div>
        : <Pass key={account} salesOpen={effectiveSalesOpen} />}
  </div></div>;
}

function Pass({ salesOpen }) {
  const { t, locale } = useI18n();
  const [plans, setPlans] = useState(null);
  const [consentVersion, setConsentVersion] = useState(null);
  const [pass, setPass] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const load = useCallback(async () => {
    const [own, catalog] = await Promise.allSettled([
      gatewayFetch('/cinema/pass'),
      salesOpen ? gatewayFetch('/cinema/pass/plans') : Promise.resolve(null),
    ]);
    if (own.status === 'fulfilled') {
      setPass(own.value.pass);
      if (!own.value.pass && !salesOpen) setNotice(t("cinema.passPanel.cinemaPassIsNotOpenYet"));
    }
    else setNotice(t("cinema.passPanel.couldNotLoadYourPassRight"));
    if (catalog.status === 'fulfilled' && catalog.value) {
      setPlans(catalog.value.plans);
      setConsentVersion(catalog.value.consent_version);
    } else if (salesOpen) {
      setNotice(t("cinema.passPanel.cinemaPassCheckoutIsUnavailableRight"));
    }
  }, [salesOpen, t]);

  // Back from checkout: record the session so a lost webhook cannot lose the Pass.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const passId = params.get('pass'), sessionId = params.get('session_id');
    if (params.get('checkout') === 'done' && passId && sessionId) {
      window.history.replaceState(null, '', window.location.pathname);
      gatewayFetch('/cinema/pass/return', { method: 'POST', body: JSON.stringify({ pass_id: passId, session_id: sessionId }) })
        .then((r) => setNotice(r.status === 'active' ? t("cinema.passPanel.yourCinemaPassIsActive") : t("cinema.passPanel.paymentReceivedYourPassWillActivate")))
        .catch(() => setNotice(t("cinema.passPanel.weCouldNotConfirmYourCheckout")))
        .finally(load);
    } else if (params.get('checkout') === 'cancelled') {
      window.history.replaceState(null, '', window.location.pathname);
      setNotice(t("cinema.passPanel.checkoutCancelledNothingWasCharged"));
      load();
    } else load();
  }, [load, t]);

  const start = async (planId) => {
    setBusy(true); setNotice('');
    try {
      const r = await gatewayFetch('/cinema/pass', { method: 'POST', body: JSON.stringify({ plan_id: planId, idempotency_key: makeIdempotencyKey(), consent: true, consent_version: consentVersion }) });
      if (r.checkout_url) window.location.assign(r.checkout_url);
      else { setNotice(t("cinema.passPanel.youAlreadyHaveACinemaPass")); await load(); }
    } catch (err) {
      setNotice(err?.code === 'pass_already_active' ? t("cinema.passPanel.youAlreadyHaveACinemaPass") : err?.code === 'account_frozen' ? t("cinema.passPanel.yourAccountIsPausedContactSupport") : t("cinema.passPanel.couldNotStartCheckoutTryAgain"));
    } finally { setBusy(false); }
  };
  const cancel = async () => {
    setConfirmingCancel(false);
    setBusy(true); setNotice('');
    try {
      const r = await gatewayFetch('/cinema/pass/cancel', { method: 'POST', body: '{}' });
      setNotice(r.mode === 'cooling_off' ? `${t('cinema.pass.ended')} ${r.refund_usd_cents > 0 ? t('cinema.pass.refund', { amount: usd.format(r.refund_usd_cents / 100) }) : ''}` : t('cinema.pass.noRenew', { date: when(r.current_period_end, locale) }));
      await load();
    } catch { setNotice(t("cinema.passPanel.couldNotCancelRightNowTry")); } finally { setBusy(false); }
  };
  const portal = async () => {
    setBusy(true);
    try { const r = await gatewayFetch('/cinema/pass/portal', { method: 'POST', body: '{}' }); window.location.assign(r.url); }
    catch { setNotice(t("cinema.passPanel.couldNotOpenYourBillingPage")); setBusy(false); }
  };

  const live = pass && ['active', 'past_due'].includes(pass.status);
  return <div className="mt-10 space-y-10">
    {notice && <p role="status" aria-live="polite" className="rounded-lg border border-vx-border bg-vx-base/60 px-4 py-3 text-sm text-vx-fg-body">{notice}</p>}
    {live && <section aria-labelledby="own-pass" className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.07] p-6">
      <h2 id="own-pass" className="text-xl font-extrabold">{t("cinema.passPanel.yourCinemaPass")}</h2>
      <p className="mt-2 text-vx-fg-body">{pass.status === 'past_due' ? t("cinema.passPanel.paymentIsOverdueUpdateYourCard") : pass.cancel_at_period_end ? t('cinema.pass.ends', { date: when(pass.current_period_end, locale) }) : t('cinema.pass.renews', { date: when(pass.current_period_end, locale), amount: usd.format(pass.price_usd_cents / 100) })}</p>
      {pass.within_cooling_off && !pass.cancel_at_period_end && <p className="mt-2 text-sm text-vx-fg-muted">{t('cinema.pass.cancelBefore', { date: when(pass.cooling_off_until, locale) })}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="secondary" disabled={busy} onClick={portal}>{t("cinema.passPanel.manageBilling")}</Button>
        {!pass.cancel_at_period_end && <Button variant="secondary" disabled={busy} onClick={() => setConfirmingCancel(true)}>{t("cinema.passPanel.cancelPass")}</Button>}
      </div>
    </section>}
    {!live && plans && <section aria-labelledby="plans">
      <h2 id="plans" className="text-xl font-extrabold">{t("cinema.passPanel.chooseAPass")}</h2>
      <p className="mt-2 text-sm text-vx-fg-muted">{t("cinema.passPanel.pricesInUsdTaxAddedAt")}</p>
      <label className="mt-4 flex items-start gap-3 text-sm text-vx-fg-body">
        <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <BindingText id="pass"  ><span lang="en" dir="ltr">{CONSENT_TEXT}</span></BindingText>
      </label>
      <ul className="mt-6 grid gap-4 sm:grid-cols-3">
        {plans.map((p) => <li key={p.id} className="flex flex-col rounded-2xl border border-vx-border bg-vx-base/60 p-5">
          <p className="font-vx-mono text-xs tracking-widest text-vx-accent uppercase">{tOr(t, `cinema.pass.${p.billing_interval}ly`, p.billing_interval)}</p>
          <p className="mt-3 text-3xl font-black">{usd.format(p.price_usd_cents / 100)}<span className="text-base font-normal text-vx-fg-muted"> / {tOr(t, `cinema.pass.${p.billing_interval}`, p.billing_interval)}</span></p>
          {p.intro_price_usd_cents != null && <p className="mt-1 text-sm font-bold text-vx-fg-body">{t('cinema.pass.intro', { interval: tOr(t, `cinema.pass.${p.billing_interval}`, p.billing_interval), amount: usd.format(p.intro_price_usd_cents / 100) })}</p>}
          <Button className="mt-5" disabled={busy || !agreed} onClick={() => start(p.id)}>{t('cinema.pass.start', { interval: tOr(t, `cinema.pass.${p.billing_interval}ly`, p.billing_interval) })}</Button>
        </li>)}
      </ul>
    </section>}
    {confirmingCancel && <ConfirmDialog
      title={pass?.within_cooling_off ? t("cinema.passPanel.endYourCinemaPassNow") : t("cinema.passPanel.cancelCinemaPassRenewal")}
      body={pass?.within_cooling_off
        ? t("cinema.passPanel.yourPassEndsTodayTheUnused")
        : t('cinema.pass.continues', { date: when(pass?.current_period_end, locale) })}
      confirmLabel={pass?.within_cooling_off ? t("cinema.passPanel.endPassAndRefund") : t("cinema.passPanel.cancelRenewal")}
      tone="danger"
      onCancel={() => setConfirmingCancel(false)}
      onConfirm={cancel}
    />}
  </div>;
}
