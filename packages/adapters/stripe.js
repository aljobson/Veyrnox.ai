/**
 * Stripe adapter — Checkout Sessions with Managed Payments (ADR-0020).
 *
 *   1. `createCheckoutSession(input, cfg)` — POST /v1/checkout/sessions,
 *      form-encoded, one-time payment, Stripe as merchant of record.
 *   2. `verifyWebhookSignature(rawBody, header, secret)` — Stripe-Signature
 *      HMAC-SHA256 over `${t}.${body}`, 5-minute tolerance.
 *
 * Plain fetch + Web Crypto, no `stripe` package: same reason as fal.js and
 * r2.js — large JS libraries break the OpenNext / Workers Builds bundle.
 */

const STRIPE_API_BASE = 'https://api.stripe.com';
export const STRIPE_API_VERSION = '2025-03-31.basil';
const SIGNATURE_TOLERANCE_SECONDS = 300;
const HEX64_RE = /^[0-9a-f]{64}$/;

/**
 * @param {object} input
 * @param {string} input.purchaseId  our purchases.id; also the idempotency anchor
 * @param {string} input.priceId     credit_packs.stripe_price_id
 * @param {string} input.successUrl
 * @param {string} input.cancelUrl
 * @param {object} cfg
 * @param {string} cfg.secretKey     STRIPE_SECRET_KEY (restricted key)
 * @param {number} [cfg.timeoutMs=10000]
 * @returns {Promise<{ok:true,id:string,url:string}|{ok:false,error:string}>}
 */
export async function createCheckoutSession(input, cfg) {
    const body = new URLSearchParams({
        mode: 'payment',
        'line_items[0][price]': input.priceId,
        'line_items[0][quantity]': '1',
        'managed_payments[enabled]': 'true',
        client_reference_id: input.purchaseId,
        'metadata[purchase_id]': input.purchaseId,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 10000);
    let res;
    try {
        res = await fetch(`${STRIPE_API_BASE}/v1/checkout/sessions`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                Authorization: `Bearer ${cfg.secretKey}`,
                'Stripe-Version': STRIPE_API_VERSION,
                'Idempotency-Key': `checkout-${input.purchaseId}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
        });
    } catch (err) {
        return { ok: false, error: err && err.name === 'AbortError' ? 'stripe timeout' : 'stripe transport' };
    } finally {
        clearTimeout(timer);
    }

    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload || typeof payload.url !== 'string' || typeof payload.id !== 'string') {
        const e = payload && payload.error;
        // Type/code only: Stripe error messages can echo request params.
        return { ok: false, error: `stripe ${res.status}${e ? ` ${e.type}/${e.code || '-'}` : ''}` };
    }
    return { ok: true, id: payload.id, url: payload.url };
}

/**
 * Completed Checkout Sessions created at or after `createdGte` (unix seconds),
 * newest first, following pagination up to `maxPages` pages of 100.
 *
 * @param {number} createdGte
 * @param {object} cfg
 * @param {string} cfg.secretKey
 * @param {number} [cfg.maxPages=10]
 * @returns {Promise<{ok:true,sessions:object[],truncated:boolean}|{ok:false,error:string}>}
 */
export async function listCompletedCheckoutSessions(createdGte, cfg) {
    const maxPages = cfg.maxPages ?? 10;
    const sessions = [];
    let startingAfter = null;
    for (let page = 0; page < maxPages; page++) {
        const url = new URL(`${STRIPE_API_BASE}/v1/checkout/sessions`);
        url.searchParams.set('status', 'complete');
        url.searchParams.set('created[gte]', String(createdGte));
        url.searchParams.set('limit', '100');
        if (startingAfter) url.searchParams.set('starting_after', startingAfter);
        let res;
        try {
            res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.secretKey}`, 'Stripe-Version': STRIPE_API_VERSION } });
        } catch {
            return { ok: false, error: 'stripe transport' };
        }
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload || !Array.isArray(payload.data)) {
            const e = payload && payload.error;
            return { ok: false, error: `stripe ${res.status}${e ? ` ${e.type}/${e.code || '-'}` : ''}` };
        }
        sessions.push(...payload.data);
        if (!payload.has_more || payload.data.length === 0) return { ok: true, sessions, truncated: false };
        startingAfter = payload.data[payload.data.length - 1].id;
    }
    return { ok: true, sessions, truncated: true };
}

/**
 * Read a Price with its Product, for pricing a Credit Pack.
 *
 * @param {string} priceId
 * @param {object} cfg
 * @param {string} cfg.secretKey  a key that can read Prices and Products
 * @returns {Promise<{ok:true,price:object}|{ok:false,error:string}>}
 */
export async function retrievePrice(priceId, cfg) {
    const url = `${STRIPE_API_BASE}/v1/prices/${encodeURIComponent(priceId)}?expand[]=product`;
    let res;
    try {
        res = await fetch(url, {
            headers: { Authorization: `Bearer ${cfg.secretKey}`, 'Stripe-Version': STRIPE_API_VERSION },
        });
    } catch {
        return { ok: false, error: 'stripe transport' };
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload || payload.object !== 'price') {
        const e = payload && payload.error;
        return { ok: false, error: `stripe ${res.status}${e ? ` ${e.type}/${e.code || '-'}` : ''}` };
    }
    return { ok: true, price: payload };
}

/**
 * @param {Uint8Array} rawBody  exact request bytes
 * @param {string|null} header  Stripe-Signature header
 * @param {string} secret       STRIPE_WEBHOOK_SECRET (whsec_...)
 * @param {number} [nowSec]
 * @returns {Promise<boolean>}
 */
export async function verifyWebhookSignature(rawBody, header, secret, nowSec = Math.floor(Date.now() / 1000)) {
    if (!secret || typeof header !== 'string' || !(rawBody instanceof Uint8Array)) return false;

    let t = null;
    const sigs = [];
    for (const part of header.split(',')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        if (k === 't') t = v;
        else if (k === 'v1' && HEX64_RE.test(v)) sigs.push(v);
    }
    if (!t || !/^\d{1,12}$/.test(t) || sigs.length === 0) return false;
    if (Math.abs(nowSec - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) return false;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const prefix = enc.encode(`${t}.`);
    const message = new Uint8Array(prefix.length + rawBody.length);
    message.set(prefix, 0);
    message.set(rawBody, prefix.length);

    // subtle.verify compares in constant time.
    for (const sig of sigs) {
        const bytes = new Uint8Array(sig.match(/../g).map((h) => parseInt(h, 16)));
        if (await crypto.subtle.verify('HMAC', key, bytes, message)) return true;
    }
    return false;
}
