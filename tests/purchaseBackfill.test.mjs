import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Next resolves the extensionless `next/server` through its bundler; plain
// Node ESM needs the file name.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const TOKEN = 'backfill-token-test';
process.env.ADMIN_BACKFILL_TOKEN = TOKEN;
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.STRIPE_SECRET_KEY = 'rk_test_x';

const { POST } = await import('../app/api/admin/backfill-purchases/route.js');

const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const OTHER = '00000000-0000-4000-8000-000000000099';
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

function stub({ pending, pages, fulfil = () => ({ ok: true, idempotent: false }) }) {
    const calls = { stripe: [], rpc: [], purchases: [] };
    let page = 0;
    globalThis.fetch = async (url, init) => {
        const u = new URL(String(url));
        if (u.pathname === '/rest/v1/purchases') {
            calls.purchases.push(u);
            return Response.json(pending);
        }
        if (u.hostname === 'api.stripe.com') {
            calls.stripe.push(u);
            return Response.json(pages[page++]);
        }
        if (u.pathname === '/rest/v1/rpc/purchase_fulfil') {
            const args = JSON.parse(init.body);
            calls.rpc.push(args);
            return Response.json(fulfil(args));
        }
        throw new Error(`unexpected fetch ${u}`);
    };
    return calls;
}

const run = (token = TOKEN) => POST(new Request('https://veyrnox.test/api/admin/backfill-purchases', {
    method: 'POST',
    headers: token ? { 'x-veyrnox-admin-token': token } : {},
}));

test('wrong or missing token is refused before any read', async () => {
    const calls = stub({ pending: [], pages: [] });
    assert.equal((await run('nope')).status, 401);
    assert.equal((await run(null)).status, 401);
    assert.equal(calls.purchases.length + calls.stripe.length, 0);
});

test('nothing pending means no Stripe call', async () => {
    const calls = stub({ pending: [], pages: [] });
    const res = await run();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { pending: 0, fulfilled: 0, failed: 0, truncated: false });
    assert.equal(calls.stripe.length, 0);
    // only purchases between 10 minutes and 24 hours old are read
    const ages = calls.purchases[0].searchParams.getAll('created_at');
    assert.equal(ages.length, 2);
    assert.match(ages[0], /^lt\./);
    assert.match(ages[1], /^gt\./);
    assert.equal(calls.purchases[0].searchParams.get('state'), 'eq.PENDING');
});

test('only paid sessions for pending purchases are fulfilled, across pages', async () => {
    const calls = stub({
        pending: [{ id: P1, created_at: minutesAgo(40) }, { id: P2, created_at: minutesAgo(20) }],
        pages: [
            { data: [
                { id: 'cs_other', client_reference_id: OTHER, mode: 'payment', payment_status: 'paid', payment_intent: 'pi_other' },
                { id: 'cs_p2', client_reference_id: P2, mode: 'payment', payment_status: 'unpaid', payment_intent: 'pi_p2' },
            ], has_more: true },
            { data: [
                { id: 'cs_p1', client_reference_id: P1, mode: 'payment', payment_status: 'paid', payment_intent: 'pi_p1' },
            ], has_more: false },
        ],
    });
    const res = await run();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { pending: 2, fulfilled: 1, failed: 0, truncated: false });
    assert.deepEqual(calls.rpc, [{ p_purchase_id: P1, p_session_id: 'cs_p1', p_payment_intent: 'pi_p1' }]);
    assert.equal(calls.stripe[0].searchParams.get('status'), 'complete');
    assert.equal(calls.stripe[1].searchParams.get('starting_after'), 'cs_p2');
    // sessions are listed from just before the oldest pending purchase
    const gte = Number(calls.stripe[0].searchParams.get('created[gte]'));
    assert.ok(Math.abs(gte - (Math.floor(Date.now() / 1000) - 40 * 60 - 300)) < 5);
});

test('a webhook that already fulfilled the purchase is not counted again', async () => {
    stub({
        pending: [{ id: P1, created_at: minutesAgo(15) }],
        pages: [{ data: [{ id: 'cs_p1', client_reference_id: P1, mode: 'payment', payment_status: 'paid', payment_intent: 'pi_p1' }], has_more: false }],
        fulfil: () => ({ ok: true, idempotent: true }),
    });
    const res = await run();
    assert.deepEqual(await res.json(), { pending: 1, fulfilled: 0, failed: 0, truncated: false });
});

test('a rejected fulfilment turns the run red', async () => {
    stub({
        pending: [{ id: P1, created_at: minutesAgo(15) }],
        pages: [{ data: [{ id: 'cs_p1', client_reference_id: P1, mode: 'payment', payment_status: 'paid', payment_intent: 'pi_p1' }], has_more: false }],
        fulfil: () => ({ ok: false, code: 'SESSION_MISMATCH' }),
    });
    const res = await run();
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { pending: 1, fulfilled: 0, failed: 1, truncated: false });
});
