import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreditSubscriptionCheckout, verifyCreditSubscriptionMetadata, creditInvoice } from '../packages/adapters/stripeCreditSubscriptions.js';
import { subscriptionHandler, SUBSCRIPTION_CONSENT_VERSION } from '../lib/subscriptions/api.js';

const ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const AUTH = '1b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const NOW = Math.floor(Date.now() / 1000);
const SECRET = 'whsec_credit_subscription_test';
const cfg = { apiKey: 'sk_test_x', signingSecret: SECRET, publicHost: 'https://veyrnox.test', idempotencyKey: 'checkout_test' };
const binding = { id: ID, plan_id: 'starter-monthly', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', price_usd_cents: 1900, credits: 270 };
const invoice = () => ({ id: 'in_1', object: 'invoice', subscription: 'sub_1', customer: 'cus_1', livemode: false, status: 'paid', currency: 'usd',
  billing_reason: 'subscription_create', amount_paid: 1900, discounts: [], lines: { has_more: false, data: [{ subscription: 'sub_1', quantity: 1,
    amount: 1900, currency: 'usd', proration: false, period: { start: NOW - 60, end: NOW - 60 + 30 * 86400 },
    price: { unit_amount: 1900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } }, discount_amounts: [] }] } });

test('credit checkout signs a separate billing kind into both objects, uses database prices and has no trials or coupons', async () => {
  let fields, init;
  const result = await createCreditSubscriptionCheckout({ subscriptionId: ID, planId: 'starter-monthly', interval: 'month', priceUsdCents: 1900, credits: 270 }, {
    ...cfg, fetch: async (_url, req) => { init = req; fields = new URLSearchParams(req.body); return Response.json({ object: 'checkout.session', id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/x' }); },
  });
  assert.equal(result.ok, true);
  assert.equal(fields.get('line_items[0][price_data][unit_amount]'), '1900');
  assert.equal(fields.get('mode'), 'subscription');
  assert.equal(fields.get('automatic_tax[enabled]'), 'true');
  assert.equal(fields.get('allow_promotion_codes'), 'false');
  assert.equal(init.headers['Idempotency-Key'], 'checkout_test');
  assert.match(fields.get('success_url'), /session_id=\{CHECKOUT_SESSION_ID\}$/);
  const metadata = Object.fromEntries(['kind', 'credit_subscription_id', 'credit_subscription_sig'].map((k) => [k, fields.get(`metadata[${k}]`)]));
  assert.equal(await verifyCreditSubscriptionMetadata(metadata, SECRET), true);
  assert.equal(await verifyCreditSubscriptionMetadata({ ...metadata, credit_subscription_id: AUTH }, SECRET), false);
  assert.equal(await verifyCreditSubscriptionMetadata({ ...metadata, kind: 'cinema_pass' }, SECRET), false);
  for (const [k, v] of Object.entries(metadata)) assert.equal(fields.get(`subscription_data[metadata][${k}]`), v);
  assert.ok(![...fields.keys()].some((k) => /trial|discount/.test(k)));
  const invalid = await createCreditSubscriptionCheckout({ subscriptionId: ID, planId: 'starter-monthly', interval: 'year', priceUsdCents: 1900, credits: 270 }, cfg);
  assert.equal(invalid.ok, false);
});

test('paid invoice validation refuses mismatched customers, prices, modes, currency, proration, annual periods and incomplete line lists', () => {
  assert.equal(creditInvoice(invoice(), binding, false).ok, true);
  for (const change of [i => i.customer = 'cus_other', i => i.subscription = 'sub_other', i => i.amount_paid = 1,
    i => i.livemode = true, i => i.currency = 'eur', i => i.status = 'open', i => i.billing_reason = 'subscription_update',
    i => i.lines.has_more = true, i => i.lines.data.push({}), i => i.lines.data[0].quantity = 2,
    i => i.lines.data[0].amount = 5900, i => i.lines.data[0].price.unit_amount = 5900,
    i => i.lines.data[0].proration = true, i => i.lines.data[0].period.end += 365 * 86400,
    i => i.lines.data[0].discount_amounts = [{ amount: 1 }], i => i.discounts = ['di_1']]) {
    const i = invoice(); change(i); assert.equal(creditInvoice(i, binding, false).ok, false);
  }
  const modern = invoice();
  delete modern.subscription;
  modern.parent = { subscription_details: { subscription: 'sub_1' } };
  const line = modern.lines.data[0]; delete line.subscription; delete line.price;
  line.parent = { subscription_item_details: { subscription: 'sub_1', proration: false } };
  assert.equal(creditInvoice(modern, binding, false).ok, true);
});

const request = (body, auth = AUTH) => new Request('https://veyrnox.test/api/v1/subscriptions', {
  method: body === undefined ? 'GET' : 'POST', headers: { ...(auth ? { 'x-veyrnox-auth-id': auth } : {}), 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const env = () => Object.assign(process.env, { SUBSCRIPTIONS_ENABLED: 'true', STRIPE_SECRET_KEY: cfg.apiKey,
  STRIPE_WEBHOOK_SECRET: SECRET, PUBLIC_HOST: cfg.publicHost, SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test' });

test('authentication and closed flag stop requests before any RPC; read response strips private Stripe ids', async () => {
  env(); let calls = 0;
  const handler = subscriptionHandler({ rpcCall: async (fn) => { calls++; return fn === 'consume_account_read_request' ? { ok: true } : { ok: true, subscription: { ...binding, status: 'active' } }; } });
  assert.equal((await handler(request(undefined, null))).status, 401);
  process.env.SUBSCRIPTIONS_ENABLED = 'false';
  assert.equal((await handler(request())).status, 503); assert.equal(calls, 0);
  process.env.SUBSCRIPTIONS_ENABLED = 'true';
  const response = await handler(request()); assert.equal(response.status, 200);
  const body = await response.json(); assert.ok(!JSON.stringify(body).includes('cus_1')); assert.ok(!JSON.stringify(body).includes('sub_1'));
});

test('checkout uses the RPC snapshot and refuses client prices, absent consent and a second live subscription', async () => {
  env(); let supplied;
  const body = { plan_id: 'starter-monthly', idempotency_key: 'checkout-key-1', consent: true, consent_version: SUBSCRIPTION_CONSENT_VERSION };
  const handler = subscriptionHandler({ action: 'start', rpcCall: async (fn) => fn === 'consume_account_read_request' ? { ok: true }
    : { ok: true, subscription_id: ID, status: 'pending', plan_id: body.plan_id, billing_interval: 'month', price_usd_cents: 1900, credits: 270 },
  checkout: async (input) => { supplied = input; return { ok: true, url: 'https://checkout.stripe.com/test' }; } });
  assert.equal((await handler(request({ ...body, price: 1 }))).status, 400);
  assert.equal((await handler(request({ ...body, consent: false }))).status, 400);
  assert.equal((await handler(request(body))).status, 200);
  assert.deepEqual([supplied.priceUsdCents, supplied.credits, supplied.subscriptionId], [1900, 270, ID]);
  const blocked = subscriptionHandler({ action: 'start', rpcCall: async (fn) => fn === 'consume_account_read_request' ? { ok: true } : { ok: false, code: 'SUBSCRIPTION_ALREADY_ACTIVE' } });
  assert.equal((await blocked(request(body))).status, 409);
});

test('cooling-off credits are removed before money moves; failed eligibility never calls Stripe', async () => {
  env(); const order = [];
  const handler = subscriptionHandler({ action: 'cancel', rpcCall: async (fn) => {
    order.push(fn); if (fn === 'consume_account_read_request') return { ok: true };
    if (fn === 'read_own_credit_subscription_by_id') return { ok: true, subscription: { ...binding, status: 'active' } };
    return { ok: true, stripe_subscription_id: 'sub_1', invoice_id: 'in_1' };
  }, refund: async () => { order.push('refund'); return { ok: true, amountCents: 1900 }; } });
  assert.equal((await handler(request({ mode: 'cooling_off', subscription_id: ID }))).status, 200);
  assert.ok(order.indexOf('cancel_credit_subscription_cooling_off') < order.indexOf('refund'));
  const denied = subscriptionHandler({ action: 'cancel', rpcCall: async (fn) => fn === 'consume_account_read_request' ? { ok: true }
    : fn === 'read_own_credit_subscription_by_id' ? { ok: true, subscription: binding } : { ok: false, code: 'CREDITS_SPENT' },
  refund: async () => { throw new Error('must not refund'); } });
  assert.equal((await denied(request({ mode: 'cooling_off', subscription_id: ID }))).status, 409);
});

test('checkout return checks ownership and recovers a lost invoice with a different event key', async () => {
  env(); const calls = [];
  const metadata = { kind: 'credit_subscription', credit_subscription_id: ID,
    credit_subscription_sig: (await import('node:crypto')).createHmac('sha256', SECRET).update(`credit_subscription:${ID}`).digest('hex') };
  const i = invoice(); i.payment_intent = 'pi_1';
  const handler = subscriptionHandler({ action: 'return', rpcCall: async (fn, args) => {
    calls.push({ fn, args });
    if (fn === 'read_credit_subscription_binding') return binding;
    return { ok: true, status: 'active' };
  }, stripe: {
    fetchSession: async () => ({ ok: true, session: { id: 'cs_1', mode: 'subscription', livemode: false, subscription: 'sub_1', metadata } }),
    fetchSubscription: async () => ({ ok: true, subscription: {} }),
    interpretSubscription: () => ({ ok: true, subscription: { id: 'sub_1', customerId: 'cus_1', status: 'active', latestInvoiceId: 'in_1' } }),
  }, fetcher: async (url) => {
    if (String(url).includes('/invoices/')) return Response.json(i);
    if (String(url).includes('/payment_intents/')) return Response.json({ object: 'payment_intent', id: 'pi_1', livemode: false, status: 'succeeded',
      currency: 'usd', amount_received: 1900, customer: 'cus_1', latest_charge: { object: 'charge', id: 'ch_1', livemode: false, currency: 'usd',
        customer: 'cus_1', payment_intent: 'pi_1', paid: true, captured: true, disputed: false, amount: 1900, amount_refunded: 0 } });
    throw new Error('unexpected fetch');
  } });
  const r = await handler(request({ subscription_id: ID, session_id: 'cs_1' }));
  assert.equal(r.status, 200); assert.equal((await r.json()).credited, true);
  assert.equal(calls.find(c => c.fn === 'apply_credit_subscription_event').args.p_event_id, 'cs_1');
  assert.equal(calls.find(c => c.fn === 'grant_credit_subscription_invoice').args.p_event_id, 'cs_recovery_in_1');
  assert.ok(calls.findIndex(c => c.fn === 'record_credit_subscription_session') < calls.findIndex(c => c.fn === 'apply_credit_subscription_event'));
  calls.length = 0;
  assert.equal((await handler(request({ subscription_id: AUTH, session_id: 'cs_1' }))).status, 409);
  assert.ok(!calls.some(c => c.fn === 'apply_credit_subscription_event'));
});

test('returning to an ended checkout succeeds without reading or granting its refunded invoice', async () => {
  env();
  const metadata = { kind: 'credit_subscription', credit_subscription_id: ID,
    credit_subscription_sig: (await import('node:crypto')).createHmac('sha256', SECRET).update(`credit_subscription:${ID}`).digest('hex') };
  for (const stripeStatus of ['ended', 'active']) {
    const calls = [];
    let denyOwnership = false;
    const handler = subscriptionHandler({ action: 'return', rpcCall: async (fn) => {
      calls.push(fn);
      if (fn === 'record_credit_subscription_session' && denyOwnership) return { ok: false, code: 'SUBSCRIPTION_NOT_FOUND' };
      if (fn === 'apply_credit_subscription_event') return { ok: true, status: 'ended', stale: true };
      return { ok: true, status: 'ended' };
    }, stripe: {
      fetchSession: async () => ({ ok: true, session: { id: 'cs_1', mode: 'subscription', livemode: false, subscription: 'sub_1', metadata } }),
      fetchSubscription: async () => ({ ok: true, subscription: {} }),
      interpretSubscription: () => ({ ok: true, subscription: { id: 'sub_1', customerId: 'cus_1', status: stripeStatus, latestInvoiceId: 'in_1' } }),
    }, fetcher: async () => { assert.fail('ended return must not fetch an invoice, payment or alert'); } });
    const r = await handler(request({ subscription_id: ID, session_id: 'cs_1' }));
    assert.equal(r.status, 200);
    const result = await r.json();
    assert.deepEqual([result.ok, result.recovered, result.status, result.credited], [true, true, 'ended', false]);
    assert.deepEqual(calls, ['consume_account_read_request', 'record_credit_subscription_session', 'apply_credit_subscription_event']);
    assert.equal((await handler(request({ subscription_id: AUTH, session_id: 'cs_1' }))).status, 409,
      'terminal shortcut still requires the signed session to match the requested row');
    calls.length = 0;
    denyOwnership = true;
    assert.equal((await handler(request({ subscription_id: ID, session_id: 'cs_1' }))).status, 404);
    assert.ok(!calls.includes('apply_credit_subscription_event'), 'ownership refusal precedes the terminal shortcut');
  }
});

test('cancellation addresses the explicit owned row, including an ended row whose refund is being retried', async () => {
  env(); let lookedUp;
  const handler = subscriptionHandler({ action: 'cancel', rpcCall: async (fn, args) => {
    if (fn === 'read_own_credit_subscription') throw new Error('must not choose newest subscription');
    if (fn === 'read_own_credit_subscription_by_id') { lookedUp = args.p_id; return { ok: true, subscription: { ...binding, status: 'ended', end_reason: 'cancelled_cooling_off' } }; }
    return { ok: true, stripe_subscription_id: 'sub_1', invoice_id: 'in_1' };
  }, refund: async () => ({ ok: true, amountCents: 1900 }) });
  assert.equal((await handler(request({ subscription_id: ID, mode: 'cooling_off' }))).status, 200);
  assert.equal(lookedUp, ID);
});

test('return recovery stops an owned unbound duplicate after session or subscription mismatch, while preserving durable bindings', async () => {
  env();
  const metadata = { kind: 'credit_subscription', credit_subscription_id: ID,
    credit_subscription_sig: (await import('node:crypto')).createHmac('sha256', SECRET).update(`credit_subscription:${ID}`).digest('hex') };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ id: 'alert' });
  Object.assign(process.env, { RESEND_API_KEY: 'test', SUBSCRIPTION_ALERT_EMAIL: 'ops@example.invalid', VIOLATION_EMAIL_FROM: 'alerts@example.invalid' });
  try {
    for (const failure of ['SESSION_MISMATCH', 'SUBSCRIPTION_MISMATCH']) {
      for (const bound of [false, true]) {
        for (const cancelOk of [false, true]) {
          const cancelled = [];
          const handler = subscriptionHandler({ action: 'return', rpcCall: async fn => {
            if (fn === 'read_credit_subscription_binding') return bound ? binding : null;
            if (fn === 'record_credit_subscription_session' && failure === 'SESSION_MISMATCH') return { ok: false, code: failure };
            if (fn === 'apply_credit_subscription_event') return { ok: false, code: failure };
            return { ok: true };
          }, stripe: {
            fetchSession: async () => ({ ok: true, session: { id: 'cs_1', mode: 'subscription', livemode: false, subscription: 'sub_2', metadata } }),
            fetchSubscription: async () => ({ ok: true, subscription: {} }),
            interpretSubscription: () => ({ ok: true, subscription: { id: 'sub_2', customerId: 'cus_1', status: 'active' } }),
            cancelSubscriptionNow: async id => { cancelled.push(id); return { ok: cancelOk }; },
          } });
          const response = await handler(request({ subscription_id: ID, session_id: 'cs_1' }));
          assert.equal(response.status, bound ? (failure === 'SESSION_MISMATCH' ? 409 : 503) : cancelOk ? 409 : 503);
          assert.deepEqual(cancelled, bound ? [] : ['sub_2']);
        }
      }
    }
  } finally { globalThis.fetch = previousFetch; }
});
