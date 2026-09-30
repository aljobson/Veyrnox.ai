import test from 'node:test';
import assert from 'node:assert/strict';
import { runPublishSweep, BATCH } from '../lib/socialPublishSweep.js';
import { tokenCryptoConfig, encryptToken } from '../lib/social/tokenCrypto.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test-service' };
const cryptoCfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
const r2cfg = { accountId: 'acct', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' };
const publicHost = 'https://veyrnox.ai';
const mediaProxySecret = 'media-proxy-secret';
const asyncDeps = { cfg, cryptoCfg, r2cfg, publicHost, mediaProxySecret };
Object.assign(process.env, {
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
        const handler = rpcHandlers[name];
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
        assert.deepEqual(calls, ['claim_due_social_post_targets']);
    });
});

test('an unimplemented network fails its target with a named reason, never hangs as pending', async () => {
    await withFetch({
        claim_due_social_post_targets: async () => [target({ network: 'pinterest', target_id: 't-2' })],
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

// ── TikTok: MEDIA_UPLOAD mode, submit-then-poll ─────────────────────────

test('TikTok: first dispatch proxies the media through our own domain and reports the publish_id back as in-progress', async () => {
    const accessTokenEnc = await encryptToken('tt-access-token', cryptoCfg);
    let seenPhotoUrl;
    await withFetch({
        claim_due_social_post_targets: async () => [target({
            network: 'tiktok', target_id: 't-tt', external_account_id: 'tt-open-id', access_token_enc: accessTokenEnc,
        })],
        report_social_post_progress: async (body) => {
            assert.equal(body.p_target_id, 't-tt');
            assert.equal(body.p_provider_state.publish_id, 'publish-1');
            assert.ok(body.p_provider_state.started_at);
            assert.ok(body.p_next_check_at);
            return { ok: true };
        },
    }, async (calls) => {
        const real = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.hostname === 'open.tiktokapis.com' && u.pathname === '/v2/post/publish/content/init/') {
                const body = JSON.parse(init.body);
                seenPhotoUrl = body.source_info.photo_images[0];
                assert.equal(body.post_mode, 'MEDIA_UPLOAD');
                assert.equal(body.is_aigc, true);
                return Response.json({ data: { publish_id: 'publish-1' } });
            }
            return real(url, init);
        };
        const out = await runPublishSweep(asyncDeps);
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 0, errors: 0 });
        assert.deepEqual(calls, ['claim_due_social_post_targets', 'report_social_post_progress']);
        assert.ok(seenPhotoUrl.startsWith('https://veyrnox.ai/media/social/'));
    });
});

test('TikTok: a still-processing status keeps polling instead of completing', async () => {
    const accessTokenEnc = await encryptToken('tt-access-token', cryptoCfg);
    await withFetch({
        claim_due_social_post_targets: async () => [target({
            network: 'tiktok', target_id: 't-tt', access_token_enc: accessTokenEnc,
            provider_state: { publish_id: 'publish-1', started_at: new Date().toISOString() },
        })],
        report_social_post_progress: async (body) => {
            assert.equal(body.p_provider_state.publish_id, 'publish-1');
            return { ok: true };
        },
    }, async (calls) => {
        const real = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.hostname === 'open.tiktokapis.com' && u.pathname === '/v2/post/publish/status/fetch/') {
                return Response.json({ data: { status: 'PROCESSING_DOWNLOAD' } });
            }
            return real(url, init);
        };
        const out = await runPublishSweep(asyncDeps);
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 0, errors: 0 });
        assert.deepEqual(calls, ['claim_due_social_post_targets', 'report_social_post_progress']);
    });
});

