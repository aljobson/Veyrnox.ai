import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createCheckout, fetchSession } from '../packages/adapters/stripe.js';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { POST } = await import('../app/api/v1/top-ups/[id]/return/route.js');
const ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const SESSION = 'cs_test_' + 'A'.repeat(64);
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only' });
function request(body, auth = 'buyer') {
    return new Request('https://veyrnox.test/api/v1/top-ups/' + ID + '/return', {
        method: 'POST', headers: auth ? { 'x-veyrnox-auth-id': auth } : {}, body: JSON.stringify(body),
    });
}
const params = { params: Promise.resolve({ id: ID.toUpperCase() }) };

test('checkout success_url preserves literal template braces after form decoding', async () => {
    let fields;
    await createCheckout({ topUpId: ID, priceUsdCents: 2500, credits: 300 }, {
        apiKey: 'sk_test_x', publicHost: 'https://veyrnox.test', signingSecret: 'test-secret',
        fetch: async (_url, init) => {
            fields = new URLSearchParams(init.body);
            return Response.json({ id: SESSION, url: 'https://checkout.stripe.com/c/pay/test' });
        },
    });
    assert.equal(fields.get('success_url'), `https://veyrnox.test/app/credits?top_up=${ID}&checkout=done&session_id={CHECKOUT_SESSION_ID}`);
    assert.doesNotMatch(fields.get('success_url'), /%7[BD]/i);
});

test('return rejects absent auth, PaymentIntent, malformed, oversized and legacy tokens without RPC', async () => {
    globalThis.fetch = () => { throw new Error('no network expected'); };
    assert.equal((await POST(request({ session_id: SESSION }, null), params)).status, 401);
    for (const session_id of ['pi_test_1', 'cs_', 'cs_a/b', 'cs_a\n', 'cs_' + 'a'.repeat(252), 1, null, ['cs_1']]) {
        const res = await POST(request({ session_id }), params);
        assert.equal(res.status, 400, String(session_id));
        assert.equal((await res.json()).error, 'invalid-session-id');
    }
    assert.equal((await POST(request({ order_id: '123', order_identifier: ID }), params)).status, 400);
});

test('return calls the session RPC with authenticated owner, normalized Top-up and unchanged token', async () => {
    for (const session_id of [SESSION, 'cs_' + 'A'.repeat(251)]) {
        let seen;
        globalThis.fetch = async (url, init) => { seen = { url: String(url), body: JSON.parse(init.body) }; return Response.json({ ok: true }); };
        const res = await POST(request({ session_id }), params);
        assert.equal(res.status, 200);
        assert.equal(seen.url, 'https://db.test/rest/v1/rpc/record_top_up_return_session');
        assert.deepEqual(seen.body, { p_auth_id: 'buyer', p_top_up_id: ID, p_session_id: session_id });
    }
});

test('return maps database refusals and hides unexpected provider details', async () => {
    for (const [reply, status, error] of [
        [{ ok: false, code: 'INVALID_SESSION_ID' }, 400, 'invalid-session-id'],
        [{ ok: false, code: 'TOP_UP_NOT_FOUND' }, 404, 'not-found'],
        [null, 502, 'internal'],
    ]) {
        globalThis.fetch = async () => Response.json(reply);
        const res = await POST(request({ session_id: SESSION }), params);
        assert.equal(res.status, status); assert.deepEqual(await res.json(), { error });
    }
    globalThis.fetch = async () => Response.json({ secret: 'must-not-leak' }, { status: 500 });
    assert.deepEqual(await (await POST(request({ session_id: SESSION }), params)).json(), { error: 'internal' });
});

test('fetchSession accepts the same upper bound as the return route', async () => {
    const sessionId = 'cs_' + 'a'.repeat(251);
    const result = await fetchSession(sessionId, { apiKey: 'test', fetch: async () => Response.json({ id: sessionId, object: 'checkout.session' }) });
    assert.equal(result.ok, true);
});

// Execute the component's actual first effect without needing a JSX renderer.
// This verifies the POST guard and URL cleanup, including rejected requests.
const source = readFileSync(new URL('../app/veyrnox/_components/TopUpPacks.js', import.meta.url), 'utf8');
const effect = source.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/)[1];
const runEffect = new Function('window', 'gatewayFetch', 'setTopUpId', 'TOP_UP_ID_RE', effect);
async function browser({ session = SESSION, enabled = true, fail = false, topUp = ID } = {}) {
    let current = new URL(`https://veyrnox.test/app/credits?top_up=${topUp}&session_id=${encodeURIComponent(session)}&checkout=done#packs`);
    const calls = [];
    const window = { location: current, localStorage: { getItem: () => enabled ? 'true' : null }, history: {
        state: { keep: true }, replaceState(state, _title, path) { assert.deepEqual(state, { keep: true }); current = new URL(path, current); },
    } };
    runEffect(window, (path, options) => { calls.push({ path, ...options }); return fail ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: true }); }, () => {}, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await new Promise((resolve) => setImmediate(resolve));
    return { calls, current };
}

test('browser posts valid cs_ tokens and strips them on success and failure', async () => {
    for (const fail of [false, true]) {
        const { calls, current } = await browser({ fail });
        assert.deepEqual(calls, [{ path: `/top-ups/${ID}/return`, method: 'POST', body: JSON.stringify({ session_id: SESSION }) }]);
        assert.equal(current.searchParams.has('session_id'), false);
        assert.equal(current.searchParams.get('top_up'), ID);
        assert.equal(current.searchParams.get('checkout'), 'done');
        assert.equal(current.hash, '#packs');
    }
});

test('browser refuses malformed tokens and stays inert until rollout is enabled', async () => {
    for (const args of [{ session: 'pi_1' }, { session: 'cs_a/b' }, { session: 'cs_' + 'a'.repeat(252) }, { enabled: false }]) {
        const { calls, current } = await browser(args);
        assert.equal(calls.length, 0);
        assert.equal(current.searchParams.has('session_id'), false);
    }
    assert.equal((await browser({ topUp: 'invalid' })).calls.length, 0);
});
