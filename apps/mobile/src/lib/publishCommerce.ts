import { ApiError, type ApiClient } from './api';

// ADR-0186: the product catalogue, read-only. Titles, prices and stock as the brand keeps them; changing a product,
// syncing a shop and discounts stay on veyrnox.ai. Text is third-party-editable: plain and bounded; a picture is shown
// only from an https address and a product link only as its host.

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
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(c / 100);
    } catch {
        return `${(c / 100).toFixed(2)} ${currency}`;
    }
}

export function commerceErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'commerce.err.network';
    if (err.status === 402) return 'commerce.err.plan';
    if (err.status === 403) return 'commerce.err.role';
    if (err.status === 404) return 'commerce.err.notOpen';
    if (err.status === 429) return 'commerce.err.rate';
    return 'commerce.err.later';
}
