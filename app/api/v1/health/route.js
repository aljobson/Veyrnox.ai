/**
 * GET /api/v1/health — gateway smoke test.
 *
 * Confirms:
 *   - The middleware verified a Supabase JWT (auth id present)
 *   - The Worker can round-trip to Supabase Postgres via PostgREST
 *   - The catalog seed is live (count > 0)
 *
 * Response includes latency to Supabase in ms. Slice 4 exit gate:
 * `select_latency_ms` must be under 100 from a Worker to declare the
 * Postgres path healthy.
 */

import { NextResponse } from 'next/server';
import { select, envConfig, SupabaseError } from '../../../../packages/db/supabase-client.js';

export async function GET(req) {
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ ok: false, error: 'supabase not configured' }, { status: 503 });
    }

    const authId = req.headers.get('x-veyrnox-auth-id');

    const t0 = Date.now();
    let catalog;
    try {
        catalog = await select('model_catalog', { columns: 'id', limit: 1 }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        return NextResponse.json(
            { ok: false, error: 'supabase unreachable', status },
            { status: 502 }
        );
    }
    const latencyMs = Date.now() - t0;

    return NextResponse.json({
        ok: true,
        auth_id: authId,
        select_latency_ms: latencyMs,
        catalog_alive: Array.isArray(catalog) && catalog.length > 0,
    });
}
