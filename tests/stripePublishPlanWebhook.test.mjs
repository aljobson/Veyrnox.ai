import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c);}`,
));

const SECRET = 'whsec_publish_webhook_0123456789abcdef';
const PLAN_ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const NOW = Math.floor(Date.now() / 1000);
Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
  STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET,
  PUBLIC_HOST: 'https://veyrnox.test', PUBLISH_PLANS_ENABLED: 'true',
  SUBSCRIPTIONS_ENABLED: 'false',
});

const { createPublishPlanCheckout } = await import('../packages/adapters/stripePublishPlan.js');
const stripeWebhook = await import('../app/api/webhook/stripe/route.js');

let checkoutFields;
await createPublishPlanCheckout({
  subscriptionId: PLAN_ID, planId: 'publish', interval: 'month', priceUsdCents: 1500,
}, {
  fetch: async (_url, init) => {
    checkoutFields = new URLSearchParams(init.body);
    return Response.json({ id: 'cs_publish', object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/publish' });
  },
  apiKey: 'sk_test_x', publicHost: 'https://veyrnox.test', signingSecret: SECRET,
});
const metadata = Object.fromEntries(['kind', 'social_publish_subscription_id', 'social_publish_subscription_sig']
  .map((key) => [key, checkoutFields.get(`subscription_data[metadata][${key}]`)]));

function signed(type, id, object) {
  const body = JSON.stringify({ id, type, livemode: false, created: NOW, data: { object } });
  const v1 = createHmac('sha256', SECRET).update(`${NOW}.${body}`).digest('hex');
  return new Request('https://veyrnox.test/api/webhook/stripe', {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${NOW},v1=${v1}` }, body,
  });
}

function stub(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const value = String(url);
    calls.push({ url: value, method: init.method || 'GET', body: typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : null });
    for (const [needle, response] of routes) if (value.includes(needle)) return typeof response === 'function' ? response(value, init) : Response.json(response);
    throw new Error(`unexpected fetch ${value}`);
  };
  return calls;
}

const dedupRoutes = () => [
  ['/rest/v1/webhook_events?on_conflict', () => new Response('[{"id":"event-row"}]', { status: 201 })],
  ['/rest/v1/webhook_events', (_url, init) => init.method === 'PATCH' ? new Response(null, { status: 204 }) : Response.json([])],
  ['/rpc/read_credit_subscription_binding', null],
];

test('the Stripe route binds a signed $15 Publish subscription before Cinema', async () => {
  const calls = stub([
    ...dedupRoutes(),
    ['/v1/subscriptions/sub_publish', {
      id: 'sub_publish', object: 'subscription', livemode: false, status: 'active', customer: 'cus_publish',
      cancel_at_period_end: false, metadata,
      items: { data: [{ current_period_start: NOW - 60, current_period_end: NOW + 2592000 }] },
    }],
    ['/rpc/apply_social_publish_subscription_event', { ok: true, status: 'active', flagged: false }],
  ]);
  const response = await stripeWebhook.POST(signed('customer.subscription.updated', 'evt_publish_route', { id: 'sub_publish', object: 'subscription' }));
  assert.equal(response.status, 200);
  const applied = calls.find((call) => call.url.includes('/rpc/apply_social_publish_subscription_event')).body;
  assert.deepEqual([applied.p_publish_subscription_id, applied.p_stripe_subscription_id, applied.p_status], [PLAN_ID, 'sub_publish', 'active']);
  assert.ok(!calls.some((call) => call.url.includes('/rpc/apply_cinema_pass_event')));
  assert.ok(calls.some((call) => call.method === 'PATCH' && call.url.includes('/rest/v1/webhook_events')));
});

test('a refunded Publish invoice ends only its Publish entitlement', async () => {
  const calls = stub([
    ...dedupRoutes(),
    ['/v1/invoices/in_publish', { id: 'in_publish', object: 'invoice', subscription: 'sub_publish' }],
    ['/v1/subscriptions/sub_publish', {
      id: 'sub_publish', object: 'subscription', livemode: false, status: 'active', customer: 'cus_publish',
      cancel_at_period_end: false, metadata,
      items: { data: [{ current_period_start: NOW - 60, current_period_end: NOW + 2592000 }] },
    }],
    ['/rpc/end_social_publish_subscription', { ok: true, subscription_id: PLAN_ID, frozen: false }],
  ]);
  const response = await stripeWebhook.POST(signed('charge.refunded', 'evt_publish_refund_route', {
    id: 'ch_publish', object: 'charge', invoice: 'in_publish', payment_intent: 'pi_publish', amount: 1500, amount_refunded: 1500,
  }));
  assert.equal(response.status, 200);
  const ended = calls.find((call) => call.url.includes('/rpc/end_social_publish_subscription')).body;
  assert.deepEqual([ended.p_stripe_subscription_id, ended.p_reason], ['sub_publish', 'refunded']);
  assert.ok(!calls.some((call) => call.url.includes('/rpc/end_cinema_pass')));
});
