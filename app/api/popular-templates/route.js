/**
 * GET /api/popular-templates (ADR-0072): the gallery templates people use most, as ranked ids.
 *
 * Unauthenticated by design, and per-account data never reaches it: the answer is the same for everyone and cached for ten minutes. Lives
 * outside /api/v1 so the auth middleware does not gate it, like /api/catalog. The database ranks by distinct accounts that completed a
 * job from a template in the last 30 days and only lists a template once 20 of them have (migration 0215), and returns ids and nothing
 * else: no counts, accounts, prompts or job ids. This route also drops anything that is not a well-formed id.
 *
 * Response: { templates: ["id", ...] }, best first. An empty list is a normal answer (nothing has enough use yet).
 */
import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../packages/db/supabase-client.js';

const TEMPLATE_ID_RE = /^[a-z0-9-]{1,40}$/;
const CACHE = 'public, max-age=60, s-maxage=600, stale-while-revalidate=300';

export async function GET() {
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    try {
        const list = await rpc('popular_templates', {}, cfg);
        const templates = (Array.isArray(list) ? list : []).filter((id) => typeof id === 'string' && TEMPLATE_ID_RE.test(id)).slice(0, 20);
        return NextResponse.json({ templates }, { headers: { 'Cache-Control': CACHE } });
    } catch {
        console.error('[api/popular-templates] read failed');
        return NextResponse.json({ error: 'popular_unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
}
