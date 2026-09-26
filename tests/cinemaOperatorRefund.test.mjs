import test from 'node:test';
import assert from 'node:assert/strict';
import { refundFlaggedPass } from '../lib/cinema/operatorRefund.js';
const op = { action_id: '11111111-1111-4111-8111-111111111111', subscription_id: 'sub_1', customer_id: 'cus_1' };
function fixture() {
  const refund = { object: 'refund', id: 're_1', amount: 1299, currency: 'usd', payment_intent: 'pi_1', charge: 'ch_1',
    metadata: { cinema_operator_action_id: op.action_id }, status: 'succeeded' };
  return {
    sub: { object: 'subscription', id: 'sub_1', customer: 'cus_1', livemode: false, status: 'canceled', latest_invoice: 'in_1' },
    invoice: { object: 'invoice', id: 'in_1', customer: 'cus_1', livemode: false, subscription: 'sub_1', status: 'paid',
      currency: 'usd', billing_reason: 'subscription_create', payment_intent: 'pi_1', amount_paid: 1299 },
    pi: { object: 'payment_intent', id: 'pi_1', customer: 'cus_1', currency: 'usd', livemode: false, status: 'succeeded', amount_received: 1299,
      latest_charge: { object: 'charge', id: 'ch_1', customer: 'cus_1', currency: 'usd', livemode: false, payment_intent: 'pi_1',
        paid: true, captured: true, disputed: false, amount: 1299, amount_refunded: 0 } },
    refunds: { object: 'list', has_more: false, data: [] }, refund,
  };
}
function setup(f = fixture(), options = {}) {
  const calls = [];
  const cfg = { apiKey: 'sk_test_fake', fetch: async (url, init = {}) => {
    const path = new URL(url).pathname, method = init.method || 'GET'; calls.push({ url, path, method, init });
    if (options.fail === path) throw Error('private upstream detail');
    let data;
    if (path === '/v1/subscriptions/sub_1') {
      if (method === 'DELETE') { if (!options.cancelStuck) f.sub.status = 'canceled'; }
      data = f.sub;
    } else if (path === '/v1/invoices/in_1') data = f.invoice;
    else if (path === '/v1/payment_intents/pi_1') data = f.pi;
    else if (path === '/v1/refunds') data = method === 'POST' ? f.refund : f.refunds;
    else throw Error(`Unexpected URL ${url}`);
    return Response.json(data);
  } };
  return { calls, run: () => refundFlaggedPass(op, cfg) };
}
test('full original charge including tax is refunded with a stable key and operation metadata', async () => {
  const s = setup(); assert.deepEqual(await s.run(), { ok: true, refundId: 're_1', amountCents: 1299 });
  const post = s.calls.find(c => c.method === 'POST');
  assert.equal(new URLSearchParams(post.init.body).get('amount'), '1299');
  assert.equal(new URLSearchParams(post.init.body).get('metadata[cinema_operator_action_id]'), op.action_id);
  assert.equal(post.init.headers['Idempotency-Key'], `cinema_flagged_refund:${op.action_id}`);
});
test('cancel before refund and re-read final subscription; failed cancellation cannot refund', async () => {
  const f = fixture(); f.sub.status = 'active'; const s = setup(f);
  assert.equal((await s.run()).ok, true);
  assert.ok(s.calls.findIndex(c => c.method === 'DELETE') < s.calls.findIndex(c => c.method === 'POST'));
  const stuck = fixture(); stuck.sub.status = 'active'; const failure = setup(stuck, { cancelStuck: true });
  assert.deepEqual(await failure.run(), { error: 'cancel_failed' }); assert.ok(!failure.calls.some(c => c.method === 'POST'));
});
test('lost response/receipt and expired Stripe keys recover the existing refund without another POST', async () => {
  for (const status of ['succeeded', 'pending', 'requires_action', 'failed', 'canceled']) {
    const f = fixture(); f.refund.status = status; f.refunds.data = [f.refund]; f.pi.latest_charge.amount_refunded = 1299;
    const s = setup(f); const result = await s.run();
    assert.deepEqual(result, status === 'succeeded' ? { ok: true, refundId: 're_1', amountCents: 1299 }
      : ['pending', 'requires_action'].includes(status) ? { pending: true } : { error: 'refund_failed' });
    assert.ok(!s.calls.some(c => c.method === 'POST'));
  }
});
test('pending creation does not claim money has returned', async () => {
  const f = fixture(); f.refund.status = 'pending'; assert.deepEqual(await setup(f).run(), { pending: true });
});
test('wrong identity, mode, invoice, currency, payment, dispute or prior manual refunds fail closed', async () => {
  const mutations = [
    f => { f.sub.customer = 'cus_other'; }, f => { f.sub.livemode = true; }, f => { f.invoice.subscription = 'sub_other'; },
    f => { f.invoice.livemode = true; }, f => { f.invoice.billing_reason = 'subscription_cycle'; }, f => { f.invoice.customer = 'cus_other'; },
    f => { f.invoice.currency = 'eur'; }, f => { f.invoice.status = 'open'; }, f => { f.invoice.amount_paid = 0; },
    f => { f.invoice.payments = { has_more: true, data: [] }; }, f => { f.pi.customer = 'cus_other'; },
    f => { f.pi.latest_charge.payment_intent = 'pi_other'; }, f => { f.pi.latest_charge.disputed = true; },
    f => { f.pi.latest_charge.amount = 999; }, f => { f.pi.latest_charge.amount_refunded = 10; },
    f => { f.refunds.has_more = true; }, f => { f.refunds.data = [{ ...f.refund, metadata: {} }]; },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); const s = setup(f);
    assert.deepEqual(await s.run(), { error: 'refund_review_required' }, String(mutate)); assert.ok(!s.calls.some(c => c.method === 'POST')); }
});
test('modern invoice shape is supported; mismatched receipt and provider errors are not success', async () => {
  const f = fixture(); delete f.invoice.subscription; delete f.invoice.payment_intent;
  f.invoice.parent = { subscription_details: { subscription: 'sub_1' } };
  f.invoice.payments = { has_more: false, data: [{ payment: { payment_intent: 'pi_1' } }] };
  assert.equal((await setup(f).run()).ok, true);
  f.refund.charge = 'ch_other'; assert.deepEqual(await setup(f).run(), { error: 'refund_review_required' });
  assert.deepEqual(await setup(fixture(), { fail: '/v1/refunds' }).run(), { error: 'stripe_unavailable' });
});
