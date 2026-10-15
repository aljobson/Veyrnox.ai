/** GET /api/v1/social/best-time?accountId= — fixed twelve-week cached
 * historical posting patterns, owned-account only. No network API calls. */
import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { postingInsightsEnabled, publishPlansEnabled } from '../../../../../lib/social/publishFeature.js';
import { readPublishEntitlement } from '../../../../../lib/social/publishPlanApi.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
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
    const brand = await resolveBrand(authId, cfg, 'api/v1/social/best-time:GET', {
        request: req, allowedRoles: ['owner', 'manager', 'editor', 'reviewer', 'analyst', 'viewer'],
    });
    if (brand.error) return brand.error;
    if (publishPlansEnabled()) {
        let entitlement;
        try { entitlement = await readPublishEntitlement(brand.rpcAuthId, cfg); }
        catch (err) {
            console.error('[api/v1/social/best-time:GET] entitlement read failed:', err instanceof SupabaseError ? err.status : 0);
            return NextResponse.json({ error: 'internal' }, { status: 502 });
        }
        if (!entitlement) return NextResponse.json({ error: 'internal' }, { status: 502 });
        if (entitlement.best_time_enabled !== true) return NextResponse.json({ error: 'publish_plan_required' }, { status: 402 });
    }
    let result;
    try {
        if (brand.selected) {
            const accounts = await rpc('list_social_accounts', { p_auth_id: brand.rpcAuthId, p_brand_id: brand.brandId }, cfg);
            if (!accounts?.ok || !accounts.accounts?.some((account) => account.id === accountId)) return NextResponse.json({ error: 'account_not_found' }, { status: 404 });
        }
        result = await rpc('get_social_posting_insights', { p_auth_id: brand.rpcAuthId, p_account_id: accountId }, cfg);
    }
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
