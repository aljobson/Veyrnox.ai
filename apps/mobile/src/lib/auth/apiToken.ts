import { ApiError } from '../api';

export function isTransientRefreshFailure(err: unknown): boolean {
    return err instanceof Error && 'status' in err && err.status === 0;
}

// Only ApiClient uses this adapter; direct auth callers retain their null contract.
export function apiTokenSource(getAccessToken: (forceRefresh?: boolean) => Promise<string | null>, lastRefreshWasTransient: () => boolean) {
    return async (forceRefresh?: boolean): Promise<string | null> => {
        const token = await getAccessToken(forceRefresh);
        if (token === null && lastRefreshWasTransient()) throw new ApiError(0, 'network');
        return token;
    };
}
