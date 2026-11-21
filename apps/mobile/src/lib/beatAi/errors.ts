import { ApiError } from '../api';
import { isRecord } from '../responseShapes';
import { definitivelyRefused, type Failure } from './shared';
export function failure(error: unknown): Failure {
    if (!(error instanceof ApiError)) return { status: -1, code: 'unknown' };
    const envelope = error.body.error;
    const code = typeof envelope === 'string' ? envelope : isRecord(envelope) && typeof envelope.code === 'string' ? envelope.code : error.code;
    return { status: error.status, code, retryAfter: error.retryAfterSeconds };
}
export const surfaceUnavailable = (error: unknown) => ['beat_ai_unavailable', 'music_unavailable'].includes(failure(error).code);
// Action-route rollout refusals cannot prove that an earlier submission was rejected.
export const unavailable = (error: unknown) => surfaceUnavailable(error) || (failure(error).status === 404 && failure(error).code.endsWith('_unavailable'));
export function retireOnError(error: unknown): boolean {
    const e = failure(error);
    // Local gates send nothing and cannot resolve an earlier lost acknowledgement.
    if (e.code === 'consent_declined' || (e.status === 402 && e.code === 'subscription_required')) return false;
    return !unavailable(error) && e.status !== 429 && definitivelyRefused(e);
}
const refusalKeys: Record<string, string> = {
    plan_unavailable: 'beatAi.a29', insufficient_balance: 'beatAi.a30',
    quote_expired: 'beatAi.a36', quote_stale: 'beatAi.a37', quote_already_used: 'beatAi.a38', idempotency_conflict: 'beatAi.a39',
    prompt_blocked: 'beatAi.a31', prompt_not_allowed: 'beatAi.a31', prompt_invalid: 'beatAi.a6', range_invalid: 'beatAi.a9',
    source_duration_invalid: 'beatAi.a32', source_unavailable: 'beatAi.a33', model_unavailable: 'beatAi.a35',
    rate_limited: 'beatAi.a44', mfa_required: 'beatAi.a28', not_found: 'beatAi.a26',
};
export function errorKey(error: unknown): string {
    const e = failure(error);
    if (refusalKeys[e.code]) return refusalKeys[e.code];
    if (e.status === 401) return 'beatAi.signedOut';
    if (e.status === 0) return 'beatAi.offline';
    if (unavailable(error)) return 'beatAi.a35';
    if (e.code === 'held' || e.code === 'source_held') return 'beatAi.held';
    return 'beatAi.error';
}
export function errorParams(error: unknown): Record<string, number> | undefined {
    const e = failure(error);
    return e.code === 'rate_limited' ? { n: e.retryAfter || 60 } : undefined;
}
