import { NextResponse } from 'next/server';
import { envConfig as dbConfig, rpc } from '../../../../../../packages/db/supabase-client.js';
import { envConfig as elevenConfig, getPvcCaptcha, isConfigured, limits, trainPvc, verifyPvcCaptcha } from '../../../../../../packages/adapters/elevenlabs.js';
import { deleteObject, envConfig as r2Config, isConfigured as r2Configured } from '../../../../../../packages/adapters/r2.js';
import { fetchWithTimeout } from '../../../../../../lib/fetchWithTimeout.js';
import { resolveUploadedSource } from '../../../../../../lib/resolveSource.js';
import { UUID_RE, VOICE_SAMPLE_MIN_SECONDS, providerErrorStatus, recentMfa } from '../../../../../../lib/voiceProfiles.js';

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200, headers = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
async function context(req, params, allowedStates = ['verification_pending']) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  const mfaAt = recentMfa(req);
  const { profileId } = await params;
  if (!authId || !UUID_RE.test(authId)) return { response: json({ error: 'not_authenticated' }, 401) };
  if (mfaAt === null) return { response: json({ error: 'recent_mfa_required' }, 403) };
  if (!UUID_RE.test(profileId)) return { response: json({ error: 'not_found' }, 404) };
  const cfg = dbConfig(), provider = elevenConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(provider)) return { response: json({ error: 'voice_provider_not_configured' }, 503) };
  let profile;
  try { profile = await rpc('get_voice_profile', { p_auth_id: authId, p_profile_id: profileId }, cfg); }
  catch { return { response: json({ error: 'profile_unavailable' }, 502) }; }
  if (profile?.ok !== true) return { response: json({ error: 'not_found' }, 404) };
  if (!allowedStates.includes(profile.status) || !profile.provider_voice_id) return { response: json({ error: 'profile_state_conflict' }, 409) };
  return { authId, mfaAt, profileId, profile, cfg, provider };
}

export async function GET(req, { params }) {
  const ctx = await context(req, params, ['samples_pending', 'verification_pending']);
  if (ctx.response) return ctx.response;
  if (Number(ctx.profile.sample_seconds) < VOICE_SAMPLE_MIN_SECONDS) return json({ error: 'sample_minimum_not_reached', minimum_seconds: VOICE_SAMPLE_MIN_SECONDS }, 409);
  let result;
  try { result = await getPvcCaptcha(ctx.profile.provider_voice_id, ctx.provider); }
  catch (err) { console.error('[voice-profiles] captcha read failed:', err?.name); result = { ok: false, status: 502, code: 'provider_unavailable' }; }
  if (!result.ok) return json({ error: result.code }, providerErrorStatus(result), result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {});
  if (ctx.profile.status === 'samples_pending') {
    const moved = await rpc('voice_profile_transition', { p_auth_id: ctx.authId, p_profile_id: ctx.profileId, p_next: 'verification_pending', p_error_code: null }, ctx.cfg);
    if (moved?.ok !== true) return json({ error: 'profile_state_conflict' }, 409);
  }
  return new NextResponse(result.bytes, { headers: { ...NO_STORE, 'Content-Type': result.contentType } });
}

export async function POST(req, { params }) {
  const ctx = await context(req, params);
  if (ctx.response) return ctx.response;
  const storage = r2Config();
  if (!r2Configured(storage)) return json({ error: 'storage_not_configured' }, 503);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (typeof body?.source_key !== 'string') return json({ error: 'source_key_required' }, 400);
  const source = await resolveUploadedSource(ctx.authId, body.source_key, storage);
  if (!source.ok) return json({ error: source.error }, source.error === 'source_not_found' ? 404 : 400);
  if (!['audio/mpeg', 'audio/wav'].includes(source.contentType)) return json({ error: 'verification_type_invalid' }, 400);
  let media;
  try { media = await fetchWithTimeout(source.url, {}, 60000, limits.maxAudioBytes); }
  catch (err) { return json({ error: err?.status === 413 ? 'verification_size_invalid' : 'source_unavailable' }, err?.status === 413 ? 400 : 502); }
  if (!media.ok) return json({ error: 'source_unavailable' }, 502);
  const bytes = new Uint8Array(await media.arrayBuffer());
  let verified;
  try { verified = await verifyPvcCaptcha({ voiceId: ctx.profile.provider_voice_id, bytes, contentType: source.contentType }, ctx.provider); }
  catch (err) { console.error('[voice-profiles] captcha verify failed:', err?.name); verified = { ok: false, status: 502, code: 'provider_unavailable' }; }
  if (!verified.ok) return json({ error: verified.code }, providerErrorStatus(verified), verified.retryAfter ? { 'Retry-After': String(verified.retryAfter) } : {});
  const moved = await rpc('voice_profile_transition', { p_auth_id: ctx.authId, p_profile_id: ctx.profileId, p_next: 'training', p_error_code: null }, ctx.cfg);
  if (moved?.ok !== true) return json({ error: 'profile_state_conflict' }, 409);
  let trained;
  try { trained = await trainPvc(ctx.profile.provider_voice_id, ctx.provider); }
  catch (err) { console.error('[voice-profiles] training start failed:', err?.name); trained = { ok: false, status: 502, code: 'provider_unavailable' }; }
  if (!trained.ok) {
    try { await rpc('voice_profile_transition', { p_auth_id: ctx.authId, p_profile_id: ctx.profileId, p_next: 'failed', p_error_code: trained.code }, ctx.cfg); } catch { /* remains non-ready */ }
    return json({ error: trained.code }, providerErrorStatus(trained), trained.retryAfter ? { 'Retry-After': String(trained.retryAfter) } : {});
  }
  const deleted = await deleteObject(body.source_key, storage);
  if (!deleted.ok) console.error('[voice-profiles] verification source cleanup failed');
  return json({ status: 'training' }, 202);
}
