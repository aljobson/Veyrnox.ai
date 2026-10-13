import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublishPlanCheckout } from '../packages/adapters/stripePublishPlan.js';
import { handlePublishPlanCharge, handlePublishPlanEvent } from '../lib/social/publishPlanWebhook.js';

const SECRET = 'whsec_publish_plan_test_0123456789abcdef';
const ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const CREATED = 1791882000;

async function signedMetadata() {
  let fields;
  const result = await createPublishPlanCheckout({
    subscriptionId: ID,
    planId: 'publish',
    interval: 'month',
    priceUsdCents: 1500,
  }, {
    fetch: async (_url, init) => {
      fields = new URLSearchParams(init.body);
      return Response.json({ object: 'checkout.session', id: 'cs_publish_test', url: 'https://checkout.stripe.com/c/pay/publish' });
    },
    apiKey: 'sk_test_publish',
    publicHost: 'https://veyrnox.test',
    signingSecret: SECRET,
  });
  assert.equal(result.ok, true);
  return {
    kind: fields.get('subscription_data[metadata][kind]'),
    social_publish_subscription_id: fields.get('subscription_data[metadata][social_publish_subscription_id]'),
    social_publish_subscription_sig: fields.get('subscription_data[metadata][social_publish_subscription_sig]'),
  };
}

const metadata = await signedMetadata();
const subscription = (over = {}) => ({
  id: 'sub_publish_test',
  customerId: 'cus_publish_test',
  status: 'active',
  periodEnd: '2026-11-13T12:00:00.000Z',
  cancelAtPeriodEnd: false,
  metadata,
  ...over,
});
const common = {
  cfg: { supabaseUrl: 'https://db.test', serviceRoleKey: 'test' },
  stripeConfig: { apiKey: 'sk_test_publish', fetch: async () => Response.json({}) },
  eventId: 'evt_publish_test',
  type: 'customer.subscription.updated',
  signingSecret: SECRET,
  eventCreated: CREATED,
  isYoung: () => true,
};

test('a signed Publish subscription is applied with the server-owned binding', async () => {
  let call;
  const response = await handlePublishPlanEvent({
    ...common,
    subscription: subscription(),
    rpcCall: async (name, args) => { call = { name, args }; return { ok: true, status: 'active', flagged: false }; },
    cancelSubscriptionNow: async () => ({ ok: true }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(call, {
    name: 'apply_social_publish_subscription_event',
    args: {
      p_event_id: 'evt_publish_test',
      p_type: 'customer.subscription.updated',
      p_publish_subscription_id: ID,
      p_stripe_subscription_id: 'sub_publish_test',
      p_customer_id: 'cus_publish_test',
      p_status: 'active',
      p_period_end: '2026-11-13T12:00:00.000Z',
      p_cancel_at_period_end: false,
      p_occurred_at: new Date(CREATED * 1000).toISOString(),
    },
  });
});

test('an unsigned unknown subscription falls through to the other Stripe products', async () => {
  const response = await handlePublishPlanEvent({
    ...common,
    subscription: subscription({ metadata: {} }),
    rpcCall: async () => ({ ok: false, code: 'SUBSCRIPTION_NOT_FOUND' }),
    cancelSubscriptionNow: async () => ({ ok: true }),
  });
  assert.equal(response, null);
});

test('a second paid Publish subscription is stopped and a failed stop stays retryable', async () => {
  let cancelled;
  const response = await handlePublishPlanEvent({
    ...common,
    subscription: subscription(),
    rpcCall: async () => ({ ok: true, status: 'flagged', flagged: true }),
    cancelSubscriptionNow: async (id) => { cancelled = id; return { ok: true }; },
  });
  assert.equal(response.status, 200);
  assert.equal(cancelled, 'sub_publish_test');

  const retry = await handlePublishPlanEvent({
    ...common,
    subscription: subscription(),
    rpcCall: async () => ({ ok: true, status: 'flagged', flagged: true }),
    cancelSubscriptionNow: async () => ({ ok: false, error: 'stripe_down' }),
  });
  assert.equal(retry.status, 503);
});

test('a refund or dispute ends a bound Publish subscription and unknown charges fall through', async () => {
  let call;
  const response = await handlePublishPlanCharge({
    cfg: common.cfg,
    stripeSubscriptionId: 'sub_publish_test',
    eventId: 'evt_publish_refund',
    type: 'charge.refunded',
    reference: 'ch_publish_test',
    eventCreated: CREATED,
    isYoung: () => true,
    rpcCall: async (name, args) => { call = { name, args }; return { ok: true, frozen: false }; },
  });
  assert.equal(response.status, 200);
  assert.deepEqual([call.name, call.args.p_reason, call.args.p_stripe_subscription_id],
    ['end_social_publish_subscription', 'refunded', 'sub_publish_test']);

  const unknown = await handlePublishPlanCharge({
    cfg: common.cfg,
    stripeSubscriptionId: 'sub_other',
    eventId: 'evt_other_refund',
    type: 'charge.refunded',
    reference: 'ch_other',
    eventCreated: CREATED,
    isYoung: () => true,
    rpcCall: async () => ({ ok: false, code: 'SUBSCRIPTION_NOT_FOUND' }),
  });
  assert.equal(unknown, null);
});
