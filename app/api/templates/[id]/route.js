/**
 * GET /api/templates/:id: one template in full (prompt, steps, negative prompt and the rest), with its preview clip. Create reads it
 * when someone arrives from a template or picks one, so the page never bundles the catalog.
 *
 * Unauthenticated by design and the same for everyone: static template data, nothing per-user, no price. Lives outside /api/v1 like
 * /api/presets and reads no identity header. The id must match a template id; anything else is 404 so the answer never depends on
 * what was asked. A template whose exact source prompt cannot run carries sourcePromptRunnable: false.
 * Errors: 404 template_not_found.
 */
import { NextResponse } from 'next/server';
import { templateDetail } from '../../../../lib/clientTemplates.js';

const CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=300';

export async function GET(_request, { params }) {
    const { id } = await params;
    const template = templateDetail(id);
    if (!template) return NextResponse.json({ error: 'template_not_found' }, { status: 404, headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' } });
    return NextResponse.json({ template }, { headers: { 'Cache-Control': CACHE } });
}
