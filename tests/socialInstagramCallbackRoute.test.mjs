import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { POST } = await import('../app/api/v1/social/accounts/instagram/callback/route.js');
const { createOAuthState } = await import('../lib/social/oauthState.js');

const auth = '11111111-1111-4111-8111-111111111111';
const brandId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const verifier = 'v'.repeat(43);

function setConfigured() {
    Object.assign(process.env, {
        SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
        META_APP_ID: '123456789012345', META_APP_SECRET: 'b'.repeat(32),
        SOCIAL_OAUTH_STATE_SECRET: 'state-secret-value', PUBLIC_HOST: 'https://veyrnox.ai',
        SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
    });
}
const request = (body, headers = {}) => new Request('https://veyrnox.test/api/v1/social/accounts/instagram/callback', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': auth, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
});

let calls;
function stub({ rpcOverrides = {} } = {}) {
    calls = [];
    globalThis.fetch = async (url, init) => {
        const u = new URL(url);
        calls.push(u.hostname + u.pathname);
        if (u.hostname === 'api.instagram.com' && u.pathname === '/oauth/access_token') {
            return Response.json({ data: [{ access_token: 'short-lived-token', user_id: '17841400000000000', permissions: 'instagram_business_basic' }] });
        }
        if (u.hostname === 'graph.instagram.com' && u.pathname === '/access_token') {
            return Response.json({ access_token: 'long-lived-token', token_type: 'bearer', expires_in: 5184000 });
        }
        if (u.hostname === 'graph.instagram.com' && u.pathname.endsWith('/me')) {
            return Response.json({ id: '17841400000000000', username: 'creator', profile_picture_url: 'https://example.com/a.jpg' });
        }
        // db.test — Supabase PostgREST RPC calls
        const name = u.pathname.split('/').pop();
        const result = rpcOverrides[name] ?? ({
            get_or_create_default_social_brand: { ok: true, idempotent: true, brand_id: brandId, label: 'My Brand', timezone: 'UTC' },
            record_social_account_connection: { ok: true, account_id: accountId, idempotent: false },
        })[name];
        return Response.json(result);
    };
}
async function validState() {
    return createOAuthState({ authId: auth, network: 'instagram' }, process.env.SOCIAL_OAUTH_STATE_SECRET);
}

test('missing or malformed identity is rejected before anything else', async () => {
    setConfigured(); stub();
    const res = await POST(request({ code: 'c', state: await validState(), codeVerifier: verifier }, { 'x-veyrnox-auth-id': 'bad' }));
    assert.equal(res.status, 401);
    assert.deepEqual(calls, []);
});

test('an invalid or forged state is rejected before any Graph API call', async () => {
    setConfigured(); stub();
    const res = await POST(request({ code: 'c', state: 'not-a-real-token', codeVerifier: verifier }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'invalid_state' });
    assert.deepEqual(calls, []);
});

test('a state issued to a different user is rejected', async () => {
    setConfigured(); stub();
    const otherState = await createOAuthState({ authId: '99999999-9999-4999-8999-999999999999', network: 'instagram' }, process.env.SOCIAL_OAUTH_STATE_SECRET);
    const res = await POST(request({ code: 'c', state: otherState, codeVerifier: verifier }));
    assert.equal(res.status, 400);
});

test('completes the full connect flow: token exchange, direct account resolution, encryption, and RPC recording', async () => {
    setConfigured(); stub();
    const res = await POST(request({ code: 'auth-code', state: await validState(), codeVerifier: verifier }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.account.id, accountId);
    assert.equal(body.account.network, 'instagram');
    assert.equal(body.account.display_name, '@creator');
    assert.equal(calls.filter((c) => c.includes('instagram.com')).length, 3, 'short-lived exchange + long-lived exchange + /me — no Pages lookup');
    assert.equal(calls.filter((c) => c.includes('db.test')).length, 2, 'brand lookup + record connection');
});

test('an RPC failure never leaks upstream detail, and the token is never in the response', async () => {
    setConfigured(); stub({ rpcOverrides: { record_social_account_connection: { error: 'boom' }, get_or_create_default_social_brand: { ok: true, brand_id: brandId } } });
    const res = await POST(request({ code: 'c', state: await validState(), codeVerifier: verifier }));
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.doesNotMatch(text, /long-lived-token/);
    assert.deepEqual(JSON.parse(text), { error: 'internal' });
});

test('each required config var missing degrades to a clean 503 before any network call', async () => {
    for (const missing of ['META_APP_ID', 'SOCIAL_OAUTH_STATE_SECRET', 'SOCIAL_TOKEN_ENCRYPTION_KEY', 'PUBLIC_HOST']) {
        setConfigured(); stub();
        delete process.env[missing];
        const res = await POST(request({ code: 'c', state: 'irrelevant', codeVerifier: verifier }));
        assert.equal(res.status, 503, `missing ${missing}`);
        assert.deepEqual(calls, []);
    }
    setConfigured();
});
