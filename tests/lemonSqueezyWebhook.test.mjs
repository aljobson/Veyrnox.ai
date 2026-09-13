import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature, normaliseOrder, fetchOrder } from '../packages/adapters/lemonsqueezy.js';

const SECRET = '0123456789abcdef0123456789abcdef01234567';
const STORE_ID = '473468';
const TOP_UP_ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const body = new TextEncoder().encode(JSON.stringify({ meta: { event_name: 'order_created' }, data: { id: '42' } }));
const sign = (bytes, secret = SECRET) => createHmac('sha256', secret).update(bytes).digest('hex');

test('signature: valid hex HMAC-SHA256 over the raw body verifies', async () => {
    assert.equal(await verifyWebhookSignature(body, sign(body), SECRET), true);
    assert.equal(await verifyWebhookSignature(body, sign(body).toUpperCase(), SECRET), true, 'hex case-insensitive');
});

test('signature: tampered body fails', async () => {
    const tampered = new TextEncoder().encode(new TextDecoder().decode(body).replace('42', '43'));
    assert.equal(await verifyWebhookSignature(tampered, sign(body), SECRET), false);
});

test('signature: wrong secret fails', async () => {
    assert.equal(await verifyWebhookSignature(body, sign(body, 'f'.repeat(40)), SECRET), false);
});

test('signature: missing header or secret fails closed', async () => {
    assert.equal(await verifyWebhookSignature(body, null, SECRET), false);
    assert.equal(await verifyWebhookSignature(body, '', SECRET), false);
    assert.equal(await verifyWebhookSignature(body, sign(body), ''), false);
    assert.equal(await verifyWebhookSignature(body, sign(body), undefined), false);
});

test('signature: wrong length or non-hex fails', async () => {
    const good = sign(body);
    assert.equal(await verifyWebhookSignature(body, good.slice(0, 62), SECRET), false);
    assert.equal(await verifyWebhookSignature(body, `${good}00`, SECRET), false);
    assert.equal(await verifyWebhookSignature(body, `${good.slice(0, 63)}g`, SECRET), false);
});

function order(over = {}, itemOver = {}) {
    return {
        type: 'orders',
        id: '5550123',
        attributes: {
            store_id: 473468,
            currency: 'USD',
            subtotal: 2500,
            discount_total: 0,
            tax: 500,
            total: 3000,
            status: 'paid',
            refunded: false,
            refunded_amount: 0,
            test_mode: true,
            first_order_item: { variant_id: 2120828, price: 2500, test_mode: true, ...itemOver },
            ...over,
        },
    };
}

test('normaliseOrder: returns our shape with a string Top-up id from custom data', () => {
    const res = normaliseOrder(order(), { top_up_id: TOP_UP_ID }, { expectTestMode: true, expectStoreId: STORE_ID });
    assert.deepEqual(res, {
        ok: true,
        order: {
            orderId: '5550123',
            status: 'paid',
            paidCents: 2500,
            currency: 'USD',
            variantId: '2120828',
            refundedCents: 0,
            totalCents: 3000,
            topUpId: TOP_UP_ID,
            testMode: true,
        },
    });
});

test('normaliseOrder: pre-tax paid amount is subtotal less discount', () => {
    const res = normaliseOrder(order({ discount_total: 2500 }), { top_up_id: TOP_UP_ID }, { expectTestMode: true, expectStoreId: STORE_ID });
    assert.equal(res.order.paidCents, 0);
});

test('normaliseOrder: parses the cumulative refunded amount', () => {
    const res = normaliseOrder(order({ status: 'partial_refund', refunded_amount: 1250 }), { top_up_id: TOP_UP_ID }, { expectTestMode: true, expectStoreId: STORE_ID });
    assert.equal(res.order.refundedCents, 1250);
    assert.equal(res.order.totalCents, 3000, 'the refund share is measured against the tax-inclusive total');
});

test('normaliseOrder: rejects a non-UUID or missing Top-up id', () => {
    for (const custom of [{ top_up_id: 'not-a-uuid' }, { top_up_id: 12 }, {}, null, undefined, { top_up_id: `${TOP_UP_ID}x` }]) {
        const res = normaliseOrder(order(), custom, { expectTestMode: true, expectStoreId: STORE_ID });
        assert.deepEqual(res, { ok: false, error: 'invalid top_up_id' }, JSON.stringify(custom));
    }
});

