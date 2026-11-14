import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../lib/musicBackend.js';
import { musicFollowsEnabled, musicReactionsEnabled, musicSocialEnabled, parseMusicSocialWrite, publicMusicSocial, validMusicHandle, validMusicSlug } from '../../../../../lib/musicSocial.js';

// Signed-in reactions and follows (0515). The anonymous counts are on the public
// track and profile routes; this one adds the caller's own state and the writes.
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicSocialEnabled()) return reply({ error: 'not_found' }, 404);
    const query = new URL(request.url).searchParams;
    const slug = query.get('slug'), handle = query.get('handle');
    if ((slug === null) === (handle === null)) return reply({ error: 'invalid_request' }, 400);
    if (slug !== null && !validMusicSlug(slug)) return reply({ error: 'slug_invalid' }, 400);
    if (handle !== null && !validMusicHandle(handle)) return reply({ error: 'handle_invalid' }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_social_summary', { p_slug: slug, p_handle: handle, p_auth_id: authId }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ social: publicMusicSocial(result, { viewer: true }) });
    } catch (error) {
        console.error('[music/social] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function POST(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicSocialWrite(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    if (input.kind === 'reaction' ? !musicReactionsEnabled() : !musicFollowsEnabled()) return reply({ error: 'not_found' }, 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = input.kind === 'reaction'
            ? await rpc('music_set_song_reaction', { p_auth_id: authId, p_slug: input.slug, p_reaction: input.reaction, p_idempotency_key: input.idempotencyKey }, cfg)
            : await rpc('music_set_creator_follow', { p_auth_id: authId, p_handle: input.handle, p_following: input.following, p_idempotency_key: input.idempotencyKey }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ social: publicMusicSocial(result, { viewer: true }), idempotent: result.idempotent === true });
    } catch (error) {
        console.error('[music/social] write failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
