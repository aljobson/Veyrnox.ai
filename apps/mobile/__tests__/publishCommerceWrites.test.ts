import { ApiError } from '../src/lib/api';
import { archiveProduct, buildProductBody, canEditProducts, commerceErrorKey, emptyProductForm, formFromProduct, parseProductDetails, saveProduct, type ProductForm } from '../src/lib/publishCommerce';

const ID = '0a1b2c3d-1111-4222-8333-444455556666';
const ok = (over: Partial<ProductForm> = {}): ProductForm => ({ ...emptyProductForm(), title: 'Print', price: '24.99', ...over });
const row = (over: Record<string, unknown> = {}) => ({
    id: ID, title: 'Print', source: 'manual', status: 'active', currency: 'EUR', price_cents: 2499, compare_at_price_cents: 3000, inventory_quantity: 4,
    description: 'A print', product_url: 'https://shop.example.test/p', image_url: 'https://cdn.example.test/p.jpg',
    variants: [{ title: 'A3', sku: 'P-A3', price_cents: 2499, inventory_quantity: 2 }], collections: ['Prints'], discount: { type: 'percent', value: 1000 }, ...over,
});

describe('products: building the request', () => {
    test('a new product becomes the body the web sends', () => {
        expect(buildProductBody(ok({ compareAt: '30', stock: '7', productUrl: 'https://shop.example.test/p' }))).toEqual({
            body: {
                id: null, title: 'Print', description: '', currency: 'GBP', priceCents: 2499, compareAtPriceCents: 3000, inventoryQuantity: 7,
                productUrl: 'https://shop.example.test/p', imageUrl: null, variants: [], collections: [], discount: null,
            },
        });
    });
    test.each([
        [{ title: ' ' }, 'commerce.err.title'],
        [{ title: 'x'.repeat(161) }, 'commerce.err.title'],
        [{ description: 'd'.repeat(5001) }, 'commerce.err.description'],
        [{ currency: 'EU' }, 'commerce.err.currency'],
        [{ price: '' }, 'commerce.err.price'],
        [{ price: '-1' }, 'commerce.err.price'],
        [{ price: '1000000000' }, 'commerce.err.price'],
        [{ compareAt: 'x' }, 'commerce.err.price'],
        [{ stock: '1.5' }, 'commerce.err.stock'],
        [{ stock: '-2' }, 'commerce.err.stock'],
        [{ productUrl: 'http://a.example.test' }, 'commerce.err.url'],
        [{ imageUrl: 'data:text/html,x' }, 'commerce.err.url'],
        [{ keep: null }, 'commerce.err.editOnWeb'],
    ] as [Partial<ProductForm>, string][])('rejects %j before any request', (over, key) => {
        expect(buildProductBody(ok(over))).toEqual({ errorKey: key });
    });
    test('blank stock is zero and blank old price is none', () => {
        expect(buildProductBody(ok({ stock: ' ', compareAt: ' ' }))).toMatchObject({ body: { inventoryQuantity: 0, compareAtPriceCents: null } });
    });
});

describe('products: reading and editing', () => {
    test('an edit sends the options, collections and discount back unchanged', () => {
        const [p] = parseProductDetails({ brandRole: 'owner', products: [row()] });
        expect(p.editable).toBe(true);
        expect(buildProductBody(formFromProduct(p))).toMatchObject({
            body: {
                id: ID, priceCents: 2499, compareAtPriceCents: 3000, description: 'A print', currency: 'EUR',
                variants: [{ title: 'A3', sku: 'P-A3', priceCents: 2499, inventoryQuantity: 2 }], collections: ['Prints'], discount: { type: 'percent', value: 1000 },
            },
        });
    });
    test('a shop-synced or archived product is not editable here', () => {
        expect(parseProductDetails({ products: [row({ source: 'shopify' })] })[0].editable).toBe(false);
        expect(parseProductDetails({ products: [row({ status: 'archived' })] })[0].editable).toBe(false);
    });
    test('a variant or discount the server would not accept is left for the web', () => {
        expect(parseProductDetails({ products: [row({ variants: [{ title: 'A', price_cents: -1, inventory_quantity: 1 }] })] })[0]).toMatchObject({ keep: null, editable: false });
        expect(parseProductDetails({ products: [row({ discount: { type: 'bogus', value: 1 } })] })[0].editable).toBe(false);
        expect(parseProductDetails({ products: [row({ collections: [5] })] })[0].keep).toBeNull();
    });
    test('no options, no discount is fine', () => {
        const [p] = parseProductDetails({ products: [row({ variants: [], collections: [], discount: null })] });
        expect(p.keep).toEqual({ variants: [], collections: [], discount: null });
    });
    test('only owner, manager and editor can change products', () => {
        expect(canEditProducts({ brandRole: 'manager' })).toBe(true);
        expect(canEditProducts({ brandRole: 'analyst' })).toBe(false);
        expect(canEditProducts(undefined)).toBe(false);
    });
});

describe('products: requests and errors', () => {
    test('save is a PUT and archive is a DELETE with an encoded id', async () => {
        const request = jest.fn().mockResolvedValue({});
        const api = { request } as never;
        const built = buildProductBody(ok());
        if (!('body' in built)) throw new Error('expected a body');
        await saveProduct(api, built.body);
        expect(request).toHaveBeenCalledWith('/api/v1/social/commerce/products', expect.objectContaining({ method: 'PUT', body: JSON.stringify(built.body) }));
        await archiveProduct(api, 'a/b');
        expect(request).toHaveBeenLastCalledWith('/api/v1/social/commerce/products?id=a%2Fb', { method: 'DELETE' });
    });
    test('the web error codes map to their own messages', () => {
        expect(commerceErrorKey(new ApiError(402, 'plan_required'))).toBe('commerce.err.plan');
        expect(commerceErrorKey(new ApiError(403, 'forbidden'))).toBe('commerce.err.role');
        expect(commerceErrorKey(new ApiError(409, 'product_not_editable'))).toBe('commerce.err.notEditable');
        expect(commerceErrorKey(new ApiError(409, 'product_limit'))).toBe('commerce.err.limit');
        expect(commerceErrorKey(new ApiError(404, 'product_not_found'))).toBe('commerce.err.gone');
        expect(commerceErrorKey(new ApiError(404, 'commerce_not_open'))).toBe('commerce.err.notOpen');
        expect(commerceErrorKey(new ApiError(400, 'invalid_body'))).toBe('commerce.err.invalid');
    });
});
