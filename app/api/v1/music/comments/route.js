import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../lib/musicBackend.js';
import { musicCommentsEnabled, parseMusicCommentWrite, publicMusicComments, validCommentId, validCommentSlug } from '../../../../../lib/musicComments.js';

// Signed-in track comments (0518). Approved comments are also on the anonymous
// public track route; this one adds the caller's own pending comments, paging and the writes.
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request) {
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
        const result = await rpc('music_comments_read', { p_slug: slug, p_auth_id: authId, p_before_id: before }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ comments: publicMusicComments(result, { viewer: true }) });
    } catch (error) {
        console.error('[music/comments] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function POST(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicCommentsEnabled()) return reply({ error: 'not_found' }, 404);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicCommentWrite(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_comment_mutate', { p_auth_id: authId, p_idempotency_key: input.idempotencyKey, p_payload: input.payload }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ id: result.id, status: result.status, idempotent: result.idempotent === true }, result.idempotent === true ? 200 : 201);
    } catch (error) {
        console.error('[music/comments] write failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
