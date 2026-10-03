import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
const { POST } = await import('../app/api/webhook/stripe/route.js');
const ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const SECRET = 'whsec_credit_subscription_test';
const NOW = Math.floor(Date.now() / 1000);
const metadata = { kind: 'credit_subscription', credit_subscription_id: ID,
  credit_subscription_sig: createHmac('sha256', SECRET).update(`credit_subscription:${ID}`).digest('hex') };
const binding = { id: ID, plan_id: 'starter-monthly', status: 'active', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', price_usd_cents: 1900, credits: 270 };
const sub = (m = metadata) => ({ object: 'subscription', id: 'sub_1', customer: 'cus_1', status: 'active', livemode: false,
  current_period_start: NOW - 60, current_period_end: NOW - 60 + 30 * 86400, metadata: m });
const inv = () => ({ id: 'in_1', object: 'invoice', subscription: 'sub_1', customer: 'cus_1', livemode: false,
  status: 'paid', currency: 'usd', billing_reason: 'subscription_create', amount_paid: 1900, payment_intent: 'pi_1', discounts: [],
  lines: { has_more: false, data: [{ subscription: 'sub_1', quantity: 1, amount: 1900, currency: 'usd',
    period: { start: NOW - 60, end: NOW - 60 + 30 * 86400 }, proration: false }] } });
function event(type, object, created = NOW, id = 'evt_credit_test') {
  const body = JSON.stringify({ id, type, livemode: false, created, data: { object } });
  return new Request('https://veyrnox.test/api/webhook/stripe', { method: 'POST', body,
    headers: { 'stripe-signature': `t=${NOW},v1=${createHmac('sha256', SECRET).update(`${NOW}.${body}`).digest('hex')}` } });
}
function stub({ bound = binding, subscription = sub(), invoice = inv(), grant = { ok: true, granted: 270 },
  reverse = { ok: true, taken: 270 }, cancelFails = false, alertFails = false, duplicate = false, missingBinding = false, refunded = 0, modernCharge = false } = {}) {
  Object.assign(process.env, { SUBSCRIPTIONS_ENABLED: 'true', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test',
    STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: 'resend_test',
    SUBSCRIPTION_ALERT_EMAIL: 'ops@example.invalid', VIOLATION_EMAIL_FROM: 'alerts@example.invalid' });
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), method = init.method || 'GET';
    const body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body });
    if (u.includes('webhook_events?on_conflict')) return Response.json(duplicate ? [] : [{ id: 'e1' }], { status: 201 });
    if (u.includes('webhook_events')) return Response.json(method === 'GET' ? [{ processed_at: 'done' }] : []);
    if (u.includes('read_credit_subscription_binding')) return missingBinding ? Response.json({ code: 'PGRST202' }, { status: 404 }) : Response.json(bound);
    if (u.includes('apply_credit_subscription_event')) return Response.json({ ok: true, status: 'active', subscription_id: ID });
    if (u.includes('grant_credit_subscription_invoice')) return Response.json(grant);
    if (u.includes('reverse_credit_subscription_invoice')) return Response.json(reverse);
    if (u.includes('apply_top_up_refund')) return Response.json({ ok: false, code: 'ORDER_NOT_FOUND' });
    if (u.includes('invoice_payments?')) return Response.json({ object: 'list', has_more: false, data: [{ object: 'invoice_payment', invoice: 'in_1', livemode: false, payment: { type: 'payment_intent', payment_intent: 'pi_1' } }] });
    if (u.includes('apply_dispute_event')) return Response.json({ ok: false, code: 'TOP_UP_NOT_FOUND' });
    if (u.includes('subscriptions/sub_1')) return method === 'DELETE' ? (cancelFails ? Response.json({}, { status: 500 }) : Response.json({ object: 'subscription' })) : Response.json(subscription);
    if (u.includes('invoices/in_1')) return Response.json(invoice);
    if (u.includes('payment_intents/pi_1')) return Response.json({ object: 'payment_intent', id: 'pi_1', livemode: false,
      status: 'succeeded', currency: 'usd', amount_received: 1900, customer: 'cus_1', latest_charge: {
        object: 'charge', id: 'ch_1', livemode: false, currency: 'usd', customer: 'cus_1', payment_intent: 'pi_1',
        paid: true, captured: true, disputed: false, amount: 1900, amount_refunded: refunded } });
    if (u.includes('charges/ch_1')) return Response.json({ object: 'charge', id: 'ch_1', customer: 'cus_1', ...(modernCharge ? {} : { invoice: 'in_1' }), payment_intent: 'pi_1', livemode: false, currency: 'usd', amount: 1900, amount_refunded: 1900 });
    if (u.includes('checkout/sessions/cs_1')) return Response.json({ id: 'cs_1', object: 'checkout.session', mode: 'subscription', livemode: false, subscription: 'sub_1', metadata });
    if (u.includes('api.resend.com')) return alertFails ? Response.json({}, { status: 500 }) : Response.json({ id: 'mail1' });
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
  return calls;
}
const processed = (calls) => calls.some((c) => c.method === 'PATCH' && c.url.includes('webhook_events'));

