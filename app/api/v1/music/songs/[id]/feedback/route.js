import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { musicLibraryEnabled, musicRpcStatus, publicMusicError, validMusicAuthId } from '../../../../../../../lib/musicBackend.js';
import { parseMusicFeedback } from '../../../../../../../lib/musicFeedback.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function PUT(request, { params }) {
  const authId = request.headers.get('x-veyrnox-auth-id');
  if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
  if (!musicLibraryEnabled()) return reply({ error: 'music_library_unavailable' }, 404);
  const { id } = await params;
  if (!UUID_RE.test(id || '')) return reply({ error: 'song_id_invalid' }, 400);
  let body;
  try { body = await request.json(); } catch { return reply({ error: 'invalid_json' }, 400); }
  const parsed = parseMusicFeedback(body);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
  try {
    const result = await rpc('music_set_song_feedback', {
      p_auth_id: authId,
      p_song_id: id,
      p_value: parsed.value,
    }, cfg);
    if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
    return reply({ feedback: result.feedback ?? null });
  } catch (error) {
    console.error('[music/feedback] update failed:', error?.message);
    return reply({ error: 'temporarily_unavailable' }, 502);
  }
}
