import { NextResponse } from 'next/server';
import { envConfig as dbConfig, rpc } from '../../../../../packages/db/supabase-client.js';
import { deleteVoice, envConfig as elevenConfig, getVoice, isConfigured } from '../../../../../packages/adapters/elevenlabs.js';
import { UUID_RE, providerErrorStatus, recentMfa } from '../../../../../lib/voiceProfiles.js';

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200, headers = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
const auth = req => { const id = req.headers.get('x-veyrnox-auth-id'); return id && UUID_RE.test(id) ? id : null; };
async function localProfile(authId, profileId, cfg) {
  if (!UUID_RE.test(profileId)) return null;
  const row = await rpc('get_voice_profile', { p_auth_id: authId, p_profile_id: profileId }, cfg);
  return row?.ok === true ? row : null;
}

export async function GET(req, { params }) {
  const authId = auth(req);
  if (!authId) return json({ error: 'not_authenticated' }, 401);
  const { profileId } = await params;
  const cfg = dbConfig(), provider = elevenConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(provider)) return json({ error: 'voice_provider_not_configured' }, 503);
  let profile;
  try { profile = await localProfile(authId, profileId, cfg); } catch { return json({ error: 'profile_unavailable' }, 502); }
  if (!profile) return json({ error: 'not_found' }, 404);
  if (!profile.provider_voice_id || ['revoking', 'revoked'].includes(profile.status)) {
    return json({ profile: { id: profile.id, name: profile.name, language: profile.language, status: profile.status, error_code: profile.error_code || null } });
  }
  let result;
  try { result = await getVoice(profile.provider_voice_id, provider); }
  catch (err) { console.error('[voice-profiles] provider status failed:', err?.name); return json({ error: 'provider_unavailable' }, 502); }
  if (!result.ok) return json({ error: result.code }, providerErrorStatus(result), result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {});
  if (!result.voice.owned) {
    try { await rpc('voice_profile_transition', { p_auth_id: authId, p_profile_id: profileId, p_next: 'failed', p_error_code: 'provider_ownership_failed' }, cfg); } catch { /* remains unusable */ }
    return json({ error: 'provider_ownership_failed' }, 409);
  }
  if (profile.status === 'training' && result.voice.verified && result.voice.state === 'fine_tuned') {
    const moved = await rpc('voice_profile_transition', { p_auth_id: authId, p_profile_id: profileId, p_next: 'ready', p_error_code: null }, cfg);
    if (moved?.ok === true) profile.status = 'ready';
  } else if (profile.status === 'training' && result.voice.state === 'failed') {
    await rpc('voice_profile_transition', { p_auth_id: authId, p_profile_id: profileId, p_next: 'failed', p_error_code: 'provider_training_failed' }, cfg);
    profile.status = 'failed'; profile.error_code = 'provider_training_failed';
  }
  return json({ profile: { id: profile.id, name: profile.name, language: profile.language, status: profile.status, error_code: profile.error_code || null } });
}

export async function DELETE(req, { params }) {
  const authId = auth(req);
  if (!authId) return json({ error: 'not_authenticated' }, 401);
  const mfaAt = recentMfa(req);
  if (mfaAt === null) return json({ error: 'recent_mfa_required' }, 403);
  const { profileId } = await params;
  if (!UUID_RE.test(profileId)) return json({ error: 'not_found' }, 404);
  const cfg = dbConfig(), provider = elevenConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(provider)) return json({ error: 'voice_provider_not_configured' }, 503);
  let started;
  try { started = await rpc('voice_profile_start_revoke', { p_auth_id: authId, p_profile_id: profileId, p_aal: 'aal2', p_mfa_at: mfaAt }, cfg); }
  catch { return json({ error: 'revocation_unavailable' }, 502); }
  if (started?.ok !== true) return json({ error: String(started?.code || 'revocation_rejected').toLowerCase() }, started?.code === 'NOT_FOUND' ? 404 : 409);
  if (started.replayed === true) return json({ revoked: true, replayed: true });
  if (started.provider_voice_id) {
    let removed;
    try { removed = await deleteVoice(started.provider_voice_id, provider); }
    catch (err) { console.error('[voice-profiles] provider delete failed:', err?.name); removed = { ok: false, code: 'provider_unavailable', status: 502 }; }
    if (!removed.ok) return json({ error: 'revocation_pending' }, providerErrorStatus(removed), removed.retryAfter ? { 'Retry-After': String(removed.retryAfter) } : {});
  }
  const finished = await rpc('voice_profile_finish_revoke', { p_auth_id: authId, p_profile_id: profileId }, cfg);
  if (finished?.ok !== true) return json({ error: 'revocation_unavailable' }, 502);
  return json({ revoked: true, replayed: false });
}
