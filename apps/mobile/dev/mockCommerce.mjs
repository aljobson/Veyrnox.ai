import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = value => typeof value === 'string' ? value.trim() : '';
const whole = value => Number.isInteger(value) && value >= 0 && value <= 100000000;
function https(value) {
    if (value == null || value === '') return null;
    try { return new URL(value).protocol === 'https:' && value.length <= 2048 ? value : null; } catch { return null; }
}

export function mockCommerce(req, res, path, body, respond, brandHeader, BRAND_VIEW) {
    if (path !== '/api/v1/social/commerce/products') return false;
    const send = (status, result) => { respond(res, status, result); return true; };
    const products = (globalThis.__MOCK_PRODUCTS ??= [
        { id: 'ca111111-1111-4111-8111-111111111111', title: 'Studio print', source: 'manual', status: 'active', currency: 'GBP', price_cents: 2499, inventory_quantity: 4,
            variants: [{ title: 'A3', sku: 'P-A3', price_cents: 2499, inventory_quantity: 2 }, { title: 'A4', sku: 'P-A4', price_cents: 1499, inventory_quantity: 2 }],
            collections: ['Prints'], discount: { type: 'percent', value: 1000 } },
        { id: 'ca222222-2222-4222-8222-222222222222', title: 'Shop poster', source: 'shopify', status: 'active', currency: 'GBP', price_cents: 1800, inventory_quantity: 3,
            variants: [{ title: 'Standard', sku: 'S-1', price_cents: 1800, inventory_quantity: 3 }], collections: [], discount: null },
    ]);
    if (req.method === 'GET') return send(200, { products, brandRole: brandHeader === BRAND_VIEW ? 'viewer' : 'owner' });
    if (brandHeader === BRAND_VIEW) return send(403, { error: 'forbidden' });
    if (req.method === 'PUT') {
        if (Buffer.byteLength(JSON.stringify(body)) > 65536) return send(413, { error: 'body_too_large' });
        const id = body?.id ?? null, title = text(body?.title), description = text(body?.description), currency = text(body?.currency).toUpperCase();
        const productUrl = https(body?.productUrl), imageUrl = https(body?.imageUrl);
        const collections = Array.isArray(body?.collections) ? [...new Set(body.collections.map(text).filter(Boolean))] : null;
        const variants = Array.isArray(body?.variants) ? body.variants.map(v => ({ title: text(v?.title), sku: text(v?.sku), price_cents: v?.priceCents, inventory_quantity: v?.inventoryQuantity })) : null;
        const discount = body?.discount == null ? null : { type: body.discount.type, value: body.discount.value };
        if ((id && !UUID.test(id)) || !title || title.length > 160 || description.length > 5000 || !/^[A-Z]{3}$/.test(currency)
            || !whole(body?.priceCents) || (body?.compareAtPriceCents != null && !whole(body.compareAtPriceCents)) || !whole(body?.inventoryQuantity)
            || (body?.productUrl && productUrl === null) || (body?.imageUrl && imageUrl === null)
            || !collections || collections.length > 20 || collections.some(c => c.length > 80)
            || !variants || variants.length > 100 || variants.some(v => !v.title || v.title.length > 120 || v.sku.length > 100 || !whole(v.price_cents) || !whole(v.inventory_quantity))
            || (discount && (!['percent', 'fixed'].includes(discount.type) || !whole(discount.value) || (discount.type === 'percent' && discount.value > 10000)))) return send(400, { error: 'invalid_body' });
        // JSON text is only a development stand-in for PostgreSQL's jsonb column size.
        if (Buffer.byteLength(JSON.stringify(variants)) > 65536) return send(400, { error: 'invalid_product' });
        const index = products.findIndex(p => p.id === id);
        if (id && index < 0) return send(404, { error: 'product_not_found' });
        if (index >= 0 && (products[index].source !== 'manual' || products[index].status === 'archived')) return send(409, { error: 'product_not_editable' });
        const product = { id: id || randomUUID(), title, description, currency, price_cents: body.priceCents, compare_at_price_cents: body.compareAtPriceCents ?? null,
            inventory_quantity: body.inventoryQuantity, product_url: productUrl, image_url: imageUrl, variants, collections, discount, source: 'manual', status: index < 0 ? 'draft' : products[index].status };
        if (index < 0) products.push(product); else products[index] = product;
        return send(index < 0 ? 201 : 200, { product_id: product.id, created: index < 0 });
    }
    if (req.method === 'DELETE') {
        const id = new URL(req.url, 'http://localhost').searchParams.get('id');
        if (!UUID.test(id ?? '')) return send(400, { error: 'invalid_id' });
        const product = products.find(p => p.id === id);
        if (!product) return send(404, { error: 'product_not_found' });
        product.status = 'archived';
        return send(200, { ok: true });
    }
    return false;
}
