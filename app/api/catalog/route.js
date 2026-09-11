/**
 * GET /api/catalog — public model catalog (active rows only).
 *
 * Unauthenticated by design: this is the price list the marketing tiles
 * and the studio model picker read. Lives outside /api/v1 so the auth
 * middleware doesn't gate it. Never exposes provider_cost_per_unit —
 * that's our margin, not the customer's business.
 *
 * Response: { models: [{ id, name, modality, credits, gated }] }
 * Cached at the edge for 5 minutes; catalog changes are migrations, not
 * per-request state.
 */

import { NextResponse } from 'next/server';
import { select, envConfig } from '../../../packages/db/supabase-client.js';

export async function GET() {
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    let rows;
    try {
        rows = await select(
            'model_catalog',
            { columns: 'id,name,modality,credits_5s,gated_flag', filter: 'active=eq.true&order=modality.asc,name.asc' },
            cfg,
        );
    } catch (err) {
        console.error('[api/catalog] select failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    const models = (Array.isArray(rows) ? rows : []).map((r) => ({
        id: r.id,
        name: r.name,
        modality: r.modality,
        credits: r.credits_5s,
        gated: !!r.gated_flag,
    }));

    return NextResponse.json(
        { models },
        { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } },
    );
}
