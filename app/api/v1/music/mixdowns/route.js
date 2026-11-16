import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured, presignPutUrl, getObject, sha256Hex } from '../../../../../packages/adapters/r2.js';
import { musicBeatLibrarySaveEnabled, validMusicAuthId, readMusicJson } from '../../../../../lib/musicBackend.js';
import { parseMusicMixdown } from '../../../../../lib/musicMixdown.js';
import { pcmWavSeconds, pcmWavFormat } from '../../../../../lib/musicWavRender.js';
import { readBoundedBody } from '../../../../../lib/boundedBody.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const errors = { NOT_FOUND: 404, ACCOUNT_FROZEN: 403, SOURCE_UNAVAILABLE: 409, IDEMPOTENCY_CONFLICT: 409,
  RESERVATION_CLOSED: 409, RESERVATION_EXPIRED: 409, RATE_LIMITED: 429, INVALID_INPUTS: 400, RIGHTS_REQUIRED: 400 };
const refusal = result => reply({ error: Object.hasOwn(errors, result?.code) ? result.code.toLowerCase() : 'mixdown_unavailable' }, errors[result?.code] || 502);
const safe = r => ({ song_id: r.song_id, version_id: r.version_id, idempotent: r.idempotent === true, committed: r.status === 'committed' || r.committed === true });
export async function POST(request) {
  const authId = request.headers.get('x-veyrnox-auth-id');
  if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
  if (!musicBeatLibrarySaveEnabled()) return reply({ error: 'beat_library_save_unavailable' }, 404);
  const cfg = envConfig(), r2cfg = r2EnvConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(r2cfg)) return reply({ error: 'gateway_not_configured' }, 503);
  const decoded = await readMusicJson(request, 4096);
  if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
  const input = parseMusicMixdown(decoded.value);
  if (!input.ok) return reply({ error: input.error }, 400);
  const binding = { p_auth_id: authId, p_idempotency_key: input.idempotency_key, p_version_id: input.version_id };
  const abandon = () => rpc('music_abandon_mixdown', binding, cfg);
  try {
    const limited = await socialPostWriteLimit(authId, cfg);
    if (limited) return limited;
    if (input.action === 'reserve') {
      const result = await rpc('music_reserve_mixdown', { p_auth_id: authId, p_idempotency_key: input.idempotency_key,
        p_song_id: crypto.randomUUID(), p_version_id: crypto.randomUUID(), p_job_id: crypto.randomUUID(), p_asset_id: crypto.randomUUID(),
        p_title: input.title, p_size_bytes: input.size_bytes, p_sha256: input.sha256, p_duration: input.duration_seconds,
        p_sources: input.sources, p_has_takes: input.has_takes, p_rights_confirmed: input.rights_confirmed }, cfg);
      if (!result?.ok) return refusal(result);
      if (result.status === 'committed') return reply(safe(result));
      // The size-bound signer also signs If-None-Match:*: an upload can never overwrite a committed object.
      // Derive TTL from the stored lease, so RPC/signing latency cannot outlive its cleanup deadline.
      const ttl = Math.min(900, Math.floor((Date.parse(result.upload_expires_at) - Date.now()) / 1000));
      if (ttl < 60) return reply({ error: 'reservation_expired' }, 409);
      const signed = await presignPutUrl(result.r2_key, 'audio/wav', ttl, r2cfg, input.size_bytes);
      return reply({ ...safe(result), upload_url: signed.url, headers: signed.headers }, result.idempotent ? 200 : 201);
    }
    const reserved = await rpc('music_read_mixdown', binding, cfg);
    if (!reserved?.ok) return refusal(reserved);
    if (reserved.status === 'committed') return reply({ ...safe(reserved), idempotent: true });
    const stored = await getObject(reserved.r2_key, r2cfg);
    if (!stored.ok) return reply({ error: 'mixdown_upload_unavailable' }, 502);
    let bytes;
    try { bytes = await readBoundedBody(stored.response.body, Number(reserved.size_bytes), request.signal); }
    catch (error) { if (error?.status !== 413) throw error; await abandon(); return reply({ error: 'mixdown_size_mismatch' }, 409); }
    let error;
    const format = pcmWavFormat(bytes), duration = pcmWavSeconds(bytes);
    if (bytes.byteLength !== Number(reserved.size_bytes)) error = 'mixdown_size_mismatch';
    else if (!format || format.channels !== 2 || format.sampleRate !== 48000 || format.bitsPerSample !== 16) error = 'mixdown_format_invalid';
    else if (duration === null || Math.abs(duration - Number(reserved.duration_seconds)) > 0.05) error = 'mixdown_duration_mismatch';
    const sha256 = await sha256Hex(bytes);
    if (!error && sha256 !== reserved.sha256) error = 'mixdown_bytes_mismatch';
    if (error) { await abandon(); return reply({ error }, 409); }
    const result = await rpc('music_commit_mixdown', { ...binding, p_size_bytes: bytes.byteLength, p_sha256: sha256, p_duration: duration }, cfg);
    if (!result?.ok) {
      if (['ACCOUNT_FROZEN', 'SOURCE_UNAVAILABLE'].includes(result?.code)) await abandon();
      return refusal(result);
    }
    return reply({ ...safe(result), committed: true }, result.idempotent ? 200 : 201);
  } catch {
    // Ambiguous commits and transient failures must keep their immutable object for retry.
    return reply({ error: 'mixdown_unavailable' }, 502);
  }
}
