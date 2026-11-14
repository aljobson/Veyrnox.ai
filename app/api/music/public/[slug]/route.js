import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicPublicationEnabled } from '../../../../../lib/musicBackend.js';
import { musicSocialEnabled, publicMusicSocial } from '../../../../../lib/musicSocial.js';

const SLUG_RE = /^[a-f0-9]{24}$/;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(_request, { params }) {
    if (!musicPublicationEnabled()) return reply({ error: 'not_found' }, 404);
    const { slug } = await params;
    if (!SLUG_RE.test(slug || '')) return reply({ error: 'not_found' }, 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'not_found' }, 404);
    try {
        const result = await rpc('music_resolve_publication', { p_slug: slug }, cfg);
        if (!result?.ok) return reply({ error: 'not_found' }, 404);
        const { job_id: _jobId, ...safe } = result.track;
        // Counts only: who reacted is never public. A failed count read hides the counts, not the track.
        const social = musicSocialEnabled()
            ? await rpc('music_social_summary', { p_slug: slug, p_handle: null, p_auth_id: null }, cfg).catch(() => null) : null;
        return reply({ track: { ...safe, audio_url: `/api/music/public/${slug}/asset` }, ...(social?.ok ? { social: publicMusicSocial(social) } : {}) });
    } catch (error) {
        console.error('[music/public] resolve failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
