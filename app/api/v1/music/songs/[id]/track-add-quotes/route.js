import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../../../../../../../packages/adapters/r2.js';
import { inspectStoredSource } from '../../../../../../../lib/resolveSource.js';
import { MUSIC_TRACK_ADD_SOURCE_MAX, musicRpcStatus, musicTrackAddEnabled, parseMusicTrackAddQuote, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../../../lib/musicBackend.js';

import { isUuid } from '../../../../../../../lib/validate.js';
const MAX_BYTES = 10 * 1024 * 1024;
const reply = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export async function POST(request, { params }) {
  const authId = request.headers.get('x-veyrnox-auth-id'); const { id } = await params;
  if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
  if (!musicTrackAddEnabled()) return reply({ error: 'music_track_add_unavailable' }, 404);
  if (!isUuid(id || '')) return reply({ error: 'song_id_invalid' }, 400);
  const decoded = await readMusicJson(request);
  if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
  const input = parseMusicTrackAddQuote(decoded.value);
  if (!input.ok) return reply({ error: input.error }, 400);
  const cfg = envConfig(); const r2cfg = r2EnvConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) return reply({ error: 'gateway_not_configured' }, 503);
  try {
    const source = await rpc('music_get_track_add_source_context', { p_auth_id: authId, p_song_id: id, p_version_id: input.versionId }, cfg);
    if (!source?.ok) return reply({ error: publicMusicError(source?.code) }, musicRpcStatus(source?.code));
    const inspected = await inspectStoredSource(source.r2_key, { contentType: source.mime_type, field: 'audio_url' }, r2cfg);
    if (!inspected.ok || inspected.contentType !== 'audio/mpeg' || inspected.sizeBytes > MAX_BYTES) return reply({ error: 'format_unavailable' }, 400);
    if (!Number.isFinite(inspected.seconds) || inspected.seconds <= 0 || inspected.seconds > MUSIC_TRACK_ADD_SOURCE_MAX) return reply({ error: 'source_duration_unavailable' }, 400);
    const result = await rpc('music_create_track_add_quote', {
      p_auth_id: authId, p_song_id: id, p_version_id: input.versionId, p_mode: input.mode,
      p_prompt: input.prompt, p_lyrics: input.lyrics, p_vocal_gender: input.vocalGender,
      p_rights_confirmed: input.rightsConfirmed,
      p_lyrics_rights_confirmed: input.lyricsRightsConfirmed,
      p_source_duration_seconds: inspected.seconds, p_source_size_bytes: inspected.sizeBytes,
    }, cfg);
    if (!result?.ok) { const status = musicRpcStatus(result?.code); return reply({ error: publicMusicError(result?.code) }, status, status === 429 ? { 'Retry-After': String(result.retry_after_seconds || 60) } : {}); }
    return reply({ quote_id: result.quote_id, mode: result.mode, source_duration_seconds: result.source_duration_seconds,
      upload_credits: result.upload_credits, track_credits: result.track_credits, total_credits: result.total_credits,
      balance: result.balance, balance_after: result.balance_after, affordable: result.affordable, expires_at: result.expires_at }, 201);
  } catch (error) { console.error('[music/track-add-quotes] failed:', error?.message); return reply({ error: 'temporarily_unavailable' }, 502); }
}
