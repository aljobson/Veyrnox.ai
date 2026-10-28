import { ApiError, type ApiClient } from './api';
import { inboxErrorKey } from './publishInbox';

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
export function parseInboxAnalytics(body: unknown) {
    const b = record(body), s = record(b.summary);
    return {
        summary: { conversations: number(s.conversations), received: number(s.received), sent: number(s.sent), failed: number(s.failed), read_actions: number(s.read_actions),
            median_response_seconds: typeof s.median_response_seconds === 'number' && Number.isFinite(s.median_response_seconds) && s.median_response_seconds >= 0 ? s.median_response_seconds : null },
        platforms: (Array.isArray(b.platforms) ? b.platforms : []).flatMap(raw => {
            const r = record(raw);
            return typeof r.network === 'string' ? [{ network: r.network.slice(0, 80), received: number(r.received), sent: number(r.sent), failed: number(r.failed) }] : [];
        }),
    };
}
export const fetchInboxAnalytics = async (api: ApiClient, days: 7 | 30 | 90) => parseInboxAnalytics(await api.request(`/api/v1/social/inbox/analytics?days=${days}`));
export function inboxAnalyticsErrorKey(err: unknown) {
    if (err instanceof ApiError && [403, 404, 503].includes(err.status)) return 'publishDepth.analytics.unavailable';
    return inboxErrorKey(err);
}
