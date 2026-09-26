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
 *   STRIPE_AUTOMATIC_TAX     Worker var. Automatic tax is ON; only the exact
 *                            string "false" turns it off. Stripe Managed
 *                            Payments is approved and enabled on both the
 *                            sandbox and the live account, which makes Stripe
 *                            the Merchant of Record and makes automatic tax
 *                            mandatory — a session without it is refused with
 *                            400 (ADR-0031, amendment 2026-09-23). The "false"
 *                            switch survives only for an account that has
 *                            Managed Payments disabled.
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
 * @param {boolean} [cfg.automaticTax=true] omitted or undefined leaves
 *   automatic tax ON; only an explicit `false` disables it, and Stripe rejects
 *   that while Managed Payments is enabled on the account.
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
        // Prices are what the catalog says; Stripe adds any tax on top, and
        // under Managed Payments Stripe is the Merchant of Record that charges
        // and remits it. On unless a caller explicitly passes false.
        'automatic_tax[enabled]': cfg.automaticTax === false ? 'false' : 'true',
        client_reference_id: input.topUpId,
        'metadata[top_up_id]': input.topUpId,
        'metadata[top_up_sig]': sig,
        // Same pair on the PaymentIntent: a dispute names the charge, not the session.
        'payment_intent_data[metadata][top_up_id]': input.topUpId,
        'payment_intent_data[metadata][top_up_sig]': sig,
        customer_email: input.email,
        expires_at: input.expiresAt,
        // Keep the template literal: encoding its braces prevents Stripe substitution.
        success_url: `${ret.toString()}?top_up=${input.topUpId}&checkout=done&session_id={CHECKOUT_SESSION_ID}`,
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
    // The browser navigates top-level to this URL, so it must be Stripe's —
    // same guard the LemonSqueezy adapter carried.
    let checkoutUrl;
    try { checkoutUrl = new URL(data.url); } catch { checkoutUrl = null; }
    if (!checkoutUrl || checkoutUrl.protocol !== 'https:'
        || !(checkoutUrl.hostname === 'stripe.com' || checkoutUrl.hostname.endsWith('.stripe.com'))) {
        console.error('[stripe] checkout url not on stripe.com');
        return { ok: false, error: 'checkout url not on stripe.com' };
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
    if (typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]{1,251}$/.test(sessionId)) return { ok: false, error: 'invalid sessionId' };
    let res;
    try {
        res = await cfg.fetch(`${STRIPE_API_BASE}/checkout/sessions/${sessionId}`, {
            headers: { Authorization: `Bearer ${cfg.apiKey}` },
        });
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.message}` };
    }
    const data = await res.json().catch(() => null);
    // Stripe's own type name, dot and all — not the snake_case one.
    if (!res.ok || !data || data.object !== 'checkout.session') return { ok: false, error: `stripe ${res.status}` };
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
    if (!session || session.object !== 'checkout.session') return { ok: false, error: 'not a session' };
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

// ── Cinema Pass (ADR-0057 Phase 2) ──────────────────────────────────────────
// Recurring Checkout Sessions for the viewing Pass. Same rules as the pack
// checkout above: the price comes from our plan row, inline `price_data`
// with a `recurring` interval so no Stripe Price object exists to drift, and
// the pass id is signed into the session AND the subscription metadata so a
// webhook can bind a subscription to the pending Pass it was opened for.

const PASS_RETURN_PATH = '/social-cinema/pass';
const SUBSCRIPTION_RE = /^sub_[A-Za-z0-9_]{1,250}$/;
const CUSTOMER_RE = /^cus_[A-Za-z0-9_]{1,250}$/;
const INVOICE_RE = /^in_[A-Za-z0-9_]{1,250}$/;
const COUPON_RE = /^[A-Za-z0-9_-]{1,64}$/;
const passMessage = (passId) => enc(`cinema_pass:${passId}`);

/** Whether verified metadata carries our signature for its Pass id. */
export async function verifyPassMetadata(metadata, secret) {
    const passId = metadata && metadata.cinema_pass_id;
    const sig = metadata && metadata.cinema_pass_sig;
    if (!secret || typeof passId !== 'string' || !UUID_RE.test(passId) || typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) {
        return false;
    }
    return (await hmacHex(passMessage(passId), secret)) === sig ? true : false;
}

async function stripePost(path, fields, cfg, idempotencyKey) {
    let res;
    try {
        res = await cfg.fetch(`${STRIPE_API_BASE}${path}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${cfg.apiKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
            },
            body: form(fields).toString(),
        });
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.message}` };
    }
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
}

async function stripeGet(path, cfg, expectObject) {
    let res;
    try {
        res = await cfg.fetch(`${STRIPE_API_BASE}${path}`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.message}` };
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.object !== expectObject) return { ok: false, error: `stripe ${res.status}` };
    return { ok: true, data };
}

