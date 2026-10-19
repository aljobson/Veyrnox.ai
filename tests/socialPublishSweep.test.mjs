import test from 'node:test';
import assert from 'node:assert/strict';
import { runPublishSweep, BATCH, nextYoutubeQuotaReset } from '../lib/socialPublishSweep.js';
import { tokenCryptoConfig, encryptToken } from '../lib/social/tokenCrypto.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test-service' };
const cryptoCfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
const r2cfg = { accountId: 'acct', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' };
const publicHost = 'https://veyrnox.ai';
const mediaProxySecret = 'media-proxy-secret';
const asyncDeps = { cfg, cryptoCfg, r2cfg, publicHost, mediaProxySecret };
Object.assign(process.env, {
    SOCIAL_HOLD_CHECKS_ENABLED: 'true',
    YOUTUBE_CLIENT_ID: '123456789012-abcdefghijklmnop.apps.googleusercontent.com',
    YOUTUBE_CLIENT_SECRET: 'a'.repeat(24),
});

function target(overrides = {}) {
    return {
        target_id: 't-1', post_id: 'p-1', account_id: 'a-1', network: 'instagram',
        text_override: null, global_text: 'caption', brand_id: 'b-1', attempts: 1,
        access_token_enc: null, external_account_id: 'ig-42',
        media_type: 'image', r2_key: 'assets/a.jpg',
        ...overrides,
    };
}

async function withFetch(rpcHandlers, run) {
    const real = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        calls.push(name);
        const handler = rpcHandlers[name] || (name === 'authorize_social_target_dispatch' ? async (body) => body.p_target_id === '00000000-0000-0000-0000-000000000000' ? ({ ok: false, code: 'CLAIM_LOST' }) : ({ ok: true }) : null);
        if (!handler) throw new Error(`unexpected rpc: ${name}`);
        return Response.json(await handler(JSON.parse(init.body)));
    };
    try { await run(calls); } finally { globalThis.fetch = real; }
}

test('refuses to run without a supabase config, a valid encryption key, or R2 configured', async () => {
    assert.deepEqual(await runPublishSweep({ cfg: {}, cryptoCfg, r2cfg }), { ok: false, skipped: 'not_configured' });
    assert.deepEqual(await runPublishSweep({ cfg, cryptoCfg: null, r2cfg }), { ok: false, skipped: 'not_configured' });
    assert.deepEqual(await runPublishSweep({ cfg, cryptoCfg, r2cfg: {} }), { ok: false, skipped: 'not_configured' });
});

test('nothing claimed is a clean no-op, not an error', async () => {
    await withFetch({ claim_due_social_post_targets: async () => [] }, async (calls) => {
        assert.deepEqual(await runPublishSweep({ cfg, cryptoCfg, r2cfg }), { ok: true, claimed: 0, published: 0, failed: 0, errors: 0 });
        assert.deepEqual(calls, ['authorize_social_target_dispatch', 'claim_due_social_post_targets']);
    });
});

test('an unimplemented network fails its target with a named reason, never hangs as pending', async () => {
    await withFetch({
        claim_due_social_post_targets: async () => [target({ network: 'unknown', target_id: 't-2' })],
        complete_social_post_target: async (body) => {
            assert.equal(body.p_target_id, 't-2');
            assert.equal(body.p_ok, false);
            assert.equal(body.p_error, 'network_not_implemented');
            return { ok: true };
        },
    }, async () => {
        const out = await runPublishSweep({ cfg, cryptoCfg, r2cfg });
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 1, errors: 0 });
    });
});

test('publishes an Instagram image target and reports the platform ids back', async () => {
    const accessTokenEnc = await encryptToken('ig-access-token', cryptoCfg);
    let publishCalls = 0;
    await withFetch({
        claim_due_social_post_targets: async () => [target({ access_token_enc: accessTokenEnc })],
        mark_social_provider_submission: async () => ({ ok: true }),
        complete_social_post_target: async (body) => {
            assert.equal(body.p_ok, true);
            assert.equal(body.p_platform_post_id, 'media-1');
            assert.equal(body.p_platform_post_url, 'https://www.instagram.com/p/abc/');
            return { ok: true };
        },
    }, async () => {
        const real = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.hostname === 'graph.instagram.com') {
                publishCalls += 1;
                if (u.pathname.endsWith('/media')) return Response.json({ id: 'container-1' });
                if (u.pathname.endsWith('/media_publish')) return Response.json({ id: 'media-1' });
                return Response.json({ id: 'media-1', permalink: 'https://www.instagram.com/p/abc/' });
            }
            return real(url, init);
        };
        const out = await runPublishSweep({ cfg, cryptoCfg, r2cfg });
        assert.deepEqual(out, { ok: true, claimed: 1, published: 1, failed: 0, errors: 0 });
        assert.equal(publishCalls, 3);
    });
});

