import { bestPackId, packRates, packSavingPercent, subscriptionSavingPercent, typicalCosts, yearlySaving } from '../src/lib/creditOffers';
import { toDisplayPackages } from '../src/lib/billing';
import type { CatalogModel } from '../src/lib/media';
const packs = toDisplayPackages([100, 300, 1000].map((credits, i) => ({ identifier: String(credits), product: { identifier: `ai.veyrnox.credits.${credits}`, title: 'Pack', priceString: 'store price', price: [10, 25, 70][i], currencyCode: 'GBP' } })));
test('best value is strict, requires multiple packs, and savings are floored', () => {
    expect(bestPackId(packs)).toBe('1000'); expect(bestPackId(packs.slice(0, 1))).toBeNull();
    expect(bestPackId([packs[0], { ...packs[1], price: 30 }])).toBeNull();
    expect(packSavingPercent(packs[1], packs)).toBe(16);
    expect(packRates(packs)?.get('100')).toBe(.1);
});
test.each([{ price: null }, { price: undefined }, { price: 0 }, { price: -1 }, { price: NaN }, { currencyCode: 'USD' }, { currencyCode: undefined }])('invalid ratio inputs suppress every comparison: %j', change => {
    const invalid = [packs[0], { ...packs[1], ...change }];
    expect(packRates(invalid)).toBeNull(); expect(bestPackId(invalid)).toBeNull(); expect(packSavingPercent(packs[0], invalid)).toBeNull();
    expect(subscriptionSavingPercent(packs[0], 100, invalid)).toBeNull();
});
test('annual allowance uses twelve monthly grants, and annual saving compares twelve monthly prices', () => {
    const month = { ...packs[0], generationPlan: 'starter' as const, interval: 'month' as const, price: 10 };
    const year = { ...month, interval: 'year' as const, price: 100 };
    expect(subscriptionSavingPercent(year, 200, packs)).toBe(40);
    expect(yearlySaving(year, [month, year])).toBe(16);
    expect(yearlySaving(year, [{ ...month, currencyCode: 'EUR' }])).toBeNull();
    expect(yearlySaving(year, [])).toBeNull();
});
test('typical costs use the web upper median of positive open non-plan video and image models', () => {
    const model = (modality: string, credits: number, extra = {}): CatalogModel => ({ id: '', name: '', modality, credits, gated: false, durations: [5], capabilities: null, ...extra });
    expect(typicalCosts([model('video', 10), model('video', 30), model('image', 4), model('image', 7), model('image', 12),
        model('video', 999, { gated: true }), model('image', 800, { capabilities: { inputs: { plan_id: {} } } }), model('audio', 40), model('image', 0), model('video', -3)]))
        .toEqual({ video: 30, image: 7 });
    expect(typicalCosts([])).toEqual({ video: null, image: null });
});
