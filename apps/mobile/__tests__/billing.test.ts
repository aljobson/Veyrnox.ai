import { creditsFor, generationCatalogId, generationPlanFor, intervalFor, isPaidSubscriptionProduct, isWebParityPack, parseGenerationCatalog, renewalTerms, stayDiscountFor, toDisplayPackages, waitForBalanceChange, type RcPackage } from '../src/lib/billing';

const pkg = (id: string, product: string, price = '$1.00'): RcPackage => ({ identifier: id, product: { identifier: product, title: product, priceString: price } });

describe('billing helpers', () => {
    test('reads credits and intervals from product ids', () => {
        expect(creditsFor('ai.veyrnox.credits.1200')).toBe(1200);
        expect(creditsFor('ai.veyrnox.credits.x')).toBeNull();
        expect(creditsFor('com.other.credits.100')).toBeNull();
        expect(intervalFor('ai.veyrnox.publish.annual')).toBe('year');
        expect(intervalFor('ai.veyrnox.generation.plus.monthly')).toBe('month');
        expect(generationPlanFor('ai.veyrnox.generation.plus.monthly')).toBe('plus');
        expect(isPaidSubscriptionProduct('ai.veyrnox.generation.ultra.annual')).toBe(true);
        expect(intervalFor('ai.veyrnox.publish.annual:annual')).toBe('year');
        expect(intervalFor('ai.veyrnox.generation.plus.monthly:monthly')).toBe('month');
        expect(generationPlanFor('ai.veyrnox.generation.plus.monthly:monthly')).toBe('plus');
        expect(generationCatalogId('ai.veyrnox.generation.plus.annual:annual')).toBe('plus-yearly');
        expect(intervalFor('ai.veyrnox.publish.monthly:annual')).toBeNull();
        expect(generationPlanFor('ai.veyrnox.generation.plus.monthly:annual')).toBeNull();
        expect(isPaidSubscriptionProduct('ai.veyrnox.publish.monthly:annual')).toBe(false);
        expect(intervalFor('ai.veyrnox.publish.daily')).toBeNull();
    });

    test('only exposes a correctly configured fifteen percent stay offer', () => {
        const product = { ...pkg('g', 'ai.veyrnox.generation.lite.monthly', '$10.00'), product: {
            ...pkg('g', 'ai.veyrnox.generation.lite.monthly', '$10.00').product,
            price: 10,
            discounts: [{ identifier: 'stay15', price: 8.5, priceString: '$8.50', cycles: 3 }],
        } };
        expect(stayDiscountFor(product)?.priceString).toBe('$8.50');
        expect(stayDiscountFor({ ...product, product: { ...product.product, discounts: [{ identifier: 'stay15', price: 8, priceString: '$8.00', cycles: 3 }] } })).toBeNull();
    });

    test('lists known packs in order and drops anything else', () => {
        const list = toDisplayPackages([
            pkg('c4', 'ai.veyrnox.credits.1000'), pkg('c3', 'ai.veyrnox.credits.3000'), pkg('c1', 'ai.veyrnox.credits.100'), pkg('x', 'ai.wallet.sub'), pkg('c2', 'ai.veyrnox.credits.300'),
        ]);
        expect(list.map((p) => p.credits)).toEqual([100, 300, 1000, 3000]);
        expect(list.filter(isWebParityPack).map((p) => p.credits)).toEqual([100, 300, 1000]);
        const subs = toDisplayPackages([pkg('a', 'ai.veyrnox.publish.annual'), pkg('w', 'ai.veyrnox.publish.weekly'), pkg('m', 'ai.veyrnox.publish.monthly')]);
        expect(subs.map((p) => p.interval)).toEqual(['week', 'month', 'year']);
    });

    test('maps and orders the website generation plan families', () => {
        const plans = toDisplayPackages([
            pkg('uy', 'ai.veyrnox.generation.ultra.annual'),
            pkg('lm', 'ai.veyrnox.generation.lite.monthly'),
            pkg('sm', 'ai.veyrnox.generation.starter.monthly'),
            pkg('sy', 'ai.veyrnox.generation.starter.annual'),
        ]);
        expect(plans.map((p) => `${p.generationPlan}:${p.interval}`)).toEqual(['lite:month', 'starter:month', 'starter:year', 'ultra:year']);
        expect(generationCatalogId('ai.veyrnox.generation.starter.annual')).toBe('starter-yearly');
        expect(parseGenerationCatalog({ plans: [{ id: 'starter-monthly', credits: 398 }, { id: '', credits: 0 }, null] })).toEqual([{ id: 'starter-monthly', credits: 398 }]);
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
    test('does not mistake an unrelated debit or small credit for a purchased pack', async () => {
        const reads = [95, 110, 199, 200];
        const r = await waitForBalanceChange(async () => reads.shift() ?? 200, 100, { ...fast, minimumIncrease: 100 });
        expect(r).toEqual({ changed: true, balance: 200 });
    });
    test('leaves fulfilment pending when the expected pack increase never arrives', async () => {
        const reads = [95, 110, 150, 199];
        const r = await waitForBalanceChange(async () => reads.shift() ?? 199, 100, { ...fast, minimumIncrease: 100 });
        expect(r).toEqual({ changed: false, balance: 199 });
    });
});
