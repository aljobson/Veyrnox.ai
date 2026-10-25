import { NextResponse } from 'next/server';
import { envConfig as dbConfig, rpc } from '../../../../../../packages/db/supabase-client.js';
import { addPvcSample, envConfig as elevenConfig, isConfigured, limits } from '../../../../../../packages/adapters/elevenlabs.js';
import { deleteObject, envConfig as r2Config, isConfigured as r2Configured } from '../../../../../../packages/adapters/r2.js';
import { fetchWithTimeout } from '../../../../../../lib/fetchWithTimeout.js';
import { resolveUploadedSource } from '../../../../../../lib/resolveSource.js';
import { UUID_RE, providerErrorStatus, recentMfa } from '../../../../../../lib/voiceProfiles.js';

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200, headers = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });

export async function POST(req, { params }) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  if (!authId || !UUID_RE.test(authId)) return json({ error: 'not_authenticated' }, 401);
  const mfaAt = recentMfa(req);
  if (mfaAt === null) return json({ error: 'recent_mfa_required' }, 403);
  const { profileId } = await params;
  if (!UUID_RE.test(profileId)) return json({ error: 'not_found' }, 404);
  const cfg = dbConfig(), provider = elevenConfig(), storage = r2Config();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(provider) || !r2Configured(storage)) return json({ error: 'voice_provider_not_configured' }, 503);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (typeof body?.source_key !== 'string') return json({ error: 'source_key_required' }, 400);

  let profile;
  try { profile = await rpc('get_voice_profile', { p_auth_id: authId, p_profile_id: profileId }, cfg); }
  catch { return json({ error: 'profile_unavailable' }, 502); }
  if (profile?.ok !== true) return json({ error: 'not_found' }, 404);
  if (profile.status !== 'samples_pending' || !profile.provider_voice_id) return json({ error: 'profile_state_conflict' }, 409);

  const source = await resolveUploadedSource(authId, body.source_key, storage);
  if (!source.ok) return json({ error: source.error }, source.error === 'source_not_found' ? 404 : 400);
  if (!['audio/mpeg', 'audio/wav'].includes(source.contentType)) return json({ error: 'sample_type_invalid' }, 400);
  let media;
  try { media = await fetchWithTimeout(source.url, {}, 60000, limits.maxAudioBytes); }
  catch (err) { return json({ error: err?.status === 413 ? 'sample_size_invalid' : 'source_unavailable' }, err?.status === 413 ? 400 : 502); }
  if (!media.ok) return json({ error: 'source_unavailable' }, 502);
  if (!Number.isFinite(source.seconds) || source.seconds <= 0) return json({ error: 'sample_duration_unavailable' }, 400);
  const bytes = new Uint8Array(await media.arrayBuffer());
  let result;
  try { result = await addPvcSample({ voiceId: profile.provider_voice_id, bytes, contentType: source.contentType }, provider); }
  catch (err) { console.error('[voice-profiles] sample upload failed:', err?.name); result = { ok: false, status: 502, code: 'provider_unavailable' }; }
  if (!result.ok) return json({ error: result.code }, providerErrorStatus(result), result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {});
  const recorded = await rpc('voice_profile_record_sample', {
    p_auth_id: authId, p_profile_id: profileId, p_provider_sample_id: result.sample.id,
    p_duration_seconds: result.sample.durationSeconds || source.seconds,
  }, cfg);
  if (recorded?.ok !== true) return json({ error: 'profile_state_conflict' }, 409);
  const deleted = await deleteObject(body.source_key, storage);
  if (!deleted.ok) console.error('[voice-profiles] transferred source cleanup failed');
  return json({ sample: result.sample, status: 'samples_pending', sample_count: recorded.sample_count,
    sample_seconds: recorded.sample_seconds, minimum_reached: recorded.minimum_reached }, 201);
}
