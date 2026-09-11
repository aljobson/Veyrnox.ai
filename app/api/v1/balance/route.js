/**
 * GET /api/v1/balance — credit balance for the authenticated user.
 *
 * Calls the read_user_balance(p_auth_id) RPC with the middleware-
 * verified x-veyrnox-auth-id header. Returns 0 for users with no
 * balance row (matches Ledger.readBalance semantics).
 *
 * Never trusts a client-supplied auth id. The header we read here is
 * set by middleware.js after JWT verification and cannot be spoofed
 * because the middleware overwrites any inbound header of the same
 * name before the handler runs.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig, SupabaseError } from '../../../../packages/db/supabase-client.js';

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }

    let balance;
    try {
        balance = await rpc('read_user_balance', { p_auth_id: authId }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/balance] rpc failed:', status, err && err.body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    // Function returns INTEGER; PostgREST wraps as JSON number.
    return NextResponse.json({ balance: Number(balance) || 0 });
}
