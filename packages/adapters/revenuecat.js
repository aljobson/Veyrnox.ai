/**
 * RevenueCat webhook verification and parsing (ADR-0108). Web Crypto only.
 *
 * Authentication: with "HMAC webhook signing" on, every delivery carries
 *   X-RevenueCat-Webhook-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
 * over the string "<t>.<raw body bytes>", keyed by the signing secret shown once
 * in the dashboard. Retries are re-signed, so t is the time of that attempt.
 * Source: RevenueCat docs, Webhooks (checked 2026-10-17).
 *
 * The body is evidence only after the signature holds. The customer id inside it
 * is a secret we issued (store_customers), never an account id.
 */

const SIGNATURE_TOLERANCE_SECONDS = 300;
const enc = (s) => new TextEncoder().encode(s);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;
const PRODUCT_RE = /^[A-Za-z0-9._-]{1,128}$/;
const TRANSACTION_MAX = 200;

/**
 * @param {Uint8Array} rawBody exact bytes received
 * @param {string|null} header X-RevenueCat-Webhook-Signature
 * @param {string} secret
 */
export async function verifyWebhookSignature(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!secret || typeof header !== 'string' || header.length > 1024) return false;
    let timestamp = null;
    const candidates = [];
    for (const part of header.split(',')) {
        const [k, v] = part.trim().split('=', 2);
        if (k === 't' && /^[0-9]{1,12}$/.test(v || '')) timestamp = Number(v);
        if (k === 'v1' && /^[0-9a-f]{64}$/.test(v || '')) candidates.push(v);
    }
    if (timestamp === null || !candidates.length) return false;
    if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

    const prefix = enc(`${timestamp}.`);
    const payload = new Uint8Array(prefix.length + rawBody.length);
    payload.set(prefix);
    payload.set(rawBody, prefix.length);
    const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    for (const hex of candidates) {
        const sig = new Uint8Array(32);
        for (let i = 0; i < 32; i += 1) sig[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        // crypto.subtle.verify compares in constant time.
        if (await crypto.subtle.verify('HMAC', key, sig, payload)) return true;
    }
    return false;
}

// TEST_STORE is RevenueCat's fake store for development: it maps to the iOS packs and is always sandbox,
// so production (which ignores sandbox events) can never credit it.
const STORES = { APP_STORE: 'ios', PLAY_STORE: 'android', TEST_STORE: 'ios' };

const CREDITS_PREFIX = 'ai.veyrnox.credits.';
const PUBLISH_PREFIX = 'ai.veyrnox.publish.';
const GENERATION_PREFIX = 'ai.veyrnox.generation.';
// Subscription events that (re)open or extend a plan. Source: RevenueCat docs, event types (checked 2026-10-17).
const SUBSCRIPTION_ACTIONS = {
    INITIAL_PURCHASE: 'activate', RENEWAL: 'activate', PRODUCT_CHANGE: 'activate', UNCANCELLATION: 'activate',
    BILLING_ISSUE: 'past_due', EXPIRATION: 'expire',
};

const finiteMs = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * Reduces a verified webhook body to what we act on.
 * @returns {{kind:'ignore', reason:string}
 *   |{kind:'purchase'|'refund', eventId:string, channel:'ios'|'android', productId:string,
 *     transactionId:string, customerIds:string[], sandbox:boolean}
 *   |{kind:'subscription', family:'publish'|'generation', eventId:string, type:string, action:'activate'|'cancel_at_period_end'|'past_due'|'expire'|'refund',
 *     channel:'ios'|'android', productId:string, originalTransactionId:string, periodEnd:string|null,
 *     occurredAt:string, customerIds:string[], sandbox:boolean}}
 */
export function parseStoreEvent(body) {
    const event = body && typeof body === 'object' ? body.event : null;
    if (!event || typeof event !== 'object') return { kind: 'ignore', reason: 'no_event' };
    const type = event.type;
    if (type !== 'NON_RENEWING_PURCHASE' && type !== 'CANCELLATION' && !(type in SUBSCRIPTION_ACTIONS)) return { kind: 'ignore', reason: 'type' };

    const eventId = typeof event.id === 'string' ? event.id : '';
    if (!EVENT_ID_RE.test(eventId)) return { kind: 'ignore', reason: 'event_id' };
    const store = String(event.store || '').toUpperCase();
    const channel = STORES[store];
    if (!channel) return { kind: 'ignore', reason: 'store' };
    const transactionId = typeof event.transaction_id === 'string' ? event.transaction_id : '';
    if (!transactionId || transactionId.length > TRANSACTION_MAX) return { kind: 'ignore', reason: 'transaction' };
    // A plan change names the new product in new_product_id; every other event carries it in product_id.
    const productId = typeof event.new_product_id === 'string' && type === 'PRODUCT_CHANGE' ? event.new_product_id
        : typeof event.product_id === 'string' ? event.product_id : '';
    if (!PRODUCT_RE.test(productId)) return { kind: 'ignore', reason: 'product' };

    const customerIds = [event.app_user_id, event.original_app_user_id]
        .filter((v, i, a) => typeof v === 'string' && UUID_RE.test(v) && a.indexOf(v) === i)
        .map((v) => v.toLowerCase());
    const sandbox = store === 'TEST_STORE' || String(event.environment || '').toUpperCase() !== 'PRODUCTION';

    // A cancellation of a credit pack is a refund; of a Publish plan it is either a refund or "will not renew".
    const family = productId.startsWith(PUBLISH_PREFIX) ? 'publish' : productId.startsWith(GENERATION_PREFIX) ? 'generation' : null;
    if (type === 'NON_RENEWING_PURCHASE' || (type === 'CANCELLATION' && family === null)) {
        if (type === 'NON_RENEWING_PURCHASE' && !productId.startsWith(CREDITS_PREFIX)) return { kind: 'ignore', reason: 'product' };
        return { kind: type === 'NON_RENEWING_PURCHASE' ? 'purchase' : 'refund', eventId, channel, productId, transactionId, customerIds, sandbox };
    }
    if (family === null) return { kind: 'ignore', reason: 'product' };

    const action = type === 'CANCELLATION'
        ? (String(event.cancel_reason || '').toUpperCase() === 'CUSTOMER_SUPPORT' ? 'refund' : 'cancel_at_period_end')
        : SUBSCRIPTION_ACTIONS[type];
    const original = typeof event.original_transaction_id === 'string' && event.original_transaction_id ? event.original_transaction_id : transactionId;
    if (original.length > TRANSACTION_MAX) return { kind: 'ignore', reason: 'transaction' };
    const expires = finiteMs(event.expiration_at_ms);
    const occurred = finiteMs(event.event_timestamp_ms);
    if (action === 'activate' && expires === null) return { kind: 'ignore', reason: 'period_end' };
    return {
        kind: 'subscription', family, eventId, type: type.toLowerCase(), action, channel, productId, originalTransactionId: original,
        periodEnd: expires === null ? null : new Date(expires).toISOString(),
        occurredAt: new Date(occurred ?? Date.now()).toISOString(), customerIds, sandbox,
    };
}
