import { readBoundedBody } from './boundedBody.js';
import { wavSeconds, mp3Seconds } from './mediaLength.js';
import {
    issueMusicInspirationReceipt, MUSIC_INSPIRATION_AUDIO_MAX_BYTES, MUSIC_INSPIRATION_AUDIO_MAX_SECONDS,
    MUSIC_INSPIRATION_IMAGE_MAX_BYTES, MUSIC_INSPIRATION_RECEIPT_TTL_SECONDS, musicInspirationKindReady,
    musicInspirationReady, parseMusicInspirationRequest, sha256Hex,
} from './musicInspiration.js';
import { checkSniffed, ownsUploadKey, requireImageDimensions, typeForKey } from './uploadSource.js';
import { readMusicJson, validMusicAuthId } from './musicBackend.js';
import { analyzeAudioInspiration } from '../packages/adapters/openrouterAudioInspiration.js';
import { analyzeImageInspiration } from '../packages/adapters/openrouterImageInspiration.js';
import { InspirationProviderError } from '../packages/adapters/inspirationProviderError.js';
import { getObject, envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../packages/adapters/r2.js';
import { envConfig, rpc, select } from '../packages/db/supabase-client.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const providerStatuses = { provider_rate_limited: 429, provider_payment_required: 503, provider_auth_failed: 503,
    provider_timeout: 504, provider_request_rejected: 502, provider_response_invalid: 502, provider_error: 502 };
const LEASE_SECONDS = 90;
const PERMANENT_PROVIDER_ERRORS = new Set(['provider_request_rejected', 'provider_response_invalid', 'provider_model_unmapped', 'provider_not_configured']);

function replay(result) {
    if (result?.status === 'completed' && result.safe === false) return reply({ error: 'source_not_allowed' }, 422);
    if (result?.status === 'completed') return reply({
        analysis_id: result.id, brief: result.brief, tags: result.tags, receipt: result.receipt,
        expires_at: result.expires_at, idempotent: true,
    });
    if (result?.status === 'failed_permanent') return reply({ error: result.error_code || 'source_invalid' }, 400);
    if (result?.code === 'IN_PROGRESS') return reply({ error: 'in_progress' }, 409);
    return null;
}

