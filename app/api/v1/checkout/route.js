/**
 * POST /api/v1/checkout — start a Stripe Checkout for a credit pack (ADR-0019).
 *
 *   1. middleware.js verified the JWT and set x-veyrnox-auth-id
 *   2. Validate { pack_id, idempotency_key }
 *   3. purchase_create RPC — PENDING purchase row, idempotent per key,
 *      rate-limited per user, credits copied from credit_packs
 *   4. Stripe Checkout Session (Managed Payments), idempotent per purchase
 *   5. Return { url } — the client navigates there
 *
 * Credits are granted only by the signed webhook, never on redirect back.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { createCheckoutSession } from '../../../../packages/adapters/stripe.js';

const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,128}$/;
const PACK_ID_RE = /^[a-z0-9_]{1,32}$/;
const RATE_WINDOW_SECONDS = 600;

const RPC_ERRORS = {
    USER_NOT_FOUND: [404, 'user_not_found'],
    PACK_UNAVAILABLE: [400, 'pack_unavailable'],
    IDEMPOTENCY_KEY_REUSED: [409, 'idempotency_key_reused'],
    PURCHASE_EXPIRED: [409, 'purchase_expired'],
    RATE_LIMITED: [429, 'rate_limited'],
};

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const cfg = envConfig();
    const secretKey = process.env.STRIPE_SECRET_KEY;
    const publicHost = process.env.PUBLIC_HOST;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !secretKey || !publicHost) {
        return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 });
    }

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    const packId = body && body.pack_id;
    const idempotencyKey = body && body.idempotency_key;
    if (typeof packId !== 'string' || !PACK_ID_RE.test(packId)) {
        return NextResponse.json({ error: 'invalid_pack_id' }, { status: 400 });
    }
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_RE.test(idempotencyKey)) {
        return NextResponse.json({ error: 'invalid_idempotency_key' }, { status: 400 });
    }

    let purchase;
    try {
        purchase = await rpc('purchase_create', {
            p_auth_id: authId, p_pack_id: packId, p_idempotency_key: idempotencyKey,
        }, cfg);
    } catch (err) {
        console.error('[checkout] purchase_create failed:', err && err.status);
        return NextResponse.json({ error: 'billing_unavailable' }, { status: 502 });
    }
    if (!purchase || purchase.ok !== true) {
        const [status, error] = RPC_ERRORS[purchase && purchase.code] || [502, 'billing_unavailable'];
        const headers = status === 429 ? { 'retry-after': String(RATE_WINDOW_SECONDS) } : undefined;
        return NextResponse.json({ error }, { status, headers });
    }
    if (purchase.state !== 'PENDING') {
        return NextResponse.json({ error: 'already_paid' }, { status: 409 });
    }

    const origin = new URL(publicHost).origin;
    const session = await createCheckoutSession({
        purchaseId: purchase.purchase_id,
        priceId: purchase.stripe_price_id,
        successUrl: `${origin}/app/credits?checkout=success`,
        cancelUrl: `${origin}/app/credits?checkout=cancel`,
    }, { secretKey });
    if (!session.ok) {
        console.error('[checkout] stripe session failed:', purchase.purchase_id, session.error);
        return NextResponse.json({ error: 'checkout_unavailable' }, { status: 502 });
    }

    return NextResponse.json({ url: session.url });
}
