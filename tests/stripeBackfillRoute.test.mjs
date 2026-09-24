import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { POST } = await import('../app/api/admin/top-up-backfill/route.js');
const ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const SESSION = 'cs_test_' + 'a'.repeat(64);
const SECRET = 'whsec_test_only';
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
    STRIPE_SECRET_KEY: 'sk_test_only', STRIPE_WEBHOOK_SECRET: SECRET, TOP_UP_BACKFILL_TOKEN: 'cron-test-only' });
for (const name of ['LEMONSQUEEZY_API_KEY', 'LEMONSQUEEZY_STORE_ID', 'LEMONSQUEEZY_TEST_MODE']) delete process.env[name];
const request = (token = 'cron-test-only') => new Request('https://veyrnox.test/api/admin/top-up-backfill', {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
});

test('cron runs with only Stripe configuration, uses credit_top_up and closes NULL identifier', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const path = new URL(url).pathname;
        calls.push({ path, body: init.body && JSON.parse(init.body) });
        if (path.endsWith('/next_top_up_backfill_batch')) return Response.json([{ top_up_id: ID, order_id: SESSION, order_identifier: null }]);
        if (path === '/v1/checkout/sessions/' + SESSION) return Response.json({
            id: SESSION, object: 'checkout.session', livemode: false, client_reference_id: ID,
            metadata: { top_up_id: ID, top_up_sig: createHmac('sha256', SECRET).update(`top_up:${ID}`).digest('hex') },
            payment_status: 'paid', payment_intent: 'pi_1', amount_subtotal: 2500, amount_total: 3000, currency: 'usd',
        });
        if (path.endsWith('/credit_top_up') || path.endsWith('/close_top_up_return')) return Response.json({ ok: true });
        throw new Error('unexpected call: ' + path);
    };
    const res = await POST(request());
    assert.equal(res.status, 200);
    const out = await res.json(); assert.equal(out.credited, 1); assert.equal(out.sweep, null);
    assert.deepEqual(calls.map((c) => c.path), ['/rest/v1/rpc/next_top_up_backfill_batch', '/v1/checkout/sessions/' + SESSION,
        '/rest/v1/rpc/credit_top_up', '/rest/v1/rpc/close_top_up_return']);
    assert.deepEqual(calls[2].body, { p_top_up_id: ID, p_order_id: 'pi_1', p_paid_usd_cents: 2500, p_currency: 'USD', p_variant_id: null });
    assert.deepEqual(calls[3].body, { p_top_up_id: ID, p_order_id: SESSION, p_order_identifier: null });
});

test('cron retains authentication and rejects missing Stripe configuration before reading rows', async () => {
    globalThis.fetch = () => { throw new Error('must not fetch'); };
    assert.equal((await POST(request('wrong'))).status, 401);
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try { assert.equal((await POST(request())).status, 503); }
    finally { process.env.STRIPE_WEBHOOK_SECRET = secret; }
});
