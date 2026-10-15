import { NextResponse } from 'next/server';
import { socialTeamsEnabled } from '../../../../../lib/social/publishFeature.js';
import { verifyTeamInviteToken } from '../../../../../lib/social/teamInviteToken.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

export async function GET(_req, { params }) {
    if (!socialTeamsEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const cfg = envConfig();
    const { token } = await params;
    const inviteId = await verifyTeamInviteToken(token, process.env.SOCIAL_TEAM_INVITE_SECRET);
    if (!inviteId || !cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'invalid_or_expired_link' }, { status: 404 });
    }
    try {
        const result = await rpc('get_social_team_invite', { p_invite_id: inviteId }, cfg);
        if (!result?.ok) return NextResponse.json({ error: 'invite_not_found' }, { status: 404 });
        return NextResponse.json({
            invite_id: result.invite_id,
            email: result.email,
            role: result.role,
            status: result.status,
            expires_at: result.expires_at,
            brand_id: result.brand_id,
            brand_name: result.brand_name,
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[api/social/team:GET] failed:', err instanceof SupabaseError ? err.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
}
