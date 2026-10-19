import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { publishPlansEnabled } from './publishFeature.js';
import { socialAccountLimitForTier } from './accountAllowance.js';
import * as stripe from '../../packages/adapters/stripe.js';
import { createPublishPlanCheckout, verifyPublishPlanMetadata } from '../../packages/adapters/stripePublishPlan.js';

export const PUBLISH_PLAN_CONSENT_VERSION = 'publish-plan-annual-2026-10-17';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SESSION = /^cs_[A-Za-z0-9_]{1,251}$/;
const PLAN = /^[a-z0-9-]{1,32}$/;
const KEY = /^[A-Za-z0-9._-]{8,128}$/;
const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 600;
const CHECKOUT_TTL_MS = 60 * 60 * 1000;
const allowed = { start: ['plan_id', 'idempotency_key', 'consent', 'consent_version'], return: ['subscription_id', 'session_id'], cancel: [], portal: [] };

const LIVE_STATUSES = ['active', 'past_due'];

// Where a live plan is managed (ADR-0109 amendment 1). Derived from columns the entitlement read already
// returns: a Stripe plan always carries its Stripe subscription id, a store plan never does (0346 writes the
// store identity instead). Only a live plan has a place to manage it; pending, ended and flagged rows are null.
// Never a customer id, receipt or token.
export function planSource(sub) {
  if (!sub || !LIVE_STATUSES.includes(sub.status)) return null;
  return sub.stripe_subscription_id ? 'stripe' : 'store';
}

export function publicEntitlement(value) {
  if (!value || value.ok !== true) return null;
  const sub = value.subscription;
  const tier = value.tier === 'publish' ? 'publish' : 'free';
  return {
    tier,
    account_limit: socialAccountLimitForTier(tier),
    analytics_days: tier === 'publish' ? Number(value.analytics_days) || 366 : 0,
    best_time_enabled: tier === 'publish' && value.best_time_enabled === true,
    subscription: sub ? {
      id: sub.id, plan_id: sub.plan_id, status: sub.status,
      price_usd_cents: sub.price_usd_cents,
      current_period_end: sub.current_period_end || null,
      cancel_at_period_end: sub.cancel_at_period_end === true,
      started_at: sub.started_at || null,
      source: planSource(sub),
    } : null,
  };
}

export async function readPublishEntitlement(authId, cfg = envConfig(), rpcCall = rpc) {
  const result = await rpcCall('read_social_publish_entitlement', { p_auth_id: authId }, cfg);
  return publicEntitlement(result);
}

