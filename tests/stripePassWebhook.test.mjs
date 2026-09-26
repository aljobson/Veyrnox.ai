import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const SECRET = 'whsec_0123456789abcdef0123456789abcdef';
Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
  STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET, PUBLIC_HOST: 'https://veyrnox.test',
});
const { createPassCheckout } = await import('../packages/adapters/stripe.js');
const stripeWebhook = await import('../app/api/webhook/stripe/route.js');

const PASS_ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const NOW = Math.floor(Date.now() / 1000);

function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : undefined });
    for (const [needle, reply] of routes) if (u.includes(needle)) return typeof reply === 'function' ? reply(u, init) : Response.json(reply);
    throw new Error(`unexpected fetch ${u}`);
  };
  return calls;
}

// The subscription metadata a real Pass checkout of ours produces.
const passMetadata = await (async () => {
  let body;
  globalThis.fetch = async (_u, init) => { body = new URLSearchParams(init.body); return Response.json({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/x', object: 'checkout.session' }); };
  const r = await createPassCheckout({ passId: PASS_ID, planId: 'pass-weekly', interval: 'week', priceUsdCents: 1499 }, { fetch: globalThis.fetch, apiKey: 'sk_test_x', publicHost: 'https://veyrnox.test', signingSecret: SECRET });
  assert.equal(r.ok, true);
  return { cinema_pass_id: body.get('subscription_data[metadata][cinema_pass_id]'), cinema_pass_sig: body.get('subscription_data[metadata][cinema_pass_sig]') };
})();

function signed(event) {
  const body = JSON.stringify(event);
  const t = NOW;
  const v1 = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  return new Request('https://veyrnox.test/api/webhook/stripe', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${v1}`, 'content-type': 'application/json' }, body });
}
const event = (id, type, object, created = NOW) => ({ id, type, livemode: false, created, data: { object } });
const subscription = (metadata = passMetadata, over = {}) => ({
  id: 'sub_1', object: 'subscription', livemode: false, status: 'active', customer: 'cus_1', latest_invoice: 'in_1',
  cancel_at_period_end: false, items: { data: [{ current_period_start: NOW - 86400, current_period_end: NOW + 6 * 86400 }] }, metadata, ...over,
});
const routes = ({ sub = subscription(), apply = { ok: true, status: 'active', pass_id: PASS_ID }, end = { ok: true, pass_id: PASS_ID, user_id: 'u1', frozen: false }, duplicate = false } = {}) => [
  ['/rest/v1/webhook_events?on_conflict', () => (duplicate ? Response.json([]) : new Response('[{"id":"e1"}]', { status: 201 }))],
  ['/rest/v1/webhook_events', (u, init) => (init.method === 'PATCH' ? new Response(null, { status: 204 }) : Response.json([{ processed_at: '2026-09-26T00:00:00Z' }]))],
  ['api.stripe.com/v1/subscriptions/sub_1', sub],
  ['api.stripe.com/v1/invoices/in_1', { id: 'in_1', object: 'invoice', subscription: 'sub_1' }],
  ['api.stripe.com/v1/charges/ch_1', { id: 'ch_1', object: 'charge', invoice: 'in_1' }],
  ['/rpc/apply_cinema_pass_event', apply],
  ['/rpc/end_cinema_pass', end],
  ['/rpc/apply_top_up_refund', { ok: false, code: 'ORDER_NOT_FOUND' }],
  ['/rpc/apply_dispute_event', { ok: false, code: 'TOP_UP_NOT_FOUND' }],
];

test('a subscription event is re-read from Stripe and applied with the signed pass id', async () => {
  const calls = stubFetch(routes());
  const res = await stripeWebhook.POST(signed(event('evt_s1', 'customer.subscription.updated', { id: 'sub_1', object: 'subscription', status: 'past_due' })));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const applied = calls.find((c) => c.url.includes('/rpc/apply_cinema_pass_event')).body;
  assert.deepEqual([applied.p_event_id, applied.p_type, applied.p_pass_id, applied.p_subscription_id, applied.p_customer_id, applied.p_status, applied.p_cancel_at_period_end],
    ['evt_s1', 'customer.subscription.updated', PASS_ID, 'sub_1', 'cus_1', 'active', false]);
  assert.equal(applied.p_period_end, new Date((NOW + 6 * 86400) * 1000).toISOString(), 'period from the re-read, not the body');
  assert.equal(applied.p_occurred_at, new Date(NOW * 1000).toISOString());
  assert.ok(calls.some((c) => c.method === 'PATCH' && c.url.includes('webhook_events')), 'marked processed');
});

test('an invoice event finds its subscription; an unsigned unknown subscription is not ours', async () => {
  const calls = stubFetch(routes());
  const res = await stripeWebhook.POST(signed(event('evt_i1', 'invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' })));
  assert.equal(res.status, 200);
  assert.equal(calls.find((c) => c.url.includes('/rpc/apply_cinema_pass_event')).body.p_pass_id, PASS_ID);

  const unsigned = stubFetch(routes({ sub: subscription({}), apply: { ok: false, code: 'PASS_NOT_FOUND' } }));
  const r = await stripeWebhook.POST(signed(event('evt_s2', 'customer.subscription.created', { id: 'sub_1', object: 'subscription' })));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(unsigned.find((c) => c.url.includes('/rpc/apply_cinema_pass_event')).body.p_pass_id, null, 'no pass id without our signature');
  assert.ok(unsigned.some((c) => c.method === 'PATCH' && c.url.includes('webhook_events')), 'processed, never retried');

  const forged = stubFetch(routes({ sub: subscription({ ...passMetadata, cinema_pass_sig: 'ab'.repeat(32) }) }));
  await stripeWebhook.POST(signed(event('evt_s3', 'customer.subscription.created', { id: 'sub_1', object: 'subscription' })));
  assert.equal(forged.find((c) => c.url.includes('/rpc/apply_cinema_pass_event')).body.p_pass_id, null);
});

test('a signed subscription whose Pass is not bound yet is retried while young, then given up', async () => {
  stubFetch(routes({ apply: { ok: false, code: 'PASS_NOT_FOUND' } }));
  const young = await stripeWebhook.POST(signed(event('evt_y', 'customer.subscription.created', { id: 'sub_1', object: 'subscription' })));
  assert.equal(young.status, 503);
  const old = stubFetch(routes({ apply: { ok: false, code: 'PASS_NOT_FOUND' } }));
  const res = await stripeWebhook.POST(signed(event('evt_o', 'customer.subscription.created', { id: 'sub_1', object: 'subscription' }, NOW - 7200)));
  assert.equal(res.status, 200);
  assert.ok(old.some((c) => c.method === 'PATCH' && c.url.includes('webhook_events')));
  stubFetch(routes({ apply: { nonsense: true } }));
  assert.equal((await stripeWebhook.POST(signed(event('evt_n', 'invoice.payment_failed', { id: 'in_1', object: 'invoice', subscription: 'sub_1' })))).status, 500);
  stubFetch([...routes().filter(([n]) => !n.includes('subscriptions')), ['api.stripe.com/v1/subscriptions/sub_1', () => new Response('{}', { status: 500 })]]);
  assert.equal((await stripeWebhook.POST(signed(event('evt_f', 'customer.subscription.updated', { id: 'sub_1', object: 'subscription' })))).status, 503);
});

test('a second Pass paid while one is live is cancelled at Stripe, and the cancel is retried with the event', async () => {
  const flagged = stubFetch(routes({ apply: { ok: true, status: 'flagged', flagged: true, pass_id: PASS_ID } }));
  const res = await stripeWebhook.POST(signed(event('evt_fl', 'invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' })));
  assert.equal(res.status, 200);
  assert.ok(flagged.some((c) => c.method === 'DELETE' && c.url.endsWith('/v1/subscriptions/sub_1')), 'billing stopped at Stripe');
  assert.ok(flagged.some((c) => c.method === 'PATCH' && c.url.includes('webhook_events')));
  const cancelFails = stubFetch([...routes({ apply: { ok: true, idempotent: true, status: 'flagged', flagged: true, pass_id: PASS_ID } }).filter(([n]) => !n.includes('subscriptions')),
    ['api.stripe.com/v1/subscriptions/sub_1', (u, init) => (init.method === 'DELETE' ? new Response('{"error":{"message":"down"}}', { status: 500 }) : Response.json(subscription()))]]);
  const r = await stripeWebhook.POST(signed(event('evt_fl', 'invoice.paid', { id: 'in_1', object: 'invoice', subscription: 'sub_1' })));
  assert.equal(r.status, 503);
  assert.ok(!cancelFails.some((c) => c.method === 'PATCH' && c.url.includes('webhook_events')), 'a replay attempts the cancel again');
});

test('a refund on a subscription invoice ends the Pass; a dispute ends it and Freezes; Top-up charges are untouched', async () => {
  const refund = stubFetch(routes());
  const r = await stripeWebhook.POST(signed(event('evt_r1', 'charge.refunded', { id: 'ch_1', object: 'charge', invoice: 'in_1', payment_intent: 'pi_1', amount: 1499, amount_refunded: 1499 })));
  assert.equal(r.status, 200);
  const ended = refund.find((c) => c.url.includes('/rpc/end_cinema_pass')).body;
  assert.deepEqual([ended.p_subscription_id, ended.p_event_id, ended.p_reason, ended.p_reference], ['sub_1', 'evt_r1', 'refunded', 'ch_1']);
  assert.ok(!refund.some((c) => c.url.includes('/rpc/apply_top_up_refund')), 'not a Top-up');

  const dispute = stubFetch(routes({ end: { ok: true, pass_id: PASS_ID, user_id: 'u1', frozen: true } }));
  const d = await stripeWebhook.POST(signed(event('evt_d1', 'charge.dispute.created', { id: 'du_1', object: 'dispute', charge: 'ch_1', payment_intent: 'pi_1', status: 'needs_response' })));
  assert.equal(d.status, 200);
  assert.equal(dispute.find((c) => c.url.includes('/rpc/end_cinema_pass')).body.p_reason, 'disputed');
  // The Top-up path runs first and needs no Stripe call; only an unclaimed charge is re-read.
  const order = dispute.map((c) => c.url).filter((u) => u.includes('/rpc/apply_dispute_event') || u.includes('/v1/charges/ch_1') || u.includes('/rpc/end_cinema_pass'));
  assert.equal(order.length, 3);
  assert.ok(order[0].includes('apply_dispute_event') && order[1].includes('charges/ch_1') && order[2].includes('end_cinema_pass'));
  const chargeDown = stubFetch([...routes().filter(([n]) => !n.includes('charges')), ['api.stripe.com/v1/charges/ch_1', () => new Response('{}', { status: 500 })]]);
  assert.equal((await stripeWebhook.POST(signed(event('evt_d3', 'charge.dispute.created', { id: 'du_3', object: 'dispute', charge: 'ch_1', payment_intent: 'pi_1' })))).status, 500);
  assert.ok(!chargeDown.some((c2) => c2.method === 'PATCH' && c2.url.includes('webhook_events')), 'left for retry');

  const closed = stubFetch(routes());
  const c = await stripeWebhook.POST(signed(event('evt_d2', 'charge.dispute.closed', { id: 'du_1', object: 'dispute', charge: 'ch_1', payment_intent: 'pi_1', status: 'won' })));
  assert.equal(c.status, 200);
  assert.ok(!closed.some((c2) => c2.url.includes('/rpc/')));

  // A charge without an invoice is a Top-up charge and takes the old path.
  const topUp = stubFetch([...routes(), ['api.stripe.com/v1/charges/ch_2', { id: 'ch_2', object: 'charge', invoice: null }]]);
  await stripeWebhook.POST(signed(event('evt_t1', 'charge.dispute.created', { id: 'du_2', object: 'dispute', charge: 'ch_2', payment_intent: 'pi_2', status: 'needs_response' })));
  assert.ok(topUp.some((c2) => c2.url.includes('/rpc/apply_dispute_event')));
  assert.ok(!topUp.some((c2) => c2.url.includes('/rpc/end_cinema_pass')));

  const dup = stubFetch(routes({ duplicate: true }));
  const dd = await stripeWebhook.POST(signed(event('evt_s1', 'customer.subscription.updated', { id: 'sub_1', object: 'subscription' })));
  assert.deepEqual(await dd.json(), { ok: true, duplicate: true });
  assert.ok(!dup.some((c2) => c2.url.includes('/rpc/') || c2.url.includes('api.stripe.com')));
});
