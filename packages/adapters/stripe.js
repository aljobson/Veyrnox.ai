/**
 * Stripe adapter — Credit Pack checkout after LemonSqueezy refused AI media
 * generation (2026-09-22). Same shape as packages/adapters/lemonsqueezy.js:
 * plain fetch against a constant API host, no SDK (the Workers bundle rule in
 * CLAUDE.md), and the network function injected so tests never touch it.
 *
 * A Checkout Session is built from our own catalog price with inline
 * `price_data`, so there are no Stripe Product or Price objects to keep in
 * step with `credit_packs` — the catalog stays normative (CLAUDE.md, Money).
 *
 * Configuration (read at the route layer):
 *   STRIPE_SECRET_KEY        Worker secret (sk_test_… or sk_live_…)
 *   STRIPE_WEBHOOK_SECRET    Worker secret (whsec_…), signs /api/webhook/stripe
 *   STRIPE_AUTOMATIC_TAX     Worker var, "true" (default) or "false"
 *   PUBLIC_HOST              https origin the buyer returns to
 */

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
// AI as a service (LLMs, image generators). The category Stripe's own
// Managed Payments eligibility list names for this business.
export const TAX_CODE = 'txcd_10105001';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const RETURN_PATH = '/app/credits';
const MAX_CENTS = 99_999_99;

const enc = (s) => new TextEncoder().encode(s);

/** Stripe takes form-encoded bodies with bracketed nested keys. */
function form(fields) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) body.set(key, String(value));
    }
    return body;
}

async function hmacHex(message, secret) {
    const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
    return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

// A buyer cannot set metadata on a Checkout Session we created, but a future
// bug (or a second integration) could; only a session we built carries this,
// so a paid session can never be redeemed against someone else's Top-up.
// The prefix keeps the message from ever equalling a webhook body.
const topUpMessage = (topUpId) => enc(`top_up:${topUpId}`);

/**
 * Hosted checkout for one pending Top-up. Amount and credits come from our
 * row, never from the client.
 *
 * @param {object} input
 * @param {string} input.topUpId       our top_ups.id
 * @param {number} input.priceUsdCents the pack price, from the Top-up row
 * @param {number} input.credits       credits the pack grants (shown on the page)
 * @param {string} [input.email]       prefills the buyer's email
 * @param {number} [input.expiresAt]   unix seconds; Stripe allows 30 min to 24 h
 * @param {object} cfg
 * @param {typeof fetch} cfg.fetch
 * @param {string} cfg.apiKey
 * @param {string} cfg.publicHost
 * @param {string} cfg.signingSecret   STRIPE_WEBHOOK_SECRET; signs the Top-up id
 * @param {boolean} [cfg.automaticTax=true]
 * @param {string} [cfg.idempotencyKey]
 * @returns {Promise<{ok:true, url:string, sessionId:string}|{ok:false, error:string}>}
 */
export async function createCheckout(input, cfg) {
    if (!UUID_RE.test(String(input.topUpId))) return { ok: false, error: 'invalid topUpId' };
    if (!Number.isSafeInteger(input.priceUsdCents) || input.priceUsdCents <= 0 || input.priceUsdCents > MAX_CENTS) {
        return { ok: false, error: 'invalid price' };
    }
    if (!Number.isSafeInteger(input.credits) || input.credits <= 0) return { ok: false, error: 'invalid credits' };
    let base;
    try { base = new URL(cfg.publicHost); } catch { return { ok: false, error: 'invalid publicHost' }; }
    if (base.protocol !== 'https:') return { ok: false, error: 'publicHost must be https' };

    const sig = await hmacHex(topUpMessage(input.topUpId), cfg.signingSecret);
    const ret = new URL(RETURN_PATH, base);
    const body = form({
        mode: 'payment',
        'line_items[0][quantity]': 1,
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': input.priceUsdCents,
        'line_items[0][price_data][product_data][name]': `${input.credits} Veyrnox credits`,
        'line_items[0][price_data][product_data][tax_code]': TAX_CODE,
        // Prices are what the catalog says; Stripe adds any tax on top.
        'automatic_tax[enabled]': cfg.automaticTax === false ? 'false' : 'true',
        client_reference_id: input.topUpId,
        'metadata[top_up_id]': input.topUpId,
        'metadata[top_up_sig]': sig,
        // Same pair on the PaymentIntent: a dispute names the charge, not the session.
        'payment_intent_data[metadata][top_up_id]': input.topUpId,
        'payment_intent_data[metadata][top_up_sig]': sig,
        customer_email: input.email,
        expires_at: input.expiresAt,
        success_url: `${ret.toString()}?top_up=${input.topUpId}&checkout=done`,
        cancel_url: `${ret.toString()}?top_up=${input.topUpId}&checkout=cancelled`,
    });

    let res;
    try {
        res = await cfg.fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${cfg.apiKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(cfg.idempotencyKey ? { 'Idempotency-Key': cfg.idempotencyKey } : {}),
            },
            body: body.toString(),
        });
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.message}` };
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data.url !== 'string' || typeof data.id !== 'string') {
        // Never surface a vendor payload to the client (CLAUDE.md, API gateway).
        console.error('[stripe] checkout create failed:', res.status, data && data.error && data.error.code);
        return { ok: false, error: `stripe ${res.status}` };
    }
    return { ok: true, url: data.url, sessionId: data.id };
}

/**
 * Verify a `Stripe-Signature` header over the exact raw bytes.
 * Header shape: `t=<unix>,v1=<hex>[,v1=<hex>…]`; the signed payload is
 * `<t>.<body>`. Stale timestamps are refused, so a captured delivery cannot
 * be replayed days later (LemonSqueezy sends none — ADR-0018 §replay).
 *
 * @param {Uint8Array} rawBody
 * @param {string} header
 * @param {string} secret
 * @param {number} [nowSeconds]
 */
export async function verifyWebhookSignature(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!secret || typeof header !== 'string' || header.length > 1024) return false;
    let timestamp = null;
    const candidates = [];
    for (const part of header.split(',')) {
        const [k, v] = part.split('=', 2);
        if (k === 't' && /^[0-9]{1,12}$/.test(v || '')) timestamp = Number(v);
        if (k === 'v1' && /^[0-9a-f]{64}$/.test(v || '')) candidates.push(v);
    }
    if (timestamp === null || !candidates.length) return false;
    if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

    const payload = new Uint8Array(enc(`${timestamp}.`).length + rawBody.length);
    payload.set(enc(`${timestamp}.`));
    payload.set(rawBody, enc(`${timestamp}.`).length);
    const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    for (const hex of candidates) {
        const sig = new Uint8Array(32);
        for (let i = 0; i < 32; i += 1) sig[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        // crypto.subtle.verify compares in constant time.
        if (await crypto.subtle.verify('HMAC', key, sig, payload)) return true;
    }
    return false;
}

/** Whether verified metadata carries our signature for its Top-up id. */
export async function verifyTopUpMetadata(metadata, secret) {
    const topUpId = metadata && metadata.top_up_id;
    const sig = metadata && metadata.top_up_sig;
    if (!secret || typeof topUpId !== 'string' || !UUID_RE.test(topUpId) || typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) {
        return false;
    }
    return (await hmacHex(topUpMessage(topUpId), secret)) === sig ? true : false;
}

/** Re-read a Checkout Session from Stripe: the webhook body is a pointer, not the truth. */
export async function fetchSession(sessionId, cfg) {
    if (!/^cs_[A-Za-z0-9_]{1,250}$/.test(String(sessionId || ''))) return { ok: false, error: 'invalid sessionId' };
    let res;
    try {
        res = await cfg.fetch(`${STRIPE_API_BASE}/checkout/sessions/${sessionId}`, {
            headers: { Authorization: `Bearer ${cfg.apiKey}` },
        });
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.message}` };
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.object !== 'checkout_session') return { ok: false, error: `stripe ${res.status}` };
    return { ok: true, session: data };
}

