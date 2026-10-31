/**
 * GET /api/templates: the template gallery for the browser, slimmed to what a card shows. Without a query it answers
 * { templates: [{ id, name, category, model, credits, durationSeconds, isNew?, bg, previewAspect, clipKey, promptPreview, taste?, clip }],
 * categories: [...] }. With ?q=<words> it answers { ids: [...] }: the gallery templates whose name, model, category, needs or whole
 * prompt contain every word, so the browser never holds the prompts to search them.
 *
 * Unauthenticated by design and the same for everyone: static template data with no price and nothing per-user. Lives outside /api/v1
 * so the auth middleware does not gate it, like /api/presets, and reads no identity header. It reads no database, so there is no outage
 * shape. The query is cut at 80 characters. Errors: 400 invalid_query.
 */
import { NextResponse } from 'next/server';
import { SEARCH_QUERY_MAX, searchTemplateIds, templateCards, templateCategories } from '../../../lib/clientTemplates.js';

const CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=300';

export function GET(request) {
    const q = new URL(request.url).searchParams.get('q');
    if (q === null) return NextResponse.json({ templates: templateCards(), categories: templateCategories() }, { headers: { 'Cache-Control': CACHE } });
    if (q.length > SEARCH_QUERY_MAX * 4) return NextResponse.json({ error: 'invalid_query' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ ids: searchTemplateIds(q) }, { headers: { 'Cache-Control': CACHE } });
}
