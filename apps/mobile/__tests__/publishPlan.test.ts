import { fetchPublishTier, paywallState, tierFrom } from '../src/lib/publishPlan';
import type { ApiClient } from '../src/lib/api';

const api = (impl: () => Promise<unknown>) => ({ request: jest.fn(impl) }) as unknown as ApiClient;

describe('publish plan check', () => {
    test('reads the tier the server reports', () => {
        expect(tierFrom({ entitlement: { tier: 'publish' } })).toBe('publish');
        expect(tierFrom({ entitlement: { tier: 'free' } })).toBe('free');
        expect(tierFrom({ entitlement: { tier: 'gold' } })).toBeNull();
        expect(tierFrom({})).toBeNull();
    });

    test('a failed or odd response is unknown, never free', async () => {
        expect(await fetchPublishTier(api(async () => ({ entitlement: { tier: 'free' } })))).toBe('free');
        expect(await fetchPublishTier(api(async () => { throw new Error('503'); }))).toBeNull();
        expect(await fetchPublishTier(api(async () => ({ plans: [] })))).toBeNull();
    });

    test('offers a purchase only on a confirmed free tier', () => {
        expect(paywallState(false, null)).toBe('checking');
        expect(paywallState(true, 'free')).toBe('subscribe');
        expect(paywallState(true, 'publish')).toBe('active');
        expect(paywallState(true, null)).toBe('unknown');
    });
});
