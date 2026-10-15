import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { approvalSigningSecret, createApprovalToken } from '../../../../../lib/social/approvalToken.js';
import { publishPlansEnabled, socialApprovalsEnabled, socialContentVariantsEnabled } from '../../../../../lib/social/publishFeature.js';
import { readPublishEntitlement } from '../../../../../lib/social/publishPlanApi.js';
import { parsePostVariants } from '../../../../../lib/social/postVariants.js';
import { postCapabilityError } from '../../../../../lib/social/postCapabilities.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
import { socialUploadsEnabled } from '../../../../../lib/social/uploadPolicy.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

function setup(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!isUuid(authId)) return { error: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }) };
    if (!socialApprovalsEnabled()) return { error: NextResponse.json({ error: 'approvals_not_open' }, { status: 404 }) };
    const cfg = envConfig();
    const signingSecret = approvalSigningSecret();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !signingSecret) {
        return { error: NextResponse.json({ error: 'approvals_not_configured' }, { status: 503 }) };
    }
    return { authId, cfg, signingSecret };
}

function statusFor(code) {
    if (code === 'PLAN_REQUIRED') return 402;
    if (code === 'FORBIDDEN') return 403;
    if (['BRAND_NOT_FOUND', 'ACCOUNT_NOT_FOUND', 'MEDIA_NOT_FOUND'].includes(code)) return 404;
    if (['INVALID_APPROVAL', 'INVALID_REVIEWERS', 'INVALID_IDEMPOTENCY_KEY', 'INVALID_SCHEDULE', 'NO_TARGET_ACCOUNTS', 'INVALID_MEDIA', 'INVALID_NETWORK_TEXT', 'IDEMPOTENCY_CONFLICT'].includes(code)) return 400;
    return 502;
}

async function linksFor(reviewers, origin, signingSecret) {
    return Promise.all((reviewers || []).map(async (reviewer) => ({
        email: reviewer.email,
        url: `${origin}/social/review/${encodeURIComponent(await createApprovalToken({ reviewerId: reviewer.id }, signingSecret))}`,
    })));
}

