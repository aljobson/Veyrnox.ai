import { NextResponse } from 'next/server';
import { socialPostWriteLimit } from '../../../../../../lib/socialPostWriteLimit.js';
import { socialTeamsEnabled } from '../../../../../../lib/social/publishFeature.js';
import { teamInviteSigningSecret, verifyTeamInviteToken } from '../../../../../../lib/social/teamInviteToken.js';
import { envConfig, rpc, SupabaseError } from '../../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!UUID_RE.test(authId || '')) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    if (!socialTeamsEnabled()) return NextResponse.json({ error: 'teams_not_open' }, { status: 404 });
    const cfg = envConfig();
    const signingSecret = teamInviteSigningSecret();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !signingSecret) return NextResponse.json({ error: 'teams_not_configured' }, { status: 503 });
    let body; try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
    const inviteId = await verifyTeamInviteToken(body?.token, signingSecret);
    if (!inviteId) return NextResponse.json({ error: 'invalid_or_expired_link' }, { status: 404 });
    const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
    try {
        const result = await rpc('accept_social_team_invite', { p_auth_id: authId, p_invite_id: inviteId }, cfg);
        if (!result?.ok) {
            const status = result?.code === 'EMAIL_MISMATCH' ? 403 : result?.code === 'USER_NOT_FOUND' ? 401 : result?.code === 'INVITE_NOT_FOUND' ? 404 : 400;
            return NextResponse.json({ error: result?.code || 'internal' }, { status });
        }
        return NextResponse.json({ ok: true, brand_id: result.brand_id, role: result.role, idempotent: result.idempotent });
    } catch (err) {
        console.error('[api/v1/social/team/accept] failed:', err instanceof SupabaseError ? err.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
}
