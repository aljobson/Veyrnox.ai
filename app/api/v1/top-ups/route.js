/**
 * POST /api/v1/top-ups — start a Top-up and get a hosted checkout URL (#92).
 * GET  /api/v1/top-ups — the caller's Top-up history (#95), at the bottom.
 *
 *   1. middleware.js verified the JWT and set x-veyrnox-auth-id
 *   2. Validate { pack_id, idempotency_key, consent: true,
 *      consent_version: 'supply-consent-v1' }
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
 * paid orders can name one Top-up; credit_top_up (0054) credits the first and
 * flags the rest for an Operator refund. Store the checkout URL on the
 * Top-up and return it on replay if that proves common.
 */

import { NextResponse } from 'next/server';
import { rpc, select, envConfig } from '../../../../packages/db/supabase-client.js';
import { createCheckout } from '../../../../packages/adapters/lemonsqueezy.js';

const PACK_ID_RE = /^[a-z0-9-]{1,32}$/;
// Same shape as POST /api/v1/generations and the top_ups CHECK.
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,128}$/;
// The only Supply Consent wording approved (#99). The buy dialog sends the
// same constant; a new wording needs a new sign-off and a new version.
const SUPPLY_CONSENT_VERSION = 'supply-consent-v1';
const RATE_LIMIT_PER_WINDOW = 5;
const RATE_WINDOW_SECONDS = 600;
const CHECKOUT_TTL_MS = 60 * 60 * 1000;

const DB_CODE_STATUS = {
    PACK_NOT_FOUND: 404,
    USER_NOT_FOUND: 409,
    CONSENT_VERSION_REQUIRED: 400,
    IDEMPOTENCY_KEY_REQUIRED: 400,
    IDEMPOTENCY_KEY_REUSED: 409,
    ACCOUNT_FROZEN: 403,
};

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const cfg = envConfig();
    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    const storeId = process.env.LEMONSQUEEZY_STORE_ID;
    const publicHost = process.env.PUBLIC_HOST;
    const signingSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !apiKey || !storeId || !publicHost || !signingSecret) {
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
    if (body.consent_version !== SUPPLY_CONSENT_VERSION) {
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
        { fetch: fetch.bind(globalThis), apiKey, storeId, publicHost, signingSecret },
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

const HISTORY_LIMIT = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * GET /api/v1/top-ups — the caller's own Top-up history, newest first (#95).
 *
 * The user row is resolved from the middleware-verified auth id and the
 * Top-ups are filtered by that row's id, so no request input picks whose
 * history is read.
 *
 * Response: { top_ups: [{ id, pack_id, credits, price_usd_cents, status, created_at }] }
 */
export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }

    let rows;
    try {
        const users = await select('users', { columns: 'id', filter: `auth_id=eq.${encodeURIComponent(authId)}` }, cfg);
        const userId = Array.isArray(users) && users[0] && users[0].id;
        // A signed-in user whose row hasn't been provisioned has no Top-ups yet.
        if (!userId || !UUID_RE.test(userId)) return NextResponse.json({ top_ups: [] });
        rows = await select(
            'top_ups',
            {
                columns: 'id,pack_id,credits,price_usd_cents,status,created_at',
                filter: `user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`,
                limit: HISTORY_LIMIT,
            },
            cfg,
        );
    } catch (err) {
        console.error('[api/v1/top-ups] history select failed:', err && err.status);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    const topUps = (Array.isArray(rows) ? rows : []).map((r) => ({
        id: r.id,
        pack_id: r.pack_id,
        credits: r.credits,
        price_usd_cents: r.price_usd_cents,
        status: r.status,
        created_at: r.created_at,
    }));
    return NextResponse.json({ top_ups: topUps });
}
