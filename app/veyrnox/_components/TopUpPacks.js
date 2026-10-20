'use client';
import BindingText from '../../../components/BindingText';
import englishBindings from '../../../lib/i18n/messages/legal/en/binding.mjs';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { tOr, pluralKey } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider';
import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { gatewayFetch, GatewayError, makeIdempotencyKey, notifyBalanceChanged, ACCOUNT_PAUSED_COPY } from '../_lib/gateway';
import { retryTopUpReturn } from '../_lib/topUpReturnRetry';
import { useCatalog } from '../_lib/useCatalog';

// Supply Consent (CONTEXT.md), approved as v1 in #99: keep the text verbatim.
// Changing it needs a new sign-off and a new version, here and in
// SUPPLY_CONSENT_VERSION in app/api/v1/top-ups/route.js.
export const SUPPLY_CONSENT_VERSION = 'supply-consent-v1';
const SUPPLY_CONSENT_TEXT = englishBindings.supply;

const TOP_UP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POLL_MS = 2000;
const POLL_GIVE_UP_MS = 3 * 60 * 1000;

// Shown after the payment provider redirects back with ?top_up=<id>. Polls the
// Top-up until the server credits it, then refreshes every balance on the
// page. This component never grants anything.
export function TopUpReturn() {
  const { t, locale } = useI18n();
  const number = new Intl.NumberFormat(localeTag(locale, 'en-US'));
  const [topUpId, setTopUpId] = useState(null);
  const [phase, setPhase] = useState('processing');
  const [credits, setCredits] = useState(null);
  const returnSession = useRef(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get('top_up');
    if (!id || !TOP_UP_ID_RE.test(id)) return;
    setTopUpId(id);
    const sessionId = q.get('session_id') || (returnSession.current?.id === id ? returnSession.current.sessionId : null);
    const stripSession = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('session_id');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    };
    if (sessionId && /^cs_[A-Za-z0-9_]{1,251}$/.test(sessionId)) {
      // Capture only in memory, remove from the URL before bounded retries.
      returnSession.current = { id, sessionId };
      const controller = new AbortController();
      stripSession();
      retryTopUpReturn(() => gatewayFetch(`/top-ups/${id}/return`, {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId }),
        signal: controller.signal,
      }), { signal: controller.signal }).catch(() => {}).finally(() => {
        if (!controller.signal.aborted) returnSession.current = null;
      });
      return () => controller.abort();
    } else if (sessionId !== null) {
      stripSession();
    }
  }, []);

  useEffect(() => {
    if (!topUpId) return;
    let stopped = false;
    let timer;
    const started = Date.now();
    async function poll() {
      try {
        const topUp = await gatewayFetch(`/top-ups/${topUpId}`);
        if (stopped) return;
        if (topUp.status === 'credited') {
          setCredits(topUp.credits);
          setPhase('credited');
          notifyBalanceChanged();
          window.history.replaceState(null, '', window.location.pathname);
          return;
        }
      } catch (e) {
        if (stopped) return;
        if (e instanceof GatewayError && (e.status === 404 || e.status === 400)) { setPhase('not_found'); return; }
      }
      if (Date.now() - started > POLL_GIVE_UP_MS) { setPhase('slow'); return; }
      timer = setTimeout(poll, POLL_MS);
    }
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [topUpId]);

  if (!topUpId) return null;
  const copy = {
    processing: t("app.credits.packs.processing"),
    credited: credits == null ? t('app.credits.packs.creditedUnknown') : t(pluralKey(t, locale, 'app.credits.packs.credited', credits), { count: number.format(credits) }),
    slow: t("app.credits.packs.slow"),
    not_found: t("app.credits.packs.notFound"),
  }[phase];
  return (
    <div role="status" aria-live="polite" className={`mt-4 rounded-lg border px-4 py-3 text-sm ${phase === 'credited' ? 'border-vx-money/40 bg-vx-money/[0.07] text-vx-money' : 'border-vx-border bg-vx-base/60 text-vx-fg-body'}`}>
      {phase === 'processing' && <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted me-2">{t("app.credits.packs.processingLabel")}</span>}
      {copy}
    </div>
  );
}

// "$10", not "$10.00": the approved wording (#99 item 1).


function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Rough "what it buys", from live catalog prices only. Hidden on the
// tokens.js fallback so no app-layer number is presented as a price.
function useTypicalCosts() {
  const { models, live } = useCatalog();
  if (!live) return null;
  const open = models.filter((m) => !m.gated && !m.takesPlan && m.credits > 0); // the video agent is not a per-clip price
  const video = median(open.filter((m) => m.kind === 'video').map((m) => m.credits));
  const image = median(open.filter((m) => m.kind === 'image').map((m) => m.credits));
  return video || image ? { video, image } : null;
}

export function TopUpPacks({ signedIn }) {
  const { t, locale } = useI18n();
  const translation = useRef(t);
  translation.current = t;
  const number = new Intl.NumberFormat(localeTag(locale, 'en-US'));
  const usd = new Intl.NumberFormat(localeTag(locale, 'en-US'), { style: 'currency', currency: 'USD', trailingZeroDisplay: 'stripIfInteger' });
  const [packs, setPacks] = useState(null);
  const [selected, setSelected] = useState(null);
  // One key per pack choice: a retry after a failed checkout reuses the same
  // pending Top-up instead of creating another.
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const typical = useTypicalCosts();

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    gatewayFetch('/credit-packs')
      .then((b) => { if (!cancelled) setPacks(Array.isArray(b?.packs) ? b.packs : []); })
      .catch(() => { if (!cancelled) setError(translation.current("app.credits.packs.unavailable")); });
    return () => { cancelled = true; };
  }, [signedIn]);

  if (!signedIn) {
    return (
      <div className="mt-6">
        <Button variant="money" onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required', { detail: { mode: 'sign_in' } }))}>
          {t("app.credits.packs.signIn")}</Button>
      </div>
    );
  }

  async function buy() {
    if (!selected || !idempotencyKey || !consent || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await gatewayFetch('/top-ups', {
        method: 'POST',
        body: JSON.stringify({
          pack_id: selected,
          idempotency_key: idempotencyKey,
          consent: true,
          consent_version: SUPPLY_CONSENT_VERSION,
        }),
      });
      // Top-level navigation to the provider's hosted checkout; the URL comes
      // from the gateway, which built it with our own server-side key.
      window.location.assign(res.checkout_url);
    } catch (e) {
      const code = e instanceof GatewayError ? e.code : null;
      setError(tOr(t, `app.credits.packs.error.${code}`, code === 'account_frozen' ? ACCOUNT_PAUSED_COPY : t('app.credits.packs.failed')));
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      {packs == null && !error && (
        <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">{t("app.credits.packs.loading")}</div>
      )}
      {packs && packs.length === 0 && (
        <div className="text-sm text-vx-fg-muted">{t("app.credits.packs.empty")}</div>
      )}
      {packs && packs.length > 0 && (
        <fieldset data-testid="credit-packs">
          <legend className="sr-only">{t("app.credits.packs.choose")}</legend>
          <div className="flex flex-wrap gap-2">
            {packs.map((p) => {
              const on = selected === p.id;
              return (
                <label
                  key={p.id}
                  data-credit-pack={p.id}
                  className={`flex flex-col items-start rounded-xl border px-4 py-3 cursor-pointer transition-colors duration-150 has-focus-visible:outline-solid has-focus-visible:outline-2 has-focus-visible:outline-vx-accent ${on ? 'border-vx-money bg-vx-money/[0.07] shadow-[inset_0_0_0_1px_rgb(var(--vx-money))]' : 'border-vx-border bg-vx-base/60 hover:border-vx-money/60'}`}
                >
                  <input type="radio" name="credit-pack" value={p.id} checked={on} onChange={() => { setSelected(p.id); setIdempotencyKey(makeIdempotencyKey()); }} className="sr-only" />
                  <span className="flex w-full items-center justify-between gap-3 font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">{t("app.credits.packs.pack")}{on && <span aria-hidden="true" className="text-vx-money">✓</span>}</span>
                  <span className="font-vx-mono text-[18px] font-bold text-vx-money mt-1 vx-num">+{number.format(p.credits)} cr</span>
                  <span className="font-vx-mono text-[12px] text-vx-fg-body mt-1">
                    {t(pluralKey(t, locale, 'app.credits.packs.price', p.credits), { count: number.format(p.credits), price: usd.format(p.price_usd_cents / 100) })} <span className="text-vx-fg-muted">{t("app.credits.packs.tax")}</span>
                  </span>
                  <span className="text-[11px] text-vx-fg-muted mt-1">{t("app.credits.packs.neverExpire")}</span>
                  {typical && (
                    <span className="text-[11px] text-vx-fg-muted">
                      ≈ {[
                        typical.video && t(pluralKey(t, locale, 'app.credits.packs.videos', Math.floor(p.credits / typical.video)), { count: number.format(Math.floor(p.credits / typical.video)) }),
                        typical.image && t(pluralKey(t, locale, 'app.credits.packs.images', Math.floor(p.credits / typical.image)), { count: number.format(Math.floor(p.credits / typical.image)) }),
                      ].filter(Boolean).join(t("app.credits.packs.or"))}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          <p className="mt-3 text-[12px] text-vx-fg-muted max-w-[640px]">
            {t("pricing.packs.tax")}</p>

          <BindingText id="supply"  ><label className="mt-4 flex items-start gap-2 text-sm text-vx-fg-body cursor-pointer">
            <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 accent-vx-accent" />
            <span>
              <span lang="en" dir="ltr">{SUPPLY_CONSENT_TEXT}</span>{' '}
              <a href="/legal/refund" className="underline text-vx-fg-muted">Refund policy</a>
            </span>
          </label></BindingText>

          <div className="mt-4 flex items-center gap-3">
            <Button data-testid="credit-packs-buy" variant="money" className="min-w-[11.5rem] justify-center" onClick={buy} disabled={!selected || !consent || busy}>
              {busy ? t("app.publish.plan.opening") : t("pricing.packs.buy")}
            </Button>
            <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-faint">{t("app.credits.packs.secure")}</span>
          </div>
        </fieldset>
      )}
      {error && (
        <div role="alert" className="mt-3 text-sm text-vx-danger">{error}</div>
      )}
    </div>
  );
}
