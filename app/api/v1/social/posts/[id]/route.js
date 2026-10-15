import { NextResponse } from 'next/server';
import { calendarEnabled, publishPlansEnabled } from '../../../../../../lib/social/publishFeature.js';
import { readPublishEntitlement } from '../../../../../../lib/social/publishPlanApi.js';
import { socialPostWriteLimit } from '../../../../../../lib/socialPostWriteLimit.js';
import { instant, UUID_RE } from '../../../../../../lib/social/calendar.js';
import { resolveBrand } from '../../../../../../lib/social/resolveBrand.js';
import { rpc, envConfig, SupabaseError } from '../../../../../../packages/db/supabase-client.js';

const CONFLICTS = new Set(['POST_STARTED', 'POST_CHANGED', 'POST_BUSY', 'RESTORE_UNAVAILABLE']);

export async function PATCH(req, { params }) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    if (!calendarEnabled()) return NextResponse.json({ error: 'calendar_not_open' }, { status: 503 });
    const { id } = await params;
    if (!UUID_RE.test(id || '')) return NextResponse.json({ error: 'invalid_post_id' }, { status: 400 });
    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
    if (!['cancel', 'restore'].includes(body?.action) || !instant(body?.expectedUpdatedAt)
        || (body.action === 'restore' && (!instant(body?.scheduledAt) || Date.parse(body.scheduledAt) <= Date.now() + 60000))) {
        return NextResponse.json({ error: body?.action === 'restore' ? 'invalid_schedule' : 'invalid_body' }, { status: 400 });
    }
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    const brand = await resolveBrand(authId, cfg, 'api/v1/social/posts/[id]:PATCH', { request: req, allowedRoles: ['owner', 'manager', 'editor'] });
    if (brand.error) return brand.error;
    if (publishPlansEnabled()) {
        try {
            const entitlement = await readPublishEntitlement(brand.rpcAuthId, cfg);
            if (!entitlement) return NextResponse.json({ error: 'internal' }, { status: 502 });
            if (entitlement.tier !== 'publish') return NextResponse.json({ error: 'publish_plan_required', feature: 'scheduling' }, { status: 402 });
        } catch { return NextResponse.json({ error: 'internal' }, { status: 502 }); }
    }
    const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
    try {
        const access = await rpc('social_brand_contains_post', { p_auth_id: authId, p_brand_id: brand.brandId, p_post_id: id }, cfg);
        if (access?.ok !== true) {
            const status = ['POST_NOT_FOUND', 'BRAND_NOT_FOUND'].includes(access?.code) ? 404 : access?.code === 'FORBIDDEN' ? 403 : 502;
            return NextResponse.json({ error: status === 502 ? 'internal' : String(access.code).toLowerCase() }, { status });
        }
        const restoring = body.action === 'restore';
        const result = await rpc(restoring ? 'restore_social_post' : 'cancel_social_post', {
            p_auth_id: authId, p_post_id: id, p_expected_updated_at: body.expectedUpdatedAt,
            ...(restoring ? { p_scheduled_at: body.scheduledAt } : {}),
        }, cfg);
        if (result?.ok !== true) {
            const code = result?.code;
            const status = code === 'USER_NOT_FOUND' ? 401 : code === 'FORBIDDEN' ? 403 : code === 'PLAN_REQUIRED' ? 402
                : code === 'POST_NOT_FOUND' ? 404 : CONFLICTS.has(code) ? 409
                    : ['INVALID_POST_VERSION', 'INVALID_SCHEDULE'].includes(code) ? 400 : 502;
            return NextResponse.json({ error: status === 502 ? 'internal' : code }, { status });
        }
        return NextResponse.json({ updated_at: result.updated_at, ...(restoring ? { scheduled_at: result.scheduled_at } : {}), idempotent: result.idempotent }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[api/v1/social/posts/[id]:PATCH] update failed:', err instanceof SupabaseError ? err.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
}
