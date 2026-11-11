import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { presignGetUrl, isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../../../../packages/adapters/r2.js';
import { musicDistributionEnabled } from '../../../../../../../lib/musicBackend.js';
import { hashMusicShareToken } from '../../../../../../../lib/musicDistribution.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const PLAYBACK_TTL_SECONDS = 300;

export async function GET(_request, { params }) {
    if (!musicDistributionEnabled()) return new Response(null, { status: 404 });
    const { token } = await params;
    if (!TOKEN_RE.test(token || '')) return new Response(null, { status: 404 });
    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) return new Response(null, { status: 503 });
    try {
        const result = await rpc('music_resolve_shared_asset', { p_token_hash: await hashMusicShareToken(token) }, cfg);
        if (!result?.ok) return new Response(null, { status: 404 });
        const signed = await presignGetUrl(result.r2_key, PLAYBACK_TTL_SECONDS, r2cfg);
        return new Response(null, {
            status: 302,
            headers: { Location: signed.url, 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        console.error('[music/shared] asset failed:', error?.message);
        return new Response(null, { status: 502 });
    }
}
