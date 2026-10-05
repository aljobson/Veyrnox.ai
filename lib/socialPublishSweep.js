/**
 * The publish-sweep: the five-minute Worker cron claims due
 * social_post_targets (ADR-0061 §2.6) and dispatches each to its network
 * adapter. Claim/complete are two separate RPC round trips (packages/db/
 * schema/supabase/0156, extended by 0161) rather than one in-process
 * transaction — Workers cannot hold a Postgres connection open across a
 * slow provider call, so the claim commits first and the result is
 * reported back after.
 *
 * Instagram, LinkedIn and X finish inside one tick: submit, get an id
 * back, done. TikTok and YouTube (ADR-0061 Phase 5) don't — TikTok
 * returns a publish_id that must be polled separately until it settles,
 * and a YouTube video upload can span many ticks (its resumable-upload
 * session URI plus the last-confirmed byte offset is exactly the state a
 * stateless cron needs to carry between them). Those two dispatchers can
 * return `{ inProgress: true, providerState, nextCheckAt }` instead of a
 * terminal outcome — the sweep reports that back with
 * report_social_post_progress and reclaims the row on nextCheckAt, never
 * incrementing the attempts-based failure counter for routine
 * continuation (see 0161's own comment on claim_due_social_post_targets).
 *
 * Any other network fails its target immediately with a named error
 * rather than being silently dropped, so it surfaces in
 * social_post_targets.last_error instead of hanging as "pending" forever.
 */

import { rpc } from '../packages/db/supabase-client.js';
import { decryptToken, encryptToken } from './social/tokenCrypto.js';
import { presignGetUrl, isConfigured as r2IsConfigured } from '../packages/adapters/r2.js';
import { createMediaProxyToken } from './social/mediaProxyToken.js';
import { publishPost as publishInstagram } from '../packages/adapters/social/instagram.js';
import { publishPost as publishLinkedin } from '../packages/adapters/social/linkedin.js';
import { publishPost as publishX } from '../packages/adapters/social/twitter.js';
import { submitMediaUploadPost, checkPublishStatus as checkTiktokStatus } from '../packages/adapters/social/tiktok.js';
import {
    youtubeConfig, refreshAccessToken as refreshYoutubeToken, initResumableUpload, probeUploadOffset, uploadChunk,
    checkProcessingStatus as checkYoutubeProcessing,
} from '../packages/adapters/social/youtube.js';

export const BATCH = 25;
const MEDIA_URL_TTL_SECONDS = 900;
const TIKTOK_POLL_INTERVAL_MS = 30_000;
const YOUTUBE_UPLOAD_RETRY_MS = 5_000;
const YOUTUBE_PROCESSING_POLL_MS = 60_000;
const TIKTOK_MAX_POLL_MS = 2 * 60 * 60 * 1000; // 2h — photo posts should settle in minutes
const YOUTUBE_MAX_POLL_MS = 24 * 60 * 60 * 1000; // 24h — a large video at a slow chunk rate needs real headroom
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;

function inMs(ms) {
    return new Date(Date.now() + ms).toISOString();
}

const QUOTA_RESET_BUFFER_MS = 5 * 60 * 1000;
// Each fresh upload session spends a unit of the daily quota, so a session
// that keeps dying fails the post instead of restarting for ever.
const YOUTUBE_MAX_SESSION_RESTARTS = 2;
const PACIFIC_CLOCK = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric',
});

/** When the daily YouTube upload quota next resets: midnight Pacific Time,
 * the day consume_youtube_upload_quota counts on (0181), plus a few minutes
 * so the sweep isn't racing the rollover. On the two days a year the clocks
 * change this is an hour out; an early wake-up just defers again. */
export function nextYoutubeQuotaReset(now = new Date()) {
    const clock = Object.fromEntries(PACIFIC_CLOCK.formatToParts(now).map((p) => [p.type, Number(p.value)]));
    const sinceMidnightMs = ((clock.hour * 60 + clock.minute) * 60 + clock.second) * 1000;
    return new Date(now.getTime() + 24 * 60 * 60 * 1000 - sinceMidnightMs + QUOTA_RESET_BUFFER_MS).toISOString();
}

/** True once a continuation has run longer than its network's own outer
 * bound — a safeguard against a provider that never settles, not a normal
 * path. Falls through complete_social_post_target's existing attempts/
 * backoff logic exactly like any other failure. */
