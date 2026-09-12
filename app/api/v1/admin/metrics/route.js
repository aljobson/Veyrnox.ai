/**
 * GET /api/v1/admin/metrics — 24h operational metrics for admins.
 *
 * Two gates, deliberately:
 *   1. middleware.js verifies the Supabase JWT and sets x-veyrnox-auth-id.
 *   2. ops_metrics_24h() re-checks users.is_admin and raises 42501 if the
 *      caller is not an admin, so the data is protected even if a future
 *      route change forgets to check.
 *
 * Every figure is read from jobs and ledger_entries. Nothing here is
 * synthesised: if there is no traffic, the numbers are zero.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig, SupabaseError } from '../../../../../packages/db/supabase-client.js';

// Postgres insufficient_privilege — ops_metrics_24h raises it for non-admins.
const NOT_ADMIN = '42501';

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }

    let metrics;
    try {
        metrics = await rpc('ops_metrics_24h', { p_auth_id: authId }, cfg);
    } catch (err) {
        const body = err instanceof SupabaseError ? err.body : null;
        const code = body && (body.code || (body.error && body.error.code));
        const message = JSON.stringify(body || '');
        if (code === NOT_ADMIN || message.includes('not_admin')) {
            // Deliberately terse: an authenticated non-admin learns only that
            // they are not one, never whether the dashboard holds anything.
            return NextResponse.json({ error: 'not_admin' }, { status: 403 });
        }
        console.error('[api/v1/admin/metrics] rpc failed:', err && err.status, body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json(metrics, {
        headers: { 'Cache-Control': 'no-store' },
    });
}
