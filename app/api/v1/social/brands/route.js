import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { socialTeamsEnabled } from '../../../../../lib/social/publishFeature.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!UUID.test(authId || '')) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    if (!socialTeamsEnabled()) return NextResponse.json({ error: 'teams_not_open' }, { status: 404 });
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    const limited = await accountReadLimit(authId, cfg, { brands: [] }); if (limited) return limited;
    try {
        const result = await rpc('list_social_brand_access', { p_auth_id: authId }, cfg);
        if (!result?.ok) return NextResponse.json({ error: result?.code === 'USER_NOT_FOUND' ? 'not_authenticated' : 'internal' }, { status: result?.code === 'USER_NOT_FOUND' ? 401 : 502 });
        return NextResponse.json({ brands: result.brands || [] }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        console.error('[api/v1/social/brands:GET] failed:', error instanceof SupabaseError ? error.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
}
