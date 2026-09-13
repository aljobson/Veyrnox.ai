'use client';
import { useEffect, useState } from 'react';
import { Button } from './Button';
import { gatewayFetch, GatewayError, makeIdempotencyKey, notifyBalanceChanged } from '../_lib/gateway';
import { useCatalog } from '../_lib/useCatalog';

// Supply Consent (CONTEXT.md). Bump the version whenever the wording changes:
// every pending Top-up stores the version its buyer agreed to.
// Wording awaits Finance/Legal sign-off (ADR-0018 preconditions, #99).
export const SUPPLY_CONSENT_VERSION = '2026-09-13';
const SUPPLY_CONSENT_TEXT =
  'Add my credits straight away. I understand that once I use any of them to generate, I lose my right to cancel this purchase.';

const ERROR_COPY = {
  consent_required: 'Tick the box above to continue.',
  pack_not_found: 'That pack is no longer available. Refresh and pick again.',
  rate_limited: 'Too many checkout attempts. Try again in a few minutes.',
  idempotency_key_reused: 'Pick your pack again to start a new checkout.',
  user_not_provisioned: 'Your account is still being set up. Try again in a moment.',
};

const TOP_UP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POLL_MS = 2000;
const POLL_GIVE_UP_MS = 3 * 60 * 1000;

// Shown after LemonSqueezy redirects back with ?top_up=<id>. Polls the
// Top-up until the webhook credits it, then refreshes every balance on the
// page. Credits come only from the webhook; this never grants anything.
export function TopUpReturn() {
  const [topUpId, setTopUpId] = useState(null);
  const [phase, setPhase] = useState('processing');
  const [credits, setCredits] = useState(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('top_up');
    if (id && TOP_UP_ID_RE.test(id)) setTopUpId(id);
  }, []);

  useEffect(() => {
    if (!topUpId) return;
    let stopped = false;
    let timer;
    const started = Date.now();
    async function poll() {
      try {
        const t = await gatewayFetch(`/top-ups/${topUpId}`);
        if (stopped) return;
        if (t.status === 'credited') {
          setCredits(t.credits);
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
    processing: 'Payment received. Adding your credits…',
    credited: `${credits == null ? 'Your' : new Intl.NumberFormat('en-US').format(credits)} credits added to your balance.`,
    slow: 'Still processing. Your credits usually arrive within a few minutes. Don’t pay again; if they haven’t arrived within the hour, contact support.',
    not_found: 'We couldn’t find that purchase on this account. If you were charged, contact support.',
  }[phase];
  return (
    <div role="status" aria-live="polite" className={`mt-4 rounded-lg border px-4 py-3 text-sm ${phase === 'credited' ? 'border-vx-money/40 bg-vx-money/[0.07] text-vx-money' : 'border-vx-border bg-vx-base/60 text-vx-fg-body'}`}>
      {phase === 'processing' && <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted mr-2">PROCESSING</span>}
      {copy}
    </div>
  );
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

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
  const open = models.filter((m) => !m.gated && m.credits > 0);
  const video = median(open.filter((m) => m.kind === 'video').map((m) => m.credits));
  const image = median(open.filter((m) => m.kind === 'image').map((m) => m.credits));
  return video || image ? { video, image } : null;
}

export function TopUpPacks({ signedIn }) {
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
      .catch(() => { if (!cancelled) setError('Credit packs are unavailable right now.'); });
    return () => { cancelled = true; };
  }, [signedIn]);

  if (!signedIn) {
    return (
      <div className="mt-6">
        <Button variant="money" onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required', { detail: { mode: 'sign_in' } }))}>
          Sign in to buy credits
        </Button>
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
      // Top-level navigation to LemonSqueezy's hosted checkout; the server
      // has already checked the URL is on lemonsqueezy.com.
      window.location.assign(res.checkout_url);
    } catch (e) {
      const code = e instanceof GatewayError ? e.code : null;
      setError(ERROR_COPY[code] || 'Checkout could not start. Nothing was charged. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      {packs == null && !error && (
        <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">LOADING PACKS…</div>
      )}
      {packs && packs.length === 0 && (
        <div className="text-sm text-vx-fg-muted">No credit packs are available right now.</div>
      )}
      {packs && packs.length > 0 && (
        <fieldset>
          <legend className="sr-only">Choose a credit pack</legend>
          <div className="flex flex-wrap gap-2">
            {packs.map((p) => {
              const on = selected === p.id;
              return (
                <label
                  key={p.id}
                  className={`flex flex-col items-start rounded-xl border px-4 py-3 cursor-pointer bg-vx-base/60 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-vx-accent ${on ? 'border-vx-money' : 'border-vx-border hover:border-vx-money/60'}`}
                >
                  <input type="radio" name="credit-pack" value={p.id} checked={on} onChange={() => { setSelected(p.id); setIdempotencyKey(makeIdempotencyKey()); }} className="sr-only" />
                  <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">CREDIT PACK</span>
                  <span className="font-vx-mono text-[18px] font-bold text-vx-money mt-1 vx-num">+{new Intl.NumberFormat('en-US').format(p.credits)} cr</span>
                  <span className="font-vx-mono text-[12px] text-vx-fg-body mt-1">
                    {usd.format(p.price_usd_cents / 100)} <span className="text-vx-fg-muted">+ applicable tax</span>
                  </span>
                  <span className="text-[11px] text-vx-fg-muted mt-1">Never expire</span>
                  {typical && (
                    <span className="text-[11px] text-vx-fg-muted">
                      ≈ {[
                        typical.video && `${Math.floor(p.credits / typical.video)} 5s videos`,
                        typical.image && `${Math.floor(p.credits / typical.image)} images`,
                      ].filter(Boolean).join(' or ')}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          <label className="mt-4 flex items-start gap-2 text-sm text-vx-fg-body cursor-pointer">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
            <span>
              {SUPPLY_CONSENT_TEXT}{' '}
              <a href="/legal/refund" className="underline text-vx-fg-muted">Refund policy</a>
            </span>
          </label>

          <div className="mt-4 flex items-center gap-3">
            <Button variant="money" onClick={buy} disabled={!selected || !consent || busy}>
              {busy ? 'Opening checkout…' : 'Buy credits'}
            </Button>
            <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-faint">SECURE CHECKOUT BY LEMONSQUEEZY · TAX SHOWN AT CHECKOUT</span>
          </div>
        </fieldset>
      )}
      {error && (
        <div role="alert" className="mt-3 text-sm text-vx-danger">{error}</div>
      )}
    </div>
  );
}