test('publishes a LinkedIn image target and reports the platform ids back', async () => {
    const accessTokenEnc = await encryptToken('member-access-token', cryptoCfg);
    let publishCalls = 0;
    await withFetch({
        claim_due_social_post_targets: async () => [target({
            network: 'linkedin', target_id: 't-li', external_account_id: 'member-42', access_token_enc: accessTokenEnc,
        })],
        mark_social_provider_submission: async () => ({ ok: true }),
        complete_social_post_target: async (body) => {
            assert.equal(body.p_ok, true);
            assert.equal(body.p_platform_post_id, 'urn:li:share:123');
            assert.equal(body.p_platform_post_url, 'https://www.linkedin.com/feed/update/urn:li:share:123/');
            return { ok: true };
        },
    }, async () => {
        const real = globalThis.fetch;
        const headerGet = (values) => ({ get: (k) => values[k.toLowerCase()] ?? null });
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.hostname === 'api.linkedin.com' && u.pathname === '/rest/images') {
                publishCalls += 1;
                return { ok: true, status: 200, headers: headerGet({}), json: async () => ({ value: { uploadUrl: 'https://www.linkedin.com/dms-uploads/x/0', image: 'urn:li:image:x' } }) };
            }
            if (u.hostname === 'acct.r2.cloudflarestorage.com') {
                publishCalls += 1;
                return { ok: true, status: 200, headers: headerGet({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1]).buffer };
            }
            if (u.hostname === 'www.linkedin.com' && u.pathname === '/dms-uploads/x/0') {
                publishCalls += 1;
                return { ok: true, status: 201, headers: headerGet({}) };
            }
            if (u.hostname === 'api.linkedin.com' && u.pathname === '/rest/posts') {
                publishCalls += 1;
                return { ok: true, status: 201, headers: headerGet({ 'x-restli-id': 'urn:li:share:123' }), json: async () => ({}) };
            }
            return real(url, init);
        };
        const out = await runPublishSweep({ cfg, cryptoCfg, r2cfg });
        assert.deepEqual(out, { ok: true, claimed: 1, published: 1, failed: 0, errors: 0 });
        assert.equal(publishCalls, 4);
    });
});

test('publishes an X image target and reports the platform ids back', async () => {
    const accessTokenEnc = await encryptToken('x-access-token', cryptoCfg);
    let publishCalls = 0;
    await withFetch({
        claim_due_social_post_targets: async () => [target({
            network: 'twitter', target_id: 't-x', external_account_id: '987654321', access_token_enc: accessTokenEnc,
        })],
        mark_social_provider_submission: async () => ({ ok: true }),
        complete_social_post_target: async (body) => {
            assert.equal(body.p_ok, true);
            assert.equal(body.p_platform_post_id, 'tweet-1');
            // No username reaches the claim row, so this falls back to X's own handle-agnostic permalink.
            assert.equal(body.p_platform_post_url, 'https://x.com/i/web/status/tweet-1');
            return { ok: true };
        },
    }, async () => {
        const real = globalThis.fetch;
        const headerGet = (values) => ({ get: (k) => values[k.toLowerCase()] ?? null });
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.hostname === 'acct.r2.cloudflarestorage.com') {
                publishCalls += 1;
                return { ok: true, status: 200, headers: headerGet({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1]).buffer };
            }
            if (u.hostname === 'api.x.com' && u.pathname === '/2/media/upload/initialize') {
                publishCalls += 1;
                return { ok: true, status: 200, headers: headerGet({}), json: async () => ({ data: { id: 'media-1' } }) };
            }
            if (u.hostname === 'api.x.com' && u.pathname === '/2/media/upload/media-1/append') {
                publishCalls += 1;
                return { ok: true, status: 204, headers: headerGet({}) };
            }
            if (u.hostname === 'api.x.com' && u.pathname === '/2/media/upload/media-1/finalize') {
                publishCalls += 1;
                return { ok: true, status: 200, headers: headerGet({}), json: async () => ({ data: { id: 'media-1' } }) };
            }
            if (u.hostname === 'api.x.com' && u.pathname === '/2/tweets') {
                publishCalls += 1;
                return { ok: true, status: 201, headers: headerGet({}), json: async () => ({ data: { id: 'tweet-1' } }) };
            }
            return real(url, init);
        };
        const out = await runPublishSweep({ cfg, cryptoCfg, r2cfg });
        assert.deepEqual(out, { ok: true, claimed: 1, published: 1, failed: 0, errors: 0 });
        assert.equal(publishCalls, 5);
    });
});

