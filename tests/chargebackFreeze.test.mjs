import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { register } from 'node:module';
import { disputeOrderId, checkOrderOrigin } from '../packages/adapters/lemonsqueezy.js';

// Next resolves the extensionless `next/server` through its bundler; plain
// Node ESM needs the file name.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const SECRET = '0123456789abcdef0123456789abcdef01234567';
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    FAL_KEY: 'fal-test',
    PUBLIC_HOST: 'https://veyrnox.test',
    LEMONSQUEEZY_API_KEY: 'ls-test',
    LEMONSQUEEZY_STORE_ID: '473468',
    LEMONSQUEEZY_TEST_MODE: 'true',
    LEMONSQUEEZY_WEBHOOK_SECRET: SECRET,
});

const webhook = await import('../app/api/webhook/lemonsqueezy/route.js');
const generations = await import('../app/api/v1/generations/route.js');
const topUps = await import('../app/api/v1/top-ups/route.js');

// ── dispute payload parsing ────────────────────────────────────────────────
// ponytail: the dispute_created shape is undocumented (ADR-0019). These cover
// the explicit order fields we accept; pin a captured body when one exists.

test('disputeOrderId: reads an explicit order id and nothing else', () => {
    assert.equal(disputeOrderId({ data: { type: 'disputes', id: '77', attributes: { order_id: 5550123 } } }), '5550123');
    assert.equal(disputeOrderId({ data: { type: 'disputes', id: '77', attributes: { order_id: '5550123' } } }), '5550123');
    assert.equal(disputeOrderId({ data: { type: 'disputes', id: '77', relationships: { order: { data: { type: 'orders', id: '5550123' } } } } }), '5550123');
    assert.equal(disputeOrderId({ data: { type: 'orders', id: '5550123' } }), '5550123');
});

test('disputeOrderId: never mistakes a dispute id for an order id, and rejects junk', () => {
    for (const event of [
        { data: { type: 'disputes', id: '77' } },
        { data: { type: 'disputes', id: '77', attributes: { order_id: '../orders' } } },
        { data: { type: 'disputes', id: '77', attributes: { order_id: 1.5 } } },
        { data: { type: 'disputes', id: '77', relationships: { order: { data: { type: 'customers', id: '9' } } } } },
        { data: null },
        null,
    ]) {
        assert.equal(disputeOrderId(event), null, JSON.stringify(event));
    }
});

test('checkOrderOrigin: our store in the expected mode only', () => {
    const order = { id: '5550123', attributes: { store_id: 473468, test_mode: true } };
    const opts = { expectTestMode: true, expectStoreId: '473468' };
    assert.deepEqual(checkOrderOrigin(order, opts), { ok: true, testMode: true });
    assert.deepEqual(checkOrderOrigin({ ...order, attributes: { ...order.attributes, store_id: 1 } }, opts), { ok: false, error: 'store mismatch' });
    assert.deepEqual(checkOrderOrigin(order, { ...opts, expectTestMode: false }), { ok: false, error: 'test_mode mismatch' });
});

// ── routes ─────────────────────────────────────────────────────────────────

function signed(event) {
    const body = JSON.stringify(event);
    return new Request('https://veyrnox.test/api/webhook/lemonsqueezy', {
        method: 'POST',
        headers: { 'x-signature': createHmac('sha256', SECRET).update(body).digest('hex'), 'content-type': 'application/json' },
        body,
    });
}

function stubFetch(routes) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        calls.push({ url: u, body: init.body ? JSON.parse(init.body) : undefined, method: init.method });
        for (const [needle, reply] of routes) {
            if (u.includes(needle)) return typeof reply === 'function' ? reply(u, init) : Response.json(reply);
        }
        throw new Error(`unexpected fetch ${u}`);
    };
    return calls;
}

const lsOrder = { data: { type: 'orders', id: '5550123', attributes: { store_id: 473468, test_mode: true } } };

test('dispute_created Freezes by the order id only, never a user named in the payload', async () => {
    const calls = stubFetch([
        ['/rest/v1/webhook_events?on_conflict', (u) => new Response('[{"id":"e1"}]', { status: 201 })],
        ['/rest/v1/webhook_events', []],
        ['api.lemonsqueezy.com/v1/orders/5550123', lsOrder],
        ['/rpc/apply_dispute_event', { ok: true, user_id: 'u-owner', top_up_id: 't1', already_frozen: false }],
    ]);
    const res = await webhook.POST(signed({
        meta: { event_name: 'dispute_created', custom_data: { user_id: 'u-attacker' } },
        data: { type: 'disputes', id: 'dp_1', attributes: { order_id: 5550123, user_id: 'u-attacker' } },
    }));
    assert.equal(res.status, 200);
    const rpcCall = calls.find((c) => c.url.includes('/rpc/apply_dispute_event'));
    assert.deepEqual(rpcCall.body, { p_order_id: '5550123', p_event: 'created', p_reference: 'dp_1' });
    const dedupe = calls.find((c) => c.url.includes('on_conflict'));
    assert.equal(dedupe.body.external_id, 'dispute_created:dp_1');
});

