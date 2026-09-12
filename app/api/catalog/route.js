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
import { durationsFor } from '../../../lib/providerDuration.js';

// Workers do not honour s-maxage for Worker-generated responses, so an
// unauthenticated flood would be one service-role PostgREST call each.
// Cache the finished response in the Workers Cache API for 5 minutes.
const CACHE_KEY = 'https://veyrnox.ai/api/catalog';
const CACHE_TTL_SECONDS = 300;

async function cacheGet() {
    try { return await caches.default.match(CACHE_KEY); } catch { return undefined; }
}
async function cachePut(res) {
    try { await caches.default.put(CACHE_KEY, res.clone()); } catch { /* not on Workers */ }
}

export async function GET() {
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const cached = await cacheGet();
    if (cached) return cached;

    let rows;
    try {
        rows = await select(
            'model_catalog',
            // provider_endpoint is read to derive `durations` and is never returned:
            // it is our routing detail, and the margin lock keeps it off the anon key.
            { columns: 'id,name,modality,credits_5s,gated_flag,provider_endpoint', filter: 'active=eq.true&order=modality.asc,name.asc' },
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
        // Clip lengths this model may be bought at. The create page renders
        // exactly these, so it can never offer a length the gateway rejects.
        durations: durationsFor(r),
    }));

    const res = NextResponse.json(
        { models },
        { headers: { 'Cache-Control': `public, max-age=60, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=60` } },
    );
    await cachePut(res);
    return res;
}
