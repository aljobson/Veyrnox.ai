import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicPublicationEnabled } from '../../../../../lib/musicBackend.js';
import { musicSocialEnabled, publicMusicSocial } from '../../../../../lib/musicSocial.js';

const HANDLE_RE = /^[a-z][a-z0-9_]{2,29}$/;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(_request, { params }) {
    if (!musicPublicationEnabled()) return reply({ error: 'not_found' }, 404);
    const { handle } = await params;
    if (!HANDLE_RE.test(handle || '')) return reply({ error: 'not_found' }, 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'not_found' }, 404);
    try {
        const result = await rpc('music_read_public_profile', { p_handle: handle }, cfg);
        if (!result?.ok) return reply({ error: 'not_found' }, 404);
        const social = musicSocialEnabled()
            ? await rpc('music_social_summary', { p_slug: null, p_handle: handle, p_auth_id: null }, cfg).catch(() => null) : null;
        return reply({ profile: result.profile, tracks: result.tracks || [], ...(social?.ok ? { social: publicMusicSocial(social) } : {}) });
    } catch (error) {
        console.error('[music/profile] resolve failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
