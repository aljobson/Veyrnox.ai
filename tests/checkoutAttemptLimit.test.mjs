import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { verifyTopUpMetadata } from '../packages/adapters/stripe.js';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role',
    STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_fake',
    PUBLIC_HOST: 'https://veyrnox.test', TOP_UP_CHECKOUT_RATE_LIMIT_ENABLED: 'true',
});
const { POST } = await import('../app/api/v1/top-ups/route.js');
const auth = '11111111-1111-4111-8111-111111111111';
const topUp = '22222222-2222-4222-8222-222222222222';
const body = { pack_id: 'starter', idempotency_key: 'same-key-123', consent: true, consent_version: 'supply-consent-v1' };
const created = { ok: true, idempotent: true, top_up_id: topUp, credits: 100, price_usd_cents: 1000 };
const post = (payload = body, identity = auth) => POST(new Request('https://veyrnox.test/api/v1/top-ups', {
    method: 'POST', headers: identity ? { 'x-veyrnox-auth-id': identity, 'x-veyrnox-auth-email': 'verified@test.invalid' } : {},
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
}));
let calls, stripeKeys;
function stub({ rate = { ok: true }, result = created, fail, stripeFailure = false } = {}) {
    calls = []; stripeKeys = [];
    globalThis.fetch = async (url, init) => {
        const u = new URL(url), name = u.hostname === 'api.stripe.com' ? 'stripe' : u.pathname.split('/').pop();
        calls.push(name);
        if (fail === name) throw new Error('private backend details');
        if (name === 'consume_top_up_checkout_request') {
            assert.deepEqual(JSON.parse(init.body), { p_auth_id: auth });
            return Response.json(typeof rate === 'function' ? rate() : rate);
        }
        if (name === 'create_pending_top_up') {
            assert.deepEqual(JSON.parse(init.body), {
                p_auth_id: auth, p_pack_id: 'starter', p_idempotency_key: 'same-key-123',
                p_consent_version: 'supply-consent-v1', p_limit_per_window: 5, p_window_seconds: 600,
            });
            return Response.json(result);
        }
        assert.equal(name, 'stripe');
        assert.equal(u.pathname, '/v1/checkout/sessions');
        const form = new URLSearchParams(init.body);
        assert.equal(form.get('line_items[0][price_data][unit_amount]'), '1000');
        assert.equal(form.get('line_items[0][price_data][currency]'), 'usd');
        assert.equal(form.get('automatic_tax[enabled]'), 'true');
        assert.equal(form.get('client_reference_id'), topUp);
        assert.equal(form.get('customer_email'), 'verified@test.invalid');
        assert.ok(await verifyTopUpMetadata({ top_up_id: form.get('metadata[top_up_id]'), top_up_sig: form.get('metadata[top_up_sig]') }, process.env.STRIPE_WEBHOOK_SECRET));
        assert.equal(form.get('metadata[top_up_sig]'), form.get('payment_intent_data[metadata][top_up_sig]'));
        assert.match(form.get('success_url'), /&session_id=\{CHECKOUT_SESSION_ID\}$/);
        const key = init.headers['Idempotency-Key']; stripeKeys.push(key);
        assert.match(key, new RegExp(`^top_up:${topUp}:[0-9]+$`));
        const bucket = Number(key.split(':').at(-1));
        assert.equal(Number(form.get('expires_at')), (bucket + 2) * 3600);
        return stripeFailure ? Response.json({ error: { code: 'unavailable' } }, { status: 500 })
            : Response.json({ id: 'cs_test_fake', url: 'https://checkout.stripe.com/c/pay/test' });
    };
}
test('identity and cheap validation reject before quota, Top-up writer or Stripe', async () => {
    stub();
    for (const identity of [null, 'bad', '../forged']) assert.equal((await post(body, identity)).status, 401);
    for (const payload of ['{', null, [], { ...body, pack_id: '../bad' }, { ...body, idempotency_key: 'bad' },
        { ...body, consent: false }, { ...body, consent: 'true' }, { ...body, consent_version: 'wrong' }]) {
        assert.equal((await post(payload)).status, 400);
    }
    assert.deepEqual(calls, []);
});
test('quota denial stops before the writer and Stripe and returns bounded uncached Retry-After', async () => {
    for (const [value, expected] of [[15, 15], [0, 1], [600, 60], [null, 60], ['bad', 60]]) {
        stub({ rate: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: value } });
        const res = await post();
        assert.equal(res.status, 429);
        assert.equal(res.headers.get('retry-after'), String(expected));
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await res.json(), { error: 'rate_limited', retry_after_seconds: expected });
        assert.deepEqual(calls, ['consume_top_up_checkout_request']);
    }
});
test('unknown users and broken limiter stop all purchase work', async () => {
    stub({ rate: { ok: false, code: 'NOT_FOUND' } });
    const unknown = await post();
    assert.equal(unknown.status, 409);
    assert.deepEqual(await unknown.json(), { error: 'user_not_found' });
    for (const rate of [null, {}, { ok: 'true' }, { ok: false, code: 'other' }]) {
        stub({ rate });
        const res = await post();
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { error: 'rate_limit_unavailable' });
        assert.deepEqual(calls, ['consume_top_up_checkout_request']);
    }
    stub({ fail: 'consume_top_up_checkout_request' });
    assert.equal((await post()).status, 503);
    assert.deepEqual(calls, ['consume_top_up_checkout_request']);
});
test('repeated identical keys consume attempts and retain checkout idempotency/metadata', async () => {
    let attempts = 0;
    stub({ rate: () => ++attempts <= 2 ? { ok: true } : { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 60 } });
    for (let i = 0; i < 2; i++) {
        const res = await post();
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { top_up_id: topUp, idempotent: true, checkout_url: 'https://checkout.stripe.com/c/pay/test' });
    }
    assert.equal((await post()).status, 429);
    assert.equal(attempts, 3);
    assert.equal(calls.filter((c) => c === 'create_pending_top_up').length, 2);
    assert.equal(stripeKeys.length, 2);
    // Keys may legitimately change at the hour boundary; each key's expiry
    // and Top-up binding are verified in the Stripe stub above.
    assert.equal(calls.at(-1), 'consume_top_up_checkout_request');
});
test('existing creation limits, frozen accounts and catalog errors still stop Stripe', async () => {
    for (const [code, status] of [['RATE_LIMITED', 429], ['ACCOUNT_FROZEN', 403], ['PACK_NOT_FOUND', 404], ['IDEMPOTENCY_KEY_REUSED', 409]]) {
        stub({ result: { ok: false, code, retry_after_seconds: 500 } });
        const res = await post();
        assert.equal(res.status, status);
        if (code === 'RATE_LIMITED') assert.equal(res.headers.get('retry-after'), '500');
        assert.deepEqual(calls, ['consume_top_up_checkout_request', 'create_pending_top_up']);
    }
});
test('writer and Stripe failures remain typed errors and retries consume quota again', async () => {
    stub({ fail: 'create_pending_top_up' });
    assert.equal((await post()).status, 502);
    assert.ok(!calls.includes('stripe'));
    stub({ stripeFailure: true });
    for (let i = 0; i < 2; i++) {
        const res = await post();
        assert.equal(res.status, 502);
        assert.deepEqual(await res.json(), { error: 'checkout_failed' });
    }
    assert.equal(calls.filter((c) => c === 'consume_top_up_checkout_request').length, 2);
});
test('disabled rollout still works against the pre-migration database', async () => {
    process.env.TOP_UP_CHECKOUT_RATE_LIMIT_ENABLED = 'false';
    try {
        stub({ fail: 'consume_top_up_checkout_request', result: { ...created, idempotent: false } });
        const res = await post();
        assert.equal(res.status, 200);
        assert.equal((await res.json()).idempotent, false);
        assert.deepEqual(calls, ['create_pending_top_up', 'stripe']);
    } finally { process.env.TOP_UP_CHECKOUT_RATE_LIMIT_ENABLED = 'true'; }
});
