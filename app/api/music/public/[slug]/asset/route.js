import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { musicPublicationEnabled } from '../../../../../../lib/musicBackend.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured, presignGetUrl } from '../../../../../../packages/adapters/r2.js';

const SLUG_RE = /^[a-f0-9]{24}$/;
export async function GET(_request, { params }) {
    if (!musicPublicationEnabled()) return Response.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const { slug } = await params;
    if (!SLUG_RE.test(slug || '')) return Response.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const cfg = envConfig(); const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) return Response.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    try {
        const result = await rpc('music_resolve_publication_asset', { p_slug: slug }, cfg);
        if (!result?.ok) return Response.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
        const signed = await presignGetUrl(result.r2_key, 300, r2cfg);
        return new Response(null, { status: 302, headers: { Location: signed.url, 'Cache-Control': 'no-store' } });
    } catch (error) {
        console.error('[music/public/asset] resolve failed:', error?.message);
        return Response.json({ error: 'temporarily_unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
}