test('TikTok: SEND_TO_USER_INBOX completes as delivered, not published — it is a draft, not a live post', async () => {
    const accessTokenEnc = await encryptToken('tt-access-token', cryptoCfg);
    await withFetch({
        claim_due_social_post_targets: async () => [target({
            network: 'tiktok', target_id: 't-tt', access_token_enc: accessTokenEnc,
            provider_state: { publish_id: 'publish-1', started_at: new Date().toISOString() },
        })],
        complete_social_post_target: async (body) => {
            assert.equal(body.p_ok, true);
            assert.equal(body.p_delivered, true);
            assert.equal(body.p_platform_post_id, 'publish-1');
            assert.equal(body.p_platform_post_url, null);
            return { ok: true };
        },
    }, async () => {
        const real = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.hostname === 'open.tiktokapis.com' && u.pathname === '/v2/post/publish/status/fetch/') {
                return Response.json({ data: { status: 'SEND_TO_USER_INBOX' } });
            }
            return real(url, init);
        };
        const out = await runPublishSweep(asyncDeps);
        assert.deepEqual(out, { ok: true, claimed: 1, published: 1, failed: 0, errors: 0 });
    });
});

test('TikTok: a FAILED status fails the target with the provider\'s own reason', async () => {
    const accessTokenEnc = await encryptToken('tt-access-token', cryptoCfg);
    await withFetch({
        claim_due_social_post_targets: async () => [target({
            network: 'tiktok', target_id: 't-tt', access_token_enc: accessTokenEnc,
            provider_state: { publish_id: 'publish-1', started_at: new Date().toISOString() },
        })],
        complete_social_post_target: async (body) => {
            assert.equal(body.p_ok, false);
            assert.equal(body.p_error, 'photo_pull_failed');
            return { ok: true };
        },
    }, async () => {
        const real = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.hostname === 'open.tiktokapis.com' && u.pathname === '/v2/post/publish/status/fetch/') {
                return Response.json({ data: { status: 'FAILED', fail_reason: 'photo_pull_failed' } });
            }
            return real(url, init);
        };
        const out = await runPublishSweep(asyncDeps);
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 1, errors: 0 });
    });
});

test('TikTok: a poll stuck past the outer time bound fails cleanly without calling TikTok again', async () => {
    const accessTokenEnc = await encryptToken('tt-access-token', cryptoCfg);
    let tiktokCalls = 0;
    await withFetch({
        claim_due_social_post_targets: async () => [target({
            network: 'tiktok', target_id: 't-tt', access_token_enc: accessTokenEnc,
            provider_state: { publish_id: 'publish-1', started_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
        })],
        complete_social_post_target: async (body) => {
            assert.equal(body.p_ok, false);
            assert.equal(body.p_error, 'poll_timeout');
            return { ok: true };
        },
    }, async () => {
        const real = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            if (new URL(url).hostname === 'open.tiktokapis.com') tiktokCalls += 1;
            return real(url, init);
        };
        const out = await runPublishSweep(asyncDeps);
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 1, errors: 0 });
        assert.equal(tiktokCalls, 0);
    });
});

// ── YouTube: resumable upload across ticks, then processing poll ───────

const youtubeTarget = (overrides = {}) => target({
    network: 'youtube', target_id: 't-yt', external_account_id: 'channel-1',
    media_type: 'video', mime_type: 'video/mp4', size_bytes: 1000,
    ...overrides,
});

test('YouTube: first dispatch spends one quota unit and starts a resumable session', async () => {
    const accessTokenEnc = await encryptToken('yt-access-token', cryptoCfg);
    let quotaCalls = 0;
    await withFetch({
        claim_due_social_post_targets: async () => [youtubeTarget({ access_token_enc: accessTokenEnc })],
        consume_youtube_upload_quota: async () => { quotaCalls += 1; return { ok: true, used: 1, limit: 80 }; },
        report_social_post_progress: async (body) => {
            assert.equal(body.p_provider_state.phase, 'uploading');
            assert.equal(body.p_provider_state.session_uri, 'https://upload.example/session-1');
            assert.equal(body.p_provider_state.total_bytes, 1000);
            return { ok: true };
        },
    }, async (calls) => {
        const real = globalThis.fetch;
        const headerGet = (values) => ({ get: (k) => values[k.toLowerCase()] ?? null });
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.hostname === 'www.googleapis.com' && u.pathname === '/upload/youtube/v3/videos') {
                assert.equal(init.headers['X-Upload-Content-Length'], '1000');
                return { ok: true, status: 200, headers: headerGet({ location: 'https://upload.example/session-1' }) };
            }
            return real(url, init);
        };
        const out = await runPublishSweep(asyncDeps);
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 0, errors: 0 });
        assert.equal(quotaCalls, 1);
        assert.deepEqual(calls, ['claim_due_social_post_targets', 'consume_youtube_upload_quota', 'report_social_post_progress']);
    });
});

