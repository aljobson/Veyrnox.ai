import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { createCheckout, verifyWebhookSignature, verifyTopUpMetadata, interpretSession, TAX_CODE } from '../packages/adapters/stripe.js';

const TOP_UP = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const SECRET = 'whsec_0123456789abcdef0123456789abcdef';
const cfg = (fetchImpl, over = {}) => ({ fetch: fetchImpl, apiKey: 'sk_test_x', publicHost: 'https://veyrnox.ai', signingSecret: SECRET, ...over });
const okSession = () => Response.json({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123', object: 'checkout.session' });

test('the checkout is built from our own price, with the AI tax code and both return URLs', async () => {
    let seen;
    const r = await createCheckout({ topUpId: TOP_UP, priceUsdCents: 2500, credits: 300, email: 'buyer@example.com' },
        cfg(async (url, init) => { seen = { url, init }; return okSession(); }));
    assert.deepEqual(r, { ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_123', sessionId: 'cs_test_123' });
    assert.equal(seen.url, 'https://api.stripe.com/v1/checkout/sessions');
    const body = new URLSearchParams(seen.init.body);
    assert.equal(body.get('mode'), 'payment');
    assert.equal(body.get('line_items[0][price_data][unit_amount]'), '2500');
    assert.equal(body.get('line_items[0][price_data][currency]'), 'usd');
    assert.equal(body.get('line_items[0][price_data][product_data][tax_code]'), TAX_CODE);
    assert.equal(body.get('line_items[0][price_data][product_data][name]'), '300 Veyrnox credits');
    assert.equal(body.get('automatic_tax[enabled]'), 'true');
    assert.equal(body.get('client_reference_id'), TOP_UP);
    assert.equal(body.get('customer_email'), 'buyer@example.com');
    assert.match(body.get('success_url'), /^https:\/\/veyrnox\.ai\/app\/credits\?top_up=/);
    assert.match(body.get('cancel_url'), /checkout=cancelled$/);
    // The same signature travels on the PaymentIntent, which is what a dispute names.
    assert.equal(body.get('metadata[top_up_sig]'), body.get('payment_intent_data[metadata][top_up_sig]'));
    assert.equal(seen.init.headers.Authorization, 'Bearer sk_test_x');
});

test('automatic tax can be turned off, and bad input never reaches Stripe', async () => {
    const off = await createCheckout({ topUpId: TOP_UP, priceUsdCents: 1000, credits: 100 },
        cfg(async (_u, init) => { assert.equal(new URLSearchParams(init.body).get('automatic_tax[enabled]'), 'false'); return okSession(); }, { automaticTax: false }));
    assert.equal(off.ok, true);
    const never = async () => { throw new Error('must not call Stripe'); };
    assert.equal((await createCheckout({ topUpId: 'nope', priceUsdCents: 1000, credits: 100 }, cfg(never))).error, 'invalid topUpId');
    assert.equal((await createCheckout({ topUpId: TOP_UP, priceUsdCents: 0, credits: 100 }, cfg(never))).error, 'invalid price');
    assert.equal((await createCheckout({ topUpId: TOP_UP, priceUsdCents: 1000, credits: 0 }, cfg(never))).error, 'invalid credits');
    assert.equal((await createCheckout({ topUpId: TOP_UP, priceUsdCents: 1000, credits: 100 }, cfg(never, { publicHost: 'http://veyrnox.ai' }))).error, 'publicHost must be https');
});

test('a checkout url that is not on stripe.com is refused, not handed to the browser', async () => {
    // The caller navigates top-level to whatever comes back, so the host is checked.
    for (const url of ['https://evil.example/c/pay/cs_test_123', 'http://checkout.stripe.com/c/pay/x', 'not a url']) {
        const r = await createCheckout({ topUpId: TOP_UP, priceUsdCents: 1000, credits: 100 },
            cfg(async () => Response.json({ id: 'cs_test_123', url, object: 'checkout.session' })));
        assert.deepEqual(r, { ok: false, error: 'checkout url not on stripe.com' }, url);
    }
});

test('a Stripe error is logged, never returned to the client', async () => {
    const r = await createCheckout({ topUpId: TOP_UP, priceUsdCents: 1000, credits: 100 },
        cfg(async () => Response.json({ error: { code: 'api_key_expired', message: 'secret' } }, { status: 401 })));
    assert.deepEqual(r, { ok: false, error: 'stripe 401' });
});

const signed = (body, secret = SECRET, t = Math.floor(Date.now() / 1000)) =>
    `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

test('webhook signatures are verified over the exact bytes, within the time window', async () => {
    const body = '{"id":"evt_1","type":"checkout.session.completed"}';
    const raw = new TextEncoder().encode(body);
    assert.equal(await verifyWebhookSignature(raw, signed(body), SECRET), true);
    assert.equal(await verifyWebhookSignature(raw, signed(body, 'whsec_other'), SECRET), false, 'another secret');
    assert.equal(await verifyWebhookSignature(new TextEncoder().encode(body + ' '), signed(body), SECRET), false, 'body changed');
    const old = Math.floor(Date.now() / 1000) - 3600;
    assert.equal(await verifyWebhookSignature(raw, signed(body, SECRET, old), SECRET), false, 'stale timestamp');
    assert.equal(await verifyWebhookSignature(raw, signed(body), ''), false, 'no secret configured');
    assert.equal(await verifyWebhookSignature(raw, 'v1=deadbeef', SECRET), false, 'no timestamp');
    // A second v1 (Stripe sends one per endpoint secret during a rotation).
    const t = Math.floor(Date.now() / 1000);
    const good = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
    assert.equal(await verifyWebhookSignature(raw, `t=${t},v1=${'0'.repeat(64)},v1=${good}`, SECRET), true);
});

test('only metadata we signed can name a Top-up', async () => {
    let captured;
    await createCheckout({ topUpId: TOP_UP, priceUsdCents: 1000, credits: 100 },
        cfg(async (_u, init) => { captured = new URLSearchParams(init.body); return okSession(); }));
    const sig = captured.get('metadata[top_up_sig]');
    assert.equal(await verifyTopUpMetadata({ top_up_id: TOP_UP, top_up_sig: sig }, SECRET), true);
    assert.equal(await verifyTopUpMetadata({ top_up_id: TOP_UP, top_up_sig: 'ab'.repeat(32) }, SECRET), false);
    assert.equal(await verifyTopUpMetadata({ top_up_id: '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6a', top_up_sig: sig }, SECRET), false);
    assert.equal(await verifyTopUpMetadata({}, SECRET), false);
});

test('a session is credited only when it is paid, in the mode we expect', () => {
    const base = {
        object: 'checkout.session', id: 'cs_test_123', payment_intent: 'pi_123', livemode: false,
        payment_status: 'paid', amount_subtotal: 2500, amount_total: 3000, currency: 'USD',
        metadata: { top_up_id: TOP_UP },
    };
    assert.deepEqual(interpretSession(base, { expectLiveMode: false }),
        { ok: true, order: { orderId: 'pi_123', topUpId: TOP_UP, paidCents: 2500, currency: 'usd', paid: true } },
        'the pack price is the subtotal; tax on top is Stripe\'s, not credits');
    assert.equal(interpretSession(base, { expectLiveMode: true }).error, 'mode mismatch');
    assert.equal(interpretSession({ ...base, payment_status: 'unpaid' }, { expectLiveMode: false }).error, 'payment_status unpaid');
    assert.equal(interpretSession({ ...base, metadata: {} }, { expectLiveMode: false }).error, 'no top_up_id');
    assert.equal(interpretSession({ object: 'event' }, { expectLiveMode: false }).error, 'not a session');
});