/**
 * Our shape for a paid Checkout Session. Money comes from the session Stripe
 * returned, the Top-up id from its signed metadata.
 *
 * @param {any} session
 * @param {{expectLiveMode: boolean}} opts
 * @returns {{ok:true, order:{orderId:string, topUpId:string, paidCents:number, currency:string, paid:boolean}}
 *        | {ok:false, error:string}}
 */
export function interpretSession(session, opts) {
    if (!session || session.object !== 'checkout_session') return { ok: false, error: 'not a session' };
    if (Boolean(session.livemode) !== Boolean(opts.expectLiveMode)) return { ok: false, error: 'mode mismatch' };
    const topUpId = session.metadata && session.metadata.top_up_id;
    if (typeof topUpId !== 'string' || !UUID_RE.test(topUpId)) return { ok: false, error: 'no top_up_id' };
    if (session.payment_status !== 'paid') return { ok: false, error: `payment_status ${session.payment_status}` };
    // amount_total includes any tax Stripe added; the pack price is
    // amount_subtotal, which is what the Top-up row was created with.
    const paidCents = Number.isSafeInteger(session.amount_subtotal) ? session.amount_subtotal : session.amount_total;
    if (!Number.isSafeInteger(paidCents) || paidCents <= 0) return { ok: false, error: 'no amount' };
    const orderId = typeof session.payment_intent === 'string' ? session.payment_intent : session.id;
    return {
        ok: true,
        order: { orderId, topUpId, paidCents, currency: String(session.currency || 'usd').toLowerCase(), paid: true },
    };
}
