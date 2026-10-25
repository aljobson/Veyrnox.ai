import { NextResponse } from 'next/server';
import { envConfig as dbConfig, rpc, select } from '../../../../../../packages/db/supabase-client.js';
import { envConfig as elevenConfig, isConfigured as elevenConfigured, synthesizeSpeech } from '../../../../../../packages/adapters/elevenlabs.js';
import { envConfig as r2Config, isConfigured as r2Configured, putObject, sha256Hex } from '../../../../../../packages/adapters/r2.js';
import { recordSubmittedJob, unknownSubmitResponse } from '../../../../../../lib/submitRejection.js';
import { UUID_RE, providerErrorStatus } from '../../../../../../lib/voiceProfiles.js';
import { VERIFIED_VOICE_TTS_MODEL, VERIFIED_VOICE_TTS_PROVIDER, validVoiceSpeechBody, voiceSpeechEnabled } from '../../../../../../lib/voiceSpeech.js';

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200, headers = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 60;

async function failAndRefund({ jobId, userId, credits, code, cfg }) {
  let failed;
  try {
    failed = await rpc('job_failed', {
      p_provider_job_id: jobId, p_provider: VERIFIED_VOICE_TTS_PROVIDER,
      p_error_code: String(code || 'provider_error').slice(0, 64),
    }, cfg);
  } catch (err) {
    console.error('[voice-speech] job failure transition unavailable:', err?.name);
    return false;
  }
  if (failed?.ok !== true) return false;
  try {
    const refunded = await rpc('ledger_refund', {
      p_job_id: jobId, p_user_id: userId, p_credits: credits, p_reason: 'refund:provider_failed',
    }, cfg);
    return refunded?.ok === true;
  } catch (err) {
    console.error('[voice-speech] refund unavailable:', err?.name);
    return false;
  }
}

export async function POST(req, { params }) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  if (!authId || !UUID_RE.test(authId)) return json({ error: 'not_authenticated' }, 401);
  const { profileId } = await params;
  if (!UUID_RE.test(profileId)) return json({ error: 'not_found' }, 404);

  let raw;
  try { raw = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const body = validVoiceSpeechBody(raw);
  if (!body) return json({ error: 'speech_request_invalid' }, 400);

  const cfg = dbConfig(), provider = elevenConfig(), r2cfg = r2Config();
  if (!voiceSpeechEnabled() || !cfg.supabaseUrl || !cfg.serviceRoleKey
      || !elevenConfigured(provider) || !r2Configured(r2cfg)) {
    return json({ error: 'voice_speech_not_configured' }, 503);
  }

  let profile, user, model;
  try {
    [profile, user, model] = await Promise.all([
      rpc('get_voice_profile', { p_auth_id: authId, p_profile_id: profileId }, cfg),
      select('users', { columns: 'id', filter: `auth_id=eq.${encodeURIComponent(authId)}`, limit: 1 }, cfg),
      select('model_catalog', { columns: 'id,credits_5s,provider,provider_endpoint', filter: `id=eq.${VERIFIED_VOICE_TTS_MODEL}`, limit: 1 }, cfg),
    ]);
  } catch (err) {
    console.error('[voice-speech] eligibility lookup failed:', err?.name);
    return json({ error: 'voice_speech_unavailable' }, 502);
  }
  const userId = Array.isArray(user) && user[0]?.id;
  const price = Array.isArray(model) && model[0];
  if (profile?.ok !== true || !userId) return json({ error: 'not_found' }, 404);
  if (profile.status !== 'ready' || !profile.provider_voice_id) return json({ error: 'voice_not_ready' }, 409);
  if (!price || price.provider !== VERIFIED_VOICE_TTS_PROVIDER
      || price.provider_endpoint !== 'elevenlabs/text-to-speech/eleven_multilingual_v2'
      || !Number.isInteger(price.credits_5s) || price.credits_5s < 1) {
    return json({ error: 'voice_speech_unavailable' }, 503);
  }
  const credits = price.credits_5s;

  let debit;
  try {
    debit = await rpc('ledger_debit', {
      p_user_id: userId,
      p_idempotency_key: body.idempotencyKey,
      p_credits: credits,
      p_reason: 'debit:generation',
      p_model_id: VERIFIED_VOICE_TTS_MODEL,
      p_inputs: { profile_id: profileId, text: body.text },
      p_limit_per_window: RATE_LIMIT,
      p_window_seconds: RATE_WINDOW_SECONDS,
    }, cfg);
  } catch (err) {
    console.error('[voice-speech] debit failed:', err?.name);
    return json({ error: 'debit_failed' }, 502);
  }
  if (debit?.ok !== true) {
    const code = String(debit?.code || 'debit_rejected').toLowerCase();
    return json({ error: code }, code === 'insufficient_balance' ? 402
      : ['account_frozen', 'account_on_hold'].includes(code) ? 403
        : code === 'rate_limited' ? 429 : 400,
    code === 'rate_limited' ? { 'Retry-After': String(Math.max(1, Number(debit.retry_after_seconds) || 60)) } : {});
  }
  const jobId = debit.job_id;
  if (debit.idempotent) return json({ job_id: jobId, idempotent: true, balance_after: debit.balance_after });

  // Persist the paid-provider boundary before sending text upstream. A lost
  // provider acknowledgement must never cause an automatic duplicate call.
  const submitted = await recordSubmittedJob({
    jobId, provider: VERIFIED_VOICE_TTS_PROVIDER, providerJobId: jobId,
  }, cfg);
  if (!submitted) return unknownSubmitResponse(jobId, cfg);

  let speech;
  try { speech = await synthesizeSpeech({ voiceId: profile.provider_voice_id, text: body.text }, provider); }
  catch (err) {
    console.error('[voice-speech] provider outcome unknown:', err?.name);
    return json({ error: 'outcome_unknown', job_id: jobId }, 503);
  }
  if (!speech.ok) {
    const refunded = await failAndRefund({ jobId, userId, credits, code: speech.code, cfg });
    return json({ error: speech.code, job_id: jobId, refunded }, providerErrorStatus(speech),
      speech.retryAfter ? { 'Retry-After': String(speech.retryAfter) } : {});
  }

  const key = `elevenlabs/${jobId}/speech.mp3`;
  const hash = await sha256Hex(speech.bytes);
  const storedObject = await putObject(key, speech.bytes, speech.contentType, r2cfg, { onlyIfAbsent: true });
  if (!storedObject.ok && storedObject.status !== 412) {
    console.error('[voice-speech] R2 store failed:', storedObject.error);
    return json({ error: 'asset_store_failed', job_id: jobId }, 503);
  }
  try {
    const succeeded = await rpc('job_succeeded', { p_provider_job_id: jobId, p_provider: VERIFIED_VOICE_TTS_PROVIDER }, cfg);
    if (succeeded?.ok !== true) return json({ error: 'job_settlement_failed', job_id: jobId }, 503);
    const completed = await rpc('job_stored', {
      p_provider_job_id: jobId, p_provider: VERIFIED_VOICE_TTS_PROVIDER,
      p_r2_key: key, p_mime_type: speech.contentType, p_size_bytes: speech.bytes.byteLength, p_sha256: hash,
    }, cfg);
    if (completed?.ok !== true) return json({ error: 'job_settlement_failed', job_id: jobId }, 503);
  } catch (err) {
    console.error('[voice-speech] settlement unavailable:', err?.name);
    return json({ error: 'job_settlement_failed', job_id: jobId }, 503);
  }
  return json({ job_id: jobId, state: 'STORED', balance_after: debit.balance_after }, 201);
}