/**
 * The once-only intro discount as a Stripe Coupon with a deterministic id, so
 * a plan's intro price maps to exactly one coupon and a price change makes a
 * new one. Creating an id that already exists is success.
 */
export async function ensureIntroCoupon({ couponId, amountOffCents, name }, cfg) {
    if (!COUPON_RE.test(String(couponId))) return { ok: false, error: 'invalid couponId' };
    if (!Number.isSafeInteger(amountOffCents) || amountOffCents <= 0 || amountOffCents > MAX_CENTS) return { ok: false, error: 'invalid amount' };
    const r = await stripePost('/coupons', {
        id: couponId, amount_off: amountOffCents, currency: 'usd', duration: 'once', name,
    }, cfg, `coupon:${couponId}`);
    if (r.ok === false && r.error) return r;
    if (r.ok) return { ok: true, couponId };
    if (r.status === 400 && r.data && r.data.error && r.data.error.code === 'resource_already_exists') return { ok: true, couponId };
    console.error('[stripe] coupon create failed:', r.status, r.data && r.data.error && r.data.error.code);
    return { ok: false, error: `stripe ${r.status}` };
}

/**
 * Hosted recurring checkout for one pending Pass. Amount, interval and intro
 * come from our row, never from the client.
 *
 * @param {object} input
 * @param {string} input.passId
 * @param {string} input.planId
 * @param {'week'|'month'|'year'} input.interval
 * @param {number} input.priceUsdCents
 * @param {string} [input.introCouponId]  applies the once-only intro discount
 * @param {string} [input.email]
 * @param {number} [input.expiresAt]
 * @param {object} cfg  as createCheckout
 */
export async function createPassCheckout(input, cfg) {
    if (!UUID_RE.test(String(input.passId))) return { ok: false, error: 'invalid passId' };
    if (!/^[a-z0-9-]{1,32}$/.test(String(input.planId))) return { ok: false, error: 'invalid planId' };
    if (!['week', 'month', 'year'].includes(input.interval)) return { ok: false, error: 'invalid interval' };
    if (!Number.isSafeInteger(input.priceUsdCents) || input.priceUsdCents <= 0 || input.priceUsdCents > MAX_CENTS) {
        return { ok: false, error: 'invalid price' };
    }
    if (input.introCouponId !== undefined && !COUPON_RE.test(String(input.introCouponId))) return { ok: false, error: 'invalid coupon' };
    let base;
    try { base = new URL(cfg.publicHost); } catch { return { ok: false, error: 'invalid publicHost' }; }
    if (base.protocol !== 'https:') return { ok: false, error: 'publicHost must be https' };

    const sig = await hmacHex(passMessage(input.passId), cfg.signingSecret);
    const ret = new URL(PASS_RETURN_PATH, base);
    const label = { week: 'weekly', month: 'monthly', year: 'yearly' }[input.interval];
    const r = await stripePost('/checkout/sessions', {
        mode: 'subscription',
        'line_items[0][quantity]': 1,
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': input.priceUsdCents,
        'line_items[0][price_data][recurring][interval]': input.interval,
        'line_items[0][price_data][recurring][interval_count]': 1,
        'line_items[0][price_data][product_data][name]': `Veyrnox Cinema Pass (${label})`,
        'line_items[0][price_data][product_data][tax_code]': TAX_CODE,
        'automatic_tax[enabled]': cfg.automaticTax === false ? 'false' : 'true',
        client_reference_id: input.passId,
        'metadata[cinema_pass_id]': input.passId,
        'metadata[cinema_pass_sig]': sig,
        // The subscription outlives the session; every later event names it.
        'subscription_data[metadata][cinema_pass_id]': input.passId,
        'subscription_data[metadata][cinema_pass_sig]': sig,
        'subscription_data[description]': `Veyrnox Cinema Pass (${label})`,
        ...(input.introCouponId ? { 'discounts[0][coupon]': input.introCouponId } : {}),
        customer_email: input.email,
        expires_at: input.expiresAt,
        success_url: `${ret.toString()}?pass=${input.passId}&checkout=done&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${ret.toString()}?pass=${input.passId}&checkout=cancelled`,
    }, cfg, cfg.idempotencyKey);
    if (r.ok === false && r.error) return r;
    const data = r.data;
    if (!r.ok || !data || typeof data.url !== 'string' || typeof data.id !== 'string') {
        console.error('[stripe] pass checkout create failed:', r.status, data && data.error && data.error.code);
        return { ok: false, error: `stripe ${r.status}` };
    }
    let checkoutUrl;
    try { checkoutUrl = new URL(data.url); } catch { checkoutUrl = null; }
    if (!checkoutUrl || checkoutUrl.protocol !== 'https:'
        || !(checkoutUrl.hostname === 'stripe.com' || checkoutUrl.hostname.endsWith('.stripe.com'))) {
        console.error('[stripe] pass checkout url not on stripe.com');
        return { ok: false, error: 'checkout url not on stripe.com' };
    }
    return { ok: true, url: data.url, sessionId: data.id };
}

