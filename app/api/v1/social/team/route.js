import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { createTeamInviteToken } from '../../../../../lib/social/teamInviteToken.js';
import { socialTeamsEnabled } from '../../../../../lib/social/publishFeature.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(['manager', 'editor', 'reviewer', 'analyst', 'viewer']);

function setup(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!UUID_RE.test(authId || '')) return { error: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }) };
    if (!socialTeamsEnabled()) return { error: NextResponse.json({ error: 'teams_not_open' }, { status: 404 }) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !process.env.SOCIAL_TEAM_INVITE_SECRET) return { error: NextResponse.json({ error: 'teams_not_configured' }, { status: 503 }) };
    return { authId, cfg };
}
function mapped(result) {
    if (result?.ok) return null;
    const code = result?.code || 'internal';
    const status = code === 'PLAN_REQUIRED' ? 402 : code === 'FORBIDDEN' ? 403
        : ['BRAND_NOT_FOUND', 'MEMBER_NOT_FOUND', 'INVITE_NOT_FOUND'].includes(code) ? 404
            : code === 'RATE_LIMITED' ? 429 : code === 'internal' ? 502 : 400;
    return NextResponse.json({ error: code }, { status });
}
async function brandIdFor(req, authId, cfg, routeTag, supplied) {
    if (supplied != null) return UUID_RE.test(supplied) ? supplied : null;
    const brand = await resolveBrand(authId, cfg, routeTag);
    return brand.error ? brand : brand.brandId;
}
async function withLinks(invitations, origin) {
    return Promise.all((invitations || []).map(async (invitation) => ({ ...invitation,
        url: `${origin}/social/team/invite/${encodeURIComponent(await createTeamInviteToken({ inviteId: invitation.id }, process.env.SOCIAL_TEAM_INVITE_SECRET))}`,
    })));
}

export async function GET(req) {
    const { authId, cfg, error } = setup(req); if (error) return error;
    const limited = await accountReadLimit(authId, cfg, { members: [], invitations: [] }); if (limited) return limited;
    try {
        const requested = new URL(req.url).searchParams.get('brand_id');
        const resolved = await brandIdFor(req, authId, cfg, 'api/v1/social/team:GET', requested);
        if (resolved?.error) return resolved.error;
        if (!resolved) return NextResponse.json({ error: 'invalid_brand_id' }, { status: 400 });
        const result = await rpc('list_social_team', { p_auth_id: authId, p_brand_id: resolved }, cfg);
        const response = mapped(result); if (response) return response;
        return NextResponse.json({ brand_id: result.brand_id, brand_name: result.brand_name, actor_role: result.actor_role,
            members: result.members || [], invitations: await withLinks(result.invitations, new URL(req.url).origin) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[api/v1/social/team:GET] failed:', err instanceof SupabaseError ? err.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
}

export async function POST(req) {
    const { authId, cfg, error } = setup(req); if (error) return error;
    let body; try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 254 || !ROLES.has(body?.role) || body?.brandId != null && !UUID_RE.test(body.brandId)) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
    try {
        const resolved = await brandIdFor(req, authId, cfg, 'api/v1/social/team:POST', body.brandId);
        if (resolved?.error) return resolved.error;
        const result = await rpc('invite_social_team_member', { p_auth_id: authId, p_brand_id: resolved, p_email: email, p_role: body.role }, cfg);
        const response = mapped(result); if (response) return response;
        const url = `${new URL(req.url).origin}/social/team/invite/${encodeURIComponent(await createTeamInviteToken({ inviteId: result.invite_id }, process.env.SOCIAL_TEAM_INVITE_SECRET))}`;
        return NextResponse.json({ invitation: { id: result.invite_id, email: result.email, role: result.role, expires_at: result.expires_at, url }, idempotent: result.idempotent }, { status: 201 });
    } catch (err) {
        console.error('[api/v1/social/team:POST] failed:', err instanceof SupabaseError ? err.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
}

export async function PATCH(req) {
    const { authId, cfg, error } = setup(req); if (error) return error;
    let body; try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
    if (!UUID_RE.test(body?.brandId || '') || !UUID_RE.test(body?.memberUserId || '') || !['role', 'remove'].includes(body?.action)
        || body.action === 'role' && !ROLES.has(body?.role)) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
    try {
        const result = await rpc('change_social_team_member', { p_auth_id: authId, p_brand_id: body.brandId,
            p_member_user_id: body.memberUserId, p_action: body.action, p_role: body.role || null }, cfg);
        return mapped(result) || NextResponse.json({ ok: true });
    } catch (err) {
        console.error('[api/v1/social/team:PATCH] failed:', err instanceof SupabaseError ? err.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
}

export async function DELETE(req) {
    const { authId, cfg, error } = setup(req); if (error) return error;
    const url = new URL(req.url); const brandId = url.searchParams.get('brand_id'); const inviteId = url.searchParams.get('invite_id');
    if (!UUID_RE.test(brandId || '') || !UUID_RE.test(inviteId || '')) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
    try {
        const result = await rpc('revoke_social_team_invite', { p_auth_id: authId, p_brand_id: brandId, p_invite_id: inviteId }, cfg);
        return mapped(result) || NextResponse.json({ ok: true, idempotent: result.idempotent });
    } catch (err) {
        console.error('[api/v1/social/team:DELETE] failed:', err instanceof SupabaseError ? err.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
}
