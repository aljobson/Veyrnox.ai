/**
 * LemonSqueezy adapter — Merchant of Record for web Credit Packs (ADR-0018).
 *
 * Plain fetch against a constant API host, no SDK (the Workers bundle rule in
 * CLAUDE.md). The network function is injected so tests never touch it.
 *
 * Configuration (read from env at the route layer):
 *   LEMONSQUEEZY_API_KEY         Worker secret. Test-mode key makes test checkouts.
 *   LEMONSQUEEZY_WEBHOOK_SECRET  Worker secret. Signs /api/webhook/lemonsqueezy.
 *   LEMONSQUEEZY_STORE_ID        Worker var.
 *   LEMONSQUEEZY_TEST_MODE       Worker var, "true" or "false": which orders count.
 *   PUBLIC_HOST                  https origin the buyer returns to.
 */

const LEMONSQUEEZY_API_BASE = 'https://api.lemonsqueezy.com/v1';
const JSON_API = 'application/vnd.api+json';
const NUMERIC_ID_RE = /^[0-9]{1,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RETURN_PATH = '/app/credits';

/**
 * Create a hosted checkout for one pending Top-up.
 *
 * @param {object} input
 * @param {string} input.variantId  LemonSqueezy variant id, copied from the Top-up row
 * @param {string} input.topUpId    our top_ups.id; travels in checkout custom data
 * @param {string} [input.expiresAt] ISO timestamp after which the checkout link is dead
 * @param {object} cfg
 * @param {typeof fetch} cfg.fetch
 * @param {string} cfg.apiKey
 * @param {string} cfg.storeId
 * @param {string} cfg.publicHost
 * @param {number} [cfg.timeoutMs=10000]
 * @returns {Promise<{ok: true, url: string} | {ok: false, error: string}>}
 */
export async function createCheckout(input, cfg) {
    if (!NUMERIC_ID_RE.test(String(input.variantId))) return { ok: false, error: 'invalid variantId' };
    if (!UUID_RE.test(String(input.topUpId))) return { ok: false, error: 'invalid topUpId' };
    if (!NUMERIC_ID_RE.test(String(cfg.storeId))) return { ok: false, error: 'invalid storeId' };
    if (!cfg.apiKey) return { ok: false, error: 'missing apiKey' };

    let redirect;
    try { redirect = new URL(RETURN_PATH, cfg.publicHost); } catch { return { ok: false, error: 'invalid publicHost' }; }
    if (redirect.protocol !== 'https:') return { ok: false, error: 'publicHost must be https' };
    redirect.searchParams.set('top_up', input.topUpId);

    const body = {
        data: {
            type: 'checkouts',
            attributes: {
                product_options: {
                    redirect_url: redirect.toString(),
                    enabled_variants: [Number(input.variantId)],
                },
                checkout_data: { custom: { top_up_id: input.topUpId } },
                ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
            },
            relationships: {
                store: { data: { type: 'stores', id: String(cfg.storeId) } },
                variant: { data: { type: 'variants', id: String(input.variantId) } },
            },
        },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 10000);
    let res;
    try {
        res = await cfg.fetch(`${LEMONSQUEEZY_API_BASE}/checkouts`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                Accept: JSON_API,
                'Content-Type': JSON_API,
                Authorization: `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify(body),
        });
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.name}` };
    } finally {
        clearTimeout(timer);
    }

    // Vendor error bodies stay out of the result; the route logs status only.
    if (!res.ok) return { ok: false, error: `lemonsqueezy ${res.status}` };

    let data;
    try { data = await res.json(); } catch { return { ok: false, error: 'lemonsqueezy returned non-JSON' }; }
    const url = data && data.data && data.data.attributes && data.data.attributes.url;
    // The browser is sent here, so only a LemonSqueezy https URL is acceptable.
    let parsed;
    try { parsed = new URL(url); } catch { return { ok: false, error: 'checkout url missing' }; }
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.lemonsqueezy.com')) {
        return { ok: false, error: 'checkout url not on lemonsqueezy.com' };
    }
    return { ok: true, url: parsed.toString() };
}

const SIGNATURE_RE = /^[0-9a-f]{64}$/i;

/**
 * Verify LemonSqueezy's X-Signature: hex HMAC-SHA256 of the raw body under
 * the webhook signing secret. crypto.subtle.verify compares in constant time,
 * so no hand-rolled compare. Fails closed on a missing header or secret and
 * on anything that is not exactly 64 hex characters.
 *
 * @param {Uint8Array} rawBody  the exact request bytes
 * @param {string|null} signatureHeader
 * @param {string|undefined} secret
 * @returns {Promise<boolean>}
 */
