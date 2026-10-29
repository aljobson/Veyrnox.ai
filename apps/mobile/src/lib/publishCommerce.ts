import { buildOptions, emptyOptions, optionsFromKeep, toCents, utf8Bytes, MAX_BODY_BYTES, type OptionsForm, type VariantOut, type DiscountOut } from './publishCommerceOptions';
import { formatCurrency } from './i18n';
import { ApiError, type ApiClient } from './api';

// ADR-0186/0229: the brand product catalogue. Text is third-party-editable: plain and bounded;
// a picture is shown only from an https address and a product link only as its host.

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cents = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

export interface Product {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly source: string;
    readonly currency: string;
    readonly priceCents: number;
    readonly compareAtCents: number | null;
    readonly inventory: number;
    readonly imageUrl: string | null;
    readonly host: string | null;
    readonly variants: number;
    readonly syncError: string | null;
}

const https = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v) && v.length <= 2048 ? v : null);

export function hostOf(url: unknown): string | null {
    const u = https(url);
    if (!u) return null;
    try {
        return new URL(u).host.slice(0, 80);
    } catch {
        return null;
    }
}

export function parseProducts(body: unknown): Product[] {
    const out: Product[] = [];
    const list = isObject(body) && Array.isArray(body.products) ? body.products : [];
    for (const raw of list) {
        if (!isObject(raw)) continue;
        const id = str(raw.id);
        const title = str(raw.title);
        if (!id || !UUID_RE.test(id) || !title) continue;
        const sync = str(raw.sync_error);
        out.push({
            id,
            title: title.slice(0, 160),
            status: str(raw.status) ?? 'draft',
            source: str(raw.source) ?? 'manual',
            currency: typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : 'USD',
            priceCents: cents(raw.price_cents) ?? 0,
            compareAtCents: cents(raw.compare_at_price_cents),
            inventory: cents(raw.inventory_quantity) ?? 0,
            imageUrl: https(raw.image_url),
            host: hostOf(raw.product_url),
            variants: Array.isArray(raw.variants) ? raw.variants.length : 0,
            // eslint-disable-next-line no-control-regex
            syncError: sync ? sync.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : null,
        });
    }
    return out;
}

export const fetchProducts = async (api: ApiClient) => parseProducts(await api.request('/api/v1/social/commerce/products'));

export function money(c: number, currency: string): string {
    return formatCurrency(c / 100, currency);
}

export function commerceErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'commerce.err.network';
    if (err.status === 402) return 'commerce.err.plan';
    if (err.status === 403) return 'commerce.err.role';
    if (err.code === 'product_not_editable') return 'commerce.err.notEditable';
    if (err.code === 'product_limit') return 'commerce.err.limit';
    if (err.code === 'product_not_found') return 'commerce.err.gone';
    if (err.status === 404) return 'commerce.err.notOpen';
    if (err.status === 429) return 'commerce.err.rate';
    if (err.status === 413) return 'commerce.err.tooLarge';
    if (err.code === 'invalid_variant') return 'commerce.err.optionInvalid';
    if (err.code === 'invalid_collections') return 'commerce.err.collections';
    if (err.code === 'invalid_discount') return 'commerce.err.discountInvalid';
    if (err.status === 400) return 'commerce.err.invalid';
    return 'commerce.err.later';
}

// ADR-0229: products, options, collections and discounts can be edited from the phone. Same routes, plan gate and error codes as the
// web (`PUT`/`DELETE /api/v1/social/commerce/products`). Catalogue only: no checkout, no payment, no credits, nothing is
// posted. The server only edits a manual product; a shop-synced product is changed in the shop or on veyrnox.ai.
const EDIT_ROLES = new Set(['owner', 'manager', 'editor']);
export const canEditProducts = (body: unknown): boolean => isObject(body) && typeof body.brandRole === 'string' && EDIT_ROLES.has(body.brandRole);

const wholeCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100000000;

export interface ProductDetail extends Product {
    readonly description: string;
    readonly productUrl: string | null;
    // Stored options seed the editable form. A save replaces the whole product, so unreadable
    // options remain null and the product stays read-only to avoid losing stored data.
    readonly keep: { variants: VariantOut[]; collections: string[]; discount: DiscountOut | null } | null;
    readonly editable: boolean;
}

function keepFrom(raw: Record<string, unknown>): ProductDetail['keep'] {
    const variants: VariantOut[] = [];
    for (const v of Array.isArray(raw.variants) ? raw.variants : []) {
        if (!isObject(v) || typeof v.title !== 'string' || !wholeCents(v.price_cents) || !wholeCents(v.inventory_quantity)) return null;
        variants.push({ title: v.title, sku: typeof v.sku === 'string' ? v.sku : '', priceCents: v.price_cents, inventoryQuantity: v.inventory_quantity });
    }
    const collections: string[] = [];
    for (const c of Array.isArray(raw.collections) ? raw.collections : []) {
        if (typeof c !== 'string') return null;
        collections.push(c);
    }
    let discount: DiscountOut | null = null;
    if (raw.discount != null) {
        const d = raw.discount;
        if (!isObject(d) || (d.type !== 'percent' && d.type !== 'fixed') || !wholeCents(d.value)) return null;
        discount = { type: d.type, value: d.value };
    }
    return { variants, collections, discount };
}

