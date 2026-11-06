import { ApiError } from './api';

export const RATE_LIMIT_DEFAULT_MS = 3000;
export const RATE_LIMIT_MAX_MS = 30000;

// How long Retry stays disabled after a failed load. Only a 429 asks the person to wait: honour the server's
// Retry-After (capped so the button never stays dead for long), else a short default.
export function retryDelayMs(err: unknown): number {
    if (!(err instanceof ApiError) || err.status !== 429) return 0;
    const seconds = err.retryAfterSeconds;
    if (seconds === undefined) return RATE_LIMIT_DEFAULT_MS;
    return Math.min(RATE_LIMIT_MAX_MS, Math.max(1000, Math.round(seconds * 1000)));
}
