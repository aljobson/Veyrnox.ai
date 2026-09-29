'use client';

/**
 * Client-side driver for the composer/scheduling UI (ADR-0061 Phase 4).
 * Thin wrapper over GET/POST /api/v1/social/posts — see that route's own
 * header for the request/response shapes.
 */

import { gatewayFetch } from '../veyrnox/_lib/gateway.js';

/** Lists the caller's scheduled/published posts, newest first. */
export async function listSocialPosts({ beforeCreatedAt, beforeId } = {}) {
    const params = new URLSearchParams();
    if (beforeCreatedAt && beforeId) {
        params.set('before_created_at', beforeCreatedAt);
        params.set('before_id', beforeId);
    }
    const qs = params.toString();
    return gatewayFetch(`/social/posts${qs ? `?${qs}` : ''}`);
}

/**
 * Schedules a post. `media` is a single-item array (v1 dispatch is
 * single-attachment only — see claim_due_social_post_targets's own
 * comment in packages/db/schema/supabase/0156): [{ mediaType, jobId }].
 * Returns { post_id, idempotent, target_count }. Throws GatewayError.
 */
export async function createSocialPost({ scheduledAt, globalText, idempotencyKey, accountIds, media }) {
    return gatewayFetch('/social/posts', {
        method: 'POST',
        body: JSON.stringify({ scheduledAt, globalText: globalText || null, idempotencyKey, accountIds, media }),
    });
}

/** A fresh key for one schedule attempt — a retried submit must reuse it. */
export function newIdempotencyKey() {
    return crypto.randomUUID().replace(/-/g, '');
}
