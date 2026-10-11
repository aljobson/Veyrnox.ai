import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { tiktokReviewAllowed, tiktokAvailable } from '../lib/social/tiktokReview.js';
import { tiktokConnectionConfig, tiktokStoredConfig,
    wrapTiktokToken, unwrapTiktokToken, isTiktokReviewToken } from '../lib/social/tiktokReviewTokens.js';
import { networkReadiness } from '../lib/social/networkReadiness.js';
import { postCapabilityError } from '../lib/social/postCapabilities.js';
import { rotateCoreToken } from '../lib/socialPublishTokens.js';
import { tokenCryptoConfig, encryptToken, decryptToken } from '../lib/social/tokenCrypto.js';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
const { POST: connect } = await import('../app/api/v1/social/accounts/tiktok/connect/route.js');
const { POST: callback } = await import('../app/api/v1/social/accounts/tiktok/callback/route.js');
const { createOAuthState } = await import('../lib/social/oauthState.js');
const auth = '11111111-1111-4111-8111-111111111111';
const other = '99999999-9999-4999-8999-999999999999';
const key = Buffer.alloc(32, 5).toString('base64');
const env = {
    PUBLISH_RELEASED_NETWORKS: 'youtube,linkedin', TIKTOK_REVIEW_ENABLED: 'true', TIKTOK_REVIEW_AUTH_IDS: auth,
    TIKTOK_REVIEW_CLIENT_KEY: 'sandboxclientkey', TIKTOK_REVIEW_CLIENT_SECRET: 'sandbox-secret',
    TIKTOK_CLIENT_KEY: 'productionclientkey', TIKTOK_CLIENT_SECRET: 'production-secret', TIKTOK_ANALYTICS_SCOPE_ENABLED: 'true',
    PUBLIC_HOST: 'https://veyrnox.ai', SOCIAL_OAUTH_STATE_SECRET: 'test-state', SOCIAL_TOKEN_ENCRYPTION_KEY: key,
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
};
async function configured(run) {
    const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    Object.assign(process.env, env);
    const fetcher = globalThis.fetch;
    try { await run(); } finally {
        globalThis.fetch = fetcher;
        for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}
function request(action, identity, body = {}) {
    return new Request(`https://veyrnox.ai/api/v1/social/accounts/tiktok/${action}`, {
        method: 'POST', headers: { 'x-veyrnox-auth-id': identity, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
}

test('review access requires exact opt-in and a valid allowlisted subject', () => {
    assert.equal(tiktokReviewAllowed(auth, env), true);
    for (const id of [undefined, '', 'not-a-uuid', 'support@veyrnox.com', other]) assert.equal(tiktokReviewAllowed(id, env), false);
    for (const flag of [undefined, '', '1', 'TRUE', 'false']) assert.equal(tiktokReviewAllowed(auth, { ...env, TIKTOK_REVIEW_ENABLED: flag }), false);
    for (const ids of [undefined, '', 'support@veyrnox.com', 'not-a-uuid', other]) assert.equal(tiktokReviewAllowed(auth, { ...env, TIKTOK_REVIEW_AUTH_IDS: ids }), false);
    assert.equal(tiktokReviewAllowed(auth.toUpperCase(), { ...env, TIKTOK_REVIEW_AUTH_IDS: `bad, ${auth.toUpperCase()} ` }), true);
});

test('pilot readiness and posting do not open other users or other networks', () => {
    const tt = id => networkReadiness(env, id).find(n => n.key === 'tiktok');
    assert.equal(tt(auth).available, true);
    for (const id of [undefined, other]) { assert.equal(tt(id).available, false); assert.equal(tt(id).status, 'not_released'); }
    assert.equal(networkReadiness(env, auth).find(n => n.key === 'instagram').available, false);
    const media = [{ media_type: 'image' }];
    assert.equal(postCapabilityError([{ network: 'tiktok' }], media, 'demo', env, auth), null);
    assert.equal(postCapabilityError([{ network: 'tiktok' }], media, 'demo', env, other), 'network_unavailable');
    assert.equal(postCapabilityError([{ network: 'instagram' }], media, 'demo', env, auth), 'network_unavailable');
    assert.equal(postCapabilityError([{ network: 'tiktok' }], [{ media_type: 'video' }], 'demo', env, auth), 'unsupported_media_type');
});

test('review credentials never fall back to production or request analytics', () => {
    assert.deepEqual(tiktokConnectionConfig(auth, env), { clientKey: 'sandboxclientkey', clientSecret: 'sandbox-secret' });
    assert.equal(tiktokConnectionConfig(other, env), null);
    for (const k of ['TIKTOK_REVIEW_CLIENT_KEY', 'TIKTOK_REVIEW_CLIENT_SECRET']) {
        const broken = { ...env, [k]: '' };
        assert.equal(tiktokConnectionConfig(auth, broken), null);
        assert.equal(networkReadiness(broken, auth).find(n => n.key === 'tiktok').status, 'setup_required');
    }
    const released = { ...env, PUBLISH_RELEASED_NETWORKS: 'youtube,linkedin,tiktok' };
    assert.equal(tiktokReviewAllowed(auth, released), false);
    assert.equal(tiktokConnectionConfig(auth, released).clientKey, 'productionclientkey');
    assert.equal(tiktokAvailable(other, released), true);
});

test('direct review connect and callback deny unlisted identities before any external request', async () => configured(async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('must not contact provider or database'); };
    for (const id of [other, 'support@veyrnox.com', '']) {
        for (const [action, handler] of [['connect', connect], ['callback', callback]]) {
            const res = await handler(request(action, id));
            assert.equal(res.status, id === other ? 404 : 401);
        }
    }
    delete process.env.TIKTOK_REVIEW_CLIENT_KEY;
    assert.equal((await connect(request('connect', auth, { codeChallenge: 'a'.repeat(43) }))).status, 503);
    assert.equal(calls, 0);
}));

test('review authorize URL uses the sandbox client and production callback with minimal scopes', async () => configured(async () => {
    const res = await connect(request('connect', auth, { codeChallenge: 'a'.repeat(43) }));
    assert.equal(res.status, 200);
    const url = new URL((await res.json()).authorizeUrl);
    assert.equal(url.searchParams.get('client_key'), 'sandboxclientkey');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback/tiktok');
    assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.upload');
}));

test('review callback exchanges only with sandbox credentials and stores marked encrypted tokens', async () => configured(async () => {
    let recorded;
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname;
        if (name === '/v2/oauth/token/') {
            const form = new URLSearchParams(init.body);
            assert.equal(form.get('client_key'), 'sandboxclientkey');
            assert.equal(form.get('client_secret'), 'sandbox-secret');
            return Response.json({ access_token: 'review-access', refresh_token: 'review-refresh', expires_in: 86400,
                open_id: 'review-open', scope: 'user.info.basic,video.upload' });
        }
        if (name === '/v2/user/info/') return Response.json({ data: { user: { open_id: 'review-open', display_name: 'Reviewer' } }, error: { code: 'ok' } });
        if (name.endsWith('/get_or_create_default_social_brand')) return Response.json({ ok: true, brand_id: auth });
        if (name.endsWith('/record_social_account_connection')) { recorded = JSON.parse(init.body); return Response.json({ ok: true, account_id: other }); }
        throw new Error('unexpected request');
    };
    const state = await createOAuthState({ authId: auth, network: 'tiktok' }, env.SOCIAL_OAUTH_STATE_SECRET);
    const res = await callback(request('callback', auth, { code: 'code', state, codeVerifier: 'a'.repeat(43) }));
    assert.equal(res.status, 200);
    assert.equal(isTiktokReviewToken(recorded.p_access_token_enc), true);
    assert.equal(isTiktokReviewToken(recorded.p_refresh_token_enc), true);
    assert.match(recorded.p_access_token_enc, /^\\x(?:[0-9a-f]{2})+$/);
    assert.match(recorded.p_refresh_token_enc, /^\\x(?:[0-9a-f]{2})+$/);
    const crypto = tokenCryptoConfig(env);
    assert.equal(await decryptToken(unwrapTiktokToken(recorded.p_access_token_enc), crypto), 'review-access');
    assert.equal(await decryptToken(unwrapTiktokToken(recorded.p_refresh_token_enc), crypto), 'review-refresh');
    assert.deepEqual(recorded.p_scopes, ['user.info.basic', 'video.upload']);
    assert.equal(JSON.stringify(await res.json()).includes('review-access'), false);
}));

test('stored review tokens keep sandbox app identity after disabling the pilot or public release', () => {
    const target = { access_token_enc: wrapTiktokToken('\\x0011', true), refresh_token_enc: wrapTiktokToken('\\x2233', true) };
    const released = { ...env, TIKTOK_REVIEW_ENABLED: 'false', PUBLISH_RELEASED_NETWORKS: 'tiktok' };
    assert.equal(tiktokStoredConfig(target, released).clientKey, 'sandboxclientkey');
    assert.equal(tiktokStoredConfig(target, { ...released, TIKTOK_REVIEW_CLIENT_KEY: '' }), null);
    assert.equal(tiktokStoredConfig({ ...target, refresh_token_enc: 'production-refresh' }, env), null);
    assert.equal(tiktokStoredConfig({ access_token_enc: 'access', refresh_token_enc: 'refresh' }, env).clientKey, 'productionclientkey');
});

test('review refresh preserves app markers and compare-and-swap values', async () => configured(async () => {
    const crypto = tokenCryptoConfig(env);
    const target = { network: 'tiktok', account_id: auth, external_account_id: 'review-open',
        access_token_enc: wrapTiktokToken(await encryptToken('old-access', crypto), true),
        refresh_token_enc: wrapTiktokToken(await encryptToken('old-refresh', crypto), true) };
    let updated;
    globalThis.fetch = async (url, init) => {
        if (new URL(url).hostname === 'open.tiktokapis.com') {
            const form = new URLSearchParams(init.body);
            assert.equal(form.get('client_key'), 'sandboxclientkey');
            assert.equal(form.get('refresh_token'), 'old-refresh');
            return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 86400,
                open_id: 'review-open', scope: 'user.info.basic,video.upload' });
        }
        updated = JSON.parse(init.body);
        return Response.json({ ok: true });
    };
    assert.equal(await rotateCoreToken(target, { cfg: { supabaseUrl: 'https://db.test', serviceRoleKey: 'test' }, cryptoCfg: crypto, env }), 'new-access');
    assert.equal(updated.p_expected_access_token_enc, target.access_token_enc);
    assert.equal(updated.p_expected_refresh_token_enc, target.refresh_token_enc);
    assert.equal(isTiktokReviewToken(updated.p_access_token_enc), true);
    assert.equal(isTiktokReviewToken(updated.p_refresh_token_enc), true);
    assert.equal(await decryptToken(unwrapTiktokToken(updated.p_refresh_token_enc), crypto), 'new-refresh');
}));