// Audit 2026-10-09 S-03: the core networks mark the row before the provider call, and never resend a marked one.
test('a core target already marked as submitted is not sent again: it ends as a result to reconcile', async () => {
    const accessTokenEnc = await encryptToken('ig-access-token', cryptoCfg);
    let providerCalls = 0;
    await withFetch({
        claim_due_social_post_targets: async () => [target({ access_token_enc: accessTokenEnc, claim_key: 'k-9', provider_state: { submission_started: true } })],
        complete_social_post_target: async (body) => {
            assert.equal(body.p_ok, false);
            assert.equal(body.p_error, 'provider_result_unknown_reconcile_before_retry');
            assert.equal(body.p_claim_key, 'k-9');
            return { ok: true };
        },
    }, async (calls) => {
        const real = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            if (new URL(url).hostname === 'graph.instagram.com') { providerCalls += 1; return Response.json({ id: 'x' }); }
            return real(url, init);
        };
        const out = await runPublishSweep({ cfg, cryptoCfg, r2cfg });
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 1, errors: 0 });
        assert.equal(providerCalls, 0, 'the provider was not called again');
        assert.ok(!calls.includes('mark_social_provider_submission'), 'nothing to mark: it already was');
    });
});

test('a core target whose marker is lost to another sweep is not sent either', async () => {
    const accessTokenEnc = await encryptToken('li-access-token', cryptoCfg);
    let providerCalls = 0;
    await withFetch({
        claim_due_social_post_targets: async () => [target({ network: 'linkedin', target_id: 't-li2', external_account_id: 'member-1', access_token_enc: accessTokenEnc, claim_key: 'k-2' })],
        mark_social_provider_submission: async (body) => {
            assert.deepEqual(body, { p_target_id: 't-li2', p_claim_key: 'k-2', p_network: 'linkedin' });
            return null; // the row is no longer ours, or already marked
        },
        complete_social_post_target: async (body) => { assert.equal(body.p_error, 'submission_claim_lost'); return { ok: true }; },
    }, async () => {
        // The marker is written right before the publishing call, so LinkedIn's
        // image preparation still runs; only the public post must not go out.
        const real = globalThis.fetch;
        const headerGet = (values) => ({ get: (k) => values[k.toLowerCase()] ?? null });
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.hostname === 'api.linkedin.com' && u.pathname === '/rest/images') {
                return { ok: true, status: 200, headers: headerGet({}), json: async () => ({ value: { uploadUrl: 'https://www.linkedin.com/dms-uploads/x/0', image: 'urn:li:image:x' } }) };
            }
            if (u.hostname === 'acct.r2.cloudflarestorage.com') {
                return { ok: true, status: 200, headers: headerGet({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1]).buffer };
            }
            if (u.hostname === 'www.linkedin.com' && u.pathname === '/dms-uploads/x/0') return { ok: true, status: 201, headers: headerGet({}) };
            if (u.hostname === 'api.linkedin.com' && u.pathname === '/rest/posts') { providerCalls += 1; return Response.json({}); }
            return real(url, init);
        };
        const out = await runPublishSweep({ cfg, cryptoCfg, r2cfg });
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 1, errors: 0 });
        assert.equal(providerCalls, 0);
    });
});

