export const VERIFIED_VOICE_TTS_MODEL = 'verified-voice-tts';
export const VERIFIED_VOICE_TTS_PROVIDER = 'elevenlabs';
export const VERIFIED_VOICE_TTS_MAX_CHARS = 1000;
export const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function validVoiceSpeechBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const key = body.idempotency_key;
  if (!text || text.length > VERIFIED_VOICE_TTS_MAX_CHARS
      || typeof key !== 'string' || !IDEMPOTENCY_RE.test(key)) return null;
  return { text, idempotencyKey: key };
}

export function voiceSpeechEnabled(env = process.env) {
  return env.VERIFIED_VOICE_TTS_ENABLED === 'true';
}