export async function GET(req) {
    const { authId, cfg, signingSecret, error } = setup(req);
    if (error) return error;
    const limited = await accountReadLimit(authId, cfg, { brand_id: null, requests: [] });
    if (limited) return limited;
    const brand = await resolveBrand(authId, cfg, 'api/v1/social/approvals:GET', {
        // This response contains freshly signed external-review links. Keep
        // those bearer links with publishing roles rather than
        // exposing them through general read-only brand access.
        request: req, allowedRoles: ['owner', 'manager', 'editor'],
    });
    if (brand.error) return brand.error;
    try {
        const listed = await rpc('list_social_approvals', { p_auth_id: brand.rpcAuthId, p_brand_id: brand.brandId }, cfg);
        if (!listed?.ok) return NextResponse.json({ error: listed?.code || 'internal' }, { status: statusFor(listed?.code) });
        const origin = new URL(req.url).origin;
        const requests = await Promise.all((listed.requests || []).map(async (request) => ({
            ...request,
            reviewers: await Promise.all((request.reviewers || []).map(async (reviewer) => ({
                ...reviewer,
                url: `${origin}/social/review/${encodeURIComponent(await createApprovalToken({ reviewerId: reviewer.id }, signingSecret))}`,
            }))),
        })));
        return NextResponse.json({ brand_id: brand.brandId, requests }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[api/v1/social/approvals:GET] failed:', err instanceof SupabaseError ? err.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
}

export async function POST(req) {
    const { authId, cfg, signingSecret, error } = setup(req);
    if (error) return error;
    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
    const scheduledAt = body?.scheduledAt;
    const globalText = body?.globalText;
    const accountIds = body?.accountIds;
    const idempotencyKey = body?.idempotencyKey;
    const reviewers = Array.isArray(body?.reviewers) ? [...new Set(body.reviewers.map((email) => typeof email === 'string' ? email.trim().toLowerCase() : ''))] : [];
    const policy = body?.policy;
    const youtubeVisibility = body?.youtubeVisibility;
    const rawNetworkText = body?.networkText;
    if (typeof scheduledAt !== 'string' || Number.isNaN(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now()) return NextResponse.json({ error: 'invalid_schedule' }, { status: 400 });
    if (globalText != null && (typeof globalText !== 'string' || globalText.length > 4000)) return NextResponse.json({ error: 'invalid_global_text' }, { status: 400 });
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) return NextResponse.json({ error: 'invalid_idempotency_key' }, { status: 400 });
    if (!Array.isArray(accountIds) || accountIds.length < 1 || accountIds.length > 20 || !accountIds.every(isUuid)) return NextResponse.json({ error: 'invalid_account_ids' }, { status: 400 });
    if (!['any', 'all'].includes(policy)) return NextResponse.json({ error: 'invalid_policy' }, { status: 400 });
    if (youtubeVisibility !== undefined && !['private', 'unlisted', 'public'].includes(youtubeVisibility)) return NextResponse.json({ error: 'invalid_youtube_visibility' }, { status: 400 });
    if (rawNetworkText != null && (!rawNetworkText || typeof rawNetworkText !== 'object' || Array.isArray(rawNetworkText))) return NextResponse.json({ error: 'invalid_network_text' }, { status: 400 });
    const hasVariants = rawNetworkText != null && Object.keys(rawNetworkText).length > 0;
    if (hasVariants && !socialContentVariantsEnabled()) return NextResponse.json({ error: 'variants_not_open' }, { status: 404 });
    if (reviewers.length < 1 || reviewers.length > 10 || reviewers.some((email) => email.length > 254 || !EMAIL_RE.test(email))) return NextResponse.json({ error: 'invalid_reviewers' }, { status: 400 });
    if (!Array.isArray(body?.media) || body.media.length < 1 || body.media.length > 10) return NextResponse.json({ error: 'invalid_media' }, { status: 400 });
    const media = [];
    for (const item of body.media) {
        const jobId = item?.jobId; const uploadId = item?.uploadId;
        if (!['image', 'video'].includes(item?.mediaType) || Boolean(jobId) === Boolean(uploadId)
            || (jobId ? !isUuid(jobId) : !isUuid(uploadId) || !socialUploadsEnabled(process.env, authId))) {
            return NextResponse.json({ error: 'invalid_media' }, { status: 400 });
        }
        media.push({ media_type: item.mediaType, ...(jobId ? { job_id: jobId } : { upload_id: uploadId }) });
    }
    const limited = await socialPostWriteLimit(authId, cfg);
    if (limited) return limited;
    const brand = await resolveBrand(authId, cfg, 'api/v1/social/approvals:POST', { request: req, allowedRoles: ['owner', 'manager', 'editor'] });
    if (brand.error) return brand.error;
    try {
        if (hasVariants) {
            if (!publishPlansEnabled()) return NextResponse.json({ error: 'variants_not_configured' }, { status: 503 });
            const entitlement = await readPublishEntitlement(brand.rpcAuthId, cfg);
            if (!entitlement) return NextResponse.json({ error: 'internal' }, { status: 502 });
            if (entitlement.tier !== 'publish') return NextResponse.json({ error: 'publish_plan_required', feature: 'platform_variants' }, { status: 402 });
        }
        const listed = await rpc('list_social_accounts', { p_auth_id: brand.rpcAuthId, p_brand_id: brand.brandId }, cfg);
        const destinations = (listed?.accounts || []).filter((account) => accountIds.includes(account.id) && account.status === 'active');
        if (!listed?.ok || destinations.length !== new Set(accountIds).size) return NextResponse.json({ error: 'ACCOUNT_NOT_FOUND' }, { status: 404 });
        const parsed = parsePostVariants(rawNetworkText, destinations.map((account) => account.network));
        if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
        const capabilityError = postCapabilityError(destinations, media, globalText, process.env, authId, parsed.variants);
        if (capabilityError) return NextResponse.json({ error: capabilityError }, { status: 400 });
        const result = await rpc(hasVariants ? 'create_social_post_approval_with_variants' : 'create_social_post_approval', {
            p_auth_id: authId, p_brand_id: brand.brandId, p_batch_id: crypto.randomUUID(), p_scheduled_at: scheduledAt,
            p_global_text: globalText || null, p_idempotency_key: idempotencyKey, p_account_ids: accountIds,
            p_media: media, p_policy: policy, p_reviewer_emails: reviewers, p_youtube_visibility: youtubeVisibility || null,
            ...(hasVariants ? { p_network_text: parsed.variants } : {}),
        }, cfg);
        if (!result?.ok) return NextResponse.json({ error: result?.code || 'internal' }, { status: statusFor(result?.code) });
        return NextResponse.json({ request_id: result.request_id, post_id: result.post_id, idempotent: result.idempotent,
            review_links: await linksFor(result.reviewers, new URL(req.url).origin, signingSecret) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[api/v1/social/approvals:POST] failed:', err instanceof SupabaseError ? err.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
}
