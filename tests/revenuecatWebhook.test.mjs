import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { register } from 'node:module';
import { verifyWebhookSignature, parseStoreEvent } from '../packages/adapters/revenuecat.js';

// The routes import 'next/server'; plain Node needs the extension (same hook as the other route tests).
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`));
const { POST } = await import('../app/api/webhook/revenuecat/route.js');
const { GET: customerGet } = await import('../app/api/v1/store-purchases/customer/route.js');

const SECRET = 'rc_whsec_test';
const CUSTOMER = '3f2b8a52-6c0e-4d7a-9b1f-0a1b2c3d4e5f';
const now = () => Math.floor(Date.now() / 1000);
const sign = (raw, t = now(), secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
const purchase = (over = {}) => ({
    api_version: '1.0',
    event: {
        type: 'NON_RENEWING_PURCHASE', id: 'evt-aaaaaaaa-1', app_user_id: CUSTOMER, original_app_user_id: CUSTOMER,
        product_id: 'ai.veyrnox.credits.100', transaction_id: 'GPA.1234-5678-9012-34567', store: 'PLAY_STORE', environment: 'PRODUCTION',
        price: 14.99, currency: 'USD', ...over,
    },
});

test('verifies a good signature and rejects tampering, staleness and other secrets', async () => {
    const raw = JSON.stringify(purchase());
    const bytes = new TextEncoder().encode(raw);
    assert.equal(await verifyWebhookSignature(bytes, sign(raw), SECRET), true);
    assert.equal(await verifyWebhookSignature(new TextEncoder().encode(raw + ' '), sign(raw), SECRET), false);
    assert.equal(await verifyWebhookSignature(bytes, sign(raw, now() - 3600), SECRET), false);
    assert.equal(await verifyWebhookSignature(bytes, sign(raw, now(), 'other'), SECRET), false);
    assert.equal(await verifyWebhookSignature(bytes, 'garbage', SECRET), false);
    assert.equal(await verifyWebhookSignature(bytes, null, SECRET), false);
    assert.equal(await verifyWebhookSignature(bytes, sign(raw), ''), false);
});

test('parses purchases and refunds and ignores everything else', () => {
    assert.deepEqual(parseStoreEvent(purchase()), {
        kind: 'purchase', eventId: 'evt-aaaaaaaa-1', channel: 'android', productId: 'ai.veyrnox.credits.100',
        transactionId: 'GPA.1234-5678-9012-34567', customerIds: [CUSTOMER], sandbox: false,
    });
    assert.equal(parseStoreEvent(purchase({ type: 'CANCELLATION', store: 'APP_STORE', cancel_reason: 'CUSTOMER_SUPPORT' })).kind, 'refund');
    assert.equal(parseStoreEvent(purchase({ environment: 'SANDBOX' })).sandbox, true);
    // The Test Store is sandbox by construction, even if an event claims production.
    const test = parseStoreEvent(purchase({ store: 'TEST_STORE', environment: 'PRODUCTION' }));
    assert.deepEqual([test.kind, test.channel, test.sandbox], ['purchase', 'ios', true]);
    for (const bad of [{ type: 'INITIAL_PURCHASE' }, { store: 'STRIPE' }, { transaction_id: '' }, { id: 'x' }, { product_id: 'bad id!' }]) {
        assert.equal(parseStoreEvent(purchase(bad)).kind, 'ignore', JSON.stringify(bad));
    }
    assert.equal(parseStoreEvent(null).kind, 'ignore');
    // Only well-formed customer ids survive; an account id or a free-form name never reaches the database.
    assert.deepEqual(parseStoreEvent(purchase({ app_user_id: 'someone@example.com', original_app_user_id: CUSTOMER.toUpperCase() })).customerIds, [CUSTOMER]);
});

// ── the route, with the database mocked at fetch ─────────────────────────────────────────────
let calls;
let handlers;
const realFetch = globalThis.fetch;
const env = { ...process.env };

beforeEach(() => {
    calls = [];
    handlers = {};
    Object.assign(process.env, {
        SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'srk', STORE_BILLING_ENABLED: 'true', REVENUECAT_WEBHOOK_SECRET: SECRET,
    });
    delete process.env.STORE_BILLING_ALLOW_SANDBOX;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const name = u.pathname.startsWith('/rest/v1/rpc/') ? u.pathname.slice('/rest/v1/rpc/'.length) : u.pathname.slice('/rest/v1/'.length);
        calls.push({ name, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
        const h = handlers[name];
        if (h) return h(init);
        if (name === 'webhook_events') return new Response(init.method === 'POST' ? '[{"id":1}]' : '[]', { status: init.method === 'POST' ? 201 : 200 });
        return new Response('{}', { status: 200 });
    };
});
afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
});

const rpcCalls = (name) => calls.filter((c) => c.name === name);
const send = (body, { signature, secret } = {}) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    return POST(new Request('https://x.test/api/webhook/revenuecat', {
        method: 'POST', headers: { 'x-revenuecat-webhook-signature': signature ?? sign(raw, now(), secret) }, body: raw,
    }));
};
const json = (obj, status = 200) => () => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

test('is invisible while the flag is off', async () => {
    process.env.STORE_BILLING_ENABLED = 'false';
    assert.equal((await send(purchase())).status, 404);
    assert.equal(calls.length, 0);
});

test('rejects a bad signature without touching the database', async () => {
    const res = await send(purchase(), { signature: 'nope' });
    assert.equal(res.status, 401);
    assert.equal((await send(purchase(), { secret: 'other' })).status, 401);
    assert.equal(calls.length, 0);
});

test('credits a production purchase through credit_store_purchase, naming no account', async () => {
    handlers.credit_store_purchase = json({ ok: true, idempotent: false, credits: 100 });
    const res = await send(purchase());
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()), { ok: true });
    assert.deepEqual(rpcCalls('credit_store_purchase')[0].body, {
        p_rc_customer_id: CUSTOMER, p_channel: 'android', p_store_product_id: 'ai.veyrnox.credits.100', p_transaction_id: 'GPA.1234-5678-9012-34567',
    });
});

test('never credits a sandbox purchase in production, and does on staging', async () => {
    handlers.credit_store_purchase = json({ ok: true, idempotent: false });
    const sandbox = purchase({ environment: 'SANDBOX' });
    assert.equal((await (await send(sandbox)).json()).ignored, true);
    assert.equal(rpcCalls('credit_store_purchase').length, 0);
    process.env.STORE_BILLING_ALLOW_SANDBOX = 'true';
    assert.equal((await send(sandbox)).status, 200);
    assert.equal(rpcCalls('credit_store_purchase').length, 1);
});

test('answers a replayed event as a duplicate with no second grant', async () => {
    handlers.webhook_events = (init) => init.method === 'POST'
        ? new Response('[]', { status: 200 })
        : new Response('[{"processed_at":"2026-10-17T00:00:00Z"}]', { status: 200 });
    const res = await send(purchase());
    assert.equal((await res.json()).duplicate, true);
    assert.equal(rpcCalls('credit_store_purchase').length, 0);
});

test('records a final verdict for an unknown pack and answers 200 with a warning', async () => {
    handlers.credit_store_purchase = json({ ok: false, code: 'PACK_NOT_FOUND' });
    const res = await send(purchase());
    assert.equal(res.status, 200);
    assert.equal((await res.json()).warn, 'pack_not_found');
});

test('tries the original customer id when the current one is unknown', async () => {
    const other = '9c1d2e3f-0000-4000-8000-000000000001';
    let n = 0;
    handlers.credit_store_purchase = () => json(n++ === 0 ? { ok: false, code: 'CUSTOMER_NOT_FOUND' } : { ok: true })();
    assert.equal((await send(purchase({ app_user_id: other }))).status, 200);
    assert.deepEqual(rpcCalls('credit_store_purchase').map((c) => c.body.p_rc_customer_id), [other, CUSTOMER]);
});

test('asks RevenueCat to retry when the database fails', async () => {
    handlers.credit_store_purchase = () => new Response('{}', { status: 500 });
    assert.equal((await send(purchase())).status, 500);
});

test('turns a cancellation into a store refund, and ignores one we never credited', async () => {
    handlers.apply_store_refund = json({ ok: true, taken: 100 });
    const refund = purchase({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' });
    assert.equal((await send(refund)).status, 200);
    assert.deepEqual(rpcCalls('apply_store_refund')[0].body, { p_channel: 'android', p_transaction_id: 'GPA.1234-5678-9012-34567' });
    handlers.apply_store_refund = json({ ok: false, code: 'ORDER_NOT_FOUND' });
    assert.equal((await (await send(purchase({ type: 'CANCELLATION', id: 'evt-bbbbbbbb-2' }))).json()).ignored, true);
});

test('the customer id route is off, authenticated, and returns only the caller\'s own id', async () => {
    const get = (headers = {}) => customerGet(new Request('https://x.test/api/v1/store-purchases/customer', { headers }));
    process.env.STORE_BILLING_ENABLED = 'false';
    assert.equal((await get({ 'x-veyrnox-auth-id': CUSTOMER })).status, 404);
    process.env.STORE_BILLING_ENABLED = 'true';
    assert.equal((await get()).status, 401);
    assert.equal((await get({ 'x-veyrnox-auth-id': 'not-a-uuid' })).status, 401);
    handlers.get_or_create_store_customer = json({ ok: true, rc_customer_id: CUSTOMER });
    const res = await get({ 'x-veyrnox-auth-id': '11111111-1111-4111-8111-111111111111' });
    assert.deepEqual(await res.json(), { rc_customer_id: CUSTOMER });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(rpcCalls('get_or_create_store_customer')[0].body, { p_auth_id: '11111111-1111-4111-8111-111111111111' });
});
