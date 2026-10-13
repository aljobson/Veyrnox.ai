import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublishPlanCheckout, verifyPublishPlanMetadata } from '../packages/adapters/stripePublishPlan.js';
import { TAX_CODE, STRIPE_CHECKOUT_API_VERSION } from '../packages/adapters/stripe.js';

const id = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const secret = 'whsec_0123456789abcdef0123456789abcdef';

test('Publish checkout charges $15 monthly and signs the session and subscription metadata', async () => {
  let seen;
  const result = await createPublishPlanCheckout({
    subscriptionId: id, planId: 'publish', interval: 'month', priceUsdCents: 1500,
    email: 'owner@example.com', expiresAt: 2_000_000_000,
  }, {
    fetch: async (url, init) => {
      seen = { url, init };
      return Response.json({ object: 'checkout.session', id: 'cs_test_publish', url: 'https://checkout.stripe.com/c/pay/publish' });
    },
    apiKey: 'sk_test_x', publicHost: 'https://veyrnox.ai', signingSecret: secret,
    idempotencyKey: `social_publish:${id}:1`,
  });
  assert.equal(result.ok, true);
  const body = new URLSearchParams(seen.init.body);
  assert.equal(body.get('mode'), 'subscription');
  assert.equal(body.get('line_items[0][price_data][unit_amount]'), '1500');
  assert.equal(body.get('line_items[0][price_data][recurring][interval]'), 'month');
  assert.equal(body.get('line_items[0][price_data][product_data][tax_code]'), TAX_CODE);
  assert.equal(body.get('managed_payments[enabled]'), 'true');
  assert.equal(body.get('metadata[kind]'), 'social_publish_plan');
  assert.equal(body.get('metadata[social_publish_subscription_id]'), id);
  assert.equal(body.get('metadata[social_publish_subscription_sig]'), body.get('subscription_data[metadata][social_publish_subscription_sig]'));
  assert.match(body.get('success_url'), /^https:\/\/veyrnox\.ai\/app\/publish\/plan\?subscription=.*session_id=\{CHECKOUT_SESSION_ID\}$/);
  assert.equal(seen.init.headers['Stripe-Version'], STRIPE_CHECKOUT_API_VERSION);
  assert.equal(seen.init.headers['Idempotency-Key'], `social_publish:${id}:1`);
  assert.equal(await verifyPublishPlanMetadata({
    kind: 'social_publish_plan', social_publish_subscription_id: id,
    social_publish_subscription_sig: body.get('metadata[social_publish_subscription_sig]'),
  }, secret), true);
});

test('Publish checkout rejects client-chosen prices, bad hosts and non-Stripe return URLs', async () => {
  const base = { subscriptionId: id, planId: 'publish', interval: 'month', priceUsdCents: 1500 };
  const cfg = { fetch: async () => Response.json({ object: 'checkout.session', id: 'cs_1', url: 'https://evil.example/pay' }), apiKey: 'sk_test_x', publicHost: 'https://veyrnox.ai', signingSecret: secret };
  assert.equal((await createPublishPlanCheckout({ ...base, priceUsdCents: 1 }, cfg)).ok, false);
  assert.equal((await createPublishPlanCheckout(base, { ...cfg, publicHost: 'http://veyrnox.ai' })).ok, false);
  assert.equal((await createPublishPlanCheckout(base, cfg)).ok, false);
  assert.equal(await verifyPublishPlanMetadata({ kind: 'social_publish_plan', social_publish_subscription_id: id, social_publish_subscription_sig: 'ab'.repeat(32) }, secret), false);
});
