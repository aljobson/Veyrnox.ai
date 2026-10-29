import { ApiError } from '../src/lib/api';
import { buildProductBody, commerceErrorKey, emptyProductForm, formFromProduct, parseProductDetails } from '../src/lib/publishCommerce';
import { buildOptions, emptyOptions, MAX_BODY_BYTES, MAX_VARIANT_BYTES, optionsFromKeep, utf8Bytes, type OptionsForm, type VariantForm } from '../src/lib/publishCommerceOptions';
const variant: VariantForm = { title: 'A3', sku: 'P-A3', price: '24.99', stock: '2' };
const keep = { variants: [{ title: 'A3', sku: 'P-A3', priceCents: 2499, inventoryQuantity: 2 }], collections: ['Prints'], discount: { type: 'percent' as const, value: 1000 } };
const options = (over: Partial<OptionsForm> = {}): OptionsForm => ({ ...emptyOptions(), variants: [variant], ...over });
const snakeBytes = (variants: readonly VariantForm[]) => utf8Bytes(JSON.stringify(variants.map(v => ({ title: v.title, sku: v.sku, price_cents: 2499, inventory_quantity: 2 }))));
function atBudget(budget: number): OptionsForm {
    const variants = Array.from({ length: 100 }, () => ({ ...variant, title: 'a'.repeat(120), sku: 'a'.repeat(100) }));
    let remaining = budget - snakeBytes(variants);
    for (const v of variants) for (const key of ['title', 'sku'] as const) {
        const count = Math.min(v[key].length, Math.floor(remaining / 2));
        v[key] = '中'.repeat(count) + v[key].slice(count); remaining -= count * 2;
        if (remaining === 1 && count < v[key].length) { v[key] = v[key].slice(0, count) + 'é' + v[key].slice(count + 1); remaining--; }
    }
    expect(remaining).toBe(0); expect(snakeBytes(variants)).toBe(budget);
    return options({ variants });
}
test("a product's stored options become the form and go back unchanged", () => {
    const product = parseProductDetails({ products: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Print', source: 'manual', price_cents: 2499,
        variants: [{ title: 'A3', sku: 'P-A3', price_cents: 2499, inventory_quantity: 2 }], collections: ['Prints'], discount: keep.discount }] })[0];
    const form = formFromProduct(product);
    expect(form.options).toEqual({ variants: [variant], collections: ['Prints'], discountType: 'percent', discountValue: '10.00' });
    expect(buildOptions(form.options)).toEqual(keep);
    expect(buildProductBody(form)).toEqual({ body: expect.objectContaining(keep) });
});
test('a 12.5 percent discount is 1250 and a 4.99 fixed discount is 499', () => {
    for (const value of ['12.5', '12,5']) expect(buildOptions(options({ discountType: 'percent', discountValue: value }))).toMatchObject({ discount: { type: 'percent', value: 1250 } });
    expect(buildOptions(options({ discountType: 'fixed', discountValue: '4.99' }))).toMatchObject({ discount: { type: 'fixed', value: 499 } });
    expect(optionsFromKeep({ ...keep, discount: { type: 'fixed', value: 499 } }).discountValue).toBe('4.99');
});
test.each<[Partial<OptionsForm>, string]>([
    [{ variants: Array(101).fill(variant) }, 'optionLimit'],
    ...[['title', '', 'optionTitle'], ['title', 'x'.repeat(121), 'optionTitle'], ['sku', 'x'.repeat(101), 'optionSku'],
        ['price', '-1', 'price'], ['price', '1.234', 'price'], ['price', '1000000000', 'price'], ['stock', '1.5', 'stock'],
        ['stock', '100000001', 'stock']].map(([key, value, error]): [Partial<OptionsForm>, string] => [{ variants: [{ ...variant, [key]: value }] }, error]),
    [{ collections: Array.from({ length: 21 }, (_, i) => String(i)) }, 'collections'],
    [{ collections: ['x'.repeat(81)] }, 'collections'],
    [{ discountType: 'percent', discountValue: '100.01' }, 'discountPercent'],
    [{ discountType: 'fixed', discountValue: 'x' }, 'discountAmount'],
    [{ discountType: 'percent', discountValue: '' }, 'discountPercent'],
])('options the route would refuse are caught before the request (%j)', (over, key) => {
    expect(buildOptions(options(over))).toEqual({ errorKey: `commerce.err.${key}` });
});
test('collections are trimmed and de-duplicated in first order', () => {
    expect(buildOptions(options({ collections: [' B', 'A ', 'B', '', ''] }))).toMatchObject({ collections: ['B', 'A'] });
});
test('a collection name containing a comma survives the round trip', () => {
    expect(buildOptions(optionsFromKeep({ ...keep, collections: ['Prints, Gifts', 'Sale'] }))).toEqual({ ...keep, collections: ['Prints, Gifts', 'Sale'] });
});
test('utf8Bytes counts ASCII, accented, CJK and emoji', () => {
    expect(['a', 'é', '中', '😀', 'aé中😀', '\ud800'].map(utf8Bytes)).toEqual([1, 2, 3, 4, 10, 3]);
});
test('options exactly at the variant byte budget pass and one byte over is too large', () => {
    expect(buildOptions(atBudget(MAX_VARIANT_BYTES))).not.toHaveProperty('errorKey');
    expect(buildOptions(atBudget(MAX_VARIANT_BYTES + 1))).toEqual({ errorKey: 'commerce.err.tooLarge' });
});
test('100 options with long CJK names and SKUs are refused as too large although each field is valid', () => {
    expect(buildOptions(options({ variants: Array(100).fill({ ...variant, title: '中'.repeat(120), sku: '中'.repeat(100) }) }))).toEqual({ errorKey: 'commerce.err.tooLarge' });
});
test('a body over 64 KiB is refused as too large', () => {
    const form = { ...emptyProductForm(), title: 'Print', price: '24.99', options: atBudget(51000) };
    const built = buildProductBody(form); if ('errorKey' in built) throw Error(built.errorKey);
    const room = MAX_BODY_BYTES - utf8Bytes(JSON.stringify(built.body));
    const description = '中'.repeat(Math.floor(room / 3)) + 'a'.repeat(room % 3);
    expect(description.length).toBeLessThan(5000);
    const exact = buildProductBody({ ...form, description });
    expect(exact).toHaveProperty('body');
    if ('body' in exact) expect(utf8Bytes(JSON.stringify(exact.body))).toBe(MAX_BODY_BYTES);
    expect(buildProductBody({ ...form, description: description + 'a' })).toEqual({ errorKey: 'commerce.err.tooLarge' });
    expect(buildProductBody({ ...form, description: '中'.repeat(5000) })).toEqual({ errorKey: 'commerce.err.tooLarge' });
});
test('a 413 from the route shows the too-large message', () => expect(commerceErrorKey(new ApiError(413, 'body_too_large'))).toBe('commerce.err.tooLarge'));
test('no discount type ignores the value', () => expect(buildOptions(options({ discountValue: 'invalid' }))).toMatchObject({ discount: null }));
test('the RPC option codes map to their own messages', () => {
    for (const [code, key] of [['invalid_variant', 'optionInvalid'], ['invalid_collections', 'collections'], ['invalid_discount', 'discountInvalid']])
        expect(commerceErrorKey(new ApiError(400, code))).toBe(`commerce.err.${key}`);
});
