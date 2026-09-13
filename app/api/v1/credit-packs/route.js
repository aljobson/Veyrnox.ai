/**
 * GET /api/v1/credit-packs — the active web Credit Packs (#92, ADR-0018).
 *
 * Authenticated by middleware.js like every /api/v1 path. Credits and prices
 * come straight from public.credit_packs; nothing is priced here. The variant
 * id is ours to pass to LemonSqueezy and is not returned.
 *
 * Response: { packs: [{ id, credits, price_usd_cents }] }
 */

import { NextResponse } from 'next/server';
import { select, envConfig } from '../../../../packages/db/supabase-client.js';

export async function GET(req) {
    if (!req.headers.get('x-veyrnox-auth-id')) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }

    let rows;
    try {
        rows = await select(
            'credit_packs',
            { columns: 'id,credits,price_usd_cents', filter: 'sales_channel=eq.web&active=eq.true&order=credits.asc' },
            cfg,
        );
    } catch (err) {
        console.error('[api/v1/credit-packs] select failed:', err && err.status);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    const packs = (Array.isArray(rows) ? rows : []).map((r) => ({
        id: r.id,
        credits: r.credits,
        price_usd_cents: r.price_usd_cents,
    }));
    return NextResponse.json({ packs });
}
