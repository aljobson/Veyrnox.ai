// Plain fetch only; preserve each wrapper's form and failure contracts.
const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_TIMEOUT_MS = 10000;
export const STRIPE_CHECKOUT_API_VERSION = '2025-03-31.basil';

export function form(fields, { omitNull = true, omitUndefined = true } = {}) {
    if (!omitNull) return new URLSearchParams(omitUndefined
        ? Object.entries(fields).filter(([, value]) => value !== undefined) : fields);
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) body.set(key, String(value));
    }
    return body;
}

export function stripeHeaders(apiKey, { body = false, idempotencyKey, alwaysIdempotency = false, checkout = false } = {}) {
    return {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded',
            ...((alwaysIdempotency || idempotencyKey) ? { 'Idempotency-Key': idempotencyKey } : {}),
        } : {}),
        ...(checkout ? { 'Stripe-Version': STRIPE_CHECKOUT_API_VERSION } : {}),
    };
}

// Subscription/customer refund wrappers intentionally collapse failures to null.
export async function stripeJsonRequest(path, cfg, fields, key, { operatorRefund = false } = {}) {
    try {
        const body = fields ? form(fields, { omitNull: false, omitUndefined: !operatorRefund }) : null;
        const res = await cfg.fetch(`${STRIPE_API_BASE}/${path}`, {
            method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
            headers: stripeHeaders(cfg.apiKey, { body: !!body, idempotencyKey: key,
                alwaysIdempotency: operatorRefund, checkout: !operatorRefund && path === 'checkout/sessions' }),
            ...(body ? { body: body.toString() } : {}),
        });
        return res.ok ? await res.json() : null;
    } catch { return null; }
}

export async function stripePost(path, fields, cfg, idempotencyKey) {
    let res;
    try {
        res = await cfg.fetch(`${STRIPE_API_BASE}${path}`, {
            method: 'POST',
            headers: stripeHeaders(cfg.apiKey, { body: true, checkout: path === '/checkout/sessions', idempotencyKey }),
            signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
            body: form(fields).toString(),
        });
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.message}` };
    }
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
}

export async function stripeGet(path, cfg, expectObject) {
    let res;
    try {
        res = await cfg.fetch(`${STRIPE_API_BASE}${path}`, {
            headers: { Authorization: `Bearer ${cfg.apiKey}` },
            signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
        });
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.message}` };
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.object !== expectObject) return { ok: false, error: `stripe ${res.status}` };
    return { ok: true, data };
}

