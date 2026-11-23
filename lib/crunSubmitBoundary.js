import { rpc as realRpc } from '../packages/db/supabase-client.js';
import { submitTask } from '../packages/adapters/crun.js';

const RETRY_CODES = new Set(['CRUN_RATE_LIMITED', 'PROVIDER_ADMISSION_PAUSED', 'CRUN_UNAVAILABLE']);

const retrySeconds = (value, fallback = 30) => Math.max(1, Math.min(600, Number(value) || fallback));

function refused(code, retryAfterSeconds) {
    const limited = code === 'CRUN_RATE_LIMITED';
    return {
        ok: false,
        outcome: 'rejected',
        error: limited ? 'provider_rate_limited' : 'provider_unavailable',
        errorCode: limited ? 'provider_rate_limited' : 'provider_unavailable',
        scope: limited ? 'deferred' : 'circuit',
        retryAfterSeconds: retrySeconds(retryAfterSeconds),
        ...(limited ? { localLimit: true } : {}),
    };
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function applyFailureControl(result, job, cfg, call, observedAt) {
    if (!result || result.ok || !result.scope) return;
    try {
        if (result.scope === 'route' && job.provider_endpoint === 'crun:suno/music-generate') {
            const tripped = await call('trip_crun_endpoint_routes', {
                p_endpoint: job.provider_endpoint,
                p_observed_at: observedAt,
            }, cfg);
            if (tripped?.ok !== true) throw new Error('control refused');
        } else if (result.scope === 'model' && job.provider_endpoint === 'crun:suno/music-generate') {
            const tripped = await call('trip_crun_suno_model_breaker', {
                p_endpoint: job.provider_endpoint,
                p_suno_model: job.inputs?.suno_model || 'v6',
                p_reason_code: 'provider_model_disabled',
                p_observed_at: observedAt,
            }, cfg);
            if (tripped?.ok !== true) throw new Error('control refused');
        }
    } catch {
        console.error(JSON.stringify({ event: 'crun.create_control_failed', scope: result.scope,
            endpoint: job.provider_endpoint }));
    }
    if (result.scope === 'account') {
        try {
            const paused = await call('pause_crun_account_admission', {
                p_reason: result.errorCode || 'provider_auth_failed',
                p_observed_at: observedAt,
            }, cfg);
            if (paused?.ok !== true && paused?.code !== 'STALE_EVIDENCE') throw new Error('control refused');
        } catch {
            console.error(JSON.stringify({ event: 'crun.create_control_failed', scope: 'account',
                code: result.errorCode || 'provider_auth_failed' }));
        }
    }
}

/** The one CreateTask boundary used by generic routes and the Suno outbox. */
export async function submitCrunAtBoundary(job, {
    apiKey, cfg, reservationKey, purpose, rpc = realRpc, submit = submitTask,
    now = () => new Date().toISOString(), wait = delay,
} = {}) {
    let reserved;
    const generic = purpose === 'generic.create';
    for (let attempt = 0; attempt < (generic ? 3 : 1); attempt += 1) {
        try {
            reserved = await rpc('reserve_crun_create_slot', {
                p_reservation_key: reservationKey,
                p_purpose: purpose,
                p_endpoint: job?.provider_endpoint || null,
                p_suno_model: job?.provider_endpoint === 'crun:suno/music-generate'
                    ? job?.inputs?.suno_model || 'v6' : null,
            }, cfg);
        } catch {
            return refused('CRUN_UNAVAILABLE', 30);
        }
        if (reserved?.ok === true || reserved?.code !== 'CRUN_RATE_LIMITED' || !generic) break;
        if (attempt < 2) await wait(Math.min(2, retrySeconds(reserved?.retry_after_seconds, 1)) * 1000);
    }
    if (reserved?.ok !== true) {
        const code = typeof reserved?.code === 'string' ? reserved.code : 'CRUN_UNAVAILABLE';
        if (generic && code === 'CRUN_RATE_LIMITED') {
            return { ...refused(code, reserved?.retry_after_seconds), outcome: 'not_sent', retryable: true };
        }
        return RETRY_CODES.has(code)
            ? refused(code, reserved?.retry_after_seconds)
            : { ok: false, outcome: 'rejected', error: 'provider_boundary_refused',
                errorCode: 'provider_boundary_refused', scope: 'circuit' };
    }

    let result;
    try {
        result = await submit(job, { apiKey });
    } catch {
        result = { ok: false, outcome: 'unknown', error: 'provider_unreachable',
            errorCode: 'provider_unreachable', scope: 'unknown' };
    }
    await applyFailureControl(result, job, cfg, rpc, now());
    return result;
}