export function parseProductDetails(body: unknown): ProductDetail[] {
    const raws = isObject(body) && Array.isArray(body.products) ? body.products : [];
    const out: ProductDetail[] = [];
    for (const p of parseProducts(body)) {
        const raw = raws.find((r) => isObject(r) && r.id === p.id);
        const r = isObject(raw) ? raw : {};
        const keep = keepFrom(r);
        out.push({
            ...p,
            description: typeof r.description === 'string' ? r.description : '',
            productUrl: https(r.product_url),
            keep,
            editable: p.source === 'manual' && p.status !== 'archived' && keep !== null,
        });
    }
    return out;
}

export async function fetchProductPage(api: ApiClient): Promise<{ products: ProductDetail[]; canEdit: boolean }> {
    const body = await api.request('/api/v1/social/commerce/products');
    return { products: parseProductDetails(body), canEdit: canEditProducts(body) };
}

export interface ProductForm {
    readonly id: string | null;
    readonly title: string;
    readonly description: string;
    readonly currency: string;
    readonly price: string;
    readonly compareAt: string;
    readonly stock: string;
    readonly productUrl: string;
    readonly imageUrl: string;
    readonly keep: ProductDetail['keep'];
    readonly options: OptionsForm;
}

export const emptyProductForm = (): ProductForm => ({
    id: null, title: '', description: '', currency: 'GBP', price: '', compareAt: '', stock: '0', productUrl: '', imageUrl: '',
    keep: { variants: [], collections: [], discount: null }, options: emptyOptions(),
});

const amount = (cents: number): string => (cents / 100).toFixed(2);

export const formFromProduct = (p: ProductDetail): ProductForm => ({
    id: p.id, title: p.title, description: p.description, currency: p.currency, price: amount(p.priceCents),
    compareAt: p.compareAtCents == null ? '' : amount(p.compareAtCents), stock: String(p.inventory), productUrl: p.productUrl ?? '', imageUrl: p.imageUrl ?? '', keep: p.keep,
    options: p.keep ? optionsFromKeep(p.keep) : emptyOptions(),
});

export interface ProductBody {
    readonly id: string | null;
    readonly title: string;
    readonly description: string;
    readonly currency: string;
    readonly priceCents: number;
    readonly compareAtPriceCents: number | null;
    readonly inventoryQuantity: number;
    readonly productUrl: string | null;
    readonly imageUrl: string | null;
    readonly variants: VariantOut[];
    readonly collections: string[];
    readonly discount: DiscountOut | null;
}

// Mirrors the server's checks so a bad form is caught before the request. Returns the body or a catalog key.
export function buildProductBody(f: ProductForm): { body: ProductBody } | { errorKey: string } {
    const title = f.title.trim();
    if (!title || title.length > 160) return { errorKey: 'commerce.err.title' };
    if (f.description.trim().length > 5000) return { errorKey: 'commerce.err.description' };
    const currency = f.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return { errorKey: 'commerce.err.currency' };
    const price = toCents(f.price);
    if (price === null) return { errorKey: 'commerce.err.price' };
    const compare = f.compareAt.trim() ? toCents(f.compareAt) : null;
    if (f.compareAt.trim() && compare === null) return { errorKey: 'commerce.err.price' };
    const stockText = f.stock.trim() || '0';
    const stock = /^\d{1,9}$/.test(stockText) ? Number(stockText) : -1;
    if (stock < 0 || stock > 100000000) return { errorKey: 'commerce.err.stock' };
    const url = f.productUrl.trim();
    const image = f.imageUrl.trim();
    if ((url && !https(url)) || (image && !https(image))) return { errorKey: 'commerce.err.url' };
    if (!f.keep) return { errorKey: 'commerce.err.optionsUnreadable' };
    const options = buildOptions(f.options);
    if ('errorKey' in options) return options;
    const body: ProductBody = {
        id: f.id, title, description: f.description.trim(), currency, priceCents: price, compareAtPriceCents: compare, inventoryQuantity: stock,
        productUrl: url || null, imageUrl: image || null, ...options,
    };
    if (utf8Bytes(JSON.stringify(body)) > MAX_BODY_BYTES) return { errorKey: 'commerce.err.tooLarge' };
    return { body };
}

export const saveProduct = (api: ApiClient, body: ProductBody) =>
    api.request<{ product_id?: string; created?: boolean }>('/api/v1/social/commerce/products', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const archiveProduct = (api: ApiClient, id: string) => api.request(`/api/v1/social/commerce/products?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
