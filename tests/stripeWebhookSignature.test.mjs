import test from 'node:test';
import assert from 'node:assert/strict';

const { verifyWebhookSignature, createCheckoutSession, STRIPE_API_VERSION } = await import('../packages/adapters/stripe.js');

const enc = new TextEncoder();
const SECRET = 'whsec_test_secret';
const body = enc.encode('{"id":"evt_1","type":"checkout.session.completed"}');
const now = 1_800_000_000;

async function sign(payload, t, secret = SECRET) {
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${new TextDecoder().decode(payload)}`));
    return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
}

test('valid signature verifies', async () => {
    const header = `t=${now},v1=${await sign(body, now)}`;
    assert.equal(await verifyWebhookSignature(body, header, SECRET, now), true);
});

test('any matching v1 among several verifies (secret rotation)', async () => {
    const header = `t=${now},v1=${'0'.repeat(64)},v1=${await sign(body, now)},v0=abc`;
    assert.equal(await verifyWebhookSignature(body, header, SECRET, now), true);
});

test('tampered body is rejected', async () => {
    const header = `t=${now},v1=${await sign(body, now)}`;
    const tampered = enc.encode('{"id":"evt_1","type":"charge.refunded"}');
    assert.equal(await verifyWebhookSignature(tampered, header, SECRET, now), false);
});

test('wrong secret is rejected', async () => {
    const header = `t=${now},v1=${await sign(body, now, 'whsec_other')}`;
    assert.equal(await verifyWebhookSignature(body, header, SECRET, now), false);
});

test('timestamp outside the 5 minute window is rejected', async () => {
    const t = now - 301;
    const header = `t=${t},v1=${await sign(body, t)}`;
    assert.equal(await verifyWebhookSignature(body, header, SECRET, now), false);
});

test('missing or malformed header is rejected, never thrown', async () => {
    for (const header of [null, '', 't=abc,v1=zz', `v1=${'a'.repeat(64)}`, `t=${now}`]) {
        assert.equal(await verifyWebhookSignature(body, header, SECRET, now), false);
    }
    assert.equal(await verifyWebhookSignature(body, `t=${now},v1=${await sign(body, now)}`, '', now), false);
});

test('checkout session request enables managed payments and is idempotent per purchase', async () => {
    let seen;
    globalThis.fetch = async (url, init) => {
        seen = { url, init };
        return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), { status: 200 });
    };
    const res = await createCheckoutSession({
        purchaseId: '00000000-0000-4000-8000-000000000001',
        priceId: 'price_123',
        successUrl: 'https://veyrnox.ai/app/credits?checkout=success',
        cancelUrl: 'https://veyrnox.ai/app/credits?checkout=cancel',
    }, { secretKey: 'rk_test_x' });

    assert.deepEqual(res, { ok: true, id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    assert.equal(seen.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(seen.init.headers['Idempotency-Key'], 'checkout-00000000-0000-4000-8000-000000000001');
    assert.equal(seen.init.headers['Stripe-Version'], STRIPE_API_VERSION);
    const form = seen.init.body;
    assert.equal(form.get('mode'), 'payment');
    assert.equal(form.get('managed_payments[enabled]'), 'true');
    assert.equal(form.get('client_reference_id'), '00000000-0000-4000-8000-000000000001');
    assert.equal(form.get('line_items[0][price]'), 'price_123');
});

test('stripe error surfaces type/code only, not the message', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
        error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such price: price_123' },
    }), { status: 400 });
    const res = await createCheckoutSession({ purchaseId: 'p', priceId: 'price_123', successUrl: 'x', cancelUrl: 'y' }, { secretKey: 'k' });
    assert.deepEqual(res, { ok: false, error: 'stripe 400 invalid_request_error/resource_missing' });
});
