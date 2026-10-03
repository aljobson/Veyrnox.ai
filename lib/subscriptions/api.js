import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import * as stripeAdapter from '../../packages/adapters/stripe.js';
import { createCreditSubscriptionCheckout, verifyCreditSubscriptionMetadata, fetchCreditInvoice, creditInvoice, creditPaymentIsSettled } from '../../packages/adapters/stripeCreditSubscriptions.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { finishCoolingOffRefund } from './refund.js';
import { subscriptionAlert } from './webhook.js';

export const SUBSCRIPTION_CONSENT_VERSION = 'credit-subscription-2026-10-03';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowed = { start: ['plan_id', 'idempotency_key', 'consent', 'consent_version'], return: ['subscription_id', 'session_id'], cancel: ['mode', 'subscription_id'] };
const errors = { USER_NOT_FOUND: 409, ACCOUNT_FROZEN: 403, PLAN_NOT_FOUND: 404, IDEMPOTENCY_KEY_REUSED: 409,
  SUBSCRIPTION_ALREADY_ACTIVE: 409, SUBSCRIPTION_NOT_FOUND: 404, SESSION_MISMATCH: 409, SUBSCRIPTION_NOT_LIVE: 409,
  COOLING_OFF_OVER: 409, CREDITS_SPENT: 409, CONSENT_VERSION_REQUIRED: 400, IDEMPOTENCY_KEY_REQUIRED: 400 };

export function subscriptionProjection(s) {
  if (!s) return null;
  return Object.fromEntries(['id', 'plan_id', 'status', 'price_usd_cents', 'credits', 'current_period_end',
    'cancel_at_period_end', 'started_at', 'ended_at', 'end_reason'].map((k) => [k, s[k] ?? null]));
}

