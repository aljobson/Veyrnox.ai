import { ApiError, type ApiClient } from '../src/lib/api';
import { cancelSubscription, creditsRemoved, parseSubscription, readSubscription, subscriptionErrorKey, visibleSubscription } from '../src/lib/creditSubscription';
const row = { id: '11111111-1111-1111-1111-111111111111', plan_id: 'starter-monthly', status: 'active', price_usd_cents: 1000, credits: 200, current_period_end: '2026-11-27T00:00:00Z', cancel_at_period_end: false, started_at: '2026-10-27T00:00:00Z', ended_at: null, end_reason: null };
test.each(Object.keys(row))('validates field %s rather than trusting the API', key => {
    expect(() => parseSubscription({ subscription: { ...row, [key]: {} } })).toThrow();
    const missing = { ...row } as Record<string, unknown>; delete missing[key];
    expect(() => parseSubscription({ subscription: missing })).toThrow();
});
test('reads actual statuses and the real cooling-off end reason', async () => {
    const api = { request: jest.fn().mockResolvedValue({ subscription: row }) } as unknown as ApiClient;
    expect(await readSubscription(api)).toEqual(row);
    expect(api.request).toHaveBeenCalledWith('/api/v1/subscriptions');
    for (const status of ['pending', 'active', 'past_due', 'flagged', 'ended']) expect(parseSubscription({ subscription: { ...row, status } })?.status).toBe(status);
    expect(visibleSubscription(parseSubscription({ subscription: { ...row, status: 'ended', end_reason: 'cancelled_cooling_off' } }))).toBe(true);
    expect(visibleSubscription(parseSubscription({ subscription: { ...row, status: 'ended', end_reason: 'expired' } }))).toBe(false);
    expect(parseSubscription({ subscription: null })).toBeNull();
});
test('POST body and JSON content type are exact; monetary response fields are discarded by the UI', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true, mode: 'cooling_off', pending: true });
    await cancelSubscription({ request } as unknown as ApiClient, row.id, 'cooling_off');
    expect(request).toHaveBeenCalledWith('/api/v1/subscriptions/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription_id: row.id, mode: 'cooling_off' }) });
});
test.each(['cooling_off_over','credits_spent','subscription_not_live','subscription_not_found','account_frozen','rate_limited','cancel_failed','refund_review_required','temporarily_unavailable'])('maps typed error %s', code => {
    expect(subscriptionErrorKey(new ApiError(409, code))).toBe(`creditsPage.error.${code}`);
});
test.each([401,403,503])('status %i hides typed codes', status => expect(subscriptionErrorKey(new ApiError(status, 'account_frozen'))).toBe('creditsPage.error.generic'));
test('unknown failures are generic, while credits_removed independently enables retry', () => {
    expect(subscriptionErrorKey(new TypeError('network'))).toBe('creditsPage.error.generic');
    expect(subscriptionErrorKey(new ApiError(409, 'unknown'))).toBe('creditsPage.error.generic');
    expect(creditsRemoved(new ApiError(503, 'refund_failed', { credits_removed: true }))).toBe(true);
    expect(creditsRemoved(new ApiError(503, 'refund_failed'))).toBe(false);
});
