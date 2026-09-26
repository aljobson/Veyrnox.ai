import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { cinemaFeatures } from './features.js';
import * as stripeAdapter from '../../packages/adapters/stripe.js';

/** Consent wording version a Pass records: supplied at once, cooling-off refund pro rata (ADR-0057 §5). */
export const PASS_CONSENT_VERSION = 'cinema-pass-2026-09-26';
export const COOLING_OFF_DAYS = 14;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,128}$/;
const PLAN_RE = /^[a-z0-9-]{1,32}$/;
const SESSION_RE = /^cs_[A-Za-z0-9_]{1,251}$/;
const RATE_LIMIT_PER_WINDOW = 5;
const RATE_WINDOW_SECONDS = 600;
const CHECKOUT_TTL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const startCodes = {
  USER_NOT_FOUND: 409, ACCOUNT_FROZEN: 403, ACCOUNT_NOT_ACTIVE: 403, IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 409, CONSENT_VERSION_REQUIRED: 400, PLAN_NOT_FOUND: 404, PASS_ALREADY_ACTIVE: 409,
};
const allowedBody = { start: ['plan_id', 'idempotency_key', 'consent', 'consent_version'], return: ['pass_id', 'session_id'], cancel: [], portal: [] };

/** What the browser may see of a Pass: never a Stripe id. */
export function passProjection(pass, nowMs = Date.now()) {
  if (!pass) return null;
  const started = pass.started_at ? Date.parse(pass.started_at) : NaN;
  const coolingOffUntil = Number.isFinite(started) ? new Date(started + COOLING_OFF_DAYS * DAY_MS).toISOString() : null;
  return {
    id: pass.id, plan_id: pass.plan_id, status: pass.status,
    price_usd_cents: pass.price_usd_cents, intro_price_usd_cents: pass.intro_price_usd_cents ?? null,
    current_period_end: pass.current_period_end ?? null, cancel_at_period_end: pass.cancel_at_period_end === true,
    started_at: pass.started_at ?? null, ended_at: pass.ended_at ?? null, end_reason: pass.end_reason ?? null,
    cooling_off_until: coolingOffUntil,
    within_cooling_off: coolingOffUntil !== null && nowMs < started + COOLING_OFF_DAYS * DAY_MS,
  };
}

/** The pro-rata amount to give back on a cooling-off cancellation, in cents, floored. */
export function coolingOffRefundCents({ paidCents, periodStartMs, periodEndMs, nowMs }) {
  if (!Number.isSafeInteger(paidCents) || paidCents <= 0) return 0;
  if (!Number.isFinite(periodStartMs) || !Number.isFinite(periodEndMs) || periodEndMs <= periodStartMs) return paidCents;
  const remaining = Math.max(0, Math.min(periodEndMs - periodStartMs, periodEndMs - nowMs));
  return Math.floor(paidCents * remaining / (periodEndMs - periodStartMs));
}

/**
 * One handler for the Pass endpoints. `action` is 'plans' (GET), 'read' (GET),
 * 'start', 'return', 'cancel' or 'portal' (POST). Identity comes only from
 * the middleware header; prices and intro eligibility only from the database;
 * every Stripe call is made server-side with the Worker's key.
 */