test('normaliseOrder: rejects a test-mode mismatch either way', () => {
    assert.deepEqual(normaliseOrder(order(), { top_up_id: TOP_UP_ID }, { expectTestMode: false, expectStoreId: STORE_ID }), { ok: false, error: 'test_mode mismatch' });
    assert.deepEqual(
        normaliseOrder(order({ test_mode: false }, { test_mode: false }), { top_up_id: TOP_UP_ID }, { expectTestMode: true, expectStoreId: STORE_ID }),
        { ok: false, error: 'test_mode mismatch' },
    );
    assert.deepEqual(
        normaliseOrder(order({ test_mode: false }), { top_up_id: TOP_UP_ID }, { expectTestMode: false, expectStoreId: STORE_ID }),
        { ok: false, error: 'test_mode mismatch' },
        'either flag set means test mode',
    );
    assert.equal(
        normaliseOrder(order({ test_mode: false }, { test_mode: false }), { top_up_id: TOP_UP_ID }, { expectTestMode: false, expectStoreId: STORE_ID }).ok,
        true,
    );
});

test('normaliseOrder: rejects a malformed order', () => {
    const custom = { top_up_id: TOP_UP_ID };
    assert.equal(normaliseOrder(null, custom, { expectTestMode: true, expectStoreId: STORE_ID }).ok, false);
    assert.equal(normaliseOrder({ id: 'abc', attributes: order().attributes }, custom, { expectTestMode: true, expectStoreId: STORE_ID }).ok, false);
    assert.equal(normaliseOrder(order({ subtotal: '2500' }), custom, { expectTestMode: true, expectStoreId: STORE_ID }).ok, false);
    assert.equal(normaliseOrder(order({ total: null }), custom, { expectTestMode: true, expectStoreId: STORE_ID }).ok, false);
    assert.equal(normaliseOrder(order({ refunded_amount: -1 }), custom, { expectTestMode: true, expectStoreId: STORE_ID }).ok, false);
    assert.equal(normaliseOrder(order({}, { variant_id: null }), custom, { expectTestMode: true, expectStoreId: STORE_ID }).ok, false);
    assert.equal(normaliseOrder(order({ first_order_item: null }), custom, { expectTestMode: true, expectStoreId: STORE_ID }).ok, false);
});

function recorder(response = { data: order() }, status = 200) {
    const calls = [];
    const fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/vnd.api+json' } });
    };
    return { calls, fetch };
}

test('fetchOrder: GETs the constant API host with bearer auth and returns the order resource', async () => {
    const { calls, fetch } = recorder();
    const res = await fetchOrder('5550123', { fetch, apiKey: 'test_key' });
    assert.equal(res.ok, true);
    assert.equal(res.order.id, '5550123');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.lemonsqueezy.com/v1/orders/5550123');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test_key');
    assert.equal(calls[0].init.headers.Accept, 'application/vnd.api+json');
});

test('fetchOrder: refuses a non-numeric order id without calling the network', async () => {
    const { calls, fetch } = recorder();
    for (const id of ['../stores', '42?x=1', '', 'abc', '1'.repeat(21), null]) {
        const res = await fetchOrder(id, { fetch, apiKey: 'test_key' });
        assert.deepEqual(res, { ok: false, error: 'invalid orderId', transient: false });
    }
    assert.equal(calls.length, 0);
});

test('fetchOrder: missing key is not transient; 5xx, 429 and transport errors are', async () => {
    assert.deepEqual(await fetchOrder('1', { fetch: recorder().fetch, apiKey: '' }), { ok: false, error: 'missing apiKey', transient: false });
    assert.deepEqual(await fetchOrder('1', { fetch: recorder({}, 503).fetch, apiKey: 'k' }), { ok: false, error: 'lemonsqueezy 503', transient: true });
    assert.deepEqual(await fetchOrder('1', { fetch: recorder({}, 429).fetch, apiKey: 'k' }), { ok: false, error: 'lemonsqueezy 429', transient: true });
    assert.deepEqual(await fetchOrder('1', { fetch: recorder({}, 404).fetch, apiKey: 'k' }), { ok: false, error: 'lemonsqueezy 404', transient: false });
    const boom = async () => { throw new TypeError('network'); };
    assert.deepEqual(await fetchOrder('1', { fetch: boom, apiKey: 'k' }), { ok: false, error: 'transport: TypeError', transient: true });
});

test('fetchOrder: a response for a different order id is refused', async () => {
    const { fetch } = recorder({ data: order() });
    const res = await fetchOrder('999', { fetch, apiKey: 'k' });
    assert.deepEqual(res, { ok: false, error: 'order id mismatch', transient: false });
});

test('normaliseOrder: rejects an order from another store, or no configured store', () => {
    const custom = { top_up_id: TOP_UP_ID };
    assert.deepEqual(normaliseOrder(order({ store_id: 999999 }), custom, { expectTestMode: true, expectStoreId: STORE_ID }), { ok: false, error: 'store mismatch' });
    assert.deepEqual(normaliseOrder(order({ store_id: undefined }), custom, { expectTestMode: true, expectStoreId: STORE_ID }), { ok: false, error: 'store mismatch' });
    for (const bad of [undefined, '', 'abc']) {
        assert.deepEqual(normaliseOrder(order(), custom, { expectTestMode: true, expectStoreId: bad }), { ok: false, error: 'store mismatch' }, String(bad));
    }
});
