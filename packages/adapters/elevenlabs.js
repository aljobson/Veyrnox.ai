/**
 * ElevenLabs Professional Voice Clone (PVC) boundary.
 *
 * This module is server-only. It deliberately exposes PVC rather than the
 * instant-clone endpoint: a professional clone must pass ElevenLabs' live
 * voice CAPTCHA before it can train, which is the ownership proof Veyrnox
 * requires. Callers remain responsible for recent AAL2, recorded consent,
 * per-user ownership and local lifecycle state.
 */
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js';

const API = 'https://api.elevenlabs.io';
const JSON_TIMEOUT_MS = 15000;
const MEDIA_TIMEOUT_MS = 60000;
const MAX_JSON_BYTES = 512 * 1024;
const MAX_CAPTCHA_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_SPEECH_BYTES = 20 * 1024 * 1024;
const MAX_SPEECH_CHARS = 1000;
const VOICE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const LANG_RE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

export function envConfig(env = process.env) {
  return { apiKey: env.ELEVENLABS_API_KEY };
}

export function isConfigured(cfg) {
  return Boolean(cfg?.apiKey && typeof cfg.apiKey === 'string');
}

function voicePath(voiceId, suffix = '') {
  if (typeof voiceId !== 'string' || !VOICE_ID_RE.test(voiceId)) throw new TypeError('voice_id_invalid');
  return `/v1/voices/${suffix ? `pvc/${voiceId}/${suffix}` : voiceId}`;
}

function headers(cfg, extra = {}) {
  if (!isConfigured(cfg)) throw new TypeError('elevenlabs_not_configured');
  return { 'xi-api-key': cfg.apiKey, ...extra };
}

async function request(path, init, cfg, { timeout = JSON_TIMEOUT_MS, maxBytes = MAX_JSON_BYTES, fetchCall = fetchWithTimeout } = {}) {
  const response = await fetchCall(new URL(path, API), {
    ...init,
    headers: headers(cfg, init?.headers),
  }, timeout, maxBytes);
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after'));
    return {
      ok: false,
      status: response.status,
      code: response.status === 401 ? 'provider_auth'
        : response.status === 402 ? 'provider_payment'
          : response.status === 409 ? 'provider_conflict'
            : response.status === 429 ? 'provider_rate_limited'
              : response.status >= 500 ? 'provider_unavailable' : 'provider_rejected',
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter: Math.min(3600, Math.ceil(retryAfter)) } : {}),
    };
  }
  return { ok: true, response };
}

async function jsonResult(result) {
  if (!result.ok) return result;
  try { return { ok: true, data: await result.response.json() }; }
  catch { return { ok: false, status: 502, code: 'provider_response_invalid' }; }
}

function imageType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

function decodeCaptcha(bytes, contentType) {
  const directType = imageType(bytes);
  if (directType) return { ok: true, bytes, contentType: directType };
  if (!String(contentType).toLowerCase().includes('json')) return { ok: false, status: 502, code: 'provider_response_invalid' };
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    const encoded = typeof parsed === 'string' ? parsed
      : typeof parsed?.captcha === 'string' ? parsed.captcha
        : typeof parsed?.image === 'string' ? parsed.image
          : typeof parsed?.data === 'string' ? parsed.data : '';
    const payload = encoded.replace(/^data:image\/(?:png|jpeg);base64,/, '');
    if (!payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) throw new Error('captcha_not_base64');
    const decoded = Uint8Array.from(Buffer.from(payload, 'base64'));
    const decodedType = imageType(decoded);
    return decodedType ? { ok: true, bytes: decoded, contentType: decodedType }
      : { ok: false, status: 502, code: 'provider_response_invalid' };
  } catch {
    return { ok: false, status: 502, code: 'provider_response_invalid' };
  }
}

export async function createPvc({ name, language, description }, cfg, deps) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanDescription = typeof description === 'string' ? description.trim() : '';
  if (!cleanName || cleanName.length > 100) return { ok: false, status: 400, code: 'name_invalid' };
  if (typeof language !== 'string' || !LANG_RE.test(language)) return { ok: false, status: 400, code: 'language_invalid' };
  if (cleanDescription.length > 500) return { ok: false, status: 400, code: 'description_invalid' };
  const result = await jsonResult(await request('/v1/voices/pvc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: cleanName, language, ...(cleanDescription ? { description: cleanDescription } : {}) }),
  }, cfg, deps));
  const voiceId = result.ok && result.data?.voice_id;
  return result.ok && typeof voiceId === 'string' && VOICE_ID_RE.test(voiceId)
    ? { ok: true, voiceId }
    : result.ok ? { ok: false, status: 502, code: 'provider_response_invalid' } : result;
}

export async function addPvcSample({ voiceId, bytes, contentType, filename = 'sample' }, cfg, deps) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_AUDIO_BYTES) {
    return { ok: false, status: 400, code: 'sample_size_invalid' };
  }
  if (!['audio/mpeg', 'audio/wav'].includes(contentType)) return { ok: false, status: 400, code: 'sample_type_invalid' };
  const safeName = String(filename).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'sample';
  const form = new FormData();
  form.append('files', new Blob([bytes], { type: contentType }), safeName);
  const result = await jsonResult(await request(voicePath(voiceId, 'samples'), { method: 'POST', body: form }, cfg, {
    timeout: MEDIA_TIMEOUT_MS, maxBytes: MAX_JSON_BYTES, ...deps,
  }));
  if (!result.ok) return result;
  const sample = Array.isArray(result.data) ? result.data[0] : null;
  return typeof sample?.sample_id === 'string'
    ? { ok: true, sample: { id: sample.sample_id, durationSeconds: Number(sample.duration_secs) || null } }
    : { ok: false, status: 502, code: 'provider_response_invalid' };
}