export async function verifyWebhookSignature(rawBody, signatureHeader, secret) {
    if (!secret || typeof signatureHeader !== 'string' || !SIGNATURE_RE.test(signatureHeader)) return false;
    const sig = new Uint8Array(32);
    for (let i = 0; i < 32; i++) sig[i] = parseInt(signatureHeader.slice(i * 2, i * 2 + 2), 16);
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    return crypto.subtle.verify('HMAC', key, sig, rawBody);
}

const isCents = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * Our shape for a LemonSqueezy order. The money facts come from the order
 * re-fetched from the API; the Top-up id comes from the signed webhook's
 * meta.custom_data, because the API's order object does not carry custom
 * data. The id is only a pointer to our pending row, never a user.
 *
 * @param {any} order        JSON:API order resource ({id, attributes})
 * @param {any} customData   verified webhook meta.custom_data
 * @param {{expectTestMode: boolean, expectStoreId: string}} opts
 * @returns {{ok: true, order: {orderId: string, status: string, paidCents: number, currency: string,
 *   variantId: string, refundedCents: number, totalCents: number, topUpId: string, testMode: boolean}} | {ok: false, error: string}}
 */
export function normaliseOrder(order, customData, { expectTestMode, expectStoreId }) {
    const topUpId = customData && customData.top_up_id;
    if (typeof topUpId !== 'string' || !UUID_RE.test(topUpId)) return { ok: false, error: 'invalid top_up_id' };

    const a = order && order.attributes;
    const item = a && a.first_order_item;
    if (!a || !item || !NUMERIC_ID_RE.test(String(order.id))) return { ok: false, error: 'malformed order' };
    const variantId = String(item.variant_id);
    const refunded = a.refunded_amount ?? 0;
    if (!NUMERIC_ID_RE.test(variantId) || !isCents(a.subtotal) || !isCents(a.discount_total ?? 0) || !isCents(refunded) || !isCents(a.total)
        || typeof a.currency !== 'string' || typeof a.status !== 'string') {
        return { ok: false, error: 'malformed order' };
    }

    // An order from another store on the same account is never ours to credit.
    if (!NUMERIC_ID_RE.test(String(expectStoreId)) || String(a.store_id) !== String(expectStoreId)) {
        return { ok: false, error: 'store mismatch' };
    }

    // Both flags must match: a test order is never credited in live mode.
    const testMode = a.test_mode === true || item.test_mode === true;
    if (testMode !== (expectTestMode === true)) return { ok: false, error: 'test_mode mismatch' };

    return {
        ok: true,
        order: {
            orderId: String(order.id),
            status: a.status,
            // Pre-tax: tax is charged on top (tax-exclusive store, ADR-0018).
            paidCents: a.subtotal - (a.discount_total ?? 0),
            currency: a.currency,
            variantId,
            refundedCents: refunded,
            // Tax included: refunded_amount is measured against this.
            totalCents: a.total,
            topUpId,
            testMode,
        },
    };
}

/**
 * Re-fetch one order from the constant API host. `transient` tells the
 * webhook whether LemonSqueezy should retry (5xx, 429, network).
 *
 * @param {string} orderId  numeric LemonSqueezy order id
 * @param {{fetch: typeof fetch, apiKey: string, timeoutMs?: number}} cfg
 * @returns {Promise<{ok: true, order: any} | {ok: false, error: string, transient: boolean}>}
 */
export async function fetchOrder(orderId, cfg) {
    if (!NUMERIC_ID_RE.test(String(orderId ?? ''))) return { ok: false, error: 'invalid orderId', transient: false };
    if (!cfg.apiKey) return { ok: false, error: 'missing apiKey', transient: false };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 10000);
    let res;
    try {
        res = await cfg.fetch(`${LEMONSQUEEZY_API_BASE}/orders/${orderId}`, {
            method: 'GET',
            signal: controller.signal,
            headers: { Accept: JSON_API, Authorization: `Bearer ${cfg.apiKey}` },
        });
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.name}`, transient: true };
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) return { ok: false, error: `lemonsqueezy ${res.status}`, transient: res.status >= 500 || res.status === 429 };

    let data;
    try { data = await res.json(); } catch { return { ok: false, error: 'lemonsqueezy returned non-JSON', transient: true }; }
    const resource = data && data.data;
    if (!resource || String(resource.id) !== String(orderId)) return { ok: false, error: 'order id mismatch', transient: false };
    return { ok: true, order: resource };
}
