'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import Link from 'next/link';
import { CheckInEntry } from '../../_components/CheckInHost';
import { Chip } from '../../_components/Chip';
import { TopUpPacks, TopUpReturn } from '../../_components/TopUpPacks';
import { CreditStatement } from '../../_components/CreditStatement';
import { CreditSubscriptions } from '../../_components/CreditSubscriptions';
import { UsageMeters } from '../../_components/UsageMeters';
import { TopUpHistory } from '../../_components/TopUpHistory';
import { gatewayFetch, GatewayError } from '../../_lib/gateway';
import { readJobHistory } from '../../_lib/jobHistory';
import { MODELS } from '../../_lib/tokens';

const ERROR_SIGN_IN = 'sign_in_required';
const ERROR_UNAVAILABLE = 'unavailable';
const STATE_UI = {
  succeeded: { chip: 'accent', glyph: '✓' },
  failed:    { chip: 'danger', glyph: '✕' },
  queued:    { chip: 'accent', glyph: '●' },
  running:   { chip: 'accent', glyph: '●' },
};

export default function Credits() {
  const { t, locale } = useI18n();
  const balanceLocale = localeTag(locale, 'en-US');
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
  const [balance, setBalance] = useState(null);
  const [free, setFree] = useState(null);
  const [error, setError] = useState(null);
  const [ledger, setLedger] = useState([]);
  const load = useCallback(async () => {
    try {
      // Clear first: a transient failure used to leave the previous error up
      // permanently, so a signed-in user kept seeing "Sign in to see your
      // balance" after the next successful load.
      setError(null);
      const b = await gatewayFetch('/balance');
      setBalance(b.balance);
      setFree(b.free_credits > 0 && b.free_expires_at ? { credits: b.free_credits, expiresAt: b.free_expires_at } : null);
    } catch (e) {
      if (e instanceof GatewayError && e.status === 401) {
        setError(ERROR_SIGN_IN);
      } else {
        setError(ERROR_UNAVAILABLE);
      }
    }
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    const onBalance = () => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('veyrnox:balance-changed', onBalance);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('veyrnox:balance-changed', onBalance);
    };
  }, [load]);

  // Local ledger reconstruction — no server /ledger endpoint yet.
  // We hydrate each history row's current state so refunds show as +cr.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const history = readJobHistory().slice(0, 15);
      const enriched = await Promise.all(history.map(async (h) => {
        try {
          const j = await gatewayFetch(`/jobs/${h.job_id}`);
          return { ...h, state: j.state, error_code: j.error_code, refunded: j.refunded === true };
        } catch { return { ...h, state: 'queued' }; }
      }));
      if (!cancelled) setLedger(enriched);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-dvh">
      <AppNav balance={balance} active="credits" />
      <Main>
      <CheckInEntry />
      <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pt-10 pb-8">
        <h1 className="vx-display text-[40px] sm:text-[56px]">{t("app.credits.page.title")}</h1>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-[1fr_340px] gap-8 lg:gap-12 items-start">
          <div>
            {/* The balance as a printed slip: the one figure this page exists
                for. Signed out there is no figure, so no slip. */}
            {error !== 'sign_in_required' && (
            <div className="vx-paper-shadow max-w-[560px]">
              <div className="vx-paper px-6 sm:px-8 pt-9 pb-10">
                <div className="text-[13px] font-bold">{t("app.credits.page.current")}</div>
                <div className="mt-2 font-vx-mono text-[56px] sm:text-[72px] font-bold text-vx-money leading-none vx-num">
                  {balance == null ? '—' : new Intl.NumberFormat(balanceLocale).format(balance)}
                  <span className="text-2xl align-middle ms-2 text-vx-fg-muted">cr</span>
                </div>
                {free && (
                  <>
                    <div className="vx-perf mt-6" aria-hidden />
                    <div className="mt-4 flex items-baseline gap-2 font-vx-mono text-[13px] vx-num">
                      <span>{t("guide.credits.s2.title")}</span>
                      <span aria-hidden className="vx-leader flex-1" />
                      <span className="font-bold text-vx-money">{new Intl.NumberFormat(balanceLocale).format(free.credits)} cr</span>
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-2 font-vx-mono text-[13px] text-vx-fg-muted vx-num">
                      <span>{t("app.credits.page.expire")}</span>
                      <span aria-hidden className="vx-leader flex-1" />
                      <span>{new Date(free.expiresAt).toLocaleDateString(localeTag(locale, 'en-GB'), { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
            )}

            {error === 'unavailable' && (
              <div role="alert" className="mt-6 rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger flex items-start gap-2">
                <span aria-hidden="true">△</span>
                <span>{t("app.credits.page.unavailable")}</span>
              </div>
            )}

            {error === 'sign_in_required' && (
              <div className="mt-6 rounded-lg border border-vx-warn/40 bg-vx-warn/[0.07] px-4 py-3 text-sm text-vx-warn flex items-start gap-2">
                <span aria-hidden="true">△</span>
                <span>{t("app.credits.page.signIn")}</span>
              </div>
            )}

            <TopUpReturn />

          </div>

          <div className="md:pt-2">
            <h2 className="text-xl font-black">{t("app.credits.page.billing")}</h2>
            <ul className="mt-4 space-y-4 text-[15px] text-vx-fg-body leading-[1.55]">
              <li>{t("app.credits.page.balanceRule")}</li>
              <li>{t("app.credits.page.priceRule")}</li>
              <li>{t("app.credits.page.refundRule")}</li>
              <li>{t("app.credits.page.packRule")}</li>
            </ul>
          </div>
        </div>
      </section>

      <CreditSubscriptions />

      <section
        id="credit-packs"
        aria-labelledby="credit-packs-heading"
        className="mx-auto max-w-[1200px] border-t border-vx-border px-4 py-12 sm:px-8"
      >
        <h2 id="credit-packs-heading" className="text-3xl font-black">
          {t('pricing.packs.title')}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-[1.6] text-vx-fg-body">
          {t('pricing.packs.lead')} {t('pricing.packs.valueLead')}
        </p>
        {/* Wait for balance to settle before loading the purchase controls. */}
        {(error === 'sign_in_required' || balance != null) && <TopUpPacks signedIn={error !== 'sign_in_required'} />}
      </section>

      {balance != null && <UsageMeters />}
      {balance != null && <CreditStatement />}
      {balance != null && <TopUpHistory />}

      {/* ============ RECENT GENERATIONS (client-side ledger) ============ */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pb-16">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h2 className="text-xl font-black tracking-[-0.02em]">{t("app.credits.page.recent")}</h2>
          <p className="text-[13px] text-vx-fg-muted">{t("app.credits.page.history")}</p>
        </div>
        {ledger.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-vx-border p-8 text-center">
            <p className="text-[15px] text-vx-fg-body">{t("app.credits.page.empty")}</p>
            <Link href="/app/create" className="vx-press inline-block mt-4 rounded-full bg-vx-accent text-vx-accent-ink px-5 py-2.5 text-sm font-extrabold hover:bg-vx-accent-hover">{t("app.library.openStudio")}</Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
            {ledger.map((l) => {
              const model = MODELS.find((m) => m.id === l.model_id);
              // `refunded` comes from /jobs/:id; a failure whose refund has
              // not landed yet shows the debit it still is.
              const isRefund = l.state === 'failed' && l.refunded === true;
              const delta = isRefund ? `+${number(l.credits)}` : `−${number(l.credits)}`;
              const cls = isRefund ? 'text-vx-accent' : 'text-vx-money';
              const s = STATE_UI[l.state] || STATE_UI.queued;
              return (
                <div
                  key={l.job_id}
                  className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[120px_minmax(0,1fr)_auto_90px] sm:items-center sm:gap-3 sm:px-5 border-b border-vx-border/60 last:border-b-0"
                >
                  <div className="order-2 font-vx-mono text-[11px] tracking-[0.06em] text-vx-fg-muted sm:order-none">
                    {formatWhen(l.submitted_at, t, locale)}
                  </div>
                  <div className="order-1 min-w-0 sm:order-none">
                    <div className="text-sm truncate">
                      {model?.name || l.model_id} · {l.name || l.prompt || l.job_id.slice(0, 8)}
                    </div>
                  </div>
                  <div className="order-3 flex items-center justify-between gap-3 sm:order-none sm:justify-start">
                    <Chip tone={s.chip} noGlyph>
                      <span aria-hidden="true" className="me-1">{s.glyph}</span>
                      {tOr(t, `app.credits.page.status.${l.state}`, l.state.toUpperCase())}
                    </Chip>
                    <div className={`font-vx-mono text-[14px] font-bold vx-num sm:hidden ${cls}`}>
                      {delta} cr
                    </div>
                  </div>
                  <div className={`hidden text-end font-vx-mono text-[14px] font-bold vx-num sm:block ${cls}`}>
                    {delta} cr
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      </Main>
    </div>
  );
}

function formatWhen(ts, t, locale) {
  if (!ts) return '—';
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return t('app.credits.page.seconds', {count: number(s)});
  const m = Math.floor(s / 60);
  if (m < 60) return t('app.credits.page.minutes', {count: number(m)});
  const h = Math.floor(m / 60);
  if (h < 24) return t('app.credits.page.hours', {count: number(h)});
  return t('app.credits.page.days', {count: number(Math.floor(h / 24))});
}
