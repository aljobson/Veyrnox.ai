/**
 * GET /api/credit-packs — public Credit Pack price list (#100, ADR-0018).
 *
 * Unauthenticated, like /api/catalog: the pricing page is read by signed-out
 * visitors. Lives outside /api/v1 so the auth middleware doesn't gate it.
 * Credits and prices come straight from public.credit_packs (active web packs
 * only); nothing is priced here, and payment-provider identifiers are not
 * returned. Buying still goes through the authenticated /api/v1 routes.
 *
 * Response: { packs: [{ id, credits, price_usd_cents }] }
 * Cached for 5 minutes; pack changes are migrations or the seed script.
 */

import { NextResponse } from 'next/server';
import { select, envConfig } from '../../../packages/db/supabase-client.js';

// Workers do not honour s-maxage for Worker-generated responses, so cache the
// finished response in the Workers Cache API (same pattern as /api/catalog).
const CACHE_KEY = 'https://veyrnox.ai/api/credit-packs';
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
            'credit_packs',
            { columns: 'id,credits,price_usd_cents', filter: 'sales_channel=eq.web&active=eq.true&order=credits.asc' },
            cfg,
        );
    } catch (err) {
        console.error('[api/credit-packs] select failed:', err && err.status);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    const packs = (Array.isArray(rows) ? rows : []).map((r) => ({
        id: r.id,
        credits: r.credits,
        price_usd_cents: r.price_usd_cents,
    }));
    const res = NextResponse.json(
        { packs },
        { headers: { 'Cache-Control': `public, max-age=60, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=60` } },
    );
    await cachePut(res);
    return res;
}
