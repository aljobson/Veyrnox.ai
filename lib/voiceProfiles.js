export const VOICE_CONSENT_VERSION = 'voice-owner-2026-10-25';
// Creator and Pro accounts include one PVC slot. Do not advertise capacity the
// configured provider account may not have; this can be raised with the plan.
export const VOICE_PROFILE_LIMIT = 1;
export const VOICE_SAMPLE_MIN_SECONDS = 30 * 60;
export const VOICE_SAMPLE_MAX_SECONDS = 3 * 60 * 60;
export const VOICE_LANGUAGES = Object.freeze(['en', 'es', 'fr', 'de', 'pt', 'it', 'pl', 'hi', 'ja', 'ko']);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function recentMfa(req, now = Math.floor(Date.now() / 1000)) {
  const raw = req.headers.get('x-veyrnox-auth-mfa-at');
  const at = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return req.headers.get('x-veyrnox-auth-aal') === 'aal2' && Number.isSafeInteger(at)
    && at >= now - 300 && at <= now + 5 ? at : null;
}

export function validCreateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const language = body.language;
  if (!name || name.length > 100 || !VOICE_LANGUAGES.includes(language)
      || body.owner_attestation !== true || body.consent_version !== VOICE_CONSENT_VERSION) return null;
  return { name, language };
}

export function publicProfile(row) {
  if (!row || typeof row !== 'object') return null;
  const { provider_voice_id: _providerVoiceId, ...safe } = row;
  return safe;
}

export function providerErrorStatus(result) {
  if (!result || result.ok !== false) return 502;
  if (result.status === 429) return 429;
  if (result.status === 401 || result.status === 402) return 503;
  if (result.status >= 400 && result.status < 500) return 422;
  return 502;
}
