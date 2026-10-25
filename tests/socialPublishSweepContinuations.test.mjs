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
        media_type: 'image', mime_type: 'image/jpeg', r2_key: 'assets/a.jpg',
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

// ── TikTok: MEDIA_UPLOAD mode, submit-then-poll ─────────────────────────

test('TikTok: unsupported photo MIME fails without submitting to the provider', async () => {
    const accessTokenEnc = await encryptToken('tt-access-token', cryptoCfg);
    for (const mime of ['image/png', 'image/gif', undefined]) {
        let failure;
        await withFetch({
            claim_due_social_post_targets_v2: async () => [target({ network: 'tiktok', access_token_enc: accessTokenEnc, mime_type: mime })],
            complete_social_post_target: async body => { failure = body; return { ok: true }; },
        }, async () => {
            const out = await runPublishSweep(asyncDeps);
            assert.equal(out.failed, 1);
            assert.equal(out.errors, 0);
            assert.equal(failure.p_error, 'tiktok_photo_format_not_supported');
        });
    }
});

test('TikTok: first dispatch proxies the media through our own domain and reports the publish_id back as in-progress', async () => {
    const accessTokenEnc = await encryptToken('tt-access-token', cryptoCfg);
    let seenPhotoUrl;
    await withFetch({
        claim_due_social_post_targets_v2: async () => [target({
            network: 'tiktok', target_id: 't-tt', external_account_id: 'tt-open-id', access_token_enc: accessTokenEnc,
        })],
        mark_social_provider_submission: async (body) => {
            assert.equal(body.p_target_id, 't-tt');
            assert.equal(body.p_network, 'tiktok');
            return { ok: true };
        },
        report_social_post_progress: async (body) => {
            assert.equal(body.p_target_id, 't-tt');
            assert.equal(body.p_provider_state.publish_id, 'publish-1');
            assert.equal(body.p_provider_state.submission_started, true);
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
        assert.deepEqual(calls, ['authorize_social_target_dispatch', 'claim_due_social_post_targets_v2', 'authorize_social_target_dispatch', 'authorize_social_target_dispatch', 'mark_social_provider_submission', 'report_social_post_progress']);
        assert.ok(seenPhotoUrl.startsWith('https://veyrnox.ai/media/social/'));
    });
});

test('TikTok: a still-processing status keeps polling instead of completing', async () => {
    const accessTokenEnc = await encryptToken('tt-access-token', cryptoCfg);
    await withFetch({
        claim_due_social_post_targets_v2: async () => [target({
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
        assert.deepEqual(calls, ['authorize_social_target_dispatch', 'claim_due_social_post_targets_v2', 'report_social_post_progress']);
    });
});

test('TikTok: SEND_TO_USER_INBOX completes as delivered, not published — it is a draft, not a live post', async () => {
    const accessTokenEnc = await encryptToken('tt-access-token', cryptoCfg);
    await withFetch({
        claim_due_social_post_targets_v2: async () => [target({
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
        claim_due_social_post_targets_v2: async () => [target({
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
        claim_due_social_post_targets_v2: async () => [target({
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
        claim_due_social_post_targets_v2: async () => [youtubeTarget({ access_token_enc: accessTokenEnc })],
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
        assert.deepEqual(calls, ['authorize_social_target_dispatch', 'claim_due_social_post_targets_v2', 'authorize_social_target_dispatch', 'consume_youtube_upload_quota', 'report_social_post_progress']);
    });
});

test('YouTube: the quota reset is the next Pacific midnight, the day 0181 counts on', () => {
    // 12:00 UTC is 05:00 PDT: the reset is 07:00 UTC the next day, not 00:00 UTC.
    assert.equal(nextYoutubeQuotaReset(new Date('2026-10-03T12:00:00Z')), '2026-10-04T07:05:00.000Z');
    // 03:00 UTC is still the previous Pacific day (20:00 PDT): four hours to go, not twenty-one.
    assert.equal(nextYoutubeQuotaReset(new Date('2026-10-03T03:00:00Z')), '2026-10-03T07:05:00.000Z');
    // Winter: PST is UTC-8.
    assert.equal(nextYoutubeQuotaReset(new Date('2026-01-15T12:00:00Z')), '2026-01-16T08:05:00.000Z');
    // Just after the reset it points at the next one.
    assert.equal(nextYoutubeQuotaReset(new Date('2026-10-03T07:00:01Z')), '2026-10-04T07:05:00.000Z');
});

test('YouTube: quota exhaustion defers to the next Pacific day rather than burning the 3-attempt retry budget', async () => {
    // Quota resets at midnight Pacific and has nothing to do with whether THIS
    // post is postable — treating it as an ordinary failure would exhaust
    // every queued post's retry budget (~15 minutes) long before the quota
    // actually resets, permanently failing posts that did nothing wrong.
    const accessTokenEnc = await encryptToken('yt-access-token', cryptoCfg);
    let uploadInitCalls = 0;
    await withFetch({
        claim_due_social_post_targets_v2: async () => [youtubeTarget({ access_token_enc: accessTokenEnc })],
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
        claim_due_social_post_targets_v2: async () => [youtubeTarget({
            access_token_enc: accessTokenEnc,
            provider_state: {
                youtube_visibility: 'private', phase: 'uploading', session_uri: 'https://upload.example/session-1', total_bytes: 1000,
                mime_type: 'video/mp4', bytes_confirmed: 0, started_at: new Date().toISOString(),
            },
        })],
        report_social_post_progress: async (body) => {
            assert.equal(body.p_provider_state.phase, 'processing');
            assert.equal(body.p_provider_state.youtube_visibility, 'private');
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
        assert.deepEqual(calls, ['authorize_social_target_dispatch', 'claim_due_social_post_targets_v2', 'authorize_social_target_dispatch', 'authorize_social_target_dispatch', 'report_social_post_progress']);
    });
});

test('YouTube: processing succeeded completes the target with a watch URL', async () => {
    const accessTokenEnc = await encryptToken('yt-access-token', cryptoCfg);
    await withFetch({
        claim_due_social_post_targets_v2: async () => [youtubeTarget({
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
        claim_due_social_post_targets_v2: async () => [youtubeTarget({
            access_token_enc: accessTokenEnc,
            provider_state: {
                phase: 'uploading', session_uri: 'https://upload.example/session-dead', total_bytes: 1000,
                mime_type: 'video/mp4', bytes_confirmed: 0, started_at: new Date().toISOString(),
            },
        })],
        report_social_post_progress: async (body) => {
            // Only a restart count survives; the dead session URI is gone.
            assert.deepEqual(body.p_provider_state, { restarts: 1 });
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

test('YouTube: a session that keeps expiring fails the post instead of restarting for ever', async () => {
    // Every fresh session spends a unit of the daily quota.
    const accessTokenEnc = await encryptToken('yt-access-token', cryptoCfg);
    let completed;
    await withFetch({
        claim_due_social_post_targets_v2: async () => [youtubeTarget({
            access_token_enc: accessTokenEnc,
            provider_state: {
                phase: 'uploading', session_uri: 'https://upload.example/session-dead', total_bytes: 1000,
                mime_type: 'video/mp4', bytes_confirmed: 0, started_at: new Date().toISOString(), restarts: 2,
            },
        })],
        report_social_post_progress: async () => assert.fail('must not restart a third time'),
        complete_social_post_target: async (body) => { completed = body; return { ok: true }; },
    }, async () => {
        const real = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            if (new URL(url).href === 'https://upload.example/session-dead') return { ok: false, status: 404, headers: { get: () => null } };
            return real(url, init);
        };
        const out = await runPublishSweep(asyncDeps);
        assert.equal(out.failed, 1);
        assert.equal(completed.p_ok, false);
        assert.equal(completed.p_error, 'youtube_upload_session_expired');
    });
});

test('YouTube: a quota answer that is not "exhausted" fails normally instead of deferring a day', async () => {
    const accessTokenEnc = await encryptToken('yt-access-token', cryptoCfg);
    let completed;
    await withFetch({
        claim_due_social_post_targets_v2: async () => [youtubeTarget({ access_token_enc: accessTokenEnc })],
        consume_youtube_upload_quota: async () => ({ ok: false, code: 'SOMETHING_ELSE' }),
        report_social_post_progress: async () => assert.fail('must not defer'),
        complete_social_post_target: async (body) => { completed = body; return { ok: true }; },
    }, async () => {
        const out = await runPublishSweep(asyncDeps);
        assert.equal(out.failed, 1);
        assert.equal(completed.p_error, 'youtube_quota_unavailable');
    });
});

test('YouTube: an access token near expiry is refreshed before dispatch, and the refreshed token is persisted', async () => {
    const accessTokenEnc = await encryptToken('yt-stale-token', cryptoCfg);
    const refreshTokenEnc = await encryptToken('yt-refresh-token', cryptoCfg);
    let sawBearer;
    await withFetch({
        claim_due_social_post_targets_v2: async () => [youtubeTarget({
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

test('YouTube preserves selected visibility through quota deferral, expired sessions and new upload initialization', async () => {
    const accessTokenEnc = await encryptToken('yt-access-token', cryptoCfg);
    for (const visibility of ['private', 'unlisted', 'public']) {
        for (const stage of ['quota', 'expired', 'init']) {
            const state = stage === 'expired'
                ? { youtube_visibility: visibility, phase: 'uploading', session_uri: 'https://upload.example/dead', total_bytes: 1000, started_at: new Date().toISOString() }
                : { youtube_visibility: visibility };
            let progress;
            await withFetch({
                claim_due_social_post_targets_v2: async () => [youtubeTarget({ access_token_enc: accessTokenEnc, provider_state: state })],
                consume_youtube_upload_quota: async () => stage === 'quota' ? { ok: false, code: 'QUOTA_EXHAUSTED' } : { ok: true },
                report_social_post_progress: async (body) => { progress = body.p_provider_state; return { ok: true }; },
            }, async () => {
                const real = globalThis.fetch;
                globalThis.fetch = async (url, init) => {
                    if (String(url) === 'https://upload.example/dead') return new Response('', { status: 404 });
                    if (new URL(url).pathname === '/upload/youtube/v3/videos') {
                        assert.equal(JSON.parse(init.body).status.privacyStatus, visibility);
                        return new Response('', { status: 200, headers: { location: 'https://upload.example/new' } });
                    }
                    return real(url, init);
                };
                assert.equal((await runPublishSweep(asyncDeps)).errors, 0);
                assert.equal(progress.youtube_visibility, visibility, stage);
                if (stage === 'expired') assert.equal(progress.session_uri, undefined);
            });
        }
    }
});

test('YouTube rejects invalid persisted visibility before calling upload or consuming quota', async () => {
    const accessTokenEnc = await encryptToken('yt-access-token', cryptoCfg);
    for (const visibility of ['invalid', null, 12]) {
        let completed;
        await withFetch({
            claim_due_social_post_targets_v2: async () => [youtubeTarget({ access_token_enc: accessTokenEnc, provider_state: { youtube_visibility: visibility } })],
            complete_social_post_target: async (body) => { completed = body; return { ok: true }; },
        }, async (calls) => {
            assert.equal((await runPublishSweep(asyncDeps)).failed, 1);
            assert.equal(completed.p_error, 'invalid_youtube_visibility');
            assert.deepEqual(calls, ['authorize_social_target_dispatch', 'claim_due_social_post_targets_v2', 'authorize_social_target_dispatch', 'complete_social_post_target']);
        });
    }
});
