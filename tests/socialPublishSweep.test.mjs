import test from 'node:test';
import assert from 'node:assert/strict';
import { runPublishSweep, BATCH } from '../lib/socialPublishSweep.js';
import { tokenCryptoConfig, encryptToken } from '../lib/social/tokenCrypto.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test-service' };
const cryptoCfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });

function target(overrides = {}) {
    return {
        target_id: 't-1', post_id: 'p-1', account_id: 'a-1', network: 'instagram',
        text_override: null, global_text: 'caption', brand_id: 'b-1', attempts: 1,
        access_token_enc: null, external_account_id: 'ig-42',
        media_type: 'image', source_url: 'https://example.com/a.jpg',
        ...overrides,
    };
}

async function withFetch(rpcHandlers, run) {
    const real = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        calls.push(name);
        const handler = rpcHandlers[name];
        if (!handler) throw new Error(`unexpected rpc: ${name}`);
        return Response.json(await handler(JSON.parse(init.body)));
    };
    try { await run(calls); } finally { globalThis.fetch = real; }
}

test('refuses to run without a supabase config or a valid encryption key', async () => {
    assert.deepEqual(await runPublishSweep({ cfg: {}, cryptoCfg }), { ok: false, skipped: 'not_configured' });
    assert.deepEqual(await runPublishSweep({ cfg, cryptoCfg: null }), { ok: false, skipped: 'not_configured' });
});

test('nothing claimed is a clean no-op, not an error', async () => {
    await withFetch({ claim_due_social_post_targets: async () => [] }, async (calls) => {
        assert.deepEqual(await runPublishSweep({ cfg, cryptoCfg }), { ok: true, claimed: 0, published: 0, failed: 0, errors: 0 });
        assert.deepEqual(calls, ['claim_due_social_post_targets']);
    });
});

test('an unimplemented network fails its target with a named reason, never hangs as pending', async () => {
    await withFetch({
        claim_due_social_post_targets: async () => [target({ network: 'tiktok', target_id: 't-2' })],
        complete_social_post_target: async (body) => {
            assert.equal(body.p_target_id, 't-2');
            assert.equal(body.p_ok, false);
            assert.equal(body.p_error, 'network_not_implemented');
            return { ok: true };
        },
    }, async () => {
        const out = await runPublishSweep({ cfg, cryptoCfg });
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 1, errors: 0 });
    });
});

test('publishes an Instagram image target and reports the platform ids back', async () => {
    const accessTokenEnc = await encryptToken('page-access-token', cryptoCfg);
    let publishCalls = 0;
    await withFetch({
        claim_due_social_post_targets: async () => [target({ access_token_enc: accessTokenEnc })],
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
            if (u.hostname === 'graph.facebook.com') {
                publishCalls += 1;
                if (u.pathname.endsWith('/media')) return Response.json({ id: 'container-1' });
                if (u.pathname.endsWith('/media_publish')) return Response.json({ id: 'media-1' });
                return Response.json({ id: 'media-1', permalink: 'https://www.instagram.com/p/abc/' });
            }
            return real(url, init);
        };
        const out = await runPublishSweep({ cfg, cryptoCfg });
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
            if (u.hostname === 'example.com') {
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
        const out = await runPublishSweep({ cfg, cryptoCfg });
        assert.deepEqual(out, { ok: true, claimed: 1, published: 1, failed: 0, errors: 0 });
        assert.equal(publishCalls, 4);
    });
});

test('missing media on a claimed target fails cleanly instead of dispatching', async () => {
    await withFetch({
        claim_due_social_post_targets: async () => [target({ media_type: null, source_url: null })],
        complete_social_post_target: async (body) => {
            assert.equal(body.p_error, 'missing_media');
            return { ok: true };
        },
    }, async () => {
        const out = await runPublishSweep({ cfg, cryptoCfg });
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 1, errors: 0 });
    });
});

test('one target throwing during dispatch does not sink the rest of the batch', async () => {
    await withFetch({
        claim_due_social_post_targets: async () => [
            target({ target_id: 't-bad', access_token_enc: '\\xnotvalidhex!' }),
            target({ target_id: 't-skip', network: 'tiktok' }),
        ],
        complete_social_post_target: async (body) => ({ ok: true, seen: body.p_target_id }),
    }, async () => {
        const out = await runPublishSweep({ cfg, cryptoCfg });
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
        await runPublishSweep({ cfg, cryptoCfg });
    });
});
