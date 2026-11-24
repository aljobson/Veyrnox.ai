import { rpc, envConfig } from '../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured, presignGetUrl } from '../packages/adapters/r2.js';
import { validAlbumSlug } from './musicAlbums.js';
import { musicAlbumsEnabled, musicPublicationEnabled, validMusicAuthId } from './musicBackend.js';
import { musicAccountReadLimit, musicBlocksEnabled } from './musicBlocks.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export function musicAlbumArtworkHandler({
  rpcCall = rpc,
  presign = presignGetUrl,
  databaseConfig = envConfig,
  storageConfig = r2EnvConfig,
  storageReady = r2IsConfigured,
  enabled = () => musicAlbumsEnabled() && musicBlocksEnabled() && musicPublicationEnabled(),
  readLimit = musicAccountReadLimit,
} = {}) {
  return async (request, context) => {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!enabled()) return reply({ error: 'not_found' }, 404);
    if (new URL(request.url).searchParams.size) return reply({ error: 'invalid_query' }, 400);
    const { slug } = await context?.params || {};
    if (!validAlbumSlug(slug)) return reply({ error: 'not_found' }, 404);
    const db = databaseConfig(); const storage = storageConfig();
    if (!db.supabaseUrl || !db.serviceRoleKey || !storageReady(storage)) return reply({ error: 'not_found' }, 404);
    try {
      const limited = await readLimit(authId, db, rpcCall);
      if (limited) return limited;
      const result = await rpcCall('music_resolve_album_artwork_for_viewer', { p_auth_id: authId, p_slug: slug }, db);
      if (result?.error === 'account_not_found') return reply({ error: 'account_not_found' }, 403);
      if (result?.ok !== true) return reply({ error: 'not_found' }, 404);
      const signed = await presign(result.r2_key, 300, storage);
      return reply({ url: signed.url });
    } catch {
      return reply({ error: 'temporarily_unavailable' }, 502);
    }
  };
}
