import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { publishPlansEnabled, socialInboxEnabled } from '../../../../../lib/social/publishFeature.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set(['all', 'unread', 'unresolved', 'resolved']);
const KINDS = new Set(['message', 'comment', 'review']);
const headers = { 'Cache-Control': 'no-store' };

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!UUID.test(authId || '')) return NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers });
    if (!socialInboxEnabled()) return NextResponse.json({ error: 'publish_inbox_not_open' }, { status: 503, headers });
    if (!publishPlansEnabled()) return NextResponse.json({ error: 'publish_plans_not_open' }, { status: 503, headers });
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503, headers });
    const url = new URL(req.url);
    const accountId = url.searchParams.get('accountId') || null;
    const state = url.searchParams.get('state') || 'unresolved';
    const kind = url.searchParams.get('kind') || null;
    const search = url.searchParams.get('search')?.trim() || null;
    if ((accountId && !UUID.test(accountId)) || !STATES.has(state) || (kind && !KINDS.has(kind)) || (search && search.length > 100)) {
        return NextResponse.json({ error: 'invalid_filter' }, { status: 400, headers });
    }
    const limited = await accountReadLimit(authId, cfg, { counts: { all: 0, unread: 0, unresolved: 0 }, threads: [] });
    if (limited) return limited;
    const brand = await resolveBrand(authId, cfg, 'api/v1/social/inbox:GET', {
        request: req, allowedRoles: ['owner', 'manager', 'editor', 'reviewer', 'analyst', 'viewer'],
    });
    if (brand.error) return brand.error;
    try {
        const result = await rpc('list_social_inbox', { p_auth_id: brand.rpcAuthId, p_brand_id: brand.brandId,
            p_account_id: accountId, p_state: state, p_kind: kind, p_search: search }, cfg);
        if (result?.ok === true) return NextResponse.json({ brand_id: brand.brandId, counts: result.counts, threads: result.threads || [] }, { headers });
        const status = result?.code === 'PLAN_REQUIRED' ? 402 : result?.code === 'ACCOUNT_NOT_FOUND' ? 404 : result?.code === 'INVALID_FILTER' ? 400 : 502;
        return NextResponse.json({ error: String(result?.code || 'internal').toLowerCase() }, { status, headers });
    } catch (error) {
        console.error('[api/v1/social/inbox:GET] read failed:', error instanceof SupabaseError ? error.status : 0);
        return NextResponse.json({ error: 'internal' }, { status: 502, headers });
    }
}
