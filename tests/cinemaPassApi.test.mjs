import test from 'node:test';
import assert from 'node:assert/strict';
import { passHandler, passProjection, coolingOffRefundCents, PASS_CONSENT_VERSION, COOLING_OFF_DAYS } from '../lib/cinema/passApi.js';

const id = '11111111-1111-4111-8111-111111111111';
const PASS = '22222222-2222-4222-8222-222222222222';
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const DAY = 86_400_000;
Object.assign(process.env, {
  CINEMA_ENABLED: 'true', CINEMA_SUBSCRIPTIONS_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_0123456789abcdef0123456789abcdef', PUBLIC_HOST: 'https://veyrnox.test',
});
const post = (path, value, headers = {}) => new Request(`https://test.invalid/api/v1/cinema/pass${path}`, {
  method: 'POST', headers: { 'x-veyrnox-auth-id': id, 'content-type': 'application/json', ...headers }, body: typeof value === 'string' ? value : JSON.stringify(value),
});
const get = (path, headers = {}) => new Request(`https://test.invalid/api/v1/cinema/pass${path}`, { headers: { 'x-veyrnox-auth-id': id, ...headers } });
const startBody = { plan_id: 'pass-weekly', idempotency_key: 'vx-key-0001', consent: true, consent_version: PASS_CONSENT_VERSION };
const livePass = (over = {}) => ({ id: PASS, plan_id: 'pass-weekly', status: 'active', price_usd_cents: 1499, intro_price_usd_cents: 1199, current_period_end: new Date(NOW + 5 * DAY).toISOString(), cancel_at_period_end: false, started_at: new Date(NOW - 2 * DAY).toISOString(), stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', ...over });

function setup(action, { rpc = {}, stripe = {} } = {}) {
  const calls = [], stripeCalls = [];
  const wrap = (name, impl) => async (...args) => { stripeCalls.push({ name, args }); return impl(...args); };
  const stripeApi = {
    ensureIntroCoupon: wrap('ensureIntroCoupon', async () => ({ ok: true })),
    createPassCheckout: wrap('createPassCheckout', async () => ({ ok: true, url: 'https://checkout.stripe.com/c/pay/x', sessionId: 'cs_1' })),
    fetchSession: wrap('fetchSession', async () => ({ ok: false, error: 'stub' })),
    fetchSubscription: wrap('fetchSubscription', async () => ({ ok: true, subscription: { object: 'subscription', id: 'sub_1', livemode: false, status: 'active', customer: 'cus_1', latest_invoice: 'in_1', current_period_start: Math.floor((NOW - 2 * DAY) / 1000), current_period_end: Math.floor((NOW + 5 * DAY) / 1000), metadata: {} } })),
    interpretSubscription: (sub, opts) => ({ ok: true, subscription: { id: sub.id, customerId: sub.customer, status: sub.status, periodStart: new Date(sub.current_period_start * 1000).toISOString(), periodEnd: new Date(sub.current_period_end * 1000).toISOString(), cancelAtPeriodEnd: false, latestInvoiceId: sub.latest_invoice, metadata: sub.metadata || {} } }),
    verifyPassMetadata: async (m) => m?.cinema_pass_sig === 'good',
    fetchInvoice: wrap('fetchInvoice', async () => ({ ok: true, invoice: { object: 'invoice', payment_intent: 'pi_1', amount_paid: 1199 } })),
    invoicePayment: (inv) => ({ paymentIntentId: inv.payment_intent, paidCents: inv.amount_paid }),
    cancelSubscriptionAtPeriodEnd: wrap('cancelSubscriptionAtPeriodEnd', async () => ({ ok: true })),
    cancelSubscriptionNow: wrap('cancelSubscriptionNow', async () => ({ ok: true })),
    createRefund: wrap('createRefund', async () => ({ ok: true, refundId: 're_1' })),
    createPortalSession: wrap('createPortalSession', async () => ({ ok: true, url: 'https://billing.stripe.com/p/x' })),
    ...stripe,
  };
  const handle = passHandler({
    action, stripe: stripeApi, now: () => NOW,
    rpcCall: async (name, args) => { calls.push({ name, args }); if (name === 'consume_account_read_request') return rpc.rate ?? { ok: true }; return rpc[name] ?? { error: 'unexpected_rpc' }; },
  });
  return { calls, stripeCalls, handle };
}

test('identity, flag, configuration and input gates run before any RPC or Stripe call', async () => {
  const s = setup('start', { rpc: { start_cinema_pass: { ok: true, pass_id: PASS, status: 'pending', plan_id: 'pass-weekly', billing_interval: 'week', price_usd_cents: 1499 } } });
  assert.equal((await s.handle(post('', startBody, { 'x-veyrnox-auth-id': '' }))).status, 401);
  for (const flag of ['CINEMA_ENABLED', 'CINEMA_SUBSCRIPTIONS_ENABLED']) { process.env[flag] = 'false'; assert.equal((await s.handle(post('', startBody))).status, 503); process.env[flag] = 'true'; }
  const key = process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_SECRET_KEY;
  assert.equal((await s.handle(post('', startBody))).status, 503);
  process.env.STRIPE_SECRET_KEY = key;
  for (const [value, code] of [[{ ...startBody, plan_id: 'Bad' }, 'plan_id_required'], [{ ...startBody, idempotency_key: 'short' }, 'idempotency_key_required'], [{ ...startBody, consent: 'yes' }, 'consent_required'], [{ ...startBody, consent_version: 'old' }, 'consent_version_required'], [{ ...startBody, price_usd_cents: 1 }, 'invalid_request'], ['[1]', 'invalid_request']]) {
    const r = await s.handle(post('', value)); assert.equal(r.status, 400, code); assert.equal((await r.json()).error, code);
  }
  assert.equal((await s.handle(post('?x=1', startBody))).status, 400);
  assert.equal((await s.handle(post('', startBody, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal(s.calls.length, 0);
  assert.equal(s.stripeCalls.length, 0);
});

test('start creates the intro coupon only when the database says the account is eligible, then a signed recurring checkout', async () => {
  const eligible = setup('start', { rpc: { start_cinema_pass: { ok: true, idempotent: false, pass_id: PASS, status: 'pending', plan_id: 'pass-weekly', billing_interval: 'week', price_usd_cents: 1499, intro_price_usd_cents: 1199 } } });
  const res = await eligible.handle(post('', startBody, { 'x-veyrnox-auth-email': 'v@example.com' }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual([data.pass_id, data.checkout_url, data.idempotent, data.intro_price_usd_cents], [PASS, 'https://checkout.stripe.com/c/pay/x', false, 1199]);
  const [coupon, checkout] = eligible.stripeCalls;
  assert.deepEqual([coupon.name, coupon.args[0].couponId, coupon.args[0].amountOffCents], ['ensureIntroCoupon', 'veyrnox-pass-intro-pass-weekly-300', 300]);
  assert.deepEqual([checkout.args[0].passId, checkout.args[0].interval, checkout.args[0].priceUsdCents, checkout.args[0].introCouponId, checkout.args[0].email], [PASS, 'week', 1499, 'veyrnox-pass-intro-pass-weekly-300', 'v@example.com']);
  assert.match(checkout.args[1].idempotencyKey, new RegExp(`^cinema_pass:${PASS}:\\d+$`));
  assert.equal(eligible.calls[1].args.p_consent_version, PASS_CONSENT_VERSION);

  const plain = setup('start', { rpc: { start_cinema_pass: { ok: true, idempotent: true, pass_id: PASS, status: 'pending', plan_id: 'pass-monthly', billing_interval: 'month', price_usd_cents: 4999, intro_price_usd_cents: null } } });
  assert.equal((await plain.handle(post('', startBody))).status, 200);
  assert.deepEqual(plain.stripeCalls.map((c) => c.name), ['createPassCheckout']);
  assert.equal(plain.stripeCalls[0].args[0].introCouponId, undefined);

  const paid = setup('start', { rpc: { start_cinema_pass: { ok: true, idempotent: true, pass_id: PASS, status: 'active', plan_id: 'pass-weekly', billing_interval: 'week', price_usd_cents: 1499 } } });
  const replay = await paid.handle(post('', startBody));
  assert.equal((await replay.json()).status, 'active');
  assert.equal(paid.stripeCalls.length, 0, 'no new checkout for a Pass that already paid');

  for (const [code, status] of [['PASS_ALREADY_ACTIVE', 409], ['ACCOUNT_FROZEN', 403], ['ACCOUNT_NOT_ACTIVE', 403], ['PLAN_NOT_FOUND', 404], ['IDEMPOTENCY_KEY_REUSED', 409], ['SOMETHING_ELSE', 503]]) {
    const s = setup('start', { rpc: { start_cinema_pass: { ok: false, code } } });
    const r = await s.handle(post('', startBody)); assert.equal(r.status, status, code);
    assert.equal((await r.json()).error, status === 503 ? 'temporarily_unavailable' : code.toLowerCase());
  }
  const limited = setup('start', { rpc: { start_cinema_pass: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 42 } } });
  const r = await limited.handle(post('', startBody)); assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '42');
  const failed = setup('start', { rpc: { start_cinema_pass: { ok: true, pass_id: PASS, status: 'pending', plan_id: 'pass-weekly', billing_interval: 'week', price_usd_cents: 1499 } }, stripe: { createPassCheckout: async () => ({ ok: false, error: 'stripe 400' }) } });
  assert.equal((await failed.handle(post('', startBody))).status, 502);
});

test('plans and the own Pass are read-only, and the projection never carries a Stripe id', async () => {
  const plans = setup('plans', { rpc: { list_cinema_pass_plans: [{ id: 'pass-weekly', billing_interval: 'week', price_usd_cents: 1499, intro_price_usd_cents: 1199, secret: 'x' }] } });
  const res = await plans.handle(get('/plans'));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.plans, [{ id: 'pass-weekly', billing_interval: 'week', price_usd_cents: 1499, intro_price_usd_cents: 1199 }]);
  assert.deepEqual([data.consent_version, data.cooling_off_days], [PASS_CONSENT_VERSION, COOLING_OFF_DAYS]);
  assert.equal((await plans.handle(get('/plans?x=1'))).status, 400);
  const own = setup('read', { rpc: { read_own_cinema_pass: { ok: true, pass: livePass() } } });
  const r = await own.handle(get(''));
  const pass = (await r.json()).pass;
  assert.equal(pass.stripe_subscription_id, undefined);
  assert.equal(pass.stripe_customer_id, undefined);
  assert.equal(pass.within_cooling_off, true);
  assert.equal(pass.cooling_off_until, new Date(NOW - 2 * DAY + COOLING_OFF_DAYS * DAY).toISOString());
  assert.equal(passProjection(null), null);
  assert.equal(passProjection({ id: PASS, status: 'pending' }, NOW).within_cooling_off, false);
  const none = setup('read', { rpc: { read_own_cinema_pass: { ok: true, pass: null } } });
  assert.equal((await (await none.handle(get(''))).json()).pass, null);
});

test('return records the session, then applies the subscription Stripe already shows for it', async () => {
  const ready = setup('return', {
    rpc: { record_cinema_pass_session: { ok: true, pass_id: PASS, status: 'pending' }, apply_cinema_pass_event: { ok: true, status: 'active', idempotent: false } },
    stripe: { fetchSession: async () => ({ ok: true, session: { object: 'checkout.session', livemode: false, subscription: 'sub_1', metadata: { cinema_pass_id: PASS, cinema_pass_sig: 'good' } } }) },
  });
  const res = await ready.handle(post('/return', { pass_id: PASS, session_id: 'cs_test_1' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json().then((d) => [d.ok, d.status, d.recovered]), [true, 'active', true]);
  const applied = ready.calls.find((c) => c.name === 'apply_cinema_pass_event').args;
  assert.deepEqual([applied.p_event_id, applied.p_type, applied.p_pass_id, applied.p_subscription_id, applied.p_status], ['cs_test_1', 'checkout.return', PASS, 'sub_1', 'active']);

  const forged = setup('return', {
    rpc: { record_cinema_pass_session: { ok: true, pass_id: PASS, status: 'pending' } },
    stripe: { fetchSession: async () => ({ ok: true, session: { object: 'checkout.session', livemode: false, subscription: 'sub_1', metadata: { cinema_pass_id: PASS, cinema_pass_sig: 'bad' } } }) },
  });
  const f = await forged.handle(post('/return', { pass_id: PASS, session_id: 'cs_test_1' }));
  assert.deepEqual(await f.json().then((d) => [d.status, d.recovered]), ['pending', false]);
  assert.ok(!forged.calls.some((c) => c.name === 'apply_cinema_pass_event'));

  const flagged = setup('return', {
    rpc: { record_cinema_pass_session: { ok: true, pass_id: PASS, status: 'pending' }, apply_cinema_pass_event: { ok: true, status: 'flagged', flagged: true } },
    stripe: { fetchSession: async () => ({ ok: true, session: { object: 'checkout.session', livemode: false, subscription: 'sub_1', metadata: { cinema_pass_id: PASS, cinema_pass_sig: 'good' } } }) },
  });
  assert.equal((await (await flagged.handle(post('/return', { pass_id: PASS, session_id: 'cs_test_1' }))).json()).status, 'flagged');
  assert.deepEqual(flagged.stripeCalls.at(-1).name, 'cancelSubscriptionNow', 'a double-paid Pass stops billing at once');

  const other = setup('return', { rpc: { record_cinema_pass_session: { ok: false, code: 'PASS_NOT_FOUND' } } });
  assert.equal((await other.handle(post('/return', { pass_id: PASS, session_id: 'cs_test_1' }))).status, 404);
  assert.equal((await other.handle(post('/return', { pass_id: PASS, session_id: 'nope' }))).status, 400);
});

test('cancel within fourteen days ends the Pass now and refunds the unused share; later it stops renewal', async () => {
  const cooling = setup('cancel', { rpc: { read_own_cinema_pass: { ok: true, pass: livePass() }, mark_cinema_pass_cancelled: { ok: true, status: 'ended' } } });
  const res = await cooling.handle(post('/cancel', {}));
  assert.equal(res.status, 200);
  const data = await res.json();
  // 1199 paid, 2 of 7 days used: 5/7 comes back, floored.
  assert.deepEqual([data.mode, data.refund_usd_cents, data.refunded], ['cooling_off', 856, true]);
  assert.deepEqual(cooling.stripeCalls.map((c) => c.name), ['fetchSubscription', 'fetchInvoice', 'cancelSubscriptionNow', 'createRefund']);
  assert.deepEqual(cooling.stripeCalls[3].args[0], { paymentIntentId: 'pi_1', amountCents: 856 });
  assert.equal(cooling.stripeCalls[3].args[2], `pass_refund:${PASS}`);
  assert.equal(cooling.calls.find((c) => c.name === 'mark_cinema_pass_cancelled').args.p_mode, 'cooling_off');

  const later = setup('cancel', { rpc: { read_own_cinema_pass: { ok: true, pass: livePass({ started_at: new Date(NOW - 20 * DAY).toISOString() }) }, mark_cinema_pass_cancelled: { ok: true } } });
  const l = await later.handle(post('/cancel', {}));
  assert.equal((await l.json()).mode, 'period_end');
  assert.deepEqual(later.stripeCalls.map((c) => c.name), ['cancelSubscriptionAtPeriodEnd']);

  const refundFails = setup('cancel', { rpc: { read_own_cinema_pass: { ok: true, pass: livePass() }, mark_cinema_pass_cancelled: { ok: true } }, stripe: { createRefund: async () => ({ ok: false, error: 'stripe 500' }) } });
  const rf = await refundFails.handle(post('/cancel', {}));
  assert.deepEqual(await rf.json().then((d) => [d.ok, d.refunded, d.refund_usd_cents]), [true, false, 856]);
  assert.ok(refundFails.calls.some((c) => c.name === 'mark_cinema_pass_cancelled'), 'the Pass still ends; the refund is an Operator item');

  const none = setup('cancel', { rpc: { read_own_cinema_pass: { ok: true, pass: livePass({ status: 'ended' }) } } });
  assert.equal((await none.handle(post('/cancel', {}))).status, 404);
  const stripeDown = setup('cancel', { rpc: { read_own_cinema_pass: { ok: true, pass: livePass() } }, stripe: { cancelSubscriptionNow: async () => ({ ok: false, error: 'stripe 500' }) } });
  assert.equal((await stripeDown.handle(post('/cancel', {}))).status, 502);
  assert.ok(!stripeDown.calls.some((c) => c.name === 'mark_cinema_pass_cancelled'));
  assert.equal((await none.handle(post('/cancel', { extra: 1 }))).status, 400);
});

test('cooling-off refund maths floors the unused share and copes with unknown periods', () => {
  assert.equal(coolingOffRefundCents({ paidCents: 1199, periodStartMs: 0, periodEndMs: 7 * DAY, nowMs: 2 * DAY }), 856);
  assert.equal(coolingOffRefundCents({ paidCents: 1499, periodStartMs: 0, periodEndMs: 7 * DAY, nowMs: 8 * DAY }), 0);
  assert.equal(coolingOffRefundCents({ paidCents: 4999, periodStartMs: NaN, periodEndMs: NaN, nowMs: NOW }), 4999);
  assert.equal(coolingOffRefundCents({ paidCents: 0, periodStartMs: 0, periodEndMs: DAY, nowMs: 0 }), 0);
});

test('the portal opens only for the caller’s own Stripe customer', async () => {
  const s = setup('portal', { rpc: { read_own_cinema_pass: { ok: true, pass: livePass() } } });
  const res = await s.handle(post('/portal', {}));
  assert.deepEqual((await res.json()).url, 'https://billing.stripe.com/p/x');
  assert.deepEqual(s.stripeCalls[0].args[0], { customerId: 'cus_1' });
  const none = setup('portal', { rpc: { read_own_cinema_pass: { ok: true, pass: null } } });
  assert.equal((await none.handle(post('/portal', {}))).status, 404);
});

test('the shared account quota and upstream failures are handled like every other cinema route', async () => {
  const limited = setup('read', { rpc: { rate: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 3 } } });
  const r = await limited.handle(get(''));
  assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '3');
  const s = passHandler({ action: 'read', rpcCall: async () => { throw new Error('private connection string'); } });
  const res = await s(get(''));
  assert.equal(res.status, 503);
  assert.ok(!(await res.text()).includes('private'));
});
