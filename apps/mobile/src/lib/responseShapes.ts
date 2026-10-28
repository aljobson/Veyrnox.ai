// Runtime guards for untrusted API responses and persisted display state.
export const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function isBalance(value: unknown): value is import('./api').Balance {
    return isRecord(value) && isFiniteNumber(value.balance) && isFiniteNumber(value.free_credits)
        && (value.free_expires_at === null || typeof value.free_expires_at === 'string');
}
export function isCheckinStatus(value: unknown): value is import('./checkin').CheckinStatus {
    return isRecord(value) && value.ok === true && typeof value.claimed_today === 'boolean'
        && ['streak', 'next_day', 'next_credits'].every(key => isFiniteNumber(value[key]))
        && Array.isArray(value.rewards) && value.rewards.every(isFiniteNumber);
}
export function isCheckinClaim(value: unknown): value is import('./checkin').CheckinClaim {
    return isRecord(value) && value.ok === true && typeof value.already_claimed === 'boolean'
        && ['streak', 'day', 'credits', 'balance_after'].every(key => isFiniteNumber(value[key]));
}
