import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { musicTrackAddEnabled, validMusicAuthId } from '../../../../../../lib/musicBackend.js';

import { isUuid } from '../../../../../../lib/validate.js';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request, { params }) {
  const authId = request.headers.get('x-veyrnox-auth-id'); const { id } = await params;
  if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
  if (!musicTrackAddEnabled()) return reply({ error: 'music_track_add_unavailable' }, 404);
  if (!isUuid(id || '')) return reply({ error: 'request_id_invalid' }, 400);
  const cfg = envConfig(); if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
  try { const result = await rpc('music_get_track_add_request', { p_auth_id: authId, p_request_id: id }, cfg); return result?.ok ? reply(result.request) : reply({ error: 'not_found' }, 404); }
  catch (error) { console.error('[music/track-add-request] failed:', error?.message); return reply({ error: 'temporarily_unavailable' }, 502); }
}
