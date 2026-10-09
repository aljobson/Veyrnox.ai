/**
 * GET /api/v1/social/accounts — the caller's connected social accounts
 * (technical spec §2.3, ADR-0061). Auto-creates the caller's default
 * Publish brand on first touch (v1 has no multi-brand UI yet).
 *
 * Response (200): { brand_id, accounts: [{ id, network, external_account_id,
 *   display_name, avatar_url, status, connected_at, token_expires_at }] }
 *   Never includes access_token_enc/refresh_token_enc — the RPC itself
 *   doesn't select them (technical spec §2.7 "tokens never returned to the
 *   client").
 *
 * Identity comes from x-veyrnox-auth-id, which middleware.js sets after
 * verifying the Supabase JWT and overwrites on every request. A
 * client-supplied id can never reach this handler.
 */

import { youtubeVisibilityEnabled } from '../../../../../lib/social/publishFeature.js';
import { socialUploadsEnabled } from '../../../../../lib/social/uploadPolicy.js';
import { networkEnabled } from '../../../../../lib/social/networks.js';
import { networkReadiness } from '../../../../../lib/social/networkReadiness.js';
import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { rpc, envConfig, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }

    const limited = await accountReadLimit(authId, cfg, { brand_id: null, accounts: [] });
    if (limited) return limited;

    let brand;
    try {
        brand = await rpc('get_or_create_default_social_brand', { p_auth_id: authId }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/social/accounts] brand lookup failed:', status, err && err.body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!brand || brand.ok !== true) {
        const code = brand && brand.code === 'USER_NOT_FOUND' ? 'not_authenticated' : 'internal';
        const status = code === 'not_authenticated' ? 401 : 502;
        return NextResponse.json({ error: code }, { status });
    }

    let accounts;
    try {
        accounts = await rpc('list_social_accounts', { p_auth_id: authId, p_brand_id: brand.brand_id }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/social/accounts] account list failed:', status, err && err.body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!accounts || accounts.ok !== true) {
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json({
        brand_id: brand.brand_id,
        accounts: (accounts.accounts || []).map((account) => ({ ...account, publishingEnabled: networkEnabled(account.network) })),
        uploadsEnabled: socialUploadsEnabled(),
        youtubeVisibilityEnabled: youtubeVisibilityEnabled(),
        networks: networkReadiness(),
    }, { headers: { 'Cache-Control': 'no-store' } });
}
