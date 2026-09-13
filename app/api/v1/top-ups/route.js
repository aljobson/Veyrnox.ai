/**
 * POST /api/v1/top-ups — start a Top-up and get a hosted checkout URL (#92).
 *
 *   1. middleware.js verified the JWT and set x-veyrnox-auth-id
 *   2. Validate { pack_id, idempotency_key, consent: true, consent_version }
 *   3. create_pending_top_up RPC: idempotent on (user, idempotency_key), rate
 *      limit under a row lock, copies the pack's credits/price/variant,
 *      records Supply Consent. No credits move.
 *   4. LemonSqueezy createCheckout with the Top-up id in custom data
 *   5. Return { top_up_id, checkout_url }; the browser navigates top-level,
 *      so no CSP connect-src change is needed.
 *
 * A pending Top-up whose checkout is never created or never paid stays
 * pending (spec #90). Credits are granted only by the verified webhook
 * (/api/webhook/lemonsqueezy, #93).
 *
 * A replayed key returns the same Top-up and gets a fresh checkout for it.
 * ponytail: the earlier checkout link stays payable until it expires, so two
 * paid orders can name one Top-up; credit_top_up (0047) credits the first and
 * flags the rest for an Operator refund. Store the checkout URL on the
 * Top-up and return it on replay if that proves common.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { createCheckout } from '../../../../packages/adapters/lemonsqueezy.js';

const PACK_ID_RE = /^[a-z0-9-]{1,32}$/;
// Same shape as POST /api/v1/generations and the top_ups CHECK.
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,128}$/;
const CONSENT_VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
const RATE_LIMIT_PER_WINDOW = 5;
const RATE_WINDOW_SECONDS = 600;
const CHECKOUT_TTL_MS = 60 * 60 * 1000;

const DB_CODE_STATUS = {
    PACK_NOT_FOUND: 404,
    USER_NOT_FOUND: 409,
    CONSENT_VERSION_REQUIRED: 400,
    IDEMPOTENCY_KEY_REQUIRED: 400,
    IDEMPOTENCY_KEY_REUSED: 409,
};

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const cfg = envConfig();
    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    const storeId = process.env.LEMONSQUEEZY_STORE_ID;
    const publicHost = process.env.PUBLIC_HOST;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !apiKey || !storeId || !publicHost) {
        return NextResponse.json({ error: 'top_ups_not_configured' }, { status: 503 });
    }

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    if (typeof body.pack_id !== 'string' || !PACK_ID_RE.test(body.pack_id)) {
        return NextResponse.json({ error: 'pack_id_required' }, { status: 400 });
    }
    if (typeof body.idempotency_key !== 'string' || !IDEMPOTENCY_RE.test(body.idempotency_key)) {
        return NextResponse.json({ error: 'idempotency_key_required' }, { status: 400 });
    }
    // Explicit true only: a truthy string or 1 is not Supply Consent.
    if (body.consent !== true) return NextResponse.json({ error: 'consent_required' }, { status: 400 });
    if (typeof body.consent_version !== 'string' || !CONSENT_VERSION_RE.test(body.consent_version)) {
        return NextResponse.json({ error: 'consent_version_required' }, { status: 400 });
    }

    let created;
    try {
        created = await rpc('create_pending_top_up', {
            p_auth_id: authId,
            p_pack_id: body.pack_id,
            p_idempotency_key: body.idempotency_key,
            p_consent_version: body.consent_version,
            p_limit_per_window: RATE_LIMIT_PER_WINDOW,
            p_window_seconds: RATE_WINDOW_SECONDS,
        }, cfg);
    } catch (err) {
        console.error('[api/v1/top-ups] create_pending_top_up failed:', err && err.status);
        return NextResponse.json({ error: 'top_up_create_failed' }, { status: 502 });
    }
    if (!created || typeof created.ok !== 'boolean') {
        console.error('[api/v1/top-ups] create_pending_top_up returned no verdict');
        return NextResponse.json({ error: 'top_up_create_failed' }, { status: 502 });
    }
    if (created.ok === false) {
        if (created.code === 'RATE_LIMITED') {
            const retryAfter = Math.max(1, Math.min(RATE_WINDOW_SECONDS, Number(created.retry_after_seconds) || RATE_WINDOW_SECONDS));
            return NextResponse.json(
                { error: 'rate_limited', retry_after_seconds: retryAfter },
                { status: 429, headers: { 'retry-after': String(retryAfter) } },
            );
        }
        const status = DB_CODE_STATUS[created.code];
        if (!status) {
            console.error('[api/v1/top-ups] unexpected code:', created.code);
            return NextResponse.json({ error: 'top_up_create_failed' }, { status: 502 });
        }
        return NextResponse.json({ error: String(created.code).toLowerCase() }, { status });
    }

    const checkout = await createCheckout(
        {
            variantId: created.variant_id,
            topUpId: created.top_up_id,
            expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS).toISOString(),
        },
        // Bound: Workers throw "Illegal invocation" for an unbound cfg.fetch().
        { fetch: fetch.bind(globalThis), apiKey, storeId, publicHost },
    );
    if (!checkout.ok) {
        console.error('[api/v1/top-ups] checkout failed:', checkout.error, created.top_up_id);
        return NextResponse.json({ error: 'checkout_failed' }, { status: 502 });
    }

    return NextResponse.json({
        top_up_id: created.top_up_id,
        idempotent: created.idempotent === true,
        checkout_url: checkout.url,
    });
}
