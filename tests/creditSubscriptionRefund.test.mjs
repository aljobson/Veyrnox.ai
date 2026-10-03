import test from 'node:test';
import assert from 'node:assert/strict';
import { finishCoolingOffRefund } from '../lib/subscriptions/refund.js';
const subscription = { id: '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1' };
function fixture() {
  const refund = { object: 'refund', id: 're_1', amount: 2090, currency: 'usd', payment_intent: 'pi_1', charge: 'ch_1',
    metadata: { credit_subscription_id: subscription.id, invoice_id: 'in_1' }, status: 'succeeded' };
  return {
    sub: { object: 'subscription', id: 'sub_1', customer: 'cus_1', livemode: false, status: 'canceled' },
    invoice: { object: 'invoice', id: 'in_1', customer: 'cus_1', livemode: false, subscription: 'sub_1', status: 'paid',
      currency: 'usd', billing_reason: 'subscription_create', payment_intent: 'pi_1', amount_paid: 2090 },
    pi: { object: 'payment_intent', id: 'pi_1', customer: 'cus_1', currency: 'usd', livemode: false, status: 'succeeded', amount_received: 2090,
      latest_charge: { object: 'charge', id: 'ch_1', customer: 'cus_1', currency: 'usd', livemode: false, payment_intent: 'pi_1',
        paid: true, captured: true, disputed: false, amount: 2090, amount_refunded: 0 } },
    refunds: { object: 'list', has_more: false, data: [] }, refund,
  };
}
function setup(f = fixture(), options = {}) {
  const calls = [];
  const cfg = { apiKey: 'sk_test_fake', fetch: async (url, init = {}) => {
    const path = new URL(url).pathname, method = init.method || 'GET'; calls.push({ path, method, init });
    if (options.fail === path) return Response.json({}, { status: 500 });
    let data;
    if (path === '/v1/subscriptions/sub_1') data = f.sub;
    else if (path === '/v1/invoices/in_1') data = f.invoice;
    else if (path === '/v1/payment_intents/pi_1') data = f.pi;
    else if (path === '/v1/refunds') data = method === 'POST' ? f.refund : f.refunds;
    else throw Error(`Unexpected URL ${url}`);
    return Response.json(data);
  } };
  return { calls, run: () => finishCoolingOffRefund({ subscription, invoiceId: 'in_1' }, cfg) };
}
test('cooling-off refunds the original charge including tax, with stable metadata, after cancellation', async () => {
  const s = setup(); assert.deepEqual(await s.run(), { ok: true, refundId: 're_1', amountCents: 2090 });
  assert.ok(s.calls.findIndex(c => c.method === 'DELETE') < s.calls.findIndex(c => c.method === 'POST'));
  const post = s.calls.find(c => c.method === 'POST');
  assert.equal(new URLSearchParams(post.init.body).get('amount'), '2090');
  assert.equal(post.init.headers['Idempotency-Key'], `credit_subscription_refund:${subscription.id}:in_1`);
});
test('lost receipts and expired Stripe keys recover the existing tagged refund without another POST', async () => {
  for (const status of ['succeeded', 'pending', 'requires_action', 'failed', 'canceled']) {
    const f = fixture(); f.refund.status = status; f.refunds.data = [f.refund]; f.pi.latest_charge.amount_refunded = 2090;
    const s = setup(f), r = await s.run();
    assert.equal(r.ok, ['succeeded', 'pending', 'requires_action'].includes(status));
    if (status === 'pending' || status === 'requires_action') assert.equal(r.pending, true);
    assert.ok(!s.calls.some(c => c.method === 'POST'));
  }
});
test('mismatched ownership, disputed charges, multiple payments, manual refunds and uncancelled subscriptions never refund', async () => {
  const changes = [f => f.invoice.subscription = 'sub_other', f => f.invoice.customer = 'cus_other',
    f => f.invoice.livemode = true, f => f.invoice.currency = 'eur', f => f.pi.latest_charge.disputed = true,
    f => f.pi.latest_charge.customer = 'cus_other', f => f.pi.amount_received = 1,
    f => f.invoice.payments = { has_more: true }, f => f.pi.latest_charge.amount_refunded = 1,
    f => f.refunds.data = [{ ...f.refund, metadata: {} }], f => f.sub.status = 'active',
    f => f.sub.customer = 'cus_other', f => f.refunds.has_more = true];
  for (const change of changes) {
    const f = fixture(); change(f); const s = setup(f);
    assert.equal((await s.run()).ok, false, String(change)); assert.ok(!s.calls.some(c => c.method === 'POST'));
  }
  const down = setup(fixture(), { fail: '/v1/subscriptions/sub_1' });
  assert.equal((await down.run()).error, 'cancel_failed'); assert.ok(!down.calls.some(c => c.method === 'POST'));
});