test('invoice.paid grants once through its own event id and never feeds the state RPC', async () => {
  const calls = stub();
  assert.equal((await POST(event('invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' }))).status, 200);
  assert.ok(!calls.some((c) => c.url.includes('apply_credit_subscription_event')));
  assert.ok(!calls.some((c) => c.url.includes('cinema_pass')));
  const grant = calls.find((c) => c.url.includes('grant_credit_subscription_invoice')).body;
  assert.equal(grant.p_event_id, 'evt_credit_test'); assert.equal(grant.p_paid_cents, 1900);
  assert.equal(grant.p_period_end, new Date((NOW - 60 + 30 * 86400) * 1000).toISOString());
  assert.ok(processed(calls));
  const dup = stub({ duplicate: true });
  assert.equal((await POST(event('invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' }))).status, 200);
  assert.ok(!dup.some((c) => c.url.includes('/rpc/') || c.url.includes('api.stripe.com')));
});

test('an invoice ahead of binding or activation stays unprocessed for retry; an old orphan alerts the operator', async () => {
  const calls = stub({ bound: null });
  assert.equal((await POST(event('invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' }))).status, 503);
  assert.ok(!processed(calls)); assert.ok(!calls.some((c) => c.url.includes('grant_credit')));
  const pending = stub({ grant: { ok: false, code: 'SUBSCRIPTION_NOT_READY' } });
  assert.equal((await POST(event('invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' }))).status, 503);
  assert.ok(!processed(pending));
  const old = stub({ bound: null });
  assert.equal((await POST(event('invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' }, NOW - 7200))).status, 200);
  assert.ok(old.some((c) => c.url.includes('api.resend.com')));
});

test('every refused paid invoice requires an operator alert; failed delivery prevents acknowledgement', async () => {
  const calls = stub({ grant: { ok: false, refused: true, code: 'PERIOD_NOT_NEWER' } });
  assert.equal((await POST(event('invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' }))).status, 200);
  assert.ok(calls.some((c) => c.url.includes('api.resend.com')));
  const failed = stub({ grant: { ok: false, refused: true, idempotent: true, code: 'PERIOD_NOT_NEWER' }, alertFails: true });
  assert.equal((await POST(event('invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' }))).status, 503);
  assert.ok(!processed(failed));
});

test('an underpaid invoice is alerted without granting; a durable binding survives removed metadata', async () => {
  const low = inv(); low.amount_paid = 1;
  const calls = stub({ invoice: low });
  assert.equal((await POST(event('invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' }))).status, 200);
  assert.ok(!calls.some((c) => c.url.includes('grant_credit')));
  const stripped = stub({ subscription: sub({}) });
  assert.equal((await POST(event('invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' }))).status, 200);
  assert.ok(stripped.some((c) => c.url.includes('grant_credit')));
});

