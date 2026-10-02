/**
 * GET/POST /api/v1/social/posts — the composer's read/write surface
 * (ADR-0061 Phase 4). Auto-resolves the caller's default Publish brand,
 * same as GET /api/v1/social/accounts.
 *
 * GET response (200): { brand_id, posts: [{ id, status, scheduled_at,
 *   global_text, created_at, targets: [{ id, network, publish_status,
 *   platform_post_url, last_error }] }] } — cursor-paginated via
 *   ?before_created_at&before_id (list_social_posts, 0160).
 *
 * POST body: { scheduledAt, globalText, idempotencyKey, accountIds: [uuid],
 *   media: [{ mediaType: 'image'|'video', jobId: uuid }] } — jobId must be
 *   one of the caller's own jobs with a stored asset (create_social_post
 *   resolves the R2 object through it at publish time; no raw URL is ever
 *   accepted here — see lib/socialPublishSweep.js's dispatch-time presign).
 * POST response (201): { post_id, idempotent, target_count }.
 */

import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { rpc, envConfig, SupabaseError } from '../../../../../packages/db/supabase-client.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_TYPES = new Set(['image', 'video']);

function isUuid(v) {
    return typeof v === 'string' && UUID_RE.test(v);
}

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }

    const limited = await accountReadLimit(authId, cfg, { brand_id: null, posts: [] });
    if (limited) return limited;

    const { brandId, error } = await resolveBrand(authId, cfg, 'api/v1/social/posts:GET');
    if (error) return error;

    const url = new URL(req.url);
    const beforeCreatedAt = url.searchParams.get('before_created_at') || undefined;
    const beforeId = url.searchParams.get('before_id') || undefined;
    if (beforeId && !isUuid(beforeId)) {
        return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 });
    }
    if (beforeCreatedAt && Number.isNaN(Date.parse(beforeCreatedAt))) {
        return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 });
    }

    let posts;
    try {
        posts = await rpc('list_social_posts', {
            p_auth_id: authId, p_brand_id: brandId,
            p_before_created_at: beforeCreatedAt || null, p_before_id: beforeId || null,
        }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/social/posts:GET] list failed:', status, err && err.body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!posts || posts.ok !== true) {
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json({ brand_id: brandId, posts: posts.posts || [] },
        { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const scheduledAt = body && body.scheduledAt;
    if (typeof scheduledAt !== 'string' || Number.isNaN(Date.parse(scheduledAt))) {
        return NextResponse.json({ error: 'invalid_schedule' }, { status: 400 });
    }
    const globalText = body && body.globalText;
    if (globalText !== null && globalText !== undefined
        && (typeof globalText !== 'string' || globalText.length > 4000)) {
        return NextResponse.json({ error: 'invalid_global_text' }, { status: 400 });
    }
    const idempotencyKey = body && body.idempotencyKey;
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
        return NextResponse.json({ error: 'invalid_idempotency_key' }, { status: 400 });
    }
    const accountIds = body && body.accountIds;
    if (!Array.isArray(accountIds) || accountIds.length < 1 || accountIds.length > 20
        || !accountIds.every(isUuid)) {
        return NextResponse.json({ error: 'invalid_account_ids' }, { status: 400 });
    }
    const media = body && body.media;
    if (!Array.isArray(media) || media.length < 1 || media.length > 10) {
        return NextResponse.json({ error: 'invalid_media' }, { status: 400 });
    }
    const mediaItems = [];
    for (const item of media) {
        const mediaType = item && item.mediaType;
        const jobId = item && item.jobId;
        if (!MEDIA_TYPES.has(mediaType) || !isUuid(jobId)) {
            return NextResponse.json({ error: 'invalid_media' }, { status: 400 });
        }
        mediaItems.push({ media_type: mediaType, job_id: jobId });
    }

    const limited = await socialPostWriteLimit(authId, cfg);
    if (limited) return limited;

    const { brandId, error } = await resolveBrand(authId, cfg, 'api/v1/social/posts:POST');
    if (error) return error;

    let result;
    try {
        result = await rpc('create_social_post', {
            p_auth_id: authId,
            p_brand_id: brandId,
            p_scheduled_at: scheduledAt,
            p_global_text: globalText || null,
            p_idempotency_key: idempotencyKey,
            p_account_ids: accountIds,
            p_media: mediaItems,
        }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/social/posts:POST] create failed:', status, err && err.body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!result || result.ok !== true) {
        const code = result && result.code;
        const status = code === 'USER_NOT_FOUND' ? 401
            : ['BRAND_NOT_FOUND', 'ACCOUNT_NOT_FOUND', 'MEDIA_NOT_FOUND'].includes(code) ? 404
            : ['INVALID_IDEMPOTENCY_KEY', 'INVALID_SCHEDULE', 'NO_TARGET_ACCOUNTS', 'INVALID_MEDIA'].includes(code) ? 400
            : 502;
        return NextResponse.json({ error: code || 'internal' }, { status });
    }

    return NextResponse.json({
        post_id: result.post_id, idempotent: result.idempotent, target_count: result.target_count || 0,
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
