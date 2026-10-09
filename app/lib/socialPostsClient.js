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
export async function createSocialPost({ scheduledAt, publishNow, globalText, idempotencyKey, accountIds, media, youtubeVisibility }) {
    return gatewayFetch('/social/posts', {
        method: 'POST',
        body: JSON.stringify({ scheduledAt, ...(publishNow !== undefined ? { publishNow } : {}), globalText: globalText || null, idempotencyKey, accountIds, media, youtubeVisibility }),
    });
}

/** A fresh key for one schedule attempt — a retried submit must reuse it. */
export function newIdempotencyKey() {
    return crypto.randomUUID().replace(/-/g, '');
}

/** Open draft posts awaiting review (GET /api/v1/social/drafts). */
export async function listSocialDrafts() {
    return gatewayFetch('/social/drafts');
}

/** Schedules every draft in a batch. Returns { approved, failed }. */
export async function approveDraftBatch(batchId) {
    return gatewayFetch('/social/drafts', { method: 'POST', body: JSON.stringify({ action: 'approve', batchId }) });
}

/** Cancels one draft, or every draft left in the batch when postId is omitted. */
export async function discardDrafts(batchId, postId) {
    return gatewayFetch('/social/drafts', {
        method: 'POST', body: JSON.stringify({ action: 'discard', batchId, ...(postId ? { postId } : {}) }),
    });
}

export async function listSocialCalendar({ from, to, status, network, afterAt, afterId }) {
    const params = new URLSearchParams({ from, to });
    for (const [key,value] of Object.entries({status,network,after_at:afterAt,after_id:afterId})) if(value)params.set(key,value);
    return gatewayFetch(`/social/calendar?${params}`);
}
export async function rescheduleSocialPost(postId, expectedAt, scheduledAt) {
    return gatewayFetch(`/social/posts/${encodeURIComponent(postId)}/schedule`, {
        method:'PATCH',body:JSON.stringify({expectedAt,scheduledAt}),
    });
}