test('YouTube: quota exhaustion defers to the next UTC day rather than burning the 3-attempt retry budget', async () => {
    // Quota resets at UTC midnight and has nothing to do with whether THIS
    // post is postable — treating it as an ordinary failure would exhaust
    // every queued post's retry budget (~15 minutes) long before the quota
    // actually resets, permanently failing posts that did nothing wrong.
    const accessTokenEnc = await encryptToken('yt-access-token', cryptoCfg);
    let uploadInitCalls = 0;
    await withFetch({
        claim_due_social_post_targets: async () => [youtubeTarget({ access_token_enc: accessTokenEnc })],
        consume_youtube_upload_quota: async () => ({ ok: false, code: 'QUOTA_EXHAUSTED' }),
        report_social_post_progress: async (body) => {
            assert.deepEqual(body.p_provider_state, {});
            assert.ok(new Date(body.p_next_check_at).getTime() > Date.now() + 60_000);
            return { ok: true };
        },
    }, async () => {
        const real = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            if (new URL(url).hostname === 'www.googleapis.com') uploadInitCalls += 1;
            return real(url, init);
        };
        const out = await runPublishSweep(asyncDeps);
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 0, errors: 0 });
        assert.equal(uploadInitCalls, 0);
    });
});

test('YouTube: an in-progress session uploads the whole small file in one chunk and moves to processing', async () => {
    const accessTokenEnc = await encryptToken('yt-access-token', cryptoCfg);
    await withFetch({
        claim_due_social_post_targets: async () => [youtubeTarget({
            access_token_enc: accessTokenEnc,
            provider_state: {
                phase: 'uploading', session_uri: 'https://upload.example/session-1', total_bytes: 1000,
                mime_type: 'video/mp4', bytes_confirmed: 0, started_at: new Date().toISOString(),
            },
        })],
        report_social_post_progress: async (body) => {
            assert.equal(body.p_provider_state.phase, 'processing');
            assert.equal(body.p_provider_state.video_id, 'video-1');
            return { ok: true };
        },
    }, async (calls) => {
        const real = globalThis.fetch;
        const headerGet = (values) => ({ get: (k) => values[k.toLowerCase()] ?? null });
        let putCount = 0;
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.hostname === 'acct.r2.cloudflarestorage.com') {
                assert.equal(init.headers.Range, 'bytes=0-999');
                return { ok: true, status: 206, headers: headerGet({}), arrayBuffer: async () => new Uint8Array(1000).buffer };
            }
            if (u.href === 'https://upload.example/session-1') {
                putCount += 1;
                assert.equal(init.headers.Authorization, 'Bearer yt-access-token', 'every PUT to the session URI must still be authenticated');
                if (init.headers['Content-Range'] === 'bytes */1000') {
                    // The probe — a brand-new session has received nothing yet.
                    return { ok: false, status: 308, headers: headerGet({}) };
                }
                assert.equal(init.headers['Content-Range'], 'bytes 0-999/1000');
                return { ok: true, status: 200, headers: headerGet({}), json: async () => ({ id: 'video-1' }) };
            }
            return real(url, init);
        };
        const out = await runPublishSweep(asyncDeps);
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 0, errors: 0 });
        assert.equal(putCount, 2); // probe, then the chunk itself
        assert.deepEqual(calls, ['claim_due_social_post_targets', 'report_social_post_progress']);
    });
});

