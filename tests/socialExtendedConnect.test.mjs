import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`,
));
const { startExtendedConnect, finishExtendedConnect } = await import('../lib/social/extendedConnect.js');
const { encryptToken, decryptToken, tokenCryptoConfig } = await import('../lib/social/tokenCrypto.js');
const { createOAuthState } = await import('../lib/social/oauthState.js');
const auth = '11111111-1111-4111-8111-111111111111';
const selectionId = '22222222-2222-4222-8222-222222222222';
Object.assign(process.env, { PUBLISH_EXTENDED_NETWORKS_ENABLED: 'true', PUBLIC_HOST: 'https://staging.test',
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), SOCIAL_OAUTH_STATE_SECRET: 'state-test',
    META_APP_ID: '123456789', META_APP_SECRET: 'secret-test', GMB_CLIENT_ID: 'client123', GMB_CLIENT_SECRET: 'secret-test' });
const cryptoCfg = tokenCryptoConfig();
const request = (body, identity = auth) => new Request('https://staging.test/api/v1/social/accounts/facebook/callback', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': identity }, body: JSON.stringify(body),
});

test('missing identity, disabled switches, malformed PKCE and invalid state fail before upstream calls', async () => {
    globalThis.fetch = async () => { throw new Error('network must not be called'); };
    assert.equal((await startExtendedConnect(request({ codeChallenge: 'a'.repeat(43) }, ''), 'facebook')).status, 401);
    assert.equal((await startExtendedConnect(request({ codeChallenge: 'bad' }), 'facebook')).status, 400);
    process.env.PUBLISH_EXTENDED_NETWORKS_ENABLED = 'false';
    assert.equal((await startExtendedConnect(request({ codeChallenge: 'a'.repeat(43) }), 'facebook')).status, 404);
    process.env.PUBLISH_EXTENDED_NETWORKS_ENABLED = 'true';
    assert.equal((await finishExtendedConnect(request({ code: 'code', codeVerifier: 'a'.repeat(43), state: 'forged' }), 'facebook')).status, 400);
});

test('Google Business Profile authorization includes S256 and the fixed registered redirect', async () => {
    const res = await startExtendedConnect(request({ codeChallenge: 'a'.repeat(43) }), 'gmb');
    const url = new URL((await res.json()).authorizeUrl);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('code_challenge'), 'a'.repeat(43));
    assert.equal(url.searchParams.get('redirect_uri'), 'https://staging.test/social/connect/callback/gmb');
});

test('Facebook OAuth stores candidate tokens encrypted and returns only labels and IDs for explicit choice', async () => {
    let encrypted;
    globalThis.fetch = async (url, init) => {
        const path = new URL(url).pathname;
        if (path.endsWith('/oauth/access_token')) return Response.json({ access_token: 'user-secret', expires_in: 3600 });
        if (path.endsWith('/me/accounts')) return Response.json({ data: [{ id: '123', name: 'Test Page', access_token: 'page-secret', tasks: ['CREATE_CONTENT'] }] });
        assert.ok(path.endsWith('/prepare_social_connection_selection'));
        const body = JSON.parse(init.body); assert.equal(body.p_auth_id, auth); assert.equal(body.p_network, 'facebook');
        encrypted = body.p_payload_enc; assert.ok(encrypted.startsWith('\\x')); assert.equal(encrypted.includes('page-secret'), false);
        return Response.json({ id: selectionId });
    };
    const state = await createOAuthState({ authId: auth, network: 'facebook' }, process.env.SOCIAL_OAUTH_STATE_SECRET);
    const res = await finishExtendedConnect(request({ code: 'code', codeVerifier: 'a'.repeat(43), state }), 'facebook');
    assert.equal(res.status, 200);
    const body = await res.json(); assert.equal(body.selectionId, selectionId);
    assert.deepEqual(body.choices, [{ id: '123', label: 'Test Page' }]);
    assert.equal(JSON.stringify(body).includes('secret'), false);
    const candidates = JSON.parse(await decryptToken(encrypted, cryptoCfg));
    assert.equal(candidates[0].accessToken, 'page-secret');
});

test('selection records only the selected Page with encrypted credentials', async () => {
    const payload = await encryptToken(JSON.stringify([{ externalAccountId: '123', displayName: 'Chosen', accessToken: 'page-secret' },
        { externalAccountId: '456', displayName: 'Other', accessToken: 'other-secret' }]), cryptoCfg);
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop(), body = JSON.parse(init.body); calls.push({ name, body });
        if (name === 'consume_social_connection_selection') return Response.json({ payload_enc: payload });
        if (name === 'get_or_create_default_social_brand') return Response.json({ ok: true, brand_id: selectionId });
        assert.equal(name, 'record_social_account_connection'); assert.equal(body.p_external_account_id, '123');
        assert.equal(await decryptToken(body.p_access_token_enc, cryptoCfg), 'page-secret');
        return Response.json({ ok: true, account_id: selectionId });
    };
    const res = await finishExtendedConnect(request({ selectionId, resourceId: '123' }), 'facebook');
    assert.equal(res.status, 200); assert.equal((await res.json()).account.display_name, 'Chosen');
    assert.deepEqual(calls[0].body, { p_auth_id: auth, p_network: 'facebook', p_id: selectionId });
});

test('expired/replayed selection and fabricated destination cannot record an account', async () => {
    globalThis.fetch = async () => Response.json(null);
    assert.equal((await finishExtendedConnect(request({ selectionId, resourceId: '123' }), 'facebook')).status, 409);
    const payload = await encryptToken(JSON.stringify([{ externalAccountId: '123', accessToken: 'page-secret' }]), cryptoCfg);
    globalThis.fetch = async (url) => {
        assert.ok(new URL(url).pathname.endsWith('/consume_social_connection_selection'));
        return Response.json({ payload_enc: payload });
    };
    assert.equal((await finishExtendedConnect(request({ selectionId, resourceId: 'foreign' }), 'facebook')).status, 400);
});

test('Bluesky accepts only dedicated app passwords, not an arbitrary account password', async () => {
    globalThis.fetch = async () => { throw new Error('must not send an invalid password'); };
    const res = await finishExtendedConnect(request({ identifier: 'tester.bsky.social', appPassword: 'my-main-password' }), 'bluesky');
    assert.equal(res.status, 400);
});
