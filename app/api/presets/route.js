/**
 * GET /api/presets: the template gallery as data, for the mobile app (apps/mobile).
 *
 * Unauthenticated by design, and per-account data never reaches it: the list is static template data priced from the public catalog, the
 * same for everyone. Lives outside /api/v1 so the auth middleware does not gate it, like /api/catalog and /api/popular-templates. It
 * takes no input and reads no identity header. Every web template is listed. Credits come from its active catalog row when present;
 * otherwise the web gallery's template fallback is returned with available: false, so clients can show it without offering generation.
 *
 * Response: { presets: [{ id, title, category, modelId, modelName, modality, prompt, needs, durationSeconds, credits, gated, available,
 * isNew, previewUrl, posterUrl, previewAspect }] }. Errors: 503 not_configured, 502 presets_unavailable (catalog unreachable).
 */
import { NextResponse } from 'next/server';
import { envConfig } from '../../../packages/db/supabase-client.js';
import { readPublicCatalog } from '../../../lib/publicCatalog.js';
import { toPublicPresets } from '../../../lib/publicPresets.js';

const CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=60';

export async function GET() {
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return NextResponse.json({ error: 'not_configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    try {
        const presets = toPublicPresets(await readPublicCatalog({ cfg }));
        return NextResponse.json({ presets }, { headers: { 'Cache-Control': CACHE } });
    } catch {
        console.error('[api/presets] catalog read failed');
        return NextResponse.json({ error: 'presets_unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
}