export function musicInspirationHandler({ env = process.env, dbcfg = envConfig(), r2cfg = r2EnvConfig(), call = rpc,
    find = select, load = getObject, analyze, analyzeAudio = analyzeAudioInspiration, analyzeImage = analyzeImageInspiration,
    now = Date.now } = {}) {
    const db = (name, args) => call(name, args, dbcfg);
    return async function POST(request) {
        const authId = request.headers.get('x-veyrnox-auth-id');
        if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
        if (!musicInspirationReady(env)) return reply({ error: 'music_inspiration_unavailable' }, 404);
        if (!dbcfg.supabaseUrl || !dbcfg.serviceRoleKey || !r2IsConfigured(r2cfg)) return reply({ error: 'gateway_not_configured' }, 503);
        const decoded = await readMusicJson(request, 2048);
        if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
        const input = parseMusicInspirationRequest(decoded.value);
        if (!input.ok) return reply({ error: input.error }, 400);
        if (!musicInspirationKindReady(env, input.kind)) return reply({ error: 'music_inspiration_unavailable' }, 404);
        if (!ownsUploadKey(authId, input.key)) return reply({ error: 'source_not_found' }, 404);
        const declared = typeForKey(input.key)?.contentType;
        const allowed = input.kind === 'audio' ? ['audio/mpeg', 'audio/wav'] : ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowed.includes(declared)) return reply({ error: 'source_not_supported' }, 400);
        try {
            const existing = await db('music_inspiration_by_key', { p_auth_id: authId, p_idempotency_key: input.idempotencyKey, p_upload_key: input.key });
            const prior = replay(existing); if (prior) return prior;
            if (existing?.ok === false && existing.code !== 'NOT_FOUND') return reply({ error: String(existing.code).toLowerCase() }, 409);
        } catch { return reply({ error: 'request_unavailable' }, 503); }

        let reservation;
        try {
            const rows = await find('upload_reservations', { columns: 'r2_key,size_bytes',
                filter: `r2_key=eq.${encodeURIComponent(input.key)}&limit=1` }, dbcfg);
            reservation = rows?.[0];
        } catch { return reply({ error: 'source_check_unavailable' }, 503); }
        const expectedSize = Number(reservation?.size_bytes);
        if (reservation?.r2_key !== input.key || !Number.isSafeInteger(expectedSize) || expectedSize <= 0) {
            return reply({ error: 'source_not_found' }, 404);
        }
        const maxBytes = input.kind === 'audio' ? MUSIC_INSPIRATION_AUDIO_MAX_BYTES : MUSIC_INSPIRATION_IMAGE_MAX_BYTES;
        if (expectedSize > maxBytes) return reply({ error: 'source_too_large' }, 400);

        let stored, bytes;
        try {
            const sourceTimeout = AbortSignal.timeout(20_000);
            const sourceSignal = request.signal ? AbortSignal.any([request.signal, sourceTimeout]) : sourceTimeout;
            stored = await load(input.key, r2cfg, { signal: sourceSignal, logErrors: false });
            if (!stored?.ok || !stored.response?.body) return reply({ error: 'source_not_found' }, 404);
            bytes = await readBoundedBody(stored.response.body, maxBytes, sourceSignal);
        } catch (error) {
            return reply({ error: error?.status === 413 ? 'source_too_large' : 'source_read_unavailable' }, error?.status === 413 ? 400 : 503);
        }
        if (bytes.length !== expectedSize) return reply({ error: 'source_size_mismatch' }, 400);
        const sniffed = checkSniffed(declared, bytes);
        if (!sniffed.ok) return reply({ error: sniffed.error }, 400);
        if (input.kind === 'audio') {
            const seconds = declared === 'audio/wav' ? wavSeconds(bytes, bytes.length) : mp3Seconds(bytes, bytes.length);
            if (!Number.isFinite(seconds) || seconds <= 0) return reply({ error: 'source_unreadable' }, 400);
            if (seconds > MUSIC_INSPIRATION_AUDIO_MAX_SECONDS) return reply({ error: 'source_too_long' }, 400);
        } else {
            const dimensions = requireImageDimensions(declared, bytes);
            if (!dimensions.ok) return reply({ error: dimensions.error }, 400);
        }
        const contentDigest = await sha256Hex(bytes);
        const requestDigest = await sha256Hex(new TextEncoder().encode(JSON.stringify({ kind: input.kind, key: input.key,
            rights_confirmed: true, content_sha256: contentDigest })));
        let admitted;
        try {
            admitted = await db('music_inspiration_reserve', { p_auth_id: authId, p_upload_key: input.key,
                p_idempotency_key: input.idempotencyKey, p_request_digest: requestDigest, p_content_digest: contentDigest,
                p_lease_seconds: LEASE_SECONDS });
        } catch { return reply({ error: 'request_unavailable' }, 503); }
        const prior = replay(admitted);
        if (prior) return prior;
        if (admitted?.ok !== true || !validMusicAuthId(admitted.id) || !validMusicAuthId(admitted.attempt_id)) {
            const status = admitted?.code === 'QUOTA_EXCEEDED' ? 429 : admitted?.code === 'SOURCE_ALREADY_USED' || admitted?.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 503;
            return reply({ error: String(admitted?.code || 'request_unavailable').toLowerCase() }, status);
        }
        try {
            const provider = analyze || (input.kind === 'audio' ? analyzeAudio : analyzeImage);
            const result = await provider({ apiKey: env.MUSIC_INSPIRATION_API_KEY,
                model: input.kind === 'audio' ? env.MUSIC_INSPIRATION_MODEL : env.MUSIC_INSPIRATION_IMAGE_MODEL,
                bytes, ...(input.kind === 'audio' ? { format: declared === 'audio/wav' ? 'wav' : 'mp3' } : { mediaType: declared }),
                signal: request.signal });
            const issuedAt = Math.floor(now() / 1000);
            const expiresAt = issuedAt + MUSIC_INSPIRATION_RECEIPT_TTL_SECONDS;
            const resultDigest = await sha256Hex(new TextEncoder().encode(JSON.stringify({ brief: result.brief, tags: result.tags })));
            const receipt = await issueMusicInspirationReceipt({ authId, analysisId: admitted.id, requestDigest, contentDigest,
                resultDigest, issuedAt, expiresAt }, env.MUSIC_INSPIRATION_RECEIPT_SECRET);
            const completed = await db('music_inspiration_complete', { p_auth_id: authId, p_id: admitted.id,
                p_attempt_id: admitted.attempt_id, p_safe: result.safe, p_brief: result.brief, p_tags: result.tags,
                p_receipt: receipt, p_issued_at: issuedAt, p_expires_at: expiresAt });
            if (completed?.code === 'STALE_ATTEMPT') return replay(await db('music_inspiration_get', { p_auth_id: authId, p_id: admitted.id }))
                || reply({ error: 'in_progress' }, 409);
            if (completed?.ok !== true) return reply({ error: 'completion_unavailable' }, 503);
            if (!result.safe) return reply({ error: 'source_not_allowed' }, 422);
            return reply({ analysis_id: admitted.id, brief: result.brief, tags: result.tags, receipt,
                expires_at: new Date(expiresAt * 1000).toISOString(), idempotent: false });
        } catch (error) {
            await db('music_inspiration_fail', { p_auth_id: authId, p_id: admitted.id, p_attempt_id: admitted.attempt_id,
                p_error_code: error instanceof InspirationProviderError ? error.code : 'provider_unavailable',
                p_permanent: error instanceof InspirationProviderError && PERMANENT_PROVIDER_ERRORS.has(error.code) }).catch(() => {});
            const code = error instanceof InspirationProviderError ? error.code : 'provider_unavailable';
            return reply({ error: code }, providerStatuses[code] || 503);
        }
    };
}