export function publishPlanHandler({ action = 'read', rpcCall = rpc, stripeAdapter = stripe, checkout = createPublishPlanCheckout, now = () => Date.now(), fetcher } = {}) {
  return async (req) => {
    const requestId = crypto.randomUUID();
    const auth = req.headers.get('x-veyrnox-auth-id');
    const reply = (body, status = 200) => Response.json({ ...body, request_id: requestId }, {
      status, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId,
        ...(status === 429 ? { 'Retry-After': String(body.retry_after_seconds || 60) } : {}) },
    });
    if (!UUID.test(auth || '')) return reply({ error: 'not_authenticated' }, 401);
    if (!publishPlansEnabled()) return reply({ error: 'publish_plans_not_open' }, 503);
    const db = envConfig();
    const apiKey = process.env.STRIPE_SECRET_KEY;
    const publicHost = process.env.PUBLIC_HOST;
    const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const needsStripe = action !== 'read';
    if (needsStripe && (!apiKey || !publicHost || !signingSecret)) return reply({ error: 'publish_plans_not_configured' }, 503);
    const scfg = { fetch: fetcher || fetch.bind(globalThis), apiKey, publicHost, signingSecret };
    const expectLiveMode = String(apiKey || '').startsWith('sk_live_');
    try {
      if (new URL(req.url).searchParams.size) return reply({ error: 'invalid_request' }, 400);
      let body = {};
      if (needsStripe) {
        if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'invalid_content_type' }, 415);
        const limited = await limitRequestBody(req);
        if (limited.response) return reply({ error: 'invalid_body' }, limited.response.status);
        try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
        if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((name) => !allowed[action].includes(name))) {
          return reply({ error: 'invalid_request' }, 400);
        }
      }
      if (action === 'start') {
        if (!PLAN.test(body.plan_id || '')) return reply({ error: 'plan_id_required' }, 400);
        if (!KEY.test(body.idempotency_key || '')) return reply({ error: 'idempotency_key_required' }, 400);
        if (body.consent !== true) return reply({ error: 'consent_required' }, 400);
        if (body.consent_version !== PUBLISH_PLAN_CONSENT_VERSION) return reply({ error: 'consent_version_required', consent_version: PUBLISH_PLAN_CONSENT_VERSION }, 400);
      }
      if (action === 'return' && (!UUID.test(body.subscription_id || '') || !SESSION.test(body.session_id || ''))) {
        return reply({ error: 'invalid_request' }, 400);
      }
      const rate = await rpcCall('consume_account_read_request', { p_auth_id: auth }, db);
      if (rate?.code === 'RATE_LIMITED') return reply({ error: 'rate_limited', retry_after_seconds: rate.retry_after_seconds }, 429);
      if (rate?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
      if (action === 'read') {
        const [plans, entitlement] = await Promise.all([
          rpcCall('list_social_publish_plans', {}, db),
          rpcCall('read_social_publish_entitlement', { p_auth_id: auth }, db),
        ]);
        if (!Array.isArray(plans) || plans.length > 10 || plans.some((plan) =>
          !PLAN.test(plan?.id || '') || typeof plan.name !== 'string'
          || !['week', 'month', 'year'].includes(plan.billing_interval)
          || !Number.isSafeInteger(plan.price_usd_cents) || plan.price_usd_cents < 100
          || plan.price_usd_cents > 9_999_999 || !Number.isSafeInteger(plan.analytics_days)
          || plan.analytics_days < 30 || plan.analytics_days > 3660
          || typeof plan.best_time_enabled !== 'boolean') || !publicEntitlement(entitlement)) {
          return reply({ error: 'temporarily_unavailable' }, 503);
        }
        return reply({
          plans: plans.map((plan) => ({
            id: plan.id, name: plan.name, billing_interval: plan.billing_interval,
            price_usd_cents: plan.price_usd_cents, analytics_days: plan.analytics_days,
            best_time_enabled: plan.best_time_enabled === true,
          })),
          entitlement: publicEntitlement(entitlement), consent_version: PUBLISH_PLAN_CONSENT_VERSION,
        });
      }
      if (action === 'start') return start(body);
      if (action === 'return') return recover(body);
      if (action === 'cancel') return cancel();
      return portal();

      async function start(input) {
        const result = await rpcCall('start_social_publish_subscription', {
          p_auth_id: auth, p_plan_id: input.plan_id, p_idempotency_key: input.idempotency_key,
          p_consent_version: input.consent_version, p_limit_per_window: RATE_LIMIT,
          p_window_seconds: RATE_WINDOW_SECONDS,
        }, db);
        if (result?.ok !== true) {
          const statuses = { USER_NOT_FOUND: 401, ACCOUNT_FROZEN: 403, IDEMPOTENCY_KEY_REUSED: 409, PLAN_NOT_FOUND: 404, SUBSCRIPTION_ALREADY_ACTIVE: 409, RATE_LIMITED: 429 };
          return reply({ error: String(result?.code || 'temporarily_unavailable').toLowerCase(), ...(result?.retry_after_seconds ? { retry_after_seconds: result.retry_after_seconds } : {}) }, statuses[result?.code] || 503);
        }
        if (result.status !== 'pending') return reply({ subscription_id: result.subscription_id, status: result.status, idempotent: true });
        const bucket = Math.floor(now() / CHECKOUT_TTL_MS);
        const created = await checkout({
          subscriptionId: result.subscription_id, planId: result.plan_id,
          interval: result.billing_interval, priceUsdCents: result.price_usd_cents,
          email: req.headers.get('x-veyrnox-auth-email') || undefined,
          expiresAt: (bucket + 2) * (CHECKOUT_TTL_MS / 1000),
        }, { ...scfg, idempotencyKey: `social_publish:${result.subscription_id}:${bucket}` });
        if (!created.ok) return reply({ error: 'checkout_failed' }, 502);
        return reply({ subscription_id: result.subscription_id, checkout_url: created.url });
      }

      async function recover(input) {
        const recorded = await rpcCall('record_social_publish_session', {
          p_auth_id: auth, p_subscription_id: input.subscription_id, p_session_id: input.session_id,
        }, db);
        if (recorded?.ok !== true) return reply({ error: recorded?.code === 'SUBSCRIPTION_NOT_FOUND' ? 'subscription_not_found' : 'temporarily_unavailable' }, recorded?.code === 'SUBSCRIPTION_NOT_FOUND' ? 404 : 503);
        const session = await stripeAdapter.fetchSession(input.session_id, scfg);
        if (!session.ok) return reply({ ok: true, status: recorded.status, recovered: false });
        const value = session.session;
        const stripeSubscriptionId = typeof value.subscription === 'string' ? value.subscription : value.subscription?.id;
        if (value.mode !== 'subscription' || value.client_reference_id !== input.subscription_id
            || Boolean(value.livemode) !== expectLiveMode
            || !(await verifyPublishPlanMetadata(value.metadata, signingSecret))
            || value.metadata.social_publish_subscription_id !== input.subscription_id || !stripeSubscriptionId) {
          return reply({ ok: true, status: recorded.status, recovered: false });
        }
        const fetched = await stripeAdapter.fetchSubscription(stripeSubscriptionId, scfg);
        const interpreted = fetched.ok ? stripeAdapter.interpretSubscription(fetched.subscription, { expectLiveMode }) : fetched;
        if (!interpreted.ok) return reply({ ok: true, status: recorded.status, recovered: false });
        const sub = interpreted.subscription;
        const applied = await rpcCall('apply_social_publish_subscription_event', {
          p_event_id: input.session_id, p_type: 'checkout.return',
          p_publish_subscription_id: input.subscription_id, p_stripe_subscription_id: sub.id,
          p_customer_id: sub.customerId, p_status: sub.status, p_period_end: sub.periodEnd,
          p_cancel_at_period_end: sub.cancelAtPeriodEnd, p_occurred_at: new Date(now()).toISOString(),
        }, db);
        if (applied?.flagged) await stripeAdapter.cancelSubscriptionNow(sub.id, scfg);
        return reply({ ok: true, status: applied?.status || recorded.status, recovered: applied?.ok === true });
      }

      async function liveSubscription() {
        const result = await rpcCall('read_social_publish_entitlement', { p_auth_id: auth }, db);
        const sub = result?.subscription;
        if (result?.ok !== true) return { error: reply({ error: 'temporarily_unavailable' }, 503) };
        if (!sub || !['active', 'past_due'].includes(sub.status) || !sub.stripe_subscription_id) return { error: reply({ error: 'no_live_subscription' }, 404) };
        return { sub };
      }

      async function cancel() {
        const { sub, error } = await liveSubscription();
        if (error) return error;
        const stopped = await stripeAdapter.cancelSubscriptionAtPeriodEnd(sub.stripe_subscription_id, scfg);
        if (!stopped.ok) return reply({ error: 'cancel_failed' }, 502);
        const marked = await rpcCall('mark_social_publish_cancelled', { p_auth_id: auth, p_subscription_id: sub.id }, db);
        if (marked?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
        return reply({ ok: true, current_period_end: marked.current_period_end });
      }

      async function portal() {
        const { sub, error } = await liveSubscription();
        if (error) return error;
        const session = await stripeAdapter.createPortalSession({ customerId: sub.stripe_customer_id, returnPath: '/app/publish/plan' }, scfg);
        if (!session.ok) return reply({ error: 'portal_failed' }, 502);
        return reply({ url: session.url });
      }
    } catch (error) {
      console.error('[social-publish-plan] request failed:', error?.message);
      return reply({ error: 'temporarily_unavailable' }, 503);
    }
  };
}
