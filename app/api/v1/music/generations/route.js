import { retryAfterSeconds } from '../../../../../lib/rateLimitHeaders.js';
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { publishFalDispatchWakeup } from '../../../../../lib/falDispatchWakeup.js';
import {
    musicGenerationEnabled, musicRpcStatus, parseMusicGeneration, publicMusicError,
    readMusicJson, validMusicAuthId,
} from '../../../../../lib/musicBackend.js';

const reply = (body, status = 200, headers = {}) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', ...headers },
});

/** Atomically consume a quote, debit two units, and enqueue two fal jobs. */
export async function POST(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicGenerationEnabled()) return reply({ error: 'music_unavailable' }, 404);

    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicGeneration(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    let result;
    try {
        result = await rpc('music_submit_pair', {
            p_auth_id: authId,
            p_quote_id: input.quoteId,
            p_idempotency_key: input.idempotencyKey,
        }, cfg);
    } catch (error) {
        // A lost acknowledgement may conceal a committed pair. The caller must
        // replay the same idempotency key; never run a fallback debit here.
        console.error('[music/generations] pair admission failed:', error?.message);
        return reply({ error: 'pair_acceptance_unknown' }, 503);
    }
    if (!result?.ok) {
        const status = musicRpcStatus(result?.code);
        const headers = status === 429 || status === 503
            ? { 'Retry-After': String(retryAfterSeconds(result?.retry_after_seconds, { max: 600, fallback: 60 })) }
            : {};
        return reply({ error: publicMusicError(result?.code) }, status, headers);
    }

    for (const jobId of result.job_ids || []) {
        try { publishFalDispatchWakeup(jobId); }
        catch { console.error('[music/generations] dispatch wakeup unavailable:', jobId); }
    }
    return reply({
        generation_id: result.request_id,
        state: result.state,
        candidates: (result.job_ids || []).map((jobId, index) => ({
            ordinal: index + 1, label: index === 0 ? 'A' : 'B', job_id: jobId, state: 'queued',
        })),
        balance_after: result.balance_after,
        ...(result.idempotent ? { idempotent: true } : {}),
    }, result.idempotent ? 200 : 202);
}
