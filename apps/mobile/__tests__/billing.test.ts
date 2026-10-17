import { creditsFor, intervalFor, renewalTerms, toDisplayPackages, waitForBalanceChange, type RcPackage } from '../src/lib/billing';

const pkg = (id: string, product: string, price = '$1.00'): RcPackage => ({ identifier: id, product: { identifier: product, title: product, priceString: price } });

describe('billing helpers', () => {
    test('reads credits and intervals from product ids', () => {
        expect(creditsFor('ai.veyrnox.credits.1200')).toBe(1200);
        expect(creditsFor('ai.veyrnox.credits.x')).toBeNull();
        expect(creditsFor('com.other.credits.100')).toBeNull();
        expect(intervalFor('ai.veyrnox.publish.annual')).toBe('year');
        expect(intervalFor('ai.veyrnox.publish.daily')).toBeNull();
    });

    test('lists known packs in order and drops anything else', () => {
        const list = toDisplayPackages([
            pkg('c3', 'ai.veyrnox.credits.3000'), pkg('c1', 'ai.veyrnox.credits.100'), pkg('x', 'ai.wallet.sub'), pkg('c2', 'ai.veyrnox.credits.270'),
        ]);
        expect(list.map((p) => p.credits)).toEqual([100, 270, 3000]);
        const subs = toDisplayPackages([pkg('a', 'ai.veyrnox.publish.annual'), pkg('w', 'ai.veyrnox.publish.weekly'), pkg('m', 'ai.veyrnox.publish.monthly')]);
        expect(subs.map((p) => p.interval)).toEqual(['week', 'month', 'year']);
    });

    test('renewal terms name the price, period, auto-renewal and where to cancel', () => {
        const ios = renewalTerms('month', '$14.99', 'ios');
        expect(ios).toContain('$14.99 per month');
        expect(ios).toContain('Renews automatically');
        expect(ios).toContain('Apple ID');
        expect(renewalTerms('year', '$124.99', 'android')).toContain('Google Play');
    });
});

describe('waitForBalanceChange', () => {
    const fast = { sleep: async () => {}, intervalMs: 1, timeoutMs: 5 };
    test('returns as soon as the balance moves', async () => {
        const reads = [10, 10, 110];
        const r = await waitForBalanceChange(async () => reads.shift() ?? 110, 10, fast);
        expect(r).toEqual({ changed: true, balance: 110 });
    });
    test('gives up when it never moves', async () => {
        expect(await waitForBalanceChange(async () => 10, 10, fast)).toEqual({ changed: false, balance: 10 });
    });
    test('survives failed reads', async () => {
        let n = 0;
        const r = await waitForBalanceChange(async () => { if (n++ < 2) throw new Error('offline'); return 60; }, 10, fast);
        expect(r.changed).toBe(true);
    });
});
