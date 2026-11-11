import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import {
    musicDistributionEnabled, musicRpcStatus, parseMusicShareLinkRevoke,
    publicMusicError, readMusicJson, validMusicAuthId,
} from '../../../../../../lib/musicBackend.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function DELETE(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicDistributionEnabled()) return reply({ error: 'music_distribution_unavailable' }, 404);
    const { id } = await params;
    if (!UUID_RE.test(id || '')) return reply({ error: 'share_link_id_invalid' }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicShareLinkRevoke(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        const result = await rpc('music_revoke_share_link', {
            p_auth_id: authId, p_link_id: id, p_idempotency_key: input.idempotencyKey,
        }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ link: result.link, idempotent: result.idempotent === true });
    } catch (error) {
        console.error('[music/share-links] revoke failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
