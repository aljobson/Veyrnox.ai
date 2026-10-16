import test from 'node:test';
import assert from 'node:assert/strict';
import { publishPlanHandler, PUBLISH_PLAN_CONSENT_VERSION, publicEntitlement } from '../lib/social/publishPlanApi.js';

const auth = '11111111-1111-4111-8111-111111111111';
const subscriptionId = '22222222-2222-4222-8222-222222222222';
Object.assign(process.env, {
  PUBLISH_PLANS_ENABLED: 'true', PUBLISH_MULTI_ACCOUNT_ENABLED: 'true',
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test',
  STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_0123456789abcdef0123456789abcdef',
  PUBLIC_HOST: 'https://veyrnox.ai',
});
const request = (path = '', body, headers = {}) => new Request(`https://veyrnox.ai/api/v1/social/plan${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'x-veyrnox-auth-id': auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
const entitlement = (over = {}) => ({ ok: true, tier: 'free', account_limit: 1, analytics_days: 0, best_time_enabled: false, subscription: null, ...over });

function setup(action, rpcValues = {}, stripeValues = {}) {
  const calls = [];
  const handler = publishPlanHandler({
    action, now: () => 1_800_000_000_000,
    rpcCall: async (name, args) => { calls.push({ name, args }); return name === 'consume_account_read_request' ? { ok: true } : rpcValues[name]; },
    checkout: async (input, cfg) => { calls.push({ name: 'checkout', args: input, cfg }); return stripeValues.checkout || { ok: true, url: 'https://checkout.stripe.com/c/pay/publish' }; },
    stripeAdapter: {
      cancelSubscriptionAtPeriodEnd: async () => ({ ok: true }),
      createPortalSession: async () => ({ ok: true, url: 'https://billing.stripe.com/p/x' }),
    },
  });
  return { handler, calls };
}

test('read returns only public entitlement fields and both billing intervals', async () => {
  const s = setup('read', {
    list_social_publish_plans: [
      { id: 'publish-weekly', name: 'Publish Plan', billing_interval: 'week', price_usd_cents: 499, analytics_days: 366, best_time_enabled: true, internal: 'x' },
      { id: 'publish', name: 'Publish Plan', billing_interval: 'month', price_usd_cents: 1500, analytics_days: 366, best_time_enabled: true },
    ],
    read_social_publish_entitlement: entitlement(),
  });
  const response = await s.handler(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.plans.map((plan) => [plan.billing_interval, plan.price_usd_cents]), [['week', 499], ['month', 1500]]);
  assert.equal(body.plans[0].internal, undefined);
  assert.equal(body.entitlement.account_limit, 1);
  assert.equal(body.entitlement.analytics_days, 0);
  assert.equal(body.consent_version, PUBLISH_PLAN_CONSENT_VERSION);
});

test('start trusts the database price and opens one recurring Stripe checkout', async () => {
  const s = setup('start', {
    start_social_publish_subscription: { ok: true, status: 'pending', subscription_id: subscriptionId, plan_id: 'publish', billing_interval: 'month', price_usd_cents: 1500 },
  });
  const response = await s.handler(request('', {
    plan_id: 'publish', idempotency_key: 'publish-key-1', consent: true,
    consent_version: PUBLISH_PLAN_CONSENT_VERSION,
  }, { 'x-veyrnox-auth-email': 'owner@example.com' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).checkout_url, 'https://checkout.stripe.com/c/pay/publish');
  const checkout = s.calls.find((call) => call.name === 'checkout');
  assert.equal(checkout.args.priceUsdCents, 1500);
  assert.equal(checkout.args.email, 'owner@example.com');
  assert.match(checkout.cfg.idempotencyKey, new RegExp(`^social_publish:${subscriptionId}:`));
});

test('start passes the weekly Publish interval from the database snapshot', async () => {
  const s = setup('start', {
    start_social_publish_subscription: { ok: true, status: 'pending', subscription_id: subscriptionId, plan_id: 'publish-weekly', billing_interval: 'week', price_usd_cents: 499 },
  });
  const response = await s.handler(request('', {
    plan_id: 'publish-weekly', idempotency_key: 'publish-weekly-key', consent: true,
    consent_version: PUBLISH_PLAN_CONSENT_VERSION,
  }));
  assert.equal(response.status, 200);
  const checkout = s.calls.find((call) => call.name === 'checkout');
  assert.deepEqual([checkout.args.interval, checkout.args.priceUsdCents], ['week', 499]);
});

test('identity, feature flag and consent gates run before billing', async () => {
  const s = setup('start');
  assert.equal((await s.handler(request('', {}, { 'x-veyrnox-auth-id': '' }))).status, 401);
  process.env.PUBLISH_PLANS_ENABLED = 'false';
  assert.equal((await s.handler(request('', {}))).status, 503);
  process.env.PUBLISH_PLANS_ENABLED = 'true';
  for (const body of [
    { plan_id: 'Publish', idempotency_key: 'publish-key-1', consent: true, consent_version: PUBLISH_PLAN_CONSENT_VERSION },
    { plan_id: 'publish', idempotency_key: 'short', consent: true, consent_version: PUBLISH_PLAN_CONSENT_VERSION },
    { plan_id: 'publish', idempotency_key: 'publish-key-1', consent: false, consent_version: PUBLISH_PLAN_CONSENT_VERSION },
  ]) assert.equal((await s.handler(request('', body))).status, 400);
  assert.equal(s.calls.length, 0);
});

test('cancel and billing portal use only the server-owned Stripe binding', async () => {
  const live = entitlement({ tier: 'publish', analytics_days: 366, best_time_enabled: true, subscription: {
    id: subscriptionId, status: 'active', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1',
  } });
  const cancel = setup('cancel', { read_social_publish_entitlement: live, mark_social_publish_cancelled: { ok: true, current_period_end: '2026-11-13T00:00:00Z' } });
  assert.equal((await cancel.handler(request('/cancel', {}))).status, 200);
  assert.equal(cancel.calls.find((call) => call.name === 'mark_social_publish_cancelled').args.p_subscription_id, subscriptionId);
  const portal = setup('portal', { read_social_publish_entitlement: live });
  assert.equal((await portal.handler(request('/portal', {}))).status, 200);
});

test('public entitlement never exposes Stripe ids', () => {
  const value = publicEntitlement(entitlement({ tier: 'publish', analytics_days: 366, best_time_enabled: true, subscription: {
    id: subscriptionId, status: 'active', stripe_subscription_id: 'sub_secret', stripe_customer_id: 'cus_secret', price_usd_cents: 1500,
  } }));
  assert.equal(value.subscription.stripe_subscription_id, undefined);
  assert.equal(value.subscription.stripe_customer_id, undefined);
  assert.equal(value.account_limit, 5);
});