// Audit 2026-10-09 S-04: X tokens last about two hours and were never refreshed on this path.
test('X: a token near expiry is refreshed first, the rotated pair is stored with a compare-and-swap, and the post goes out with the new token', async () => {
    Object.assign(process.env, { X_CLIENT_ID: 'x-client-id-1234', X_CLIENT_SECRET: 'x-secret-12345678' });
    const accessTokenEnc = await encryptToken('x-old-token', cryptoCfg);
    const refreshTokenEnc = await encryptToken('x-old-refresh', cryptoCfg);
    const seen = { auth: [], rotate: null };
    await withFetch({
        claim_due_social_post_targets: async () => [target({
            network: 'twitter', target_id: 't-x2', external_account_id: '987654321', account_id: 'acct-x', claim_key: 'k-x',
            access_token_enc: accessTokenEnc, refresh_token_enc: refreshTokenEnc,
            token_expires_at: new Date(Date.now() + 60 * 1000).toISOString(), // inside the ten-minute buffer
        })],
        rotate_extended_social_tokens: async (body) => { seen.rotate = body; return { ok: true }; },
        mark_social_provider_submission: async () => ({ ok: true }),
        complete_social_post_target: async (body) => { assert.equal(body.p_ok, true); return { ok: true }; },
    }, async () => {
        const real = globalThis.fetch;
        const headerGet = (values) => ({ get: (k) => values[k.toLowerCase()] ?? null });
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.hostname === 'api.x.com' && u.pathname === '/2/oauth2/token') {
                const params = new URLSearchParams(init.body);
                assert.equal(params.get('grant_type'), 'refresh_token');
                assert.equal(params.get('refresh_token'), 'x-old-refresh');
                return { ok: true, status: 200, json: async () => ({ access_token: 'x-new-token', refresh_token: 'x-new-refresh', expires_in: 7200 }) };
            }
            if (u.hostname === 'api.x.com') seen.auth.push(new Headers(init.headers).get('authorization'));
            if (u.hostname === 'acct.r2.cloudflarestorage.com') return { ok: true, status: 200, headers: headerGet({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1]).buffer };
            if (u.pathname === '/2/media/upload/initialize') return { ok: true, status: 200, headers: headerGet({}), json: async () => ({ data: { id: 'm-1' } }) };
            if (u.pathname === '/2/media/upload/m-1/append') return { ok: true, status: 204, headers: headerGet({}) };
            if (u.pathname === '/2/media/upload/m-1/finalize') return { ok: true, status: 200, headers: headerGet({}), json: async () => ({ data: { id: 'm-1' } }) };
            if (u.pathname === '/2/tweets') return { ok: true, status: 201, headers: headerGet({}), json: async () => ({ data: { id: 'tweet-2' } }) };
            return real(url, init);
        };
        const out = await runPublishSweep({ cfg, cryptoCfg, r2cfg });
        assert.deepEqual(out, { ok: true, claimed: 1, published: 1, failed: 0, errors: 0 });
        assert.ok(seen.auth.length > 0 && seen.auth.every((h) => h === 'Bearer x-new-token'), `every X call used the new token: ${seen.auth}`);
        assert.equal(seen.rotate.p_account_id, 'acct-x');
        assert.equal(seen.rotate.p_network, 'twitter');
        assert.equal(seen.rotate.p_expected_access_token_enc, accessTokenEnc, 'the pair that was read');
        assert.equal(seen.rotate.p_expected_refresh_token_enc, refreshTokenEnc);
        assert.notEqual(seen.rotate.p_refresh_token_enc, refreshTokenEnc, 'the rotated refresh token is stored');
        assert.ok(Date.parse(seen.rotate.p_token_expires_at) > Date.now() + 7000 * 1000);
    });
});

