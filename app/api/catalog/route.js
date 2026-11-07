import { loadTemplateClip } from '../../../lib/templateClipGate.js';
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

import { loadSwapScene } from '../../../lib/swapSceneGate.js';
import { NextResponse } from 'next/server';
import { envConfig } from '../../../packages/db/supabase-client.js';
import { readPublicCatalog, CATALOG_TTL_SECONDS } from '../../../lib/publicCatalog.js';

export async function GET(req) {
    const cfg = envConfig();
    // A scene lookup is public catalog data, never caller identity or source media.
    // Keep it uncached: a paused offer or removed manifest must disappear immediately.
    const templateId = req?.url ? new URL(req.url).searchParams.get('template_clip') : null;
    if (templateId !== null) {
        const clip = await loadTemplateClip(templateId, cfg);
        const headers = { 'cache-control': 'no-store' };
        return clip ? NextResponse.json(clip.template, { headers })
            : NextResponse.json({ error: 'template_clip_not_found' }, { status: 404, headers });
    }
    const swapId = req?.url ? new URL(req.url).searchParams.get('swap') : null;
    if (swapId !== null) {
        const swap = await loadSwapScene(swapId, cfg);
        const headers = { 'cache-control': 'no-store' };
        return swap ? NextResponse.json(swap.scene, { headers })
            : NextResponse.json({ error: 'swap_scene_not_found' }, { status: 404, headers });
    }
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
