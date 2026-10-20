import { ApiError } from '../src/lib/api';
import { adsErrorKey, hostOf, money, parseCampaigns } from '../src/lib/publishAds';

const ID = '0a1b2c3d-1111-4222-8333-444455556666';

describe('ads', () => {
    test('parses campaigns, drops rows without a real id or name', () => {
        const r = parseCampaigns({ campaigns: [{ id: ID, name: 'Launch', network: 'meta', mode: 'boost', objective: 'traffic', status: 'active', daily_budget_cents: 1250.9, currency: 'EUR', starts_at: '2026-11-01T00:00:00Z', destination_url: 'https://shop.example.test/p?x=1' }, { id: 'bad', name: 'x' }, { id: ID }, 'junk'] });
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ name: 'Launch', status: 'active', dailyBudgetCents: 1250, currency: 'EUR', destinationHost: 'shop.example.test' });
        expect(parseCampaigns(null)).toEqual([]);
    });
    test('a link is shown as its host only, and only for https', () => {
        expect(hostOf('https://a.example.test/path?q=1')).toBe('a.example.test');
        expect(hostOf('http://a.example.test')).toBeNull();
        expect(hostOf('javascript:alert(1)')).toBeNull();
        expect(hostOf(5)).toBeNull();
    });
    test('bad budget and currency fall back safely', () => {
        const r = parseCampaigns({ campaigns: [{ id: ID, name: 'N', daily_budget_cents: -5, currency: 'usd' }] });
        expect(r[0].dailyBudgetCents).toBe(0);
        expect(r[0].currency).toBe('USD');
    });
    test('money formats cents and survives an unknown currency', () => {
        expect(money(1250, 'USD')).toMatch(/12[.,]50/);
        expect(money(500, 'ZZZ')).toMatch(/5[.,]00/);
    });
    test('error keys', () => {
        expect(adsErrorKey(new ApiError(402, 'plan_required'))).toBe('ads.err.plan');
        expect(adsErrorKey(new ApiError(404, 'ads_not_open'))).toBe('ads.err.notOpen');
        expect(adsErrorKey(new ApiError(0, 'network'))).toBe('ads.err.network');
    });
});
