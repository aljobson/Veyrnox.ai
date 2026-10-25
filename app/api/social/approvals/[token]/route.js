import { NextResponse } from 'next/server';
import { approvalSigningSecret, verifyApprovalToken } from '../../../../../lib/social/approvalToken.js';
import { createMediaProxyToken } from '../../../../../lib/social/mediaProxyToken.js';
import { socialApprovalsEnabled } from '../../../../../lib/social/publishFeature.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

async function context(params) {
    if (!socialApprovalsEnabled()) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
    const { token } = await params;
    const reviewerId = await verifyApprovalToken(token, approvalSigningSecret());
    const cfg = envConfig();
    if (!reviewerId) return { error: NextResponse.json({ error: 'invalid_or_expired_link' }, { status: 404 }) };
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: NextResponse.json({ error: 'not_configured' }, { status: 503 }) };
    return { reviewerId, cfg };
}

export async function GET(_req, { params }) {
    const ctx = await context(params);
    if (ctx.error) return ctx.error;
    try {
        const review = await rpc('get_social_approval_review', { p_reviewer_id: ctx.reviewerId }, ctx.cfg);
        if (!review?.ok) return NextResponse.json({ error: 'review_not_found' }, { status: 404 });
        const sources = Array.isArray(review.attachments) ? review.attachments : review.media ? [review.media] : [];
        const attachments = [];
        for (const [position, media] of sources.entries()) {
            let preview_url = null;
            if (!media.held && media.r2_key && process.env.SOCIAL_MEDIA_PROXY_SECRET) {
                const token = await createMediaProxyToken({ r2Key: media.r2_key }, process.env.SOCIAL_MEDIA_PROXY_SECRET);
                preview_url = `/media/social/${encodeURIComponent(token)}`;
            }
            attachments.push({ position, media_type: media.media_type, mime_type: media.mime_type, preview_url, held: media.held === true });
        }
        return NextResponse.json({ reviewer_id: review.reviewer_id, decision: review.decision,
            request_status: review.request_status, policy: review.policy, scheduled_at: review.scheduled_at,
            global_text: review.global_text, brand_name: review.brand_name,
            networks: Array.isArray(review.networks) ? review.networks : [],
            targets: Array.isArray(review.targets) ? review.targets : [],
            attachments, media: attachments[0] || null },
            { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[api/social/approvals:GET] failed:', err instanceof SupabaseError ? err.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
}

export async function POST(req, { params }) {
    const ctx = await context(params);
    if (ctx.error) return ctx.error;
    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
    if (!['approved', 'rejected'].includes(body?.decision) || (body?.comment != null && (typeof body.comment !== 'string' || body.comment.length > 2000))) {
        return NextResponse.json({ error: 'invalid_decision' }, { status: 400 });
    }
    try {
        const result = await rpc('decide_social_approval', { p_reviewer_id: ctx.reviewerId, p_decision: body.decision, p_comment: body.comment || null }, ctx.cfg);
        if (!result?.ok) return NextResponse.json({ error: result?.code?.toLowerCase() || 'internal' }, { status: result?.code === 'REVIEW_NOT_FOUND' ? 404 : 400 });
        return NextResponse.json({ decision: result.decision, request_status: result.request_status, idempotent: result.idempotent },
            { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[api/social/approvals:POST] failed:', err instanceof SupabaseError ? err.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
}
