import { ApiError, type ApiClient } from './api';

export type CancelStatus = { cancellable: boolean; credits: number };
const validCredits = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

export async function getCancelStatus(api: ApiClient, id: string): Promise<CancelStatus | null> {
    try {
        const row = await api.request<Partial<CancelStatus> | null>(`/api/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: 'GET' });
        return row && typeof row.cancellable === 'boolean' && validCredits(row.credits)
            ? { cancellable: row.cancellable, credits: row.credits } : null;
    } catch { return null; }
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
