import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { register } from 'node:module';

// Next resolves the extensionless `next/server` through its bundler; plain
// Node ESM needs the file name.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const LS_SECRET = '0123456789abcdef0123456789abcdef01234567';
const FAL_TENANT = 'tenant-ours';
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    LEMONSQUEEZY_API_KEY: 'ls-test',
    LEMONSQUEEZY_STORE_ID: '473468',
    LEMONSQUEEZY_TEST_MODE: 'true',
    LEMONSQUEEZY_WEBHOOK_SECRET: LS_SECRET,
    FAL_WEBHOOK_USER_ID: FAL_TENANT,
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'bucket',
});

const { createCheckout } = await import('../packages/adapters/lemonsqueezy.js');
const lsWebhook = await import('../app/api/webhook/lemonsqueezy/route.js');
const falWebhook = await import('../app/api/webhook/fal/route.js');

function stubFetch(routes) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        calls.push({ url: u, method: init.method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
        for (const [needle, reply] of routes) {
            if (u.includes(needle)) return typeof reply === 'function' ? reply(u, init) : Response.json(reply);
        }
        throw new Error(`unexpected fetch ${u}`);
    };
    return calls;
}

// ── LemonSqueezy: a buy link can't name someone else's Top-up ──────────────

const TOP_UP_ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const paidOrder = { data: { type: 'orders', id: '5550123', attributes: {
    store_id: 473468, currency: 'USD', subtotal: 2500, discount_total: 0, total: 3000, status: 'paid',
    refunded_amount: 0, test_mode: true, first_order_item: { variant_id: 2120828, test_mode: true },
} } };

function lsSigned(customData) {
    const body = JSON.stringify({ meta: { event_name: 'order_created', custom_data: customData }, data: { type: 'orders', id: '5550123' } });
    return new Request('https://veyrnox.test/api/webhook/lemonsqueezy', {
        method: 'POST',
        headers: { 'x-signature': createHmac('sha256', LS_SECRET).update(body).digest('hex'), 'content-type': 'application/json' },
        body,
    });
}

const lsRoutes = () => [
    ['/rest/v1/webhook_events?on_conflict', () => new Response('[{"id":"e1"}]', { status: 201 })],
    ['/rest/v1/webhook_events', []],
    ['api.lemonsqueezy.com/v1/orders/5550123', paidOrder],
    ['/rpc/credit_top_up', { ok: true, top_up_id: TOP_UP_ID }],
];

test('order_created naming a Top-up without our signature credits nothing', async () => {
    for (const customData of [{ top_up_id: TOP_UP_ID }, { top_up_id: TOP_UP_ID, top_up_sig: 'ab'.repeat(32) }]) {
        const calls = stubFetch(lsRoutes());
        const res = await lsWebhook.POST(lsSigned(customData));
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { ok: true, warn: 'order_not_creditable' });
        assert.ok(!calls.some((c) => c.url.includes('/rpc/')), 'no RPC');
        assert.ok(calls.some((c) => c.method === 'PATCH' && c.url.includes('webhook_events')), 'marked processed');
    }
});

test('order_created from our own checkout credits its Top-up', async () => {
    const checkoutCalls = stubFetch([['api.lemonsqueezy.com/v1/checkouts', { data: { attributes: { url: 'https://veyrnox.lemonsqueezy.com/checkout/x' } } }]]);
    await createCheckout({ variantId: '2120828', topUpId: TOP_UP_ID },
        { fetch: globalThis.fetch, apiKey: 'ls-test', storeId: '473468', publicHost: 'https://veyrnox.test', signingSecret: LS_SECRET });
    const custom = checkoutCalls[0].body.data.attributes.checkout_data.custom;

    const calls = stubFetch(lsRoutes());
    const res = await lsWebhook.POST(lsSigned(custom));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(calls.find((c) => c.url.includes('/rpc/credit_top_up')).body.p_top_up_id, TOP_UP_ID);
});

// ── fal: a callback that beat job_submitted is redelivered, not dropped ─────

const falKeys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const falJwk = await crypto.subtle.exportKey('jwk', falKeys.publicKey);

async function falSigned(requestId, event) {
    const body = JSON.stringify(event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const hash = createHash('sha256').update(body).digest('hex');
    const message = new TextEncoder().encode(`${requestId}\n${FAL_TENANT}\n${timestamp}\n${hash}`);
    const sig = Buffer.from(await crypto.subtle.sign({ name: 'Ed25519' }, falKeys.privateKey, message)).toString('hex');
    return new Request('https://veyrnox.test/api/webhook/fal', {
        method: 'POST',
        headers: {
            'x-fal-webhook-signature': sig,
            'x-fal-webhook-timestamp': timestamp,
            'x-fal-webhook-request-id': requestId,
            'x-fal-webhook-user-id': FAL_TENANT,
        },
        body,
    });
}

test('a fal success callback with no job yet answers 409 before the dedup row, so fal retries', async () => {
    const calls = stubFetch([
        ['rest.alpha.fal.ai/.well-known/jwks.json', { keys: [{ ...falJwk, kid: 'k1' }] }],
        ['/rest/v1/jobs', []],
        // Composite-job steps (ADR-0029) are checked next; no step either.
        ['/rest/v1/job_steps', []],
    ]);
    const res = await falWebhook.POST(await falSigned('req-early', { request_id: 'req-early', status: 'OK', payload: { images: [{ url: 'https://fal.media/x.png' }] } }));
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'job_not_found' });
    assert.ok(!calls.some((c) => c.url.includes('webhook_events')), 'delivery not consumed');
    assert.ok(!calls.some((c) => c.url.includes('/rpc/')), 'no state change');
});

test('a fal callback whose job lookup fails answers 500, not 200', async () => {
    const calls = stubFetch([
        ['rest.alpha.fal.ai/.well-known/jwks.json', { keys: [{ ...falJwk, kid: 'k1' }] }],
        ['/rest/v1/jobs', () => new Response('{}', { status: 503 })],
    ]);
    const res = await falWebhook.POST(await falSigned('req-db-down', { request_id: 'req-db-down', status: 'OK' }));
    assert.equal(res.status, 500);
    assert.ok(!calls.some((c) => c.url.includes('webhook_events')), 'delivery not consumed');
});
