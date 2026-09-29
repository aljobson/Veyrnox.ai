/**
 * The publish-sweep: the five-minute Worker cron claims due
 * social_post_targets (ADR-0061 §2.6) and dispatches each to its network
 * adapter. Claim/complete are two separate RPC round trips (packages/db/
 * schema/supabase/0156) rather than one in-process transaction — Workers
 * cannot hold a Postgres connection open across a slow provider call, so
 * the claim commits first and the result is reported back after.
 *
 * Instagram, LinkedIn and X (image posts) have real adapters today; any
 * other network fails its target immediately with a named error rather
 * than being silently dropped, so it surfaces in
 * social_post_targets.last_error instead of hanging as "pending" forever.
 */

import { rpc } from '../packages/db/supabase-client.js';
import { decryptToken } from './social/tokenCrypto.js';
import { presignGetUrl, isConfigured as r2IsConfigured } from '../packages/adapters/r2.js';
import { publishPost as publishInstagram } from '../packages/adapters/social/instagram.js';
import { publishPost as publishLinkedin } from '../packages/adapters/social/linkedin.js';
import { publishPost as publishX } from '../packages/adapters/social/twitter.js';

export const BATCH = 25;
const MEDIA_URL_TTL_SECONDS = 900;

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
};

/**
 * @param {{cfg: {supabaseUrl:string, serviceRoleKey:string}, cryptoCfg: {raw: Uint8Array}|null, r2cfg: object}} deps
 * @returns {Promise<{ok:boolean, skipped?:string, claimed?:number, published?:number, failed?:number, errors?:number}>}
 */
export async function runPublishSweep({ cfg, cryptoCfg, r2cfg }) {
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

    const out = { claimed: rows.length, published: 0, failed: 0, errors: 0 };
    for (const target of rows) {
        let outcome;
        try {
            outcome = await dispatch(target, cryptoCfg, r2cfg);
        } catch (err) {
            outcome = { ok: false, error: (err && err.message) || 'dispatch_failed' };
        }
        try {
            await rpc('complete_social_post_target', {
                p_target_id: target.target_id,
                p_ok: outcome.ok,
                p_platform_post_id: outcome.platformPostId || null,
                p_platform_post_url: outcome.platformPostUrl || null,
                p_error: outcome.ok ? null : outcome.error,
            }, cfg);
            if (outcome.ok) out.published += 1; else out.failed += 1;
        } catch (err) {
            // The target is left 'publishing'; claim's stale-reclaim backstop
            // (15 minutes) picks it up again rather than double-reporting here.
            out.errors += 1;
            console.error('[publish-sweep] complete report failed for target', target.target_id, err && err.message);
        }
    }
    return { ok: true, ...out };
}

async function dispatch(target, cryptoCfg, r2cfg) {
    const handler = DISPATCHERS[target.network];
    if (!handler) return { ok: false, error: 'network_not_implemented' };
    if (!target.media_type || !target.r2_key) return { ok: false, error: 'missing_media' };

    let accessToken;
    try {
        accessToken = await decryptToken(target.access_token_enc, cryptoCfg);
    } catch {
        return { ok: false, error: 'token_decrypt_failed' };
    }

    let mediaUrl;
    try {
        ({ url: mediaUrl } = await presignGetUrl(target.r2_key, MEDIA_URL_TTL_SECONDS, r2cfg));
    } catch {
        return { ok: false, error: 'media_url_failed' };
    }

    return handler(target, accessToken, mediaUrl);
}
