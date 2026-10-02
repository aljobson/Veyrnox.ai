/**
 * GET /api/catalog — public model catalog (active rows only).
 *
 * Unauthenticated by design: this is the price list the marketing tiles
 * and the studio model picker read. Lives outside /api/v1 so the auth
 * middleware doesn't gate it. Never exposes provider_cost_per_unit —
 * that's our margin, not the customer's business.
 *
 * Response: { models: [{ id, name, modality, credits, gated, durations, capabilities }] }
 * Cached for 5 minutes (lib/publicCatalog.js); catalog changes are
 * migrations, not per-request state.
 */

import { NextResponse } from 'next/server';
import { envConfig } from '../../../packages/db/supabase-client.js';
import { readPublicCatalog, CATALOG_TTL_SECONDS } from '../../../lib/publicCatalog.js';

export async function GET() {
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    let models;
    try {
        models = await readPublicCatalog({ cfg });
    } catch (err) {
        console.error('[api/catalog] select failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json(
        { models },
        { headers: { 'Cache-Control': `public, max-age=60, s-maxage=${CATALOG_TTL_SECONDS}, stale-while-revalidate=60` } },
    );
}
