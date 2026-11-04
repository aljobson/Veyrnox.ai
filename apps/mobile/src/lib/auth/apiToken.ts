import { ApiError } from '../api';

// A refresh that failed for a reason that says nothing about the token: no
// network (0), a timeout, throttling, or the auth service being down. Only a
// definitive 4xx rejection (400/401/403) may end the session and wipe drafts.
export function isTransientRefreshFailure(err: unknown): boolean {
    if (!(err instanceof Error) || !('status' in err)) return false;
    const status = (err as { status: unknown }).status;
    if (typeof status !== 'number') return false;
    return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

// Only ApiClient uses this adapter; direct auth callers retain their null contract.
export function apiTokenSource(getAccessToken: (forceRefresh?: boolean, expected?: number) => Promise<string | null>, lastRefreshWasTransient: () => boolean) {
    return async (forceRefresh?: boolean, expected?: number): Promise<string | null> => {
        const token = await (expected === undefined ? getAccessToken(forceRefresh) : getAccessToken(forceRefresh, expected));
        if (token === null && lastRefreshWasTransient()) throw new ApiError(0, 'network');
        return token;
    };
}