export function passHandler({ action = 'read', rpcCall = rpc, stripe = stripeAdapter, now = () => Date.now(), fetcher } = {}) {
  return async (req) => {
    const id = crypto.randomUUID();
    const auth = req.headers.get('x-veyrnox-auth-id');
    const reply = (body, status = 200) => {
      console.info(JSON.stringify({ event: 'cinema.pass', request_id: id, actor_id: UUID.test(auth || '') ? auth : undefined, action, status, code: body.error || 'ok' }));
      const headers = { 'Cache-Control': 'no-store', 'x-request-id': id };
      if (status === 429) headers['Retry-After'] = String(body.retry_after_seconds || 60);
      return Response.json({ ...body, request_id: id }, { status, headers });
    };
    if (!UUID.test(auth || '')) return reply({ error: 'not_authenticated' }, 401);
    if (!cinemaFeatures(process.env).subscriptions) return reply({ error: 'pass_not_open' }, 503);
    try {
      const db = envConfig();
      const apiKey = process.env.STRIPE_SECRET_KEY, publicHost = process.env.PUBLIC_HOST, signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
      const needsStripe = !['plans', 'read'].includes(action);
      if (needsStripe && (!apiKey || !publicHost || !signingSecret)) return reply({ error: 'pass_not_configured' }, 503);
      const scfg = { fetch: fetcher || fetch.bind(globalThis), apiKey, publicHost, signingSecret, automaticTax: process.env.STRIPE_AUTOMATIC_TAX !== 'false' };
      const expectLiveMode = String(apiKey || '').startsWith('sk_live_');
      const query = new URL(req.url).searchParams;
      if (query.size) return reply({ error: 'invalid_request' }, 400);
      let body = {};
      if (needsStripe) {
        if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'invalid_content_type' }, 415);
        const limited = await limitRequestBody(req);
        if (limited.response) return reply({ error: 'invalid_body' }, limited.response.status);
        try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
        if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((k) => !allowedBody[action].includes(k))) return reply({ error: 'invalid_request' }, 400);
      }
      if (action === 'start') {
        if (typeof body.plan_id !== 'string' || !PLAN_RE.test(body.plan_id)) return reply({ error: 'plan_id_required' }, 400);
        if (typeof body.idempotency_key !== 'string' || !IDEMPOTENCY_RE.test(body.idempotency_key)) return reply({ error: 'idempotency_key_required' }, 400);
        if (body.consent !== true) return reply({ error: 'consent_required' }, 400);
        if (body.consent_version !== PASS_CONSENT_VERSION) return reply({ error: 'consent_version_required', consent_version: PASS_CONSENT_VERSION }, 400);
      }
      if (action === 'return' && (typeof body.pass_id !== 'string' || !UUID.test(body.pass_id) || typeof body.session_id !== 'string' || !SESSION_RE.test(body.session_id))) return reply({ error: 'invalid_request' }, 400);

      const rate = await rpcCall('consume_account_read_request', { p_auth_id: auth }, db);
      if (rate?.code === 'RATE_LIMITED') return reply({ error: 'rate_limited', retry_after_seconds: rate.retry_after_seconds }, 429);
      if (rate?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);

      if (action === 'plans') {
        const plans = await rpcCall('list_cinema_pass_plans', {}, db);
        if (!Array.isArray(plans)) return reply({ error: 'temporarily_unavailable' }, 503);
        return reply({ plans: plans.map((p) => ({ id: p.id, billing_interval: p.billing_interval, price_usd_cents: p.price_usd_cents, intro_price_usd_cents: p.intro_price_usd_cents ?? null })), consent_version: PASS_CONSENT_VERSION, cooling_off_days: COOLING_OFF_DAYS });
      }
      if (action === 'read') {
        const r = await rpcCall('read_own_cinema_pass', { p_auth_id: auth }, db);
        if (r?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
        return reply({ pass: passProjection(r.pass, now()) });
      }
      if (action === 'start') return await start(body);
      if (action === 'return') return await recover(body);
      if (action === 'cancel') return await cancel();
      return await portal();

      async function start(b) {
        const r = await rpcCall('start_cinema_pass', {
          p_auth_id: auth, p_plan_id: b.plan_id, p_idempotency_key: b.idempotency_key, p_consent_version: b.consent_version,
          p_limit_per_window: RATE_LIMIT_PER_WINDOW, p_window_seconds: RATE_WINDOW_SECONDS,
        }, db);
        if (!r || typeof r.ok !== 'boolean') return reply({ error: 'temporarily_unavailable' }, 503);
        if (r.ok === false) {
          if (r.code === 'RATE_LIMITED') return reply({ error: 'rate_limited', retry_after_seconds: Math.max(1, Math.min(RATE_WINDOW_SECONDS, Number(r.retry_after_seconds) || RATE_WINDOW_SECONDS)) }, 429);
          const status = startCodes[r.code];
          return status ? reply({ error: String(r.code).toLowerCase() }, status) : reply({ error: 'temporarily_unavailable' }, 503);
        }
        // A replayed key for a Pass that already went through checkout needs no new link.
        if (r.status !== 'pending') return reply({ pass_id: r.pass_id, status: r.status, idempotent: true });
        let introCouponId;
        if (Number.isSafeInteger(r.intro_price_usd_cents)) {
          const off = r.price_usd_cents - r.intro_price_usd_cents;
          introCouponId = `veyrnox-pass-intro-${r.plan_id}-${off}`;
          const coupon = await stripe.ensureIntroCoupon({ couponId: introCouponId, amountOffCents: off, name: 'Cinema Pass first period' }, scfg);
          if (!coupon.ok) { console.error('[cinema-pass] intro coupon failed:', coupon.error, r.pass_id); return reply({ error: 'checkout_failed' }, 502); }
        }
        const bucket = Math.floor(now() / CHECKOUT_TTL_MS);
        const checkout = await stripe.createPassCheckout({
          passId: r.pass_id, planId: r.plan_id, interval: r.billing_interval, priceUsdCents: r.price_usd_cents, introCouponId,
          email: req.headers.get('x-veyrnox-auth-email') || undefined, expiresAt: (bucket + 2) * (CHECKOUT_TTL_MS / 1000),
        }, { ...scfg, idempotencyKey: `cinema_pass:${r.pass_id}:${bucket}` });
        if (!checkout.ok) { console.error('[cinema-pass] checkout failed:', checkout.error, r.pass_id); return reply({ error: 'checkout_failed' }, 502); }
        return reply({ pass_id: r.pass_id, checkout_url: checkout.url, idempotent: r.idempotent === true, intro_price_usd_cents: r.intro_price_usd_cents ?? null });
      }

      // The buyer came back from checkout: record the session and, if Stripe
      // already shows a subscription for it, apply that state now rather than
      // wait for a webhook that may never land (ADR-0033's lesson).
      async function recover(b) {
        const rec = await rpcCall('record_cinema_pass_session', { p_auth_id: auth, p_pass_id: b.pass_id, p_session_id: b.session_id }, db);
        if (rec?.ok !== true) {
          const code = rec?.code;
          return reply({ error: code === 'PASS_NOT_FOUND' ? 'pass_not_found' : code === 'SESSION_MISMATCH' ? 'session_mismatch' : 'temporarily_unavailable' }, code === 'PASS_NOT_FOUND' ? 404 : code === 'SESSION_MISMATCH' ? 409 : 503);
        }
        const session = await stripe.fetchSession(b.session_id, scfg);
        if (!session.ok) return reply({ ok: true, status: rec.status, recovered: false });
        const s = session.session;
        const subscriptionId = typeof s.subscription === 'string' ? s.subscription : s.subscription && s.subscription.id;
        if (Boolean(s.livemode) !== expectLiveMode || !(await stripe.verifyPassMetadata(s.metadata, signingSecret)) || s.metadata.cinema_pass_id !== b.pass_id || !subscriptionId) {
          return reply({ ok: true, status: rec.status, recovered: false });
        }
        const sub = await stripe.fetchSubscription(subscriptionId, scfg);
        const interp = sub.ok ? stripe.interpretSubscription(sub.subscription, { expectLiveMode }) : sub;
        if (!interp.ok) return reply({ ok: true, status: rec.status, recovered: false });
        const x = interp.subscription;
        const applied = await rpcCall('apply_cinema_pass_event', {
          p_event_id: b.session_id, p_type: 'checkout.return', p_pass_id: b.pass_id, p_subscription_id: x.id, p_customer_id: x.customerId,
          p_status: x.status, p_period_end: x.periodEnd, p_cancel_at_period_end: x.cancelAtPeriodEnd, p_occurred_at: new Date(now()).toISOString(),
        }, db);
        if (applied?.ok !== true) return reply({ ok: true, status: rec.status, recovered: false });
        if (applied.flagged) {
          // Paid while another Pass was live: stop the billing now; the webhook retries the cancel if this fails.
          const stop = await stripe.cancelSubscriptionNow(x.id, scfg);
          console.error('[cinema-pass] second Pass paid while one was live, flagged for Operator refund:', b.pass_id, stop.ok ? 'subscription cancelled' : `cancel failed: ${stop.error}`);
        }
        return reply({ ok: true, status: applied.status ?? rec.status, recovered: applied.idempotent !== true });
      }

      async function ownLivePass() {
        const r = await rpcCall('read_own_cinema_pass', { p_auth_id: auth }, db);
        if (r?.ok !== true) return { error: reply({ error: 'temporarily_unavailable' }, 503) };
        const pass = r.pass;
        if (!pass || !['active', 'past_due'].includes(pass.status) || !pass.stripe_subscription_id) return { error: reply({ error: 'no_live_pass' }, 404) };
        return { pass };
      }

      // Within 14 days of the first charge: cancel now and refund the unused
      // share of what was paid. After that: stop renewing at the period end.
      async function cancel() {
        const { pass, error } = await ownLivePass();
        if (error) return error;
        const nowMs = now();
        const started = pass.started_at ? Date.parse(pass.started_at) : NaN;
        const coolingOff = Number.isFinite(started) && nowMs < started + COOLING_OFF_DAYS * DAY_MS;
        if (!coolingOff) {
          const stop = await stripe.cancelSubscriptionAtPeriodEnd(pass.stripe_subscription_id, scfg);
          if (!stop.ok) { console.error('[cinema-pass] cancel at period end failed:', stop.error, pass.id); return reply({ error: 'cancel_failed' }, 502); }
          const marked = await rpcCall('mark_cinema_pass_cancelled', { p_auth_id: auth, p_pass_id: pass.id, p_mode: 'period_end' }, db);
          if (marked?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
          return reply({ ok: true, mode: 'period_end', current_period_end: pass.current_period_end ?? null });
        }
        let refundCents = 0, payment = null;
        const sub = await stripe.fetchSubscription(pass.stripe_subscription_id, scfg);
        const interp = sub.ok ? stripe.interpretSubscription(sub.subscription, { expectLiveMode }) : sub;
        if (interp.ok && interp.subscription.latestInvoiceId) {
          const inv = await stripe.fetchInvoice(interp.subscription.latestInvoiceId, scfg);
          payment = inv.ok ? stripe.invoicePayment(inv.invoice) : null;
          if (payment) {
            refundCents = coolingOffRefundCents({
              paidCents: payment.paidCents, nowMs,
              periodStartMs: Date.parse(interp.subscription.periodStart || pass.started_at), periodEndMs: Date.parse(interp.subscription.periodEnd || pass.current_period_end),
            });
          }
        }
        const stopped = await stripe.cancelSubscriptionNow(pass.stripe_subscription_id, scfg);
        if (!stopped.ok) { console.error('[cinema-pass] cooling-off cancel failed:', stopped.error, pass.id); return reply({ error: 'cancel_failed' }, 502); }
        let refunded = false;
        if (refundCents > 0 && payment) {
          const refund = await stripe.createRefund({ paymentIntentId: payment.paymentIntentId, amountCents: refundCents }, scfg, `pass_refund:${pass.id}`);
          refunded = refund.ok === true;
          // The Pass is ended either way; an unrefunded amount is an Operator item, never silent.
          if (!refunded) console.error('[cinema-pass] cooling-off refund failed, Operator refund needed:', refund.error, pass.id, refundCents);
        } else if (!payment) {
          console.error('[cinema-pass] cooling-off refund amount unknown, Operator review needed:', pass.id);
        }
        const marked = await rpcCall('mark_cinema_pass_cancelled', { p_auth_id: auth, p_pass_id: pass.id, p_mode: 'cooling_off' }, db);
        if (marked?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
        return reply({ ok: true, mode: 'cooling_off', refund_usd_cents: refundCents, refunded });
      }

      async function portal() {
        const r = await rpcCall('read_own_cinema_pass', { p_auth_id: auth }, db);
        if (r?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
        if (!r.pass || !r.pass.stripe_customer_id) return reply({ error: 'no_live_pass' }, 404);
        const session = await stripe.createPortalSession({ customerId: r.pass.stripe_customer_id }, scfg);
        if (!session.ok) { console.error('[cinema-pass] portal failed:', session.error); return reply({ error: 'portal_failed' }, 502); }
        return reply({ url: session.url });
      }
    } catch { return reply({ error: 'temporarily_unavailable' }, 503); }
  };
}
