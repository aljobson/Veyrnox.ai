import test from 'node:test';
import assert from 'node:assert/strict';
import {
  subscriptionCheckoutUrl,
  subscriptionReturnFrom,
} from '../app/veyrnox/_lib/creditSubscriptionUi.js';
const id = '11111111-1111-4111-8111-111111111111';
test('subscription checkout rejects lookalike origins, credentials and insecure redirects', () => {
  assert.equal(
    subscriptionCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test'),
    'https://checkout.stripe.com/c/pay/cs_test',
  );
  for (const url of [
    'https://stripe.com.evil.invalid/path',
    'https://evilstripe.com/path',
    'http://checkout.stripe.com/path',
    'https://user:password@checkout.stripe.com/path',
    'javascript:alert(1)',
    null,
  ])
    assert.equal(subscriptionCheckoutUrl(url), null);
});
test('subscription return captures one explicit owned-record identifier and session; ambiguous or forged query values are rejected', () => {
  const read = (q) =>
    subscriptionReturnFrom(new URL(`https://test.invalid/app/credits?${q}`));
  assert.deepEqual(
    read(`subscription=${id}&checkout=done&session_id=cs_test_valid`),
    { subscription_id: id, session_id: 'cs_test_valid' },
  );
  assert.deepEqual(read(`subscription=${id}&checkout=cancelled`), {
    subscription_id: id,
    cancelled: true,
  });
  for (const q of [
    `subscription=${id}&subscription=${id}&checkout=done&session_id=cs_x`,
    `subscription=${id}&checkout=done&session_id=cs_x&session_id=cs_y`,
    `subscription=${id}&checkout=done&session_id=invalid`,
    `subscription=bad&checkout=done&session_id=cs_x`,
    `subscription=${id}&checkout=other&session_id=cs_x`,
  ])
    assert.equal(read(q), null);
});
