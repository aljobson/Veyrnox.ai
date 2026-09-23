import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { register } from 'node:module';

// Next resolves the extensionless `next/server` through its bundler; plain
// Node ESM needs the file name.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const SECRET = 'whsec_0123456789abcdef0123456789abcdef';
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: SECRET,
    PUBLIC_HOST: 'https://veyrnox.test',
});

const { createCheckout } = await import('../packages/adapters/stripe.js');
const stripeWebhook = await import('../app/api/webhook/stripe/route.js');

const TOP_UP_ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const SESSION_ID = 'cs_test_123';
const PAYMENT_INTENT = 'pi_test_456';

function stubFetch(routes) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        calls.push({ url: u, method: init.method, body: typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : undefined });
        for (const [needle, reply] of routes) {
            if (u.includes(needle)) return typeof reply === 'function' ? reply(u, init) : Response.json(reply);
        }
        throw new Error(`unexpected fetch ${u}`);
    };
    return calls;
}

// The metadata a real checkout of ours produces — signature included.
const checkoutMetadata = await (async () => {
    let body;
    globalThis.fetch = async (_u, init) => {
        body = new URLSearchParams(init.body);
        return Response.json({ id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/x', object: 'checkout.session' });
    };
    const r = await createCheckout({ topUpId: TOP_UP_ID, priceUsdCents: 2500, credits: 300 },
        { fetch: globalThis.fetch, apiKey: 'sk_test_x', publicHost: 'https://veyrnox.test', signingSecret: SECRET });
    assert.equal(r.ok, true);
    return { top_up_id: body.get('metadata[top_up_id]'), top_up_sig: body.get('metadata[top_up_sig]') };
})();

function signed(event, { secret = SECRET, skewSeconds = 0 } = {}) {
    const body = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000) + skewSeconds;
    const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    return new Request('https://veyrnox.test/api/webhook/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': `t=${t},v1=${v1}`, 'content-type': 'application/json' },
        body,
    });
}

const sessionEvent = (id, metadata) => ({
    id, type: 'checkout.session.completed', livemode: false,
    data: { object: { id: SESSION_ID, object: 'checkout.session', metadata } },
});

const paidSession = (metadata) => ({
    id: SESSION_ID, object: 'checkout.session', livemode: false, payment_status: 'paid',
    amount_subtotal: 2500, amount_total: 2500, currency: 'usd', payment_intent: PAYMENT_INTENT,
    metadata,
});

const routes = ({ duplicate = false, session = paidSession(checkoutMetadata), credit = { ok: true, top_up_id: TOP_UP_ID } } = {}) => [
    ['/rest/v1/webhook_events?on_conflict', () => (duplicate ? Response.json([]) : new Response('[{"id":"e1"}]', { status: 201 }))],
    ['/rest/v1/webhook_events', (u, init) => (init.method === 'PATCH' ? new Response(null, { status: 204 }) : Response.json([{ processed_at: '2026-09-23T00:00:00Z' }]))],
    [`api.stripe.com/v1/checkout/sessions/${SESSION_ID}`, session],
    ['/rpc/credit_top_up', credit],
    ['/rpc/apply_top_up_refund', { ok: true, taken: 300, shortfall: 0, frozen: false }],
];

test('a signed checkout.session.completed from our own checkout credits its Top-up', async () => {
    const calls = stubFetch(routes());
    const res = await stripeWebhook.POST(signed(sessionEvent('evt_1', checkoutMetadata)));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    const credit = calls.find((c) => c.url.includes('/rpc/credit_top_up')).body;
    assert.equal(credit.p_top_up_id, TOP_UP_ID, 'Top-up id from the signed metadata');
    // A dispute names the charge, not the session, so the PaymentIntent is the order id.
    assert.equal(credit.p_order_id, PAYMENT_INTENT);
    assert.equal(credit.p_paid_usd_cents, 2500, 'the pre-tax amount Stripe reports');
    assert.equal(credit.p_currency, 'USD', 'credit_top_up compares against the literal USD');
    assert.ok(calls.some((c) => c.method === 'PATCH' && c.url.includes('webhook_events')), 'marked processed');
});

test('a session whose metadata lacks our signature credits nothing', async () => {
    for (const metadata of [{ top_up_id: TOP_UP_ID }, { top_up_id: TOP_UP_ID, top_up_sig: 'ab'.repeat(32) }, undefined]) {
        const calls = stubFetch(routes());
        const res = await stripeWebhook.POST(signed(sessionEvent('evt_unsigned', metadata)));
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { ok: true, warn: 'session_not_creditable' });
        assert.ok(!calls.some((c) => c.url.includes('/rpc/')), 'no RPC');
        assert.ok(!calls.some((c) => c.url.includes('api.stripe.com')), 'not even re-fetched');
        assert.ok(calls.some((c) => c.method === 'PATCH' && c.url.includes('webhook_events')), 'marked processed');
    }
});

test('a forged Stripe-Signature is refused before any database read', async () => {
    for (const req of [
        signed(sessionEvent('evt_forged', checkoutMetadata), { secret: 'whsec_not_ours' }),
        // A captured delivery replayed outside the ±5 min window (ADR-0031).
        signed(sessionEvent('evt_stale', checkoutMetadata), { skewSeconds: -3600 }),
    ]) {
        const calls = stubFetch(routes());
        const res = await stripeWebhook.POST(req);
        assert.equal(res.status, 401);
        assert.deepEqual(await res.json(), { error: 'invalid_signature' });
        assert.equal(calls.length, 0, 'nothing was read');
    }
});

test('a redelivered event id is a no-op', async () => {
    const calls = stubFetch(routes({ duplicate: true }));
    const res = await stripeWebhook.POST(signed(sessionEvent('evt_1', checkoutMetadata)));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, duplicate: true });
    assert.ok(!calls.some((c) => c.url.includes('/rpc/')), 'no RPC');
    assert.ok(!calls.some((c) => c.url.includes('api.stripe.com')), 'no re-fetch');
});

test('charge.refunded claws back the cumulative amount refunded', async () => {
    const calls = stubFetch(routes());
    const res = await stripeWebhook.POST(signed({
        id: 'evt_refund', type: 'charge.refunded', livemode: false,
        data: { object: { id: 'ch_1', object: 'charge', payment_intent: PAYMENT_INTENT, amount: 2500, amount_refunded: 1000, metadata: checkoutMetadata } },
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    const refund = calls.find((c) => c.url.includes('/rpc/apply_top_up_refund')).body;
    assert.equal(refund.p_order_id, PAYMENT_INTENT);
    assert.equal(refund.p_refunded_cents, 1000, 'cumulative, not this refund alone');
    assert.equal(refund.p_total_cents, 2500);
    assert.equal(refund.p_top_up_id, TOP_UP_ID);
    assert.ok(calls.some((c) => c.method === 'PATCH' && c.url.includes('webhook_events')), 'marked processed');
});

test('a live-mode event never reaches a test-key account, and unknown types are ignored', async () => {
    for (const event of [
        { ...sessionEvent('evt_live', checkoutMetadata), livemode: true },
        { id: 'evt_other', type: 'invoice.paid', livemode: false, data: { object: {} } },
    ]) {
        const calls = stubFetch(routes());
        const res = await stripeWebhook.POST(signed(event));
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { ok: true, ignored: true });
        assert.equal(calls.length, 0, 'nothing was read');
    }
});
