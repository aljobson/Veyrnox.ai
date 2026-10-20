import { ApiError, type ApiClient } from '../src/lib/api';
import {
    fetchWorkflows, fetchWorkflowPlan, parseWorkflows, parseWorkflowPlan,
    workflowErrorKey, planManagementKey, planPeriodKey,
} from '../src/lib/publishWorkflows';

const ID = '0a1b2c3d-1111-4222-8333-444455556666';
const edited = '2026-10-19T12:00:00Z';
const workflow = {
    id: ID, name: 'Welcome', kind: 'comment', match_mode: 'contains', keyword: 'hello',
    enabled: true, suggestion_count: 3, updated_at: edited, reply_text: 'Welcome aboard',
    account_id: null, account_name: null, network: null,
};
const entitlement = {
    tier: 'publish', account_limit: 5, analytics_days: 366, best_time_enabled: true,
    subscription: { source: 'stripe', status: 'active', current_period_end: '2026-11-20T12:00:00Z', cancel_at_period_end: false },
};

describe('Publish workflow reads', () => {
    test('reads the actual trigger, suggestion count and last edit, never a last run', () => {
        const result = parseWorkflows({ workflows: [workflow, { id: 'invalid' }, null] });
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            id: ID, name: 'Welcome', kind: 'comment', matchMode: 'contains', keyword: 'hello',
            enabled: true, suggestionCount: 3, updatedAt: edited, replyText: 'Welcome aboard',
            allAccounts: true, accountName: '', network: '',
        });
        expect(JSON.stringify(result)).not.toMatch(/lastRun|neverRun/);
    });

    test('bounds plain text and keeps missing or malformed values unknown', () => {
        const [result] = parseWorkflows({ workflows: [{
            id: ID, name: `a\u0000${'x'.repeat(100)}`, reply_text: 'x'.repeat(9000),
            kind: 'new-kind', match_mode: 'regexp', enabled: 'false', updated_at: 'invalid',
            suggestion_count: -2, account_id: ID,
        }] });
        expect(result.name).not.toContain('\u0000');
        expect(result.name.length).toBeLessThanOrEqual(81);
        expect(result.replyText.length).toBeLessThanOrEqual(8001);
        expect(result).toMatchObject({ enabled: null, updatedAt: null, suggestionCount: null, kind: 'unknown', matchMode: 'unknown', allAccounts: false });
        expect(parseWorkflows({ workflows: [{ ...workflow, enabled: false, kind: null, suggestion_count: 0 }] })[0])
            .toMatchObject({ enabled: false, kind: 'any', suggestionCount: 0 });
    });

    test('an invalid envelope is unavailable, not an empty workflow list', () => {
        expect(parseWorkflows({ workflows: [] })).toEqual([]);
        for (const bad of [null, {}, { workflows: null }, { error: 'inbox_workflows_not_open' }]) {
            expect(() => parseWorkflows(bad)).toThrow(ApiError);
        }
    });

    test('both surfaces use GET only on the real routes', async () => {
        const request = jest.fn().mockResolvedValueOnce({ workflows: [workflow] }).mockResolvedValueOnce({ entitlement });
        const api = { request } as unknown as ApiClient;
        expect(await fetchWorkflows(api)).toHaveLength(1);
        expect(await fetchWorkflowPlan(api)).toMatchObject({ tier: 'publish', source: 'stripe' });
        expect(request.mock.calls).toEqual([
            ['/api/v1/social/workflows'], ['/api/v1/social/plan'],
        ]);
    });

    test.each([402, 403, 404, 503])('status %i degrades quietly without raw errors or a purchase', async (status) => {
        const error = new ApiError(status, 'private_server_detail');
        const api = { request: jest.fn().mockRejectedValue(error) } as unknown as ApiClient;
        await expect(fetchWorkflows(api)).rejects.toBe(error);
        await expect(fetchWorkflowPlan(api)).rejects.toBe(error);
        expect(workflowErrorKey(error)).toBe('publishWorkflows.unavailable');
    });

    test('network and other errors use local safe messages', () => {
        expect(workflowErrorKey(new ApiError(0, 'network'))).toBe('publishWorkflows.network');
        expect(workflowErrorKey(new Error('secret'))).toBe('publishWorkflows.failed');
    });
});

describe('price-free Publish Plan status', () => {
    test('reads entitlement limits and source, drops prices, checkout URLs and catalogue names', () => {
        const plan = parseWorkflowPlan({
            entitlement: { ...entitlement, subscription: { ...entitlement.subscription, price_usd_cents: 1234 } },
            plans: [{ name: 'Pay $12.34', price_usd_cents: 1234 }], checkout_url: 'https://payment.example',
        });
        expect(plan).toEqual({
            tier: 'publish', accountLimit: 5, analyticsDays: 366, bestTimeEnabled: true,
            source: 'stripe', periodEnd: '2026-11-20T12:00:00Z', cancelAtPeriodEnd: false, status: 'active',
        });
        expect(JSON.stringify(plan)).not.toMatch(/price|1234|payment|Pay/);
    });

    test('free, unknown and malformed data do not invent entitlements', () => {
        expect(parseWorkflowPlan({ entitlement: { tier: 'free', account_limit: 1, analytics_days: 0, best_time_enabled: false } }))
            .toMatchObject({ tier: 'free', accountLimit: 1, analyticsDays: 0, bestTimeEnabled: false, source: null, periodEnd: null });
        for (const body of [null, {}, { entitlement: null }, { entitlement: { tier: 'gold' } }]) {
            expect(parseWorkflowPlan(body)).toBeNull();
        }
        expect(parseWorkflowPlan({ entitlement: {
            tier: 'publish', account_limit: -1, analytics_days: '366', best_time_enabled: 'yes',
            subscription: { source: 'unknown', current_period_end: 'invalid' },
        } })).toMatchObject({ accountLimit: null, analyticsDays: null, bestTimeEnabled: null, source: null, periodEnd: null });
    });

    test('management copy follows the source; renewal is not claimed for an ending or past-due plan', () => {
        expect(planManagementKey('stripe')).toBe('publishWorkflows.manageWeb');
        expect(planManagementKey('store')).toBe('publishWorkflows.manageStore');
        expect(planManagementKey(null)).toBeNull();
        const plan = parseWorkflowPlan({ entitlement })!;
        expect(planPeriodKey(plan)).toBe('publishWorkflows.renews');
        expect(planPeriodKey({ ...plan, cancelAtPeriodEnd: true })).toBe('publishWorkflows.ends');
        expect(planPeriodKey({ ...plan, status: 'past_due' })).toBe('publishWorkflows.periodEnd');
        expect(planPeriodKey({ ...plan, cancelAtPeriodEnd: null })).toBe('publishWorkflows.periodEnd');
    });
});
