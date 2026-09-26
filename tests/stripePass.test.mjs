import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPassCheckout, ensureIntroCoupon, verifyPassMetadata, interpretSubscription, invoiceSubscriptionId, invoicePayment,
  cancelSubscriptionAtPeriodEnd, cancelSubscriptionNow, createRefund, createPortalSession, fetchSubscription, fetchInvoice, fetchCharge, TAX_CODE,
} from '../packages/adapters/stripe.js';

const PASS = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const SECRET = 'whsec_0123456789abcdef0123456789abcdef';
const cfg = (fetchImpl, over = {}) => ({ fetch: fetchImpl, apiKey: 'sk_test_x', publicHost: 'https://veyrnox.ai', signingSecret: SECRET, ...over });
const okSession = () => Response.json({ id: 'cs_test_9', url: 'https://checkout.stripe.com/c/pay/cs_test_9', object: 'checkout.session' });

test('a Pass checkout is recurring, signed on the session and the subscription, and priced from our row', async () => {
  let seen;
  const r = await createPassCheckout({ passId: PASS, planId: 'pass-weekly', interval: 'week', priceUsdCents: 1499, introCouponId: 'veyrnox-pass-intro-pass-weekly-300', email: 'v@example.com' },
    cfg(async (url, init) => { seen = { url, init }; return okSession(); }, { idempotencyKey: `cinema_pass:${PASS}:1` }));
  assert.deepEqual(r, { ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_9', sessionId: 'cs_test_9' });
  const body = new URLSearchParams(seen.init.body);
  assert.equal(body.get('mode'), 'subscription');
  assert.equal(body.get('line_items[0][price_data][unit_amount]'), '1499');
  assert.equal(body.get('line_items[0][price_data][recurring][interval]'), 'week');
  assert.equal(body.get('line_items[0][price_data][product_data][tax_code]'), TAX_CODE);
  assert.equal(body.get('automatic_tax[enabled]'), 'true');
  assert.equal(body.get('discounts[0][coupon]'), 'veyrnox-pass-intro-pass-weekly-300');
  assert.equal(body.get('metadata[cinema_pass_id]'), PASS);
  assert.equal(body.get('metadata[cinema_pass_sig]'), body.get('subscription_data[metadata][cinema_pass_sig]'));
  assert.match(body.get('success_url'), /^https:\/\/veyrnox\.ai\/social-cinema\/pass\?pass=.*session_id=\{CHECKOUT_SESSION_ID\}$/);
  assert.equal(seen.init.headers['Idempotency-Key'], `cinema_pass:${PASS}:1`);
  assert.equal(await verifyPassMetadata({ cinema_pass_id: PASS, cinema_pass_sig: body.get('metadata[cinema_pass_sig]') }, SECRET), true);
  assert.equal(await verifyPassMetadata({ cinema_pass_id: PASS, cinema_pass_sig: 'ab'.repeat(32) }, SECRET), false);
  assert.equal(await verifyPassMetadata({ cinema_pass_id: PASS, cinema_pass_sig: body.get('metadata[cinema_pass_sig]') }, 'whsec_other'), false);
  // No coupon param when there is no intro.
  const plain = await createPassCheckout({ passId: PASS, planId: 'pass-monthly', interval: 'month', priceUsdCents: 4999 }, cfg(async (u, init) => { seen = { init }; return okSession(); }));
  assert.equal(plain.ok, true);
  assert.equal(new URLSearchParams(seen.init.body).has('discounts[0][coupon]'), false);
});

test('a Pass checkout refuses bad input, tax off is explicit, and only stripe.com URLs are returned', async () => {
  for (const input of [{ passId: 'x', planId: 'p', interval: 'week', priceUsdCents: 1499 }, { passId: PASS, planId: 'Bad Plan', interval: 'week', priceUsdCents: 1499 },
    { passId: PASS, planId: 'p', interval: 'day', priceUsdCents: 1499 }, { passId: PASS, planId: 'p', interval: 'week', priceUsdCents: 0 }, { passId: PASS, planId: 'p', interval: 'week', priceUsdCents: 1499, introCouponId: 'no spaces' }]) {
    assert.equal((await createPassCheckout(input, cfg(async () => okSession()))).ok, false, JSON.stringify(input));
  }
  const evil = await createPassCheckout({ passId: PASS, planId: 'p', interval: 'week', priceUsdCents: 1499 }, cfg(async () => Response.json({ id: 'cs_1', url: 'https://evil.example/pay', object: 'checkout.session' })));
  assert.equal(evil.ok, false);
  const http = await createPassCheckout({ passId: PASS, planId: 'p', interval: 'week', priceUsdCents: 1499 }, cfg(async () => okSession(), { publicHost: 'http://veyrnox.ai' }));
  assert.equal(http.ok, false);
  let body;
  await createPassCheckout({ passId: PASS, planId: 'p', interval: 'week', priceUsdCents: 1499 }, cfg(async (u, init) => { body = new URLSearchParams(init.body); return okSession(); }, { automaticTax: false }));
  assert.equal(body.get('automatic_tax[enabled]'), 'false');
});

test('the intro coupon is created once with a deterministic id; an existing id is success', async () => {
  let seen;
  const created = await ensureIntroCoupon({ couponId: 'veyrnox-pass-intro-pass-weekly-300', amountOffCents: 300, name: 'x' }, cfg(async (url, init) => { seen = { url, init }; return Response.json({ id: 'veyrnox-pass-intro-pass-weekly-300', object: 'coupon' }); }));
  assert.deepEqual(created, { ok: true, couponId: 'veyrnox-pass-intro-pass-weekly-300' });
  const body = new URLSearchParams(seen.init.body);
  assert.deepEqual([body.get('id'), body.get('amount_off'), body.get('currency'), body.get('duration')], ['veyrnox-pass-intro-pass-weekly-300', '300', 'usd', 'once']);
  assert.equal(seen.init.headers['Idempotency-Key'], 'coupon:veyrnox-pass-intro-pass-weekly-300');
  const exists = await ensureIntroCoupon({ couponId: 'veyrnox-pass-intro-pass-weekly-300', amountOffCents: 300 }, cfg(async () => Response.json({ error: { code: 'resource_already_exists' } }, { status: 400 })));
  assert.equal(exists.ok, true);
  const other = await ensureIntroCoupon({ couponId: 'veyrnox-pass-intro-pass-weekly-300', amountOffCents: 300 }, cfg(async () => Response.json({ error: { code: 'rate_limit' } }, { status: 429 })));
  assert.equal(other.ok, false);
  assert.equal((await ensureIntroCoupon({ couponId: 'bad id', amountOffCents: 300 }, cfg(async () => okSession()))).ok, false);
});

test('subscriptions collapse to our four statuses and read the period from either API shape', () => {
  const base = { id: 'sub_1', object: 'subscription', livemode: false, customer: 'cus_1', latest_invoice: 'in_1', cancel_at_period_end: true, metadata: { cinema_pass_id: PASS } };
  for (const [raw, status] of [['active', 'active'], ['trialing', 'active'], ['past_due', 'past_due'], ['incomplete', 'incomplete'], ['canceled', 'ended'], ['unpaid', 'ended'], ['incomplete_expired', 'ended'], ['paused', 'ended']]) {
    const r = interpretSubscription({ ...base, status: raw, current_period_end: 1_800_000_000 }, { expectLiveMode: false });
    assert.equal(r.ok, true, raw);
    assert.equal(r.subscription.status, status, raw);
  }
  const old = interpretSubscription({ ...base, status: 'active', current_period_start: 1_799_000_000, current_period_end: 1_800_000_000 }, { expectLiveMode: false }).subscription;
  assert.deepEqual([old.periodStart, old.periodEnd, old.customerId, old.latestInvoiceId, old.cancelAtPeriodEnd], [new Date(1_799_000_000 * 1000).toISOString(), new Date(1_800_000_000 * 1000).toISOString(), 'cus_1', 'in_1', true]);
  const fresh = interpretSubscription({ ...base, status: 'active', items: { data: [{ current_period_start: 1_799_000_000, current_period_end: 1_800_000_000 }] } }, { expectLiveMode: false }).subscription;
  assert.equal(fresh.periodEnd, new Date(1_800_000_000 * 1000).toISOString());
  assert.equal(interpretSubscription({ ...base, status: 'active', livemode: true }, { expectLiveMode: false }).ok, false);
  assert.equal(interpretSubscription({ ...base, status: 'weird' }, { expectLiveMode: false }).ok, false);
  assert.equal(interpretSubscription({ ...base, object: 'invoice' }, { expectLiveMode: false }).ok, false);
  assert.equal(interpretSubscription({ ...base, status: 'active', customer: 'not-a-customer', latest_invoice: null }, { expectLiveMode: false }).subscription.customerId, null);
});

test('invoices name their subscription and payment in either API shape', () => {
  assert.equal(invoiceSubscriptionId({ object: 'invoice', subscription: 'sub_a' }), 'sub_a');
  assert.equal(invoiceSubscriptionId({ object: 'invoice', parent: { subscription_details: { subscription: 'sub_b' } } }), 'sub_b');
  assert.equal(invoiceSubscriptionId({ object: 'invoice', subscription: 'nope' }), null);
  assert.equal(invoiceSubscriptionId({ object: 'charge', subscription: 'sub_a' }), null);
  assert.deepEqual(invoicePayment({ object: 'invoice', payment_intent: 'pi_1', amount_paid: 1499 }), { paymentIntentId: 'pi_1', paidCents: 1499 });
  assert.deepEqual(invoicePayment({ object: 'invoice', payments: { data: [{ payment: { payment_intent: 'pi_2' } }] }, amount_paid: 1199 }), { paymentIntentId: 'pi_2', paidCents: 1199 });
  assert.equal(invoicePayment({ object: 'invoice', amount_paid: 1499 }), null);
});

test('cancel, refund, portal and re-reads use the right verbs and guard every id and URL', async () => {
  const calls = [];
  const fetcher = (reply) => async (url, init = {}) => { calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? new URLSearchParams(init.body) : null, headers: init.headers }); return reply(String(url)); };
  assert.deepEqual(await cancelSubscriptionAtPeriodEnd('sub_1', cfg(fetcher(() => Response.json({ object: 'subscription', id: 'sub_1' })))), { ok: true });
  assert.equal(calls.at(-1).body.get('cancel_at_period_end'), 'true');
  assert.deepEqual(await cancelSubscriptionNow('sub_1', cfg(fetcher(() => Response.json({ object: 'subscription', id: 'sub_1', status: 'canceled' })))), { ok: true });
  assert.equal(calls.at(-1).method, 'DELETE');
  assert.deepEqual(await cancelSubscriptionNow('sub_1', cfg(fetcher(() => Response.json({ error: { message: 'No such subscription: it has already been canceled' } }, { status: 400 })))), { ok: true });
  assert.equal((await cancelSubscriptionNow('sub_1', cfg(fetcher(() => Response.json({ error: { message: 'boom' } }, { status: 500 }))))).ok, false);
  assert.equal((await cancelSubscriptionNow('bad', cfg(fetcher(() => okSession())))).ok, false);
  const refund = await createRefund({ paymentIntentId: 'pi_1', amountCents: 857 }, cfg(fetcher(() => Response.json({ object: 'refund', id: 're_1' }))), 'pass_refund:x');
  assert.deepEqual(refund, { ok: true, refundId: 're_1' });
  assert.deepEqual([calls.at(-1).body.get('payment_intent'), calls.at(-1).body.get('amount'), calls.at(-1).headers['Idempotency-Key']], ['pi_1', '857', 'pass_refund:x']);
  assert.equal((await createRefund({ paymentIntentId: 'pi_1', amountCents: 0 }, cfg(fetcher(() => okSession())))).ok, false);
  const portal = await createPortalSession({ customerId: 'cus_1' }, cfg(fetcher(() => Response.json({ url: 'https://billing.stripe.com/p/session/x' }))));
  assert.deepEqual(portal, { ok: true, url: 'https://billing.stripe.com/p/session/x' });
  assert.equal(calls.at(-1).body.get('return_url'), 'https://veyrnox.ai/social-cinema/pass');
  assert.equal((await createPortalSession({ customerId: 'cus_1' }, cfg(fetcher(() => Response.json({ url: 'https://evil.example/x' }))))).ok, false);
  assert.equal((await createPortalSession({ customerId: 'nope' }, cfg(fetcher(() => okSession())))).ok, false);
  assert.equal((await fetchSubscription('sub_1', cfg(fetcher(() => Response.json({ object: 'subscription', id: 'sub_1' }))))).ok, true);
  assert.equal((await fetchSubscription('sub_1', cfg(fetcher(() => Response.json({ object: 'invoice' }))))).ok, false);
  assert.equal((await fetchInvoice('in_1', cfg(fetcher(() => Response.json({ object: 'invoice', id: 'in_1' }))))).ok, true);
  assert.equal((await fetchCharge('ch_1', cfg(fetcher(() => Response.json({ object: 'charge', id: 'ch_1', invoice: 'in_1' }))))).charge.invoice, 'in_1');
  assert.equal((await fetchCharge('pi_1', cfg(fetcher(() => okSession())))).ok, false);
  assert.ok(calls.every((c) => c.url.startsWith('https://api.stripe.com/v1/')));
});
