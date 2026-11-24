import { ApiError, type ApiClient } from './api';

export type CancelStatus = { cancellable: boolean; credits: number };
export type MusicCancelProbe =
    | { kind: 'available'; status: CancelStatus }
    | { kind: 'retry'; retryAfterMs: number }
    | { kind: 'hidden' };
const validCredits = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

export async function getCancelStatus(api: ApiClient, id: string): Promise<CancelStatus | null> {
    try {
        const row = await api.request<Partial<CancelStatus> | null>(`/api/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: 'GET' });
        return row && typeof row.cancellable === 'boolean' && validCredits(row.credits)
            ? { cancellable: row.cancellable, credits: row.credits } : null;
    } catch { return null; }
}

// Music cards need to honor Retry-After without changing the deliberately
// compatibility-shaped generic helper above.
export async function getMusicCancelProbe(api: ApiClient, id: string): Promise<MusicCancelProbe> {
    try {
        const row = await api.request<Partial<CancelStatus> | null>(`/api/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: 'GET' });
        return row && typeof row.cancellable === 'boolean' && validCredits(row.credits)
            ? { kind: 'available', status: { cancellable: row.cancellable, credits: row.credits } }
            : { kind: 'hidden' };
    } catch (error) {
        if (error instanceof ApiError && error.code === 'rate_limited') {
            return { kind: 'retry', retryAfterMs: Math.max(15_000, (error.retryAfterSeconds ?? 60) * 1000) };
        }
        return !(error instanceof ApiError) || error.status === 0 || error.status >= 500
            ? { kind: 'retry', retryAfterMs: 15_000 }
            : { kind: 'hidden' };
    }
}

export async function cancelJob(api: ApiClient, id: string): Promise<{ replayed: boolean; credits: number }> {
    const row = await api.request<{ cancelled?: unknown; replayed?: unknown; credits?: unknown } | null>(
        `/api/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' },
    );
    if (row?.cancelled !== true || typeof row.replayed !== 'boolean' || !validCredits(row.credits)) {
        throw new ApiError(502, 'internal');
    }
    return { replayed: row.replayed, credits: row.credits };
}

export function cancelErrorKey(err: unknown): string {
    if (!(err instanceof ApiError) || err.status >= 500) return 'jobCancel.unsure';
    switch (err.code) {
        case 'job_started': return 'jobCancel.started';
        case 'job_finished': return 'jobCancel.finished';
        case 'account_frozen': return 'jobCancel.frozen';
        case 'rate_limited': return 'jobCancel.rateLimited';
        case 'not_found': return 'jobCancel.unavailable';
        default: return 'jobCancel.unsure';
    }
}