test('YouTube: processing succeeded completes the target with a watch URL', async () => {
    const accessTokenEnc = await encryptToken('yt-access-token', cryptoCfg);
    await withFetch({
        claim_due_social_post_targets: async () => [youtubeTarget({
            access_token_enc: accessTokenEnc,
            provider_state: { phase: 'processing', video_id: 'video-1', started_at: new Date().toISOString() },
        })],
        complete_social_post_target: async (body) => {
            assert.equal(body.p_ok, true);
            assert.equal(body.p_platform_post_id, 'video-1');
            assert.equal(body.p_platform_post_url, 'https://www.youtube.com/watch?v=video-1');
            return { ok: true };
        },
    }, async () => {
        const real = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.hostname === 'www.googleapis.com' && u.pathname === '/youtube/v3/videos') {
                return Response.json({ items: [{ status: { uploadStatus: 'processed' }, processingDetails: { processingStatus: 'succeeded' } }] });
            }
            return real(url, init);
        };
        const out = await runPublishSweep(asyncDeps);
        assert.deepEqual(out, { ok: true, claimed: 1, published: 1, failed: 0, errors: 0 });
    });
});

test('YouTube: an expired upload session clears provider_state instead of retrying the same dead URI', async () => {
    // A 404/410 on the session URI never recovers (Google's own docs) — the
    // old behavior burned the 3-attempt retry budget re-probing a session
    // that could never succeed, permanently failing a video a fresh
    // session could have completed.
    const accessTokenEnc = await encryptToken('yt-access-token', cryptoCfg);
    let uploadInitCalls = 0;
    await withFetch({
        claim_due_social_post_targets: async () => [youtubeTarget({
            access_token_enc: accessTokenEnc,
            provider_state: {
                phase: 'uploading', session_uri: 'https://upload.example/session-dead', total_bytes: 1000,
                mime_type: 'video/mp4', bytes_confirmed: 0, started_at: new Date().toISOString(),
            },
        })],
        report_social_post_progress: async (body) => {
            assert.deepEqual(body.p_provider_state, {});
            return { ok: true };
        },
    }, async () => {
        const real = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.href === 'https://upload.example/session-dead') return { ok: false, status: 404, headers: { get: () => null } };
            if (u.hostname === 'www.googleapis.com') uploadInitCalls += 1;
            return real(url, init);
        };
        const out = await runPublishSweep(asyncDeps);
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 0, errors: 0 });
        // Clearing provider_state is enough — a fresh session opens on the
        // *next* tick (this one doesn't fall through and re-dispatch itself).
        assert.equal(uploadInitCalls, 0);
    });
});

test('YouTube: an access token near expiry is refreshed before dispatch, and the refreshed token is persisted', async () => {
    const accessTokenEnc = await encryptToken('yt-stale-token', cryptoCfg);
    const refreshTokenEnc = await encryptToken('yt-refresh-token', cryptoCfg);
    let sawBearer;
    await withFetch({
        claim_due_social_post_targets: async () => [youtubeTarget({
            access_token_enc: accessTokenEnc, refresh_token_enc: refreshTokenEnc,
            token_expires_at: new Date(Date.now() - 1000).toISOString(),
        })],
        consume_youtube_upload_quota: async () => ({ ok: true, used: 1, limit: 80 }),
        update_social_account_token: async (body) => {
            assert.equal(body.p_account_id, 'a-1');
            return { ok: true };
        },
        report_social_post_progress: async () => ({ ok: true }),
    }, async (calls) => {
        const real = globalThis.fetch;
        const headerGet = (values) => ({ get: (k) => values[k.toLowerCase()] ?? null });
        globalThis.fetch = async (url, init) => {
            const u = new URL(url);
            if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') {
                return Response.json({ access_token: 'yt-fresh-token', expires_in: 3600 });
            }
            if (u.hostname === 'www.googleapis.com' && u.pathname === '/upload/youtube/v3/videos') {
                sawBearer = init.headers.Authorization;
                return { ok: true, status: 200, headers: headerGet({ location: 'https://upload.example/session-2' }) };
            }
            return real(url, init);
        };
        const out = await runPublishSweep(asyncDeps);
        assert.deepEqual(out, { ok: true, claimed: 1, published: 0, failed: 0, errors: 0 });
        assert.equal(sawBearer, 'Bearer yt-fresh-token');
        assert.ok(calls.includes('update_social_account_token'));
    });
});
