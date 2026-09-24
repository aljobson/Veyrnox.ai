/**
 * GET /api/v1/balance — credit balance for the authenticated user, plus
 * the Free Credit remainder and when it expires (ADR-0013).
 *
 * Calls the read_user_credits(p_auth_id) RPC with the middleware-
 * verified x-veyrnox-auth-id header. Returns zeros for users with no
 * balance row.
 *
 * Never trusts a client-supplied auth id. The header we read here is
 * set by middleware.js after JWT verification and cannot be spoofed
 * because the middleware overwrites any inbound header of the same
 * name before the handler runs.
 */

import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../lib/accountReadLimit.js';
import { rpc, envConfig, SupabaseError } from '../../../../packages/db/supabase-client.js';

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

    const limited = await accountReadLimit(authId, cfg, { balance: 0, free_credits: 0, free_expires_at: null });
    if (limited) return limited;

    let credits;
    try {
        credits = await rpc('read_user_credits', { p_auth_id: authId }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/balance] rpc failed:', status, err && err.body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    // Per-user figures: never let a browser or intermediary keep a copy.
    return NextResponse.json({
        balance: Number(credits && credits.balance) || 0,
        free_credits: Number(credits && credits.free_credits) || 0,
        free_expires_at: (credits && credits.free_expires_at) || null,
    }, { headers: { 'Cache-Control': 'no-store' } });
}
