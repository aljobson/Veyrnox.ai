import { ApiError } from '../src/lib/api';
import { commerceErrorKey, hostOf, money, parseProducts } from '../src/lib/publishCommerce';

const ID = '0a1b2c3d-1111-4222-8333-444455556666';

describe('commerce', () => {
    test('parses products and drops rows without a real id or title', () => {
        const r = parseProducts({ products: [{ id: ID, title: 'Print', status: 'active', currency: 'GBP', price_cents: 2500, compare_at_price_cents: 3000, inventory_quantity: 4, image_url: 'https://cdn.example.test/p.jpg', product_url: 'https://shop.example.test/p', variants: [{}, {}], sync_error: 'bad\u0000thing' }, { id: 'x', title: 'y' }, { id: ID }] });
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ title: 'Print', priceCents: 2500, compareAtCents: 3000, inventory: 4, variants: 2, host: 'shop.example.test', imageUrl: 'https://cdn.example.test/p.jpg' });
        expect(r[0].syncError).not.toContain('\u0000');
        expect(parseProducts(null)).toEqual([]);
    });
    test('only https pictures and links are kept; links become hosts', () => {
        const r = parseProducts({ products: [{ id: ID, title: 'T', image_url: 'http://x.test/a.jpg', product_url: 'javascript:alert(1)' }] });
        expect(r[0].imageUrl).toBeNull();
        expect(r[0].host).toBeNull();
        expect(hostOf('https://a.example.test/x?y=1')).toBe('a.example.test');
    });
    test('negative or missing numbers fall back to zero or null', () => {
        const r = parseProducts({ products: [{ id: ID, title: 'T', price_cents: -1, inventory_quantity: 'many' }] });
        expect(r[0]).toMatchObject({ priceCents: 0, inventory: 0, compareAtCents: null });
    });
    test('money survives an unknown currency', () => {
        expect(money(2500, 'USD')).toMatch(/25[.,]00/);
        expect(money(2500, 'ZZZ')).toMatch(/25[.,]00/);
    });
    test('error keys', () => {
        expect(commerceErrorKey(new ApiError(402, 'plan_required'))).toBe('commerce.err.plan');
        expect(commerceErrorKey(new ApiError(404, 'commerce_not_open'))).toBe('commerce.err.notOpen');
    });
});