/** Re-read a Subscription: the webhook body is a pointer, not the truth. */
export async function fetchSubscription(subscriptionId, cfg) {
    if (!SUBSCRIPTION_RE.test(String(subscriptionId))) return { ok: false, error: 'invalid subscriptionId' };
    const r = await stripeGet(`/subscriptions/${subscriptionId}`, cfg, 'subscription');
    return r.ok ? { ok: true, subscription: r.data } : r;
}

/** Re-read an Invoice, to find the subscription a charge belongs to. */
export async function fetchInvoice(invoiceId, cfg) {
    if (!INVOICE_RE.test(String(invoiceId))) return { ok: false, error: 'invalid invoiceId' };
    const r = await stripeGet(`/invoices/${invoiceId}`, cfg, 'invoice');
    return r.ok ? { ok: true, invoice: r.data } : r;
}

const unix = (v) => (Number.isSafeInteger(v) && v > 0 ? new Date(v * 1000).toISOString() : null);

/**
 * Our shape for a Subscription. Statuses collapse to the four the database
 * knows. Period bounds moved from the subscription to its items in Stripe's
 * 2025-03 API version; both places are read.
 *
 * @returns {{ok:true, subscription:{id, customerId, status, periodStart, periodEnd, cancelAtPeriodEnd, latestInvoiceId, metadata}}|{ok:false, error:string}}
 */
export function interpretSubscription(sub, opts) {
    if (!sub || sub.object !== 'subscription' || !SUBSCRIPTION_RE.test(String(sub.id))) return { ok: false, error: 'not a subscription' };
    if (Boolean(sub.livemode) !== Boolean(opts.expectLiveMode)) return { ok: false, error: 'mode mismatch' };
    const raw = String(sub.status || '');
    const status = raw === 'active' || raw === 'trialing' ? 'active'
        : raw === 'past_due' ? 'past_due'
            : raw === 'incomplete' ? 'incomplete'
                : ['canceled', 'unpaid', 'incomplete_expired', 'paused'].includes(raw) ? 'ended' : null;
    if (!status) return { ok: false, error: `status ${raw}` };
    const item = sub.items && sub.items.data && sub.items.data[0];
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer && sub.customer.id;
    const latestInvoiceId = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice && sub.latest_invoice.id;
    return {
        ok: true,
        subscription: {
            id: sub.id,
            customerId: CUSTOMER_RE.test(String(customerId)) ? customerId : null,
            status,
            periodStart: unix(sub.current_period_start ?? (item && item.current_period_start)),
            periodEnd: unix(sub.current_period_end ?? (item && item.current_period_end)),
            cancelAtPeriodEnd: sub.cancel_at_period_end === true,
            latestInvoiceId: INVOICE_RE.test(String(latestInvoiceId)) ? latestInvoiceId : null,
            metadata: sub.metadata && typeof sub.metadata === 'object' ? sub.metadata : {},
        },
    };
}

/** The subscription an Invoice bills, from either API shape. */
export function invoiceSubscriptionId(invoice) {
    if (!invoice || invoice.object !== 'invoice') return null;
    const direct = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription && invoice.subscription.id;
    const nested = invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.subscription;
    const id = direct || (typeof nested === 'string' ? nested : nested && nested.id);
    return SUBSCRIPTION_RE.test(String(id)) ? id : null;
}

