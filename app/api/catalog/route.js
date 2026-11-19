import { envConfig as r2EnvConfig } from '../../../packages/adapters/r2.js';
import { loadTemplateSwapClip, loadTemplateSwapRow } from '../../../lib/templateSwapClipGate.js';
import { TEMPLATE_SWAP_ROW } from '../../../app/veyrnox/_lib/templateSwapRow.js';
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
import { withPublicModelIds } from '../../../lib/publicModelIds.js';

export async function GET(req) {
    const cfg = envConfig();
    // The curated swap row: the row's live cards ({ id, credits }), [] while the swap switch is off. Discovery only, so it may sit in the
    // edge cache briefly; opening a card still runs the uncached per-template check above.
    if (req?.url && new URL(req.url).searchParams.has('template_swap_row')) {
        const items = await loadTemplateSwapRow(TEMPLATE_SWAP_ROW.map(row => row.id), cfg, { r2cfg: r2EnvConfig() });
        return NextResponse.json({ items }, { headers: { 'cache-control': 'public, max-age=30, s-maxage=60' } });
    }
    const templateSwapId = req?.url ? new URL(req.url).searchParams.get('template_swap') : null;
    if (templateSwapId !== null) {
        const clip = await loadTemplateSwapClip(templateSwapId, cfg, { r2cfg: r2EnvConfig() });
        const headers = { 'cache-control': 'no-store' };
        return clip ? NextResponse.json(clip.template, { headers })
            : NextResponse.json({ error: 'template_swap_not_found' }, { status: 404, headers });
    }
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
        // Ids leave here supplier-neutral (lib/publicModelIds.js); the gateway accepts both forms.
        models = withPublicModelIds(await readPublicCatalog({ cfg }));
    } catch (err) {
        console.error('[api/catalog] select failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json(
        { models },
        { headers: { 'Cache-Control': `public, max-age=60, s-maxage=${CATALOG_TTL_SECONDS}, stale-while-revalidate=60` } },
    );
}
