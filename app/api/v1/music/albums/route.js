import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicAlbumsEnabled, musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../lib/musicBackend.js';
import { parseAlbumCreate } from '../../../../../lib/musicAlbums.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function context(request) {
    const auth = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(auth)) return { error: reply({ error: 'not_authenticated' }, 401) };
    if (!musicAlbumsEnabled()) return { error: reply({ error: 'albums_unavailable' }, 404) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: reply({ error: 'gateway_not_configured' }, 503) };
    return { auth, cfg };
}
export async function GET(request) {
    const ctx = context(request); if (ctx.error) return ctx.error;
    try {
        const result = await rpc('music_list_albums', { p_auth_id: ctx.auth }, ctx.cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ albums: result.albums || [], available_tracks: result.available_tracks || [] });
    } catch { return reply({ error: 'temporarily_unavailable' }, 502); }
}
export async function POST(request) {
    const ctx = context(request); if (ctx.error) return ctx.error;
    const body = await readMusicJson(request); if (!body.ok) return reply({ error: body.error }, 400);
    const input = parseAlbumCreate(body.value); if (!input.ok) return reply({ error: input.error }, 400);
    try {
        const result = await rpc('music_create_album', { p_auth_id: ctx.auth, p_id: crypto.randomUUID(), p_title: input.title,
            p_album_type: input.albumType, p_description: input.description, p_artwork_asset_id: input.artworkAssetId, p_key: input.idempotencyKey }, ctx.cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ album: result.album, idempotent: result.idempotent === true }, result.idempotent ? 200 : 201);
    } catch { return reply({ error: 'temporarily_unavailable' }, 502); }
}
