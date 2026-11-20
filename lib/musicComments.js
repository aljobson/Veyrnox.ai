import { musicActorField } from './musicActors.js';
// Track comments (0518, song page parity slice 3). Every comment waits for an
// administrator before anyone else sees it. Off unless MUSIC_RUNTIME_FLAGS comments is on.
import { musicPublicationEnabled } from './musicBackend.js';
import { musicRuntimeFlag } from './musicRuntime.js';

export const musicCommentsEnabled = (env = process.env) => musicPublicationEnabled(env) && musicRuntimeFlag('comments', env);

export const MUSIC_COMMENT_MAX = 1000;
export const MUSIC_COMMENT_REPORT_CATEGORIES = Object.freeze(['spam', 'abuse', 'privacy', 'rights', 'other']);

const SLUG_RE = /^[a-f0-9]{24}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,120}$/;

export const validCommentSlug = (value) => typeof value === 'string' && SLUG_RE.test(value);
export const validCommentId = (value) => typeof value === 'string' && UUID_RE.test(value);
const textIn = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max;

/** Body for POST /api/v1/music/comments → { idempotencyKey, payload } for music_comment_mutate. */
export function parseMusicCommentWrite(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'invalid_request' };
    const { idempotency_key: key, ...payload } = value;
    if (!IDEMPOTENCY_RE.test(key || '')) return { ok: false, error: 'idempotency_key_invalid' };
    const keys = Object.keys(payload);
    if (payload.action === 'submit') {
        if (keys.some((k) => !['action', 'slug', 'body', 'at_seconds', 'parent_id'].includes(k))) return { ok: false, error: 'invalid_request' };
        if (!validCommentSlug(payload.slug)) return { ok: false, error: 'slug_invalid' };
        if (!textIn(payload.body, 1, MUSIC_COMMENT_MAX)) return { ok: false, error: 'body_invalid' };
        if ('at_seconds' in payload && !(typeof payload.at_seconds === 'number' && Number.isFinite(payload.at_seconds) && payload.at_seconds >= 0 && payload.at_seconds <= 600)) return { ok: false, error: 'at_seconds_invalid' };
        if ('parent_id' in payload && !validCommentId(payload.parent_id)) return { ok: false, error: 'parent_id_invalid' };
        const clean = { action: 'submit', slug: payload.slug, body: payload.body.trim() };
        if ('at_seconds' in payload) clean.at_seconds = Math.round(payload.at_seconds * 10) / 10;
        if ('parent_id' in payload) clean.parent_id = payload.parent_id.toLowerCase();
        return { ok: true, idempotencyKey: key, payload: clean };
    }
    if (payload.action === 'withdraw') {
        if (keys.length !== 2 || !validCommentId(payload.comment_id)) return { ok: false, error: 'comment_id_invalid' };
        return { ok: true, idempotencyKey: key, payload: { action: 'withdraw', comment_id: payload.comment_id.toLowerCase() } };
    }
    if (payload.action === 'report') {
        if (keys.some((k) => !['action', 'comment_id', 'category', 'details'].includes(k))) return { ok: false, error: 'invalid_request' };
        if (!validCommentId(payload.comment_id)) return { ok: false, error: 'comment_id_invalid' };
        if (!MUSIC_COMMENT_REPORT_CATEGORIES.includes(payload.category)) return { ok: false, error: 'category_invalid' };
        if (!textIn(payload.details, 3, 500)) return { ok: false, error: 'details_invalid' };
        return { ok: true, idempotencyKey: key, payload: { action: 'report', comment_id: payload.comment_id.toLowerCase(), category: payload.category, details: payload.details.trim() } };
    }
    return { ok: false, error: 'invalid_request' };
}

const comment = (c, viewer) => ({
    ...(viewer ? musicActorField(c?.author_id, 'author_id') : {}),
    id: String(c?.id || ''), parent_id: c?.parent_id || null, body: String(c?.body || ''),
    at_seconds: c?.at_seconds === null || c?.at_seconds === undefined ? null : Number(c.at_seconds),
    created_at: c?.created_at || null, author: String(c?.author || 'Listener'),
    is_creator: c?.is_creator === true, own: c?.own === true,
});

/** The projection of music_comments_read. The viewer's own pending and rejected comments only when signed in. */
export function publicMusicComments(result, { viewer = false } = {}) {
    return {
        allow_comments: result?.allow_comments === true,
        comments: (Array.isArray(result?.comments) ? result.comments : []).map((c) => comment(c, viewer)),
        next_cursor: validCommentId(result?.next_cursor) ? result.next_cursor : null,
        ...(viewer ? { own_comments: (Array.isArray(result?.own_comments) ? result.own_comments : []).map((c) => ({
            id: String(c?.id || ''), parent_id: c?.parent_id || null, body: String(c?.body || ''),
            status: c?.status === 'rejected' ? 'rejected' : 'pending', created_at: c?.created_at || null })) } : {}),
    };
}

/** Admin POST body → payload for music_comment_review. */
export function parseMusicCommentReview(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'body_invalid' };
    const { action, id, decision, reason } = value;
    if (Object.keys(value).some((k) => !['action', 'id', 'decision', 'reason'].includes(k))) return { ok: false, error: 'body_invalid' };
    if (!validCommentId(id)) return { ok: false, error: 'id_invalid' };
    if (!textIn(reason, 3, 500)) return { ok: false, error: 'reason_invalid' };
    if (action === 'review_comment') {
        if (!['approved', 'rejected', 'removed'].includes(decision)) return { ok: false, error: 'decision_invalid' };
        return { ok: true, payload: { action, id: id.toLowerCase(), decision, reason: reason.trim() } };
    }
    if (action === 'resolve_report' && decision === undefined) return { ok: true, payload: { action, id: id.toLowerCase(), reason: reason.trim() } };
    return { ok: false, error: 'action_invalid' };
}
