import { ApiError, type ApiClient } from './api';
export type SubscriptionStatus = 'pending' | 'active' | 'past_due' | 'flagged' | 'ended';
export type CancelMode = 'period_end' | 'cooling_off';
export interface CreditSubscription {
    id: string; plan_id: string; status: SubscriptionStatus; price_usd_cents: number; credits: number;
    current_period_end: string | null; cancel_at_period_end: boolean;
    started_at: string | null; ended_at: string | null; end_reason: string | null;
}
const dateOrNull = (v: unknown) => v === null || (typeof v === 'string' && v.length > 0 && Number.isFinite(Date.parse(v)));
export function parseSubscription(value: unknown): CreditSubscription | null {
    if (!value || typeof value !== 'object' || !('subscription' in value)) throw new Error('Invalid subscription response');
    const s = (value as { subscription: unknown }).subscription;
    if (s === null) return null;
    if (!s || typeof s !== 'object') throw new Error('Invalid subscription');
    const row = s as CreditSubscription;
    if (typeof row.id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.id)
        || typeof row.plan_id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(row.plan_id)
        || !['pending', 'active', 'past_due', 'flagged', 'ended'].includes(row.status)
        || !Number.isSafeInteger(row.price_usd_cents) || row.price_usd_cents < 0
        || !Number.isSafeInteger(row.credits) || row.credits <= 0
        || typeof row.cancel_at_period_end !== 'boolean'
        || !dateOrNull(row.current_period_end) || !dateOrNull(row.started_at) || !dateOrNull(row.ended_at)
        || !(row.end_reason === null || typeof row.end_reason === 'string')) throw new Error('Invalid subscription fields');
    return row;
}
export async function readSubscription(api: ApiClient) { return parseSubscription(await api.request<unknown>('/api/v1/subscriptions')); }
export function visibleSubscription(s: CreditSubscription | null) {
    return s !== null && (s.status !== 'ended' || s.end_reason === 'cancelled_cooling_off');
}
export async function cancelSubscription(api: ApiClient, id: string, mode: CancelMode) {
    const result = await api.request<{ ok: boolean; mode: CancelMode; pending?: boolean; refunded?: boolean }>('/api/v1/subscriptions/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription_id: id, mode }),
    });
    if (result.ok !== true || result.mode !== mode) throw new Error('Invalid cancellation response');
    return result;
}
const errorKeys = {
    cooling_off_over: 'creditsPage.error.cooling_off_over', credits_spent: 'creditsPage.error.credits_spent',
    subscription_not_live: 'creditsPage.error.subscription_not_live', subscription_not_found: 'creditsPage.error.subscription_not_found',
    account_frozen: 'creditsPage.error.account_frozen', rate_limited: 'creditsPage.error.rate_limited',
    cancel_failed: 'creditsPage.error.cancel_failed', refund_review_required: 'creditsPage.error.refund_review_required',
    temporarily_unavailable: 'creditsPage.error.temporarily_unavailable', no_live_subscription: 'creditsPage.error.subscription_not_live',
} as const;
export function subscriptionErrorKey(error: unknown) {
    if (!(error instanceof ApiError) || [401, 403, 503].includes(error.status)) return 'creditsPage.error.generic';
    return errorKeys[error.code as keyof typeof errorKeys] ?? 'creditsPage.error.generic';
}
export const creditsRemoved = (error: unknown) => error instanceof ApiError && error.body.credits_removed === true;
