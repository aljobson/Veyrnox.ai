import { rpc, envConfig } from '../packages/db/supabase-client.js';
import { musicRpcStatus, publicMusicError, validMusicAuthId } from './musicBackend.js';
import { musicCommentsEnabled, publicMusicComments, validCommentId, validCommentSlug } from './musicComments.js';
import { musicBlocksEnabled } from './musicBlocks.js';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export function musicCommentsReadHandler({ rpcCall = rpc } = {}) {
    return async function GET(request) {
        const authId = request.headers.get('x-veyrnox-auth-id');
        if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
        if (!musicCommentsEnabled()) return reply({ error: 'not_found' }, 404);
        const query = new URL(request.url).searchParams;
        const slug = query.get('slug'), before = query.get('before');
        if (!validCommentSlug(slug)) return reply({ error: 'slug_invalid' }, 400);
        if (before !== null && !validCommentId(before)) return reply({ error: 'before_invalid' }, 400);
        const cfg = envConfig();
        if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
        try {
            const result = await rpcCall(musicBlocksEnabled() ? 'music_comments_read_for_viewer' : 'music_comments_read', { p_slug: slug, p_auth_id: authId, p_before_id: before }, cfg);
            if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
            return reply({ comments: publicMusicComments(result, { viewer: true }) });
        } catch (error) {
            console.error('[music/comments] read failed:', error?.message);
            return reply({ error: 'temporarily_unavailable' }, 502);
        }
    };
}
