import type { ProductDetail } from './publishCommerce';

export const MAX_OPTIONS = 100;
export const MAX_COLLECTIONS = 20;
export const MAX_VARIANT_BYTES = 56000;
export const MAX_BODY_BYTES = 65536;
export interface VariantForm { readonly title: string; readonly sku: string; readonly price: string; readonly stock: string }
export interface OptionsForm {
    readonly variants: readonly VariantForm[];
    readonly collections: readonly string[];
    readonly discountType: '' | 'percent' | 'fixed';
    readonly discountValue: string;
}
export interface VariantOut { title: string; sku: string; priceCents: number; inventoryQuantity: number }
export interface DiscountOut { type: 'percent' | 'fixed'; value: number }
export const emptyOptions = (): OptionsForm => ({ variants: [], collections: [], discountType: '', discountValue: '' });
export const optionsFromKeep = (keep: NonNullable<ProductDetail['keep']>): OptionsForm => ({
    variants: keep.variants.map(v => ({ title: v.title, sku: v.sku, price: (v.priceCents / 100).toFixed(2), stock: String(v.inventoryQuantity) })),
    collections: [...keep.collections],
    discountType: keep.discount?.type ?? '',
    discountValue: keep.discount ? (keep.discount.value / 100).toFixed(2) : '',
});

export const toCents = (text: string): number | null => {
    const s = text.trim().replace(',', '.');
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
    const c = Math.round(Number(s) * 100);
    return c <= 100000000 ? c : null;
};

// Unpaired surrogates occupy three bytes, as the UTF-8 replacement character does.
export function utf8Bytes(s: string): number {
    let bytes = 0;
    for (const character of s) {
        const point = character.codePointAt(0)!;
        bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    return bytes;
}

export function buildOptions(o: OptionsForm): { variants: VariantOut[]; collections: string[]; discount: DiscountOut | null } | { errorKey: string } {
    if (o.variants.length > MAX_OPTIONS) return { errorKey: 'commerce.err.optionLimit' };
    const variants: VariantOut[] = [];
    for (const v of o.variants) {
        const title = v.title.trim(), sku = v.sku.trim();
        if (!title || title.length > 120) return { errorKey: 'commerce.err.optionTitle' };
        if (sku.length > 100) return { errorKey: 'commerce.err.optionSku' };
        const priceCents = toCents(v.price);
        if (priceCents === null) return { errorKey: 'commerce.err.price' };
        const stock = v.stock.trim() || '0';
        if (!/^\d{1,9}$/.test(stock) || Number(stock) > 100000000) return { errorKey: 'commerce.err.stock' };
        variants.push({ title, sku, priceCents, inventoryQuantity: Number(stock) });
    }
    const collections = [...new Set(o.collections.map(c => c.trim()).filter(Boolean))];
    if (collections.length > MAX_COLLECTIONS || collections.some(c => c.length > 80)) return { errorKey: 'commerce.err.collections' };
    const snakeVariants = variants.map(v => ({ title: v.title, sku: v.sku, price_cents: v.priceCents, inventory_quantity: v.inventoryQuantity }));
    // Conservative JSON-text budget for the RPC's 65536-byte jsonb storage limit (ADR-0298).
    if (utf8Bytes(JSON.stringify(snakeVariants)) > MAX_VARIANT_BYTES) return { errorKey: 'commerce.err.tooLarge' };
    let discount: DiscountOut | null = null;
    if (o.discountType === 'percent') {
        const value = o.discountValue.trim().replace(',', '.');
        const basisPoints = Math.round(Number(value) * 100);
        if (!/^\d{1,3}(\.\d{1,2})?$/.test(value) || basisPoints > 10000) return { errorKey: 'commerce.err.discountPercent' };
        discount = { type: 'percent', value: basisPoints };
    } else if (o.discountType === 'fixed') {
        const value = toCents(o.discountValue);
        if (value === null) return { errorKey: 'commerce.err.discountAmount' };
        discount = { type: 'fixed', value };
    }
    return { variants, collections, discount };
}