test('dispute_resolved only logs through apply_dispute_event', async () => {
    const calls = stubFetch([
        ['/rest/v1/webhook_events?on_conflict', () => new Response('[{"id":"e2"}]', { status: 201 })],
        ['/rest/v1/webhook_events', []],
        ['api.lemonsqueezy.com/v1/orders/5550123', lsOrder],
        ['/rpc/apply_dispute_event', { ok: true, user_id: 'u-owner', top_up_id: 't1' }],
    ]);
    const res = await webhook.POST(signed({ meta: { event_name: 'dispute_resolved' }, data: { type: 'orders', id: '5550123' } }));
    assert.equal(res.status, 200);
    assert.equal(calls.find((c) => c.url.includes('/rpc/apply_dispute_event')).body.p_event, 'resolved');
    assert.ok(!calls.some((c) => c.url.includes('unfreeze')), 'never unfreezes');
});

test('a dispute with no usable order id: 200, logged, no Freeze', async () => {
    const calls = stubFetch([]);
    const res = await webhook.POST(signed({ meta: { event_name: 'dispute_created' }, data: { type: 'disputes', id: 'dp_2' } }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, warn: 'no_order_id' });
    assert.equal(calls.length, 0);
});

test('a dispute for an order from another store Freezes nobody', async () => {
    const calls = stubFetch([
        ['/rest/v1/webhook_events?on_conflict', () => new Response('[{"id":"e3"}]', { status: 201 })],
        ['/rest/v1/webhook_events', []],
        ['api.lemonsqueezy.com/v1/orders/5550123', { data: { type: 'orders', id: '5550123', attributes: { store_id: 1, test_mode: true } } }],
    ]);
    const res = await webhook.POST(signed({ meta: { event_name: 'dispute_created' }, data: { type: 'disputes', id: 'dp_3', attributes: { order_id: '5550123' } } }));
    assert.equal(res.status, 200);
    assert.ok(!calls.some((c) => c.url.includes('/rpc/')), 'no RPC');
});

test('a Frozen account gets 403 account_frozen from generations, and nothing is submitted', async () => {
    const calls = stubFetch([
        ['/rpc/check_generation_rate_limit', { ok: true }],
        ['/rest/v1/model_catalog', [{ id: 'm1', provider: 'fal', provider_endpoint: 'fal-ai/x', modality: 'text-to-image', credits_5s: 4, gated_flag: false, active: true }]],
        ['/rest/v1/users', [{ id: '00000000-0000-4000-8000-000000000009' }]],
        ['/rpc/ledger_debit', { ok: false, code: 'ACCOUNT_FROZEN' }],
    ]);
    const res = await generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST',
        headers: { 'x-veyrnox-auth-id': 'auth-user-1', 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: 'm1', idempotency_key: 'gen-key-0001', inputs: { prompt: 'a cat' } }),
    }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'account_frozen' });
    assert.ok(!calls.some((c) => c.url.includes('fal.run') || c.url.includes('queue.fal')), 'no provider submission');
});

test('a Frozen account gets 403 account_frozen from top-ups, and no checkout is created', async () => {
    const calls = stubFetch([['/rpc/create_pending_top_up', { ok: false, code: 'ACCOUNT_FROZEN' }]]);
    const res = await topUps.POST(new Request('https://veyrnox.test/api/v1/top-ups', {
        method: 'POST',
        headers: { 'x-veyrnox-auth-id': 'auth-user-1', 'content-type': 'application/json' },
        body: JSON.stringify({ pack_id: 'web-300', idempotency_key: 'topup-key-0001', consent: true, consent_version: 'supply-consent-v1' }),
    }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'account_frozen' });
    assert.ok(!calls.some((c) => c.url.includes('lemonsqueezy')), 'no checkout');
});

test('top-ups accepts only the approved Supply Consent version, before any DB call', async () => {
    for (const consent_version of [undefined, '', '2026-09-13', 'supply-consent-v2', 'SUPPLY-CONSENT-V1', ['supply-consent-v1']]) {
        const calls = stubFetch([]);
        const res = await topUps.POST(new Request('https://veyrnox.test/api/v1/top-ups', {
            method: 'POST',
            headers: { 'x-veyrnox-auth-id': 'auth-user-1', 'content-type': 'application/json' },
            body: JSON.stringify({ pack_id: 'web-300', idempotency_key: 'topup-key-0001', consent: true, consent_version }),
        }));
        assert.equal(res.status, 400, String(consent_version));
        assert.deepEqual(await res.json(), { error: 'consent_version_required' });
        assert.equal(calls.length, 0, 'no Top-up created');
    }
});
