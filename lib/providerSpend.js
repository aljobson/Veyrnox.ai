import { SupabaseError } from '../packages/db/supabase-client.js';

const SCOPES = new Set(['single', 'user_hour', 'user_day', 'provider_hour', 'provider_day', 'global_hour', 'global_day', 'closed']);

function boundedRetry(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? Math.max(1, Math.min(86400, Math.ceil(seconds))) : 60;
}

/** Normalise the database's typed spend refusal without exposing dollar limits. */
export function providerSpendLimit(result) {
    if (!result || (result.code !== 'PROVIDER_SPEND_LIMIT' && result.code !== 'PROVIDER_SPEND_UNAVAILABLE')) return null;
    const scope = SCOPES.has(result.scope) ? result.scope : 'closed';
    return {
        scope,
        retryAfter: boundedRetry(result.retry_after_seconds),
        status: scope.startsWith('user_') ? 429 : 503,
    };
}

/** Extract a trigger refusal from PostgREST's error body. */
export function providerSpendError(error) {
    if (!(error instanceof SupabaseError)) return null;
    const body = error.body && typeof error.body === 'object' ? error.body : {};
    const message = String(body.message || body.details || '');
    const match = /PROVIDER_SPEND_LIMIT:([a-z_]+):(\d+)/.exec(message);
    if (!match) return null;
    return providerSpendLimit({ code: 'PROVIDER_SPEND_LIMIT', scope: match[1], retry_after_seconds: match[2] });
}

export function providerSpendBody(limit) {
    return {
        error: limit.status === 429 ? 'supplier_spend_limit' : 'supplier_capacity_unavailable',
        retry_after_seconds: limit.retryAfter,
    };
}

