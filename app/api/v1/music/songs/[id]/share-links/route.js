import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import {
    musicDistributionEnabled, musicRpcStatus, parseMusicShareLinkCreate,
    publicMusicError, readMusicJson, validMusicAuthId,
} from '../../../../../../../lib/musicBackend.js';
import { hashMusicShareToken } from '../../../../../../../lib/musicDistribution.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function context(request, id) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return { response: reply({ error: 'not_authenticated' }, 401) };
    if (!musicDistributionEnabled()) return { response: reply({ error: 'music_distribution_unavailable' }, 404) };
    if (!UUID_RE.test(id || '')) return { response: reply({ error: 'song_id_invalid' }, 400) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { response: reply({ error: 'gateway_not_configured' }, 503) };
    return { authId, cfg };
}

export async function GET(request, { params }) {
    const { id } = await params;
    const current = context(request, id);
    if (current.response) return current.response;
    try {
        const result = await rpc('music_list_share_links', { p_auth_id: current.authId, p_song_id: id }, current.cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ links: Array.isArray(result.links) ? result.links : [] });
    } catch (error) {
        console.error('[music/share-links] list failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function POST(request, { params }) {
    const { id } = await params;
    const current = context(request, id);
    if (current.response) return current.response;
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicShareLinkCreate(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        const result = await rpc('music_create_share_link', {
            p_auth_id: current.authId,
            p_song_id: id,
            p_version_id: input.versionId,
            p_token_hash: await hashMusicShareToken(input.token),
            p_idempotency_key: input.idempotencyKey,
        }, current.cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ link: { ...result.link, url: `/listen/${input.token}` } }, result.idempotent ? 200 : 201);
    } catch (error) {
        console.error('[music/share-links] create failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