function pollTimedOut(providerState, maxMs) {
    return providerState?.started_at && Date.now() - Date.parse(providerState.started_at) > maxMs;
}

const DISPATCHERS = {
    instagram: async (target, accessToken, mediaUrl) => {
        const result = await publishInstagram(accessToken, {
            externalAccountId: target.external_account_id,
            caption: target.text_override || target.global_text || '',
            mediaType: target.media_type,
            mediaUrl,
        });
        return { ok: true, platformPostId: result.platformPostId, platformPostUrl: result.platformPostUrl };
    },
    linkedin: async (target, accessToken, mediaUrl) => {
        const result = await publishLinkedin(accessToken, {
            externalAccountId: target.external_account_id,
            caption: target.text_override || target.global_text || '',
            mediaType: target.media_type,
            mediaUrl,
        });
        return { ok: true, platformPostId: result.platformPostId, platformPostUrl: result.platformPostUrl };
    },
    // No username field reaches the claim row (only the numeric
    // external_account_id does) — publishPost falls back to X's own
    // handle-agnostic i/web/status/ permalink form when it's absent.
    twitter: async (target, accessToken, mediaUrl) => {
        const result = await publishX(accessToken, {
            caption: target.text_override || target.global_text || '',
            mediaType: target.media_type,
            mediaUrl,
        });
        return { ok: true, platformPostId: result.platformPostId, platformPostUrl: result.platformPostUrl };
    },

    // MEDIA_UPLOAD only (see packages/adapters/social/tiktok.js's own
    // header) — a "delivered" success means content reached the
    // creator's TikTok inbox, not that it's publicly live.
    tiktok: async (target, accessToken, mediaUrl, ctx) => {
        const state = target.provider_state || {};
        if (state.publish_id) {
            if (pollTimedOut(state, TIKTOK_MAX_POLL_MS)) return { ok: false, error: 'poll_timeout' };
            const status = await checkTiktokStatus(accessToken, state.publish_id);
            if (status.status === 'PUBLISH_COMPLETE' || status.status === 'SEND_TO_USER_INBOX') {
                return { ok: true, delivered: true, platformPostId: state.publish_id, platformPostUrl: null };
            }
            if (status.status === 'FAILED') {
                return { ok: false, error: status.failReason || 'tiktok_publish_failed' };
            }
            return { inProgress: true, providerState: state, nextCheckAt: inMs(TIKTOK_POLL_INTERVAL_MS) };
        }
        const token = await createMediaProxyToken({ r2Key: target.r2_key }, ctx.mediaProxySecret);
        const photoUrl = new URL(`/media/social/${token}`, ctx.publicHost).toString();
        const { publishId } = await submitMediaUploadPost(accessToken, {
            photoUrl, caption: target.text_override || target.global_text || '',
        });
        return {
            inProgress: true,
            providerState: { publish_id: publishId, started_at: new Date().toISOString() },
            nextCheckAt: inMs(TIKTOK_POLL_INTERVAL_MS),
        };
    },

    // Resumable upload, one chunk per tick — see packages/adapters/social/
    // youtube.js's own header. provider_state.phase distinguishes an
    // in-progress byte upload from the post-upload processing wait.
    youtube: async (target, accessToken, mediaUrl, ctx) => {
        const state = target.provider_state || {};

        if (state.phase === 'processing') {
            if (pollTimedOut(state, YOUTUBE_MAX_POLL_MS)) return { ok: false, error: 'poll_timeout' };
            const status = await checkYoutubeProcessing(accessToken, state.video_id);
            if (status.processingStatus === 'succeeded') {
                return {
                    ok: true, platformPostId: state.video_id,
                    platformPostUrl: `https://www.youtube.com/watch?v=${state.video_id}`,
                };
            }
            if (status.processingStatus === 'failed' || status.uploadStatus === 'failed' || status.uploadStatus === 'rejected') {
                return { ok: false, error: status.failureReason || status.rejectionReason || 'youtube_processing_failed' };
            }
            return { inProgress: true, providerState: state, nextCheckAt: inMs(YOUTUBE_PROCESSING_POLL_MS) };
        }

        if (state.phase === 'uploading' && state.session_uri) {
            if (pollTimedOut(state, YOUTUBE_MAX_POLL_MS)) return { ok: false, error: 'poll_timeout' };
            let probe;
            try {
                // Reconciles against what the session actually has — a
                // prior tick's PUT may have landed even if the Worker died
                // before we recorded it.
                probe = await probeUploadOffset(state.session_uri, state.total_bytes, accessToken);
            } catch (err) {
                if (err && err.code === 'UPLOAD_SESSION_EXPIRED') {
                    // The session URI is permanently dead (Google docs: a
                    // 404/410 here never recovers) — clearing provider_state
                    // makes the next tick fall through to "first dispatch"
                    // below and open a fresh session, rather than burning
                    // the 3-attempt retry budget re-probing a URI that can
                    // never succeed.
                    const restarts = (state.restarts || 0) + 1;
                    if (restarts > YOUTUBE_MAX_SESSION_RESTARTS) return { ok: false, error: 'youtube_upload_session_expired' };
                    return { inProgress: true, providerState: { restarts }, nextCheckAt: inMs(YOUTUBE_UPLOAD_RETRY_MS) };
                }
                throw err;
            }
            if (probe.done) {
                return {
                    inProgress: true,
                    providerState: { phase: 'processing', video_id: probe.videoId, started_at: state.started_at },
                    nextCheckAt: inMs(YOUTUBE_PROCESSING_POLL_MS),
                };
            }
            const startByte = probe.bytesConfirmed;
            const endByte = Math.min(startByte + ctx.youtubeChunkBytes - 1, state.total_bytes - 1);
            const result = await uploadChunk(state.session_uri, {
                mediaUrl, startByte, endByte, totalBytes: state.total_bytes, mimeType: state.mime_type, accessToken,
            });
            if (result.done) {
                return {
                    inProgress: true,
                    providerState: { phase: 'processing', video_id: result.videoId, started_at: state.started_at },
                    nextCheckAt: inMs(YOUTUBE_PROCESSING_POLL_MS),
                };
            }
            return {
                inProgress: true,
                providerState: { ...state, bytes_confirmed: result.bytesConfirmed },
                nextCheckAt: inMs(YOUTUBE_UPLOAD_RETRY_MS),
            };
        }

        // First dispatch: the daily videos.insert quota (0161) is only
        // spent here — every later chunk PUT and status poll is free.
        // Exhaustion is deferred, not failed: it resets at midnight Pacific and
        // has nothing to do with whether THIS post is postable, so it must
        // not burn the same 3-attempt budget a genuine per-post failure
        // would (that budget exhausts in ~15 minutes — every post queued
        // behind an exhausted quota would otherwise fail permanently long
        // before the quota actually resets).
        const quota = await rpc('consume_youtube_upload_quota', {}, ctx.cfg);
        const restarts = state.restarts ? { restarts: state.restarts } : {};
        if (quota && quota.code === 'QUOTA_EXHAUSTED') {
            return { inProgress: true, providerState: restarts, nextCheckAt: nextYoutubeQuotaReset() };
        }
        // Anything else is not a full quota; let the normal retry budget handle it.
        if (!quota || quota.ok !== true) return { ok: false, error: 'youtube_quota_unavailable' };
        const { sessionUri } = await initResumableUpload(accessToken, {
            title: target.text_override || target.global_text || '',
            description: target.text_override || target.global_text || '',
            privacyStatus: 'public',
            mimeType: target.mime_type,
            totalBytes: target.size_bytes,
        });
        return {
            inProgress: true,
            providerState: {
                phase: 'uploading', session_uri: sessionUri, total_bytes: target.size_bytes,
                mime_type: target.mime_type, bytes_confirmed: 0, started_at: new Date().toISOString(), ...restarts,
            },
            nextCheckAt: inMs(YOUTUBE_UPLOAD_RETRY_MS),
        };
    },
};