export async function getPvcCaptcha(voiceId, cfg, deps) {
  const result = await request(voicePath(voiceId, 'captcha'), { method: 'GET' }, cfg, {
    timeout: JSON_TIMEOUT_MS, maxBytes: MAX_CAPTCHA_BYTES, ...deps,
  });
  if (!result.ok) return result;
  const contentType = result.response.headers.get('content-type') || 'application/octet-stream';
  const bytes = new Uint8Array(await result.response.arrayBuffer());
  if (!bytes.byteLength) return { ok: false, status: 502, code: 'provider_response_invalid' };
  return decodeCaptcha(bytes, contentType);
}

export async function verifyPvcCaptcha({ voiceId, bytes, contentType }, cfg, deps) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_AUDIO_BYTES) {
    return { ok: false, status: 400, code: 'verification_size_invalid' };
  }
  if (!['audio/mpeg', 'audio/wav'].includes(contentType)) return { ok: false, status: 400, code: 'verification_type_invalid' };
  const form = new FormData();
  form.append('recording', new Blob([bytes], { type: contentType }), contentType === 'audio/wav' ? 'verification.wav' : 'verification.mp3');
  const result = await jsonResult(await request(voicePath(voiceId, 'captcha'), { method: 'POST', body: form }, cfg, {
    timeout: MEDIA_TIMEOUT_MS, maxBytes: MAX_JSON_BYTES, ...deps,
  }));
  return result.ok && result.data?.status === 'ok'
    ? { ok: true }
    : result.ok ? { ok: false, status: 502, code: 'provider_response_invalid' } : result;
}

export async function trainPvc(voiceId, cfg, deps) {
  const result = await jsonResult(await request(voicePath(voiceId, 'train'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model_id: 'eleven_multilingual_v2' }),
  }, cfg, { timeout: MEDIA_TIMEOUT_MS, ...deps }));
  return result.ok && result.data?.status === 'ok'
    ? { ok: true }
    : result.ok ? { ok: false, status: 502, code: 'provider_response_invalid' } : result;
}

export async function getVoice(voiceId, cfg, deps) {
  const result = await jsonResult(await request(voicePath(voiceId), { method: 'GET' }, cfg, deps));
  if (!result.ok) return result;
  const voice = result.data;
  if (voice?.voice_id !== voiceId) return { ok: false, status: 502, code: 'provider_response_invalid' };
  const state = voice.fine_tuning?.state?.eleven_multilingual_v2 || null;
  return {
    ok: true,
    voice: {
      id: voiceId,
      owned: voice.is_owner === true,
      verified: voice.voice_verification?.is_verified === true,
      requiresVerification: voice.voice_verification?.requires_verification !== false,
      state: typeof state === 'string' ? state : null,
    },
  };
}

export async function deleteVoice(voiceId, cfg, deps) {
  const result = await jsonResult(await request(voicePath(voiceId), { method: 'DELETE' }, cfg, deps));
  // Provider deletion is part of a retryable revocation workflow. A missing
  // provider copy is already the desired terminal state.
  if (!result.ok && result.status === 404) return { ok: true, replayed: true };
  return result.ok && result.data?.status === 'ok'
    ? { ok: true }
    : result.ok ? { ok: false, status: 502, code: 'provider_response_invalid' } : result;
}

/**
 * Render speech with a private, already verified PVC. The voice id remains a
 * server-side value throughout; callers receive only bounded audio bytes.
 */
export async function synthesizeSpeech({ voiceId, text }, cfg, deps) {
  if (typeof voiceId !== 'string' || !VOICE_ID_RE.test(voiceId)) {
    return { ok: false, status: 400, code: 'voice_id_invalid' };
  }
  const cleanText = typeof text === 'string' ? text.trim() : '';
  if (!cleanText || cleanText.length > MAX_SPEECH_CHARS) {
    return { ok: false, status: 400, code: 'speech_text_invalid' };
  }
  const result = await request(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { accept: 'audio/mpeg', 'content-type': 'application/json' },
    body: JSON.stringify({ text: cleanText, model_id: 'eleven_multilingual_v2' }),
  }, cfg, { timeout: MEDIA_TIMEOUT_MS, maxBytes: MAX_SPEECH_BYTES, ...deps });
  if (!result.ok) return result;
  const contentType = String(result.response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const bytes = new Uint8Array(await result.response.arrayBuffer());
  if (contentType !== 'audio/mpeg' || !bytes.byteLength || bytes.byteLength > MAX_SPEECH_BYTES) {
    return { ok: false, status: 502, code: 'provider_response_invalid' };
  }
  return { ok: true, bytes, contentType: 'audio/mpeg' };
}

export const limits = Object.freeze({
  maxAudioBytes: MAX_AUDIO_BYTES,
  maxCaptchaBytes: MAX_CAPTCHA_BYTES,
  maxSpeechBytes: MAX_SPEECH_BYTES,
  maxSpeechChars: MAX_SPEECH_CHARS,
});