/** What an Invoice was paid with, for a cooling-off refund. */
export function invoicePayment(invoice) {
    if (!invoice || invoice.object !== 'invoice') return null;
    const direct = typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent && invoice.payment_intent.id;
    const entry = invoice.payments && invoice.payments.data && invoice.payments.data[0];
    const nested = entry && entry.payment && (typeof entry.payment.payment_intent === 'string'
        ? entry.payment.payment_intent : entry.payment.payment_intent && entry.payment.payment_intent.id);
    const paymentIntentId = direct || nested;
    const paidCents = Number.isSafeInteger(invoice.amount_paid) ? invoice.amount_paid : null;
    if (!/^pi_[A-Za-z0-9_]{1,250}$/.test(String(paymentIntentId)) || paidCents === null || paidCents < 0) return null;
    return { paymentIntentId, paidCents };
}

/** Stop renewing at the period end; viewing continues until then. */
export async function cancelSubscriptionAtPeriodEnd(subscriptionId, cfg) {
    if (!SUBSCRIPTION_RE.test(String(subscriptionId))) return { ok: false, error: 'invalid subscriptionId' };
    const r = await stripePost(`/subscriptions/${subscriptionId}`, { cancel_at_period_end: 'true' }, cfg);
    if (r.ok === false && r.error) return r;
    if (!r.ok || !r.data || r.data.object !== 'subscription') return { ok: false, error: `stripe ${r.status}` };
    return { ok: true };
}

/** Cancel now (cooling-off). No proration invoice: the refund is made separately. */
export async function cancelSubscriptionNow(subscriptionId, cfg) {
    if (!SUBSCRIPTION_RE.test(String(subscriptionId))) return { ok: false, error: 'invalid subscriptionId' };
    let res;
    try {
        res = await cfg.fetch(`${STRIPE_API_BASE}/subscriptions/${subscriptionId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form({ prorate: 'false' }).toString(),
        });
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.message}` };
    }
    const data = await res.json().catch(() => null);
    // A subscription already canceled is a 400 resource_missing-style refusal we treat as done.
    if (!res.ok && !(res.status === 400 && data && data.error && /already been canceled/i.test(String(data.error.message || '')))) {
        return { ok: false, error: `stripe ${res.status}` };
    }
    return { ok: true };
}

/** Refund part of a PaymentIntent; idempotent on the key the caller derives from the Pass. */
export async function createRefund({ paymentIntentId, amountCents }, cfg, idempotencyKey) {
    if (!/^pi_[A-Za-z0-9_]{1,250}$/.test(String(paymentIntentId))) return { ok: false, error: 'invalid paymentIntentId' };
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_CENTS) return { ok: false, error: 'invalid amount' };
    const r = await stripePost('/refunds', { payment_intent: paymentIntentId, amount: amountCents }, cfg, idempotencyKey);
    if (r.ok === false && r.error) return r;
    if (!r.ok || !r.data || r.data.object !== 'refund') {
        console.error('[stripe] refund failed:', r.status, r.data && r.data.error && r.data.error.code);
        return { ok: false, error: `stripe ${r.status}` };
    }
    return { ok: true, refundId: r.data.id };
}

/** A Customer Portal session for the Pass owner's own Stripe customer. */
export async function createPortalSession({ customerId, returnPath = PASS_RETURN_PATH }, cfg) {
    if (!CUSTOMER_RE.test(String(customerId))) return { ok: false, error: 'invalid customerId' };
    let base;
    try { base = new URL(cfg.publicHost); } catch { return { ok: false, error: 'invalid publicHost' }; }
    if (base.protocol !== 'https:') return { ok: false, error: 'publicHost must be https' };
    const r = await stripePost('/billing_portal/sessions', { customer: customerId, return_url: new URL(returnPath, base).toString() }, cfg);
    if (r.ok === false && r.error) return r;
    if (!r.ok || !r.data || typeof r.data.url !== 'string') return { ok: false, error: `stripe ${r.status}` };
    let url;
    try { url = new URL(r.data.url); } catch { url = null; }
    if (!url || url.protocol !== 'https:' || !(url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com'))) {
        return { ok: false, error: 'portal url not on stripe.com' };
    }
    return { ok: true, url: r.data.url };
}

/** Re-read a Charge: a Dispute names its charge, and only the charge knows its invoice. */
export async function fetchCharge(chargeId, cfg) {
    if (!/^ch_[A-Za-z0-9_]{1,250}$/.test(String(chargeId))) return { ok: false, error: 'invalid chargeId' };
    const r = await stripeGet(`/charges/${chargeId}`, cfg, 'charge');
    return r.ok ? { ok: true, charge: r.data } : r;
}