/**
 * @param {{cfg: {supabaseUrl:string, serviceRoleKey:string}, cryptoCfg: {raw: Uint8Array}|null,
 *   r2cfg: object, publicHost?: string, mediaProxySecret?: string, youtubeChunkBytes?: number}} deps
 * @returns {Promise<{ok:boolean, skipped?:string, claimed?:number, published?:number, failed?:number, errors?:number, claimLost?:number}>}
 */
export async function runPublishSweep({ cfg, cryptoCfg, r2cfg, publicHost, mediaProxySecret, youtubeChunkBytes }) {
    if (!cfg?.supabaseUrl || !cfg.serviceRoleKey || !cryptoCfg || !r2IsConfigured(r2cfg)) {
        return { ok: false, skipped: 'not_configured' };
    }

    let rows;
    try {
        const claimed = await rpc('claim_due_social_post_targets', { p_limit: BATCH }, cfg);
        rows = Array.isArray(claimed) ? claimed : [];
    } catch (err) {
        console.error('[publish-sweep] claim failed:', err && err.message);
        return { ok: false, error: 'claim_failed' };
    }

    const ctx = { cfg, publicHost, mediaProxySecret, youtubeChunkBytes: youtubeChunkBytes || 8 * 1024 * 1024 };
    // claimLost is reported only when it happens, so the usual shape is unchanged.
    const out = { claimed: rows.length, published: 0, failed: 0, errors: 0 };
    for (const target of rows) {
        let outcome;
        try {
            outcome = await dispatch(target, cryptoCfg, r2cfg, ctx);
        } catch (err) {
            outcome = { ok: false, error: (err && err.message) || 'dispatch_failed' };
        }
        // 0168 returns a claim_key with each row and refuses a report whose
        // key no longer matches (CLAIM_LOST). Sent only when the claim
        // returned one, so this also runs against the pre-0168 functions.
        const claim = target.claim_key ? { p_claim_key: target.claim_key } : {};
        try {
            let res;
            if (outcome.inProgress) {
                res = await rpc('report_social_post_progress', {
                    p_target_id: target.target_id,
                    p_provider_state: outcome.providerState,
                    p_next_check_at: outcome.nextCheckAt,
                    ...claim,
                }, cfg);
                // Not published or failed yet — no counter to bump.
            } else {
                res = await rpc('complete_social_post_target', {
                    p_target_id: target.target_id,
                    p_ok: outcome.ok,
                    p_platform_post_id: outcome.platformPostId || null,
                    p_platform_post_url: outcome.platformPostUrl || null,
                    p_error: outcome.ok ? null : outcome.error,
                    p_delivered: !!outcome.delivered,
                    ...claim,
                }, cfg);
            }
            if (res && res.code === 'CLAIM_LOST') {
                // Another sweep reclaimed this target (or the account was
                // disconnected); its report is the one that counts.
                out.claimLost = (out.claimLost || 0) + 1;
                console.error('[publish-sweep] claim lost for target', target.target_id);
            } else if (!outcome.inProgress) {
                if (outcome.ok) out.published += 1; else out.failed += 1;
            }
        } catch (err) {
            // The target is left 'publishing'; claim's stale-reclaim backstop
            // (15 minutes) picks it up again rather than double-reporting here.
            out.errors += 1;
            console.error('[publish-sweep] report failed for target', target.target_id, err && err.message);
        }
    }
    return { ok: true, ...out };
}

