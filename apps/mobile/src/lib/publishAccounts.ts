import type { ApiClient } from './api';

// ADR-0161: disconnect one connected account. The route soft-deletes (status revoked) so the audit log keeps its place.
export const disconnectAccount = (api: ApiClient, accountId: string) =>
    api.request(`/api/v1/social/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });

export function disconnectErrorKey(err: unknown): string {
    const status = (err as { status?: number } | null)?.status;
    if (status === 0) return 'accounts.err.network';
    if (status === 404) return 'accounts.err.gone';
    return 'accounts.err.later';
}
