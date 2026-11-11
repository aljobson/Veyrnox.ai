import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { musicDistributionEnabled } from '../../../../../../lib/musicBackend.js';
import { hashMusicShareToken } from '../../../../../../lib/musicDistribution.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(_request, { params }) {
    if (!musicDistributionEnabled()) return reply({ error: 'not_found' }, 404);
    const { token } = await params;
    if (!TOKEN_RE.test(token || '')) return reply({ error: 'not_found' }, 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'temporarily_unavailable' }, 503);
    try {
        const result = await rpc('music_resolve_share_link', { p_token_hash: await hashMusicShareToken(token) }, cfg);
        if (!result?.ok) return reply({ error: 'not_found' }, 404);
        return reply({ song: {
            title: result.song.title,
            version_number: result.song.version_number,
            created_at: result.song.created_at,
            audio_url: `/api/v1/music/shared/${token}/asset`,
        } });
    } catch (error) {
        console.error('[music/shared] resolve failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