async function dispatch(target, cryptoCfg, r2cfg, ctx) {
    const handler = DISPATCHERS[target.network];
    if (!handler) return { ok: false, error: 'network_not_implemented' };
    if (!target.media_type || !target.r2_key) return { ok: false, error: 'missing_media' };

    let accessToken;
    try {
        accessToken = await decryptToken(target.access_token_enc, cryptoCfg);
    } catch {
        return { ok: false, error: 'token_decrypt_failed' };
    }

    // A YouTube upload can span many ticks and easily outlive Google's
    // ~1h access token — nothing dispatched before this needed a
    // mid-flight refresh, since every prior network finishes in one tick.
    if (target.network === 'youtube' && target.token_expires_at
        && Date.parse(target.token_expires_at) - Date.now() < TOKEN_REFRESH_BUFFER_MS && target.refresh_token_enc) {
        try {
            const refreshToken = await decryptToken(target.refresh_token_enc, cryptoCfg);
            const refreshed = await refreshYoutubeToken(youtubeConfig(), refreshToken);
            accessToken = refreshed.accessToken;
            const accessTokenEnc = await encryptToken(refreshed.accessToken, cryptoCfg);
            await rpc('update_social_account_token', {
                p_account_id: target.account_id,
                p_access_token_enc: accessTokenEnc,
                p_token_expires_at: refreshed.expiresAt,
            }, ctx.cfg);
        } catch (err) {
            return { ok: false, error: 'token_refresh_failed' };
        }
    }

    let mediaUrl;
    try {
        ({ url: mediaUrl } = await presignGetUrl(target.r2_key, MEDIA_URL_TTL_SECONDS, r2cfg));
    } catch {
        return { ok: false, error: 'media_url_failed' };
    }

    return handler(target, accessToken, mediaUrl, ctx);
}
