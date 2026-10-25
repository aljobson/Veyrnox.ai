/** Owner-only verified voice profiles. No provider handle is returned here. */
import { NextResponse } from 'next/server';
import { envConfig as dbConfig, rpc } from '../../../../packages/db/supabase-client.js';
import { createPvc, deleteVoice, envConfig as elevenConfig, isConfigured } from '../../../../packages/adapters/elevenlabs.js';
import { envConfig as r2Config, isConfigured as r2Configured } from '../../../../packages/adapters/r2.js';
import { UUID_RE, VOICE_CONSENT_VERSION, publicProfile, providerErrorStatus, recentMfa, validCreateBody } from '../../../../lib/voiceProfiles.js';
import { voiceSpeechEnabled } from '../../../../lib/voiceSpeech.js';

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200, headers = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });

function identity(req) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  return authId && UUID_RE.test(authId) ? authId : null;
}

export async function GET(req) {
  const authId = identity(req);
  if (!authId) return json({ error: 'not_authenticated' }, 401);
  const cfg = dbConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'gateway_not_configured' }, 503);
  try {
    const result = await rpc('list_voice_profiles', { p_auth_id: authId }, cfg);
    if (result?.ok !== true) return json({ error: 'profiles_unavailable' }, 502);
    return json({
      available: isConfigured(elevenConfig()),
      speech_available: voiceSpeechEnabled() && isConfigured(elevenConfig()) && r2Configured(r2Config()),
      profiles: Array.isArray(result.profiles) ? result.profiles.map(publicProfile).filter(Boolean) : [],
    });
  } catch (err) {
    console.error('[voice-profiles] list failed:', err?.name);
    return json({ error: 'profiles_unavailable' }, 502);
  }
}

export async function POST(req) {
  const authId = identity(req);
  if (!authId) return json({ error: 'not_authenticated' }, 401);
  const mfaAt = recentMfa(req);
  if (mfaAt === null) return json({ error: 'recent_mfa_required' }, 403);
  const cfg = dbConfig();
  const provider = elevenConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(provider)) return json({ error: 'voice_provider_not_configured' }, 503);
  let raw;
  try { raw = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const body = validCreateBody(raw);
  if (!body) return json({ error: 'owner_attestation_required' }, 400);

  let created;
  try {
    created = await rpc('create_voice_profile', {
      p_auth_id: authId, p_name: body.name, p_language: body.language,
      p_consent_version: VOICE_CONSENT_VERSION, p_aal: 'aal2', p_mfa_at: mfaAt,
    }, cfg);
  } catch (err) {
    console.error('[voice-profiles] local create failed:', err?.name);
    return json({ error: 'profile_create_unavailable' }, 502);
  }
  if (created?.ok !== true) {
    const code = String(created?.code || '').toLowerCase();
    return json({ error: code || 'profile_create_rejected' }, code === 'profile_limit' ? 409 : code === 'account_frozen' ? 403 : 400);
  }
  const profileId = created.profile_id;

  let upstream;
  try {
    upstream = await createPvc({ name: body.name, language: body.language, description: 'Owner-verified Veyrnox voice profile' }, provider);
  } catch (err) {
    console.error('[voice-profiles] provider create transport failed:', err?.name);
    upstream = { ok: false, code: 'provider_unavailable', status: 502 };
  }
  if (!upstream.ok) {
    try { await rpc('voice_profile_transition', { p_auth_id: authId, p_profile_id: profileId, p_next: 'failed', p_error_code: upstream.code }, cfg); } catch { /* profile remains unusable */ }
    return json({ error: upstream.code }, providerErrorStatus(upstream), upstream.retryAfter ? { 'Retry-After': String(upstream.retryAfter) } : {});
  }

  let attached;
  try {
    attached = await rpc('voice_profile_set_provider', { p_auth_id: authId, p_profile_id: profileId, p_provider_voice_id: upstream.voiceId }, cfg);
  } catch (err) {
    console.error('[voice-profiles] provider handle attach failed:', err?.name);
  }
  if (attached?.ok !== true) {
    try { await deleteVoice(upstream.voiceId, provider); } catch { /* operator reconciliation required */ }
    try { await rpc('voice_profile_transition', { p_auth_id: authId, p_profile_id: profileId, p_next: 'failed', p_error_code: 'local_attach_failed' }, cfg); } catch { /* unusable either way */ }
    return json({ error: 'profile_create_unavailable' }, 502);
  }
  return json({ profile: { id: profileId, name: body.name, language: body.language, status: 'samples_pending' } }, 201);
}
