import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import {
    musicPublicationEnabled, musicPromptPolicy, musicRpcStatus, publicMusicError,
    readMusicJson, validMusicAuthId,
} from '../../../../../../../lib/musicBackend.js';
import { parseMusicPublish, parseMusicUnpublish } from '../../../../../../../lib/musicPublication.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function context(request, id) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return { response: reply({ error: 'not_authenticated' }, 401) };
    if (!musicPublicationEnabled()) return { response: reply({ error: 'music_publication_unavailable' }, 404) };
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
        const result = await rpc('music_read_song_publication', { p_auth_id: current.authId, p_song_id: id }, current.cfg);
        if (!result?.ok) return reply({ error: 'not_found' }, 404);
        return reply({ publication: result.publication });
    } catch (error) {
        console.error('[music/publication] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function POST(request, { params }) {
    const { id } = await params;
    const current = context(request, id);
    if (current.response) return current.response;
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicPublish(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        const evidence = await rpc('music_get_publication_context', {
            p_auth_id: current.authId, p_song_id: id, p_version_id: input.versionId,
        }, current.cfg);
        if (!evidence?.ok) return reply({ error: 'not_found' }, 404);
        const policy = musicPromptPolicy(`${evidence.title || ''}\n${evidence.prompt || ''}`);
        if (!policy.ok) return reply({ error: 'publication_not_allowed', policy_version: policy.version }, 400);
        const result = await rpc('music_publish_song', {
            p_auth_id: current.authId,
            p_song_id: id,
            p_version_id: input.versionId,
            p_handle: input.handle,
            p_display_name: input.displayName,
            p_allow_comments: input.allowComments,
            p_allow_remixes: input.allowRemixes,
            p_policy_version: policy.version,
            p_idempotency_key: input.idempotencyKey,
        }, current.cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ publication: { ...result.publication, url: `/music/tracks/${result.publication.slug}`, profile_url: `/music/creators/${result.publication.handle}` } }, result.idempotent ? 200 : 201);
    } catch (error) {
        console.error('[music/publication] publish failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function DELETE(request, { params }) {
    const { id } = await params;
    const current = context(request, id);
    if (current.response) return current.response;
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, 400);
    const input = parseMusicUnpublish(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        const result = await rpc('music_unpublish_song', {
            p_auth_id: current.authId, p_song_id: id, p_idempotency_key: input.idempotencyKey,
        }, current.cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ ok: true, idempotent: result.idempotent === true });
    } catch (error) {
        console.error('[music/publication] unpublish failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