test('checkout binds status but never grants from a checkout event', async () => {
  const calls = stub({ bound: null });
  assert.equal((await POST(event('checkout.session.completed', { id: 'cs_1', object: 'checkout.session', metadata }))).status, 200);
  assert.equal(calls.find((c) => c.url.includes('apply_credit_subscription_event')).body.p_id, ID);
  assert.ok(!calls.some((c) => c.url.includes('grant_credit') || c.url.includes('credit_top_up')));
});

test('closing checkout leaves existing subscription settlement enabled', async () => {
  const calls = stub(); process.env.SUBSCRIPTIONS_ENABLED = 'false';
  assert.equal((await POST(event('invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' }))).status, 200);
  assert.ok(calls.some(c => c.url.includes('grant_credit_subscription_invoice')));
});

test('a charge already refunded never grants, and a reversal before binding retries', async () => {
  const refunded = stub({ refunded: 1900 });
  assert.equal((await POST(event('invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' }))).status, 200);
  assert.ok(!refunded.some((c) => c.url.includes('grant_credit')));
  const early = stub({ bound: null });
  assert.equal((await POST(event('charge.refunded', { id: 'ch_1', object: 'charge', invoice: 'in_1' }))).status, 503);
  assert.ok(!processed(early)); assert.ok(!early.some((c) => c.url.includes('end_cinema_pass')));
});

test('full refunds and disputes reverse only the invoice and stop billing; cancellation failures retry without processing', async () => {
  const calls = stub();
  assert.equal((await POST(event('charge.refunded', { id: 'ch_1', object: 'charge', invoice: 'in_1', amount: 1900, amount_refunded: 1900 }))).status, 200);
  const reversal = calls.find((c) => c.url.includes('reverse_credit_subscription_invoice')).body;
  assert.deepEqual([reversal.p_invoice_id, reversal.p_reason], ['in_1', 'refunded']);
  assert.ok(calls.some((c) => c.method === 'DELETE'));
  const failed = stub({ cancelFails: true });
  assert.equal((await POST(event('charge.dispute.created', { id: 'du_1', charge: 'ch_1', payment_intent: 'pi_1' }))).status, 503);
  assert.equal(failed.find((c) => c.url.includes('reverse_credit_subscription_invoice')).body.p_reason, 'disputed');
  assert.ok(!processed(failed));
});

test('replaying a partial-refund event after a later full refund retains its original audit-only classification', async () => {
  const calls = stub({ reverse: { ok: true, idempotent: true } });
  assert.equal((await POST(event('charge.refunded', { id: 'ch_1', object: 'charge', invoice: { id: 'in_1' }, amount: 1900, amount_refunded: 100 }))).status, 200);
  assert.equal(calls.find(c => c.url.includes('reverse_credit_subscription_invoice')).body.p_reason, 'partially_refunded');
  assert.ok(!calls.some(c => c.method === 'DELETE'));
  assert.ok(calls.some(c => c.url.includes('api.resend.com')));
});

test('modern charges find their subscription invoice through Invoice Payments for refunds and disputes', async () => {
  const refund = stub({ modernCharge: true });
  assert.equal((await POST(event('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_1', amount: 1900, amount_refunded: 1900 }))).status, 200);
  assert.ok(refund.some(c => c.url.includes('invoice_payments?')));
  assert.equal(refund.find(c => c.url.includes('reverse_credit_subscription_invoice')).body.p_reason, 'refunded');
  const dispute = stub({ modernCharge: true });
  assert.equal((await POST(event('charge.dispute.created', { id: 'du_1', charge: 'ch_1', payment_intent: 'pi_1' }))).status, 200);
  assert.equal(dispute.find(c => c.url.includes('reverse_credit_subscription_invoice')).body.p_reason, 'disputed');
});
