/** GET /api/v1/social/best-time?accountId= — fixed twelve-week cached
 * historical posting patterns, owned-account only. No network API calls. */
import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { postingInsightsEnabled } from '../../../../../lib/social/publishFeature.js';
import { rpc, envConfig, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    if (!postingInsightsEnabled()) return NextResponse.json({ error: 'posting_insights_not_open' }, { status: 503 });
    const accountId = new URL(req.url).searchParams.get('accountId') || '';
    if (!UUID_RE.test(accountId)) return NextResponse.json({ error: 'invalid_account_id' }, { status: 400 });
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    const limited = await accountReadLimit(authId, cfg, { insights: null });
    if (limited) return limited;
    let result;
    try { result = await rpc('get_social_posting_insights', { p_auth_id: authId, p_account_id: accountId }, cfg); }
    catch (err) {
        console.error('[api/v1/social/best-time:GET] read failed:', err instanceof SupabaseError ? err.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (result?.ok !== true) {
        if (result?.code === 'USER_NOT_FOUND') return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
        if (result?.code === 'ACCOUNT_NOT_FOUND') return NextResponse.json({ error: 'account_not_found' }, { status: 404 });
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    return NextResponse.json({ insights: result.insights || null }, { headers: { 'Cache-Control': 'no-store' } });
}