test('X: a rotation that loses the compare-and-swap fails the attempt without publishing; no app credentials is its own reason', async () => {
    const accessTokenEnc = await encryptToken('x-old-token', cryptoCfg);
    const refreshTokenEnc = await encryptToken('x-old-refresh', cryptoCfg);
    const expiring = () => target({ network: 'twitter', target_id: 't-x3', external_account_id: '1', access_token_enc: accessTokenEnc, refresh_token_enc: refreshTokenEnc, token_expires_at: new Date(Date.now() + 1000).toISOString() });
    Object.assign(process.env, { X_CLIENT_ID: 'x-client-id-1234', X_CLIENT_SECRET: 'x-secret-12345678' });
    await withFetch({
        claim_due_social_post_targets: async () => [expiring()],
        rotate_extended_social_tokens: async () => null,
        complete_social_post_target: async (body) => { assert.equal(body.p_error, 'token_refresh_failed'); return { ok: true }; },
    }, async (calls) => {
        const real = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            if (new URL(url).pathname === '/2/oauth2/token') return { ok: true, status: 200, json: async () => ({ access_token: 'n', refresh_token: 'r', expires_in: 7200 }) };
            if (new URL(url).hostname === 'api.x.com') throw new Error('must not publish');
            return real(url, init);
        };
        assert.deepEqual(await runPublishSweep({ cfg, cryptoCfg, r2cfg }), { ok: true, claimed: 1, published: 0, failed: 1, errors: 0 });
        assert.ok(!calls.includes('mark_social_provider_submission'));
    });
    delete process.env.X_CLIENT_ID; delete process.env.X_CLIENT_SECRET;
    await withFetch({
        claim_due_social_post_targets: async () => [expiring()],
        complete_social_post_target: async (body) => { assert.equal(body.p_error, 'token_refresh_unavailable'); return { ok: true }; },
    }, async () => {
        assert.deepEqual(await runPublishSweep({ cfg, cryptoCfg, r2cfg }), { ok: true, claimed: 1, published: 0, failed: 1, errors: 0 });
    });
});

test('missing media on a claimed target fails cleanly instead of dispatching', async () => {
    await withFetch({
        claim_due_social_post_targets: async () => [target({ media_type: null, r2_key: null })],
        complete_social_post_target: async (body) => {
            assert.equal(body.p_error, 'missing_media');
            return { ok: true };
        },
    }, async () => {
        const out = await runPublishSweep({ cfg, cryptoCfg, r2cfg });
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 1, errors: 0 });
    });
});

test('passes the claim key back with the report (0168)', async () => {
    await withFetch({
        claim_due_social_post_targets: async () => [target({ network: 'pinterest', claim_key: 'k-1' })],
        complete_social_post_target: async (body) => {
            assert.equal(body.p_claim_key, 'k-1');
            return { ok: true };
        },
    }, async () => {
        const out = await runPublishSweep({ cfg, cryptoCfg, r2cfg });
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 1, errors: 0 });
    });
});

test('omits the claim key when the claim returned none (pre-0168 functions)', async () => {
    await withFetch({
        claim_due_social_post_targets: async () => [target({ network: 'pinterest' })],
        complete_social_post_target: async (body) => {
            assert.equal('p_claim_key' in body, false);
            return { ok: true };
        },
    }, async () => {
        await runPublishSweep({ cfg, cryptoCfg, r2cfg });
    });
});

test('a lost claim is counted on its own, not as published or failed', async () => {
    await withFetch({
        claim_due_social_post_targets: async () => [target({ network: 'pinterest', claim_key: 'stale' })],
        complete_social_post_target: async () => ({ ok: false, code: 'CLAIM_LOST' }),
    }, async () => {
        const out = await runPublishSweep({ cfg, cryptoCfg, r2cfg });
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 0, errors: 0, claimLost: 1 });
    });
});

test('one target throwing during dispatch does not sink the rest of the batch', async () => {
    await withFetch({
        claim_due_social_post_targets: async () => [
            target({ target_id: 't-bad', access_token_enc: '\\xnotvalidhex!' }),
            target({ target_id: 't-skip', network: 'pinterest' }),
        ],
        complete_social_post_target: async (body) => ({ ok: true, seen: body.p_target_id }),
    }, async () => {
        const out = await runPublishSweep({ cfg, cryptoCfg, r2cfg });
        assert.equal(out.claimed, 2);
        assert.equal(out.published, 0);
        assert.equal(out.failed, 2);
        assert.equal(out.errors, 0);
    });
});

test(`claims at most ${BATCH} targets per sweep`, async () => {
    await withFetch({
        claim_due_social_post_targets: async (body) => {
            assert.equal(body.p_limit, BATCH);
            return [];
        },
    }, async () => {
        await runPublishSweep({ cfg, cryptoCfg, r2cfg });
    });
});