export function subscriptionHandler({ action = 'read', rpcCall = rpc, stripe = stripeAdapter,
  checkout = createCreditSubscriptionCheckout, refund = finishCoolingOffRefund,
  now = () => Date.now(), fetcher } = {}) {
  if (!['read', 'plans', 'start', 'return', 'cancel'].includes(action)) throw new Error('Invalid subscription action');
  return async (req) => {
    const requestId = crypto.randomUUID();
    const auth = req.headers.get('x-veyrnox-auth-id');
    const reply = (body, status = 200) => Response.json({ ...body, request_id: requestId }, {
      status, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId,
        ...(status === 429 ? { 'Retry-After': String(body.retry_after_seconds || 60) } : {}) },
    });
    const verdict = (r) => reply({ error: errors[r?.code] ? r.code.toLowerCase() : 'temporarily_unavailable' }, errors[r?.code] || 503);
    if (!UUID.test(auth || '')) return reply({ error: 'not_authenticated' }, 401);
    if (process.env.SUBSCRIPTIONS_ENABLED !== 'true') return reply({ error: 'subscriptions_not_open' }, 503);
    try {
      if (new URL(req.url).searchParams.size) return reply({ error: 'invalid_request' }, 400);
      const db = envConfig(), apiKey = process.env.STRIPE_SECRET_KEY;
      const scfg = { fetch: fetcher || fetch.bind(globalThis), apiKey, publicHost: process.env.PUBLIC_HOST,
        signingSecret: process.env.STRIPE_WEBHOOK_SECRET, automaticTax: process.env.STRIPE_AUTOMATIC_TAX !== 'false' };
      const write = Boolean(allowed[action]);
      if (write && (!apiKey || !scfg.publicHost || !scfg.signingSecret)) return reply({ error: 'subscriptions_not_configured' }, 503);
      let body = {};
      if (write) {
        if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'invalid_content_type' }, 415);
        const limited = await limitRequestBody(req);
        if (limited.response) return reply({ error: 'invalid_body' }, limited.response.status);
        try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
        if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((k) => !allowed[action].includes(k))) return reply({ error: 'invalid_request' }, 400);
      }
      if (action === 'start' && (typeof body.plan_id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(body.plan_id)
          || typeof body.idempotency_key !== 'string' || !/^[A-Za-z0-9._-]{8,128}$/.test(body.idempotency_key)
          || body.consent !== true || body.consent_version !== SUBSCRIPTION_CONSENT_VERSION)) return reply({ error: 'invalid_checkout_request', consent_version: SUBSCRIPTION_CONSENT_VERSION }, 400);
      if (action === 'return' && (!UUID.test(body.subscription_id || '') || typeof body.session_id !== 'string'
          || !/^cs_[A-Za-z0-9_]{1,251}$/.test(body.session_id))) return reply({ error: 'invalid_request' }, 400);
      if (action === 'cancel' && (!['period_end', 'cooling_off'].includes(body.mode) || !UUID.test(body.subscription_id || ''))) return reply({ error: 'invalid_cancellation_request' }, 400);
      const rate = await rpcCall('consume_account_read_request', { p_auth_id: auth }, db);
      if (rate?.code === 'RATE_LIMITED') return reply({ error: 'rate_limited', retry_after_seconds: rate.retry_after_seconds }, 429);
      if (rate?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
      if (action === 'plans') {
        const plans = await rpcCall('list_credit_subscription_plans', {}, db);
        if (!Array.isArray(plans)) return reply({ error: 'temporarily_unavailable' }, 503);
        return reply({ plans: plans.map((p) => ({ id: p.id, billing_interval: p.billing_interval, price_usd_cents: p.price_usd_cents, credits: p.credits })),
          consent_version: SUBSCRIPTION_CONSENT_VERSION, cooling_off_days: 14 });
      }
      if (action === 'start') {
        const r = await rpcCall('start_credit_subscription', { p_auth_id: auth, p_plan_id: body.plan_id,
          p_idempotency_key: body.idempotency_key, p_consent_version: body.consent_version,
          p_limit_per_window: 5, p_window_seconds: 600 }, db);
        if (r?.code === 'RATE_LIMITED') return reply({ error: 'rate_limited', retry_after_seconds: Math.max(1, Math.min(600, Number(r.retry_after_seconds) || 600)) }, 429);
        if (r?.ok !== true) return verdict(r);
        if (r.status !== 'pending') return reply({ subscription_id: r.subscription_id, status: r.status, idempotent: true });
        const bucket = Math.floor(now() / 3600000);
        const session = await checkout({ subscriptionId: r.subscription_id, planId: r.plan_id, interval: r.billing_interval,
          priceUsdCents: r.price_usd_cents, credits: r.credits, email: req.headers.get('x-veyrnox-auth-email') || undefined,
          expiresAt: (bucket + 2) * 3600 }, { ...scfg, idempotencyKey: `credit_subscription:${r.subscription_id}:${bucket}` });
        if (!session.ok) return reply({ error: 'checkout_failed' }, 502);
        return reply({ subscription_id: r.subscription_id, checkout_url: session.url, idempotent: r.idempotent === true });
      }
      if (action === 'return') return await recover();
      const own = action === 'cancel'
        ? await rpcCall('read_own_credit_subscription_by_id', { p_auth_id: auth, p_id: body.subscription_id }, db)
        : await rpcCall('read_own_credit_subscription', { p_auth_id: auth }, db);
      if (!own && action === 'cancel') return reply({ error: 'subscription_not_found' }, 404);
      if (own?.ok !== true) return verdict(own);
      if (action === 'read') return reply({ subscription: subscriptionProjection(own.subscription) });
      const sub = own.subscription;
      if (!sub?.stripe_subscription_id) return reply({ error: 'no_live_subscription' }, 404);
      if (body.mode === 'period_end') {
        if (!['active', 'past_due'].includes(sub.status)) return reply({ error: 'no_live_subscription' }, 409);
        const stopped = await stripe.cancelSubscriptionAtPeriodEnd(sub.stripe_subscription_id, scfg);
        if (!stopped.ok) return reply({ error: 'cancel_failed' }, 502);
        const r = await rpcCall('mark_credit_subscription_cancelled', { p_auth_id: auth, p_subscription_id: sub.id }, db);
        return r?.ok === true ? reply({ ok: true, mode: 'period_end', current_period_end: r.current_period_end }) : verdict(r);
      }
      // Atomic eligibility check/reversal happens before Stripe sees a refund.
      const r = await rpcCall('cancel_credit_subscription_cooling_off', { p_auth_id: auth, p_subscription_id: sub.id }, db);
      if (r?.ok !== true) return verdict(r);
      if (r.stripe_subscription_id !== sub.stripe_subscription_id) return reply({ error: 'refund_review_required' }, 503);
      const result = await refund({ subscription: sub, invoiceId: r.invoice_id }, scfg);
      if (!result.ok) {
        await subscriptionAlert({ eventId: `cooling_off_${sub.id}`, subscriptionId: sub.stripe_subscription_id, invoiceId: r.invoice_id, code: result.error });
        return reply({ error: result.error, credits_removed: true, retryable: true }, 503);
      }
      return reply({ ok: true, mode: 'cooling_off', refunded: !result.pending, pending: result.pending === true, refund_usd_cents: result.amountCents });

      async function recover() {
        const fetched = await stripe.fetchSession(body.session_id, scfg);
        if (!fetched.ok) return reply({ error: 'session_fetch_failed' }, 503);
        const session = fetched.session, live = apiKey.startsWith('sk_live_');
        if (session.id !== body.session_id || session.mode !== 'subscription' || session.livemode !== live
            || !(await verifyCreditSubscriptionMetadata(session.metadata, scfg.signingSecret))
            || session.metadata.credit_subscription_id !== body.subscription_id) return reply({ error: 'session_mismatch' }, 409);
        // Ownership is checked before applying the verified Stripe binding.
        const rec = await rpcCall('record_credit_subscription_session', { p_auth_id: auth,
          p_subscription_id: body.subscription_id, p_session_id: body.session_id }, db);
        if (rec?.ok !== true) return verdict(rec);
        const sid = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        if (!sid) return reply({ ok: true, recovered: false, status: rec.status });
        const fetchedSub = await stripe.fetchSubscription(sid, scfg);
        const parsed = fetchedSub.ok && stripe.interpretSubscription(fetchedSub.subscription, { expectLiveMode: live });
        if (!parsed?.ok) return reply({ error: 'subscription_fetch_failed' }, 503);
        const s = parsed.subscription;
        const applied = await rpcCall('apply_credit_subscription_event', { p_event_id: body.session_id,
          p_type: 'checkout.return', p_id: body.subscription_id, p_stripe_subscription_id: s.id, p_customer_id: s.customerId,
          p_status: s.status, p_period_end: s.periodEnd, p_cancel_at_period_end: s.cancelAtPeriodEnd,
          p_occurred_at: new Date(now()).toISOString() }, db);
        if (applied?.ok !== true) return verdict(applied);
        if (applied.flagged) {
          const stop = await stripe.cancelSubscriptionNow(s.id, scfg);
          if (!stop.ok) return reply({ error: 'cancel_failed' }, 503);
          const alerted = await subscriptionAlert({ eventId: body.session_id, subscriptionId: s.id, code: 'duplicate_paid_subscription' });
          return alerted ? reply({ ok: true, status: 'flagged', credited: false }) : reply({ error: 'operator_alert_failed' }, 503);
        }
        let credited = false;
        if (s.latestInvoiceId) {
          const binding = await rpcCall('read_credit_subscription_binding', { p_stripe_subscription_id: s.id }, db);
          const invoice = await fetchCreditInvoice(s.latestInvoiceId, scfg);
          if (!invoice) return reply({ error: 'invoice_fetch_failed' }, 503);
          if (invoice.status === 'paid') {
            const payment = creditInvoice(invoice, binding, live, Math.floor(now() / 1000));
            const settled = payment.ok && await creditPaymentIsSettled(invoice, scfg);
            if (!payment.ok || !settled.ok) {
              if (!settled?.retry) await subscriptionAlert({ eventId: `cs_recovery_${invoice.id}`, subscriptionId: s.id, invoiceId: invoice.id, code: payment.error || settled.error });
              return reply({ error: 'invoice_review_required' }, 503);
            }
            // Separate namespace: the session id used above cannot also grant.
            const eventId = `cs_recovery_${payment.invoiceId}`;
            const granted = await rpcCall('grant_credit_subscription_invoice', { p_stripe_subscription_id: s.id,
              p_invoice_id: payment.invoiceId, p_event_id: eventId, p_paid_cents: payment.paidCents,
              p_period_end: payment.periodEnd, p_occurred_at: new Date(now()).toISOString() }, db);
            if (granted?.ok !== true) {
              if (granted?.refused) await subscriptionAlert({ eventId, subscriptionId: s.id, invoiceId: payment.invoiceId, code: granted.code });
              return reply({ error: 'subscription_grant_failed' }, 503);
            }
            credited = true;
          }
        }
        return reply({ ok: true, recovered: true, status: applied.status, credited });
      }
    } catch (err) {
      console.error('[credit-subscription] request failed:', requestId, err?.name);
      return reply({ error: 'temporarily_unavailable' }, 503);
    }
  };
}
