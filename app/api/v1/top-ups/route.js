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
 *   4. Stripe createCheckout with the Top-up id, its signature and the pack's
 *      own price in the Checkout Session (ADR-0031)
 *   5. Return { top_up_id, checkout_url }; the browser navigates top-level,
 *      so no CSP connect-src change is needed.
 *
 * A pending Top-up whose checkout is never created or never paid stays
 * pending (spec #90). Credits are granted only by the verified webhook
 * (/api/webhook/stripe, #93).
 *
 * A replayed key returns the same Top-up, and the Stripe Idempotency-Key
 * carries its id, so within one expiry bucket Stripe replays the SAME
 * Checkout Session instead of opening a second payable link.
 */

import { NextResponse } from 'next/server';
import { rpc, select, envConfig } from '../../../../packages/db/supabase-client.js';
import { historyCursor, historyPage } from '../../../../lib/historyCursor.js';
import { topUpReadLimit } from '../../../../lib/topUpReadLimit.js';
import { createCheckout } from '../../../../packages/adapters/stripe.js';

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
    if (!authId || !UUID_RE.test(authId)) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const cfg = envConfig();
    const apiKey = process.env.STRIPE_SECRET_KEY;
    const publicHost = process.env.PUBLIC_HOST;
    // Signs the Top-up id into the session metadata the webhook checks back.
    const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !apiKey || !publicHost || !signingSecret) {
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

    // Count every valid attempt, including replayed keys, before the DB writer
    // and Stripe. Enable only after migration 0120 is applied.
    if (process.env.TOP_UP_CHECKOUT_RATE_LIMIT_ENABLED === 'true') {
        let rate;
        try {
            rate = await rpc('consume_top_up_checkout_request', { p_auth_id: authId }, cfg);
        } catch {
            console.error('[top-ups] checkout rate limit unavailable');
        }
        const headers = { 'Cache-Control': 'no-store' };
        if (rate?.ok === false && rate.code === 'RATE_LIMITED') {
            const retry = Number.isInteger(rate.retry_after_seconds)
                ? Math.max(1, Math.min(60, rate.retry_after_seconds)) : 60;
            return NextResponse.json({ error: 'rate_limited', retry_after_seconds: retry },
                { status: 429, headers: { ...headers, 'Retry-After': String(retry) } });
        }
        if (rate?.ok === false && rate.code === 'NOT_FOUND') {
            return NextResponse.json({ error: 'user_not_found' }, { status: 409, headers });
        }
        if (rate?.ok !== true) {
            return NextResponse.json({ error: 'rate_limit_unavailable' },
                { status: 503, headers: { ...headers, 'Retry-After': '30' } });
        }
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

    // Stripe refuses an Idempotency-Key reused with different parameters, so
    // the key and the expiry move together: one Checkout Session per Top-up
    // per bucket, expiring one to two hours out (Stripe allows 30 min to 24 h).
    const bucket = Math.floor(Date.now() / CHECKOUT_TTL_MS);
    const checkout = await createCheckout(
        {
            topUpId: created.top_up_id,
            credits: created.credits,
            priceUsdCents: created.price_usd_cents,
            email: req.headers.get('x-veyrnox-auth-email') || undefined,
            expiresAt: (bucket + 2) * (CHECKOUT_TTL_MS / 1000),
        },
        // Bound: Workers throw "Illegal invocation" for an unbound cfg.fetch().
        {
            fetch: fetch.bind(globalThis),
            apiKey,
            publicHost,
            signingSecret,
            // Stripe Managed Payments is enabled on both accounts, so Stripe
            // is the Merchant of Record and handles the tax — and refuses a
            // session with automatic tax off (ADR-0031, amendment 2026-09-23).
            // On unless the var is exactly "false"; an unset var must not
            // silently produce tax-off, which is what returned 502 on
            // 2026-09-23.
            automaticTax: process.env.STRIPE_AUTOMATIC_TAX !== 'false',
            idempotencyKey: `top_up:${created.top_up_id}:${bucket}`,
        },
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
    if (!authId || !UUID_RE.test(authId)) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    let cursor;
    try { cursor = historyCursor(req.url); } catch {
        return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 });
    }
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }

    const limited = await topUpReadLimit(authId, cfg, true);
    if (limited) return limited;

    let rows;
    try {
        const users = await select('users', { columns: 'id', filter: `auth_id=eq.${encodeURIComponent(authId)}` }, cfg);
        const userId = Array.isArray(users) && users[0] && users[0].id;
        // A signed-in user whose row hasn't been provisioned has no Top-ups yet.
        if (!userId || !UUID_RE.test(userId)) return NextResponse.json({ top_ups: [] }, { headers: { 'Cache-Control': 'no-store' } });
        rows = await select(
            'top_ups',
            {
                columns: 'id,pack_id,credits,price_usd_cents,status,created_at',
                filter: `user_id=eq.${encodeURIComponent(userId)}${cursor}&order=created_at.desc,id.desc`,
                limit: HISTORY_LIMIT + 1,
            },
            cfg,
        );
    } catch (err) {
        console.error('[api/v1/top-ups] history select failed:', err && err.status);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    const { items, next } = historyPage(Array.isArray(rows) ? rows : [], HISTORY_LIMIT);
    const topUps = items.map((r) => ({
        id: r.id,
        pack_id: r.pack_id,
        credits: r.credits,
        price_usd_cents: r.price_usd_cents,
        status: r.status,
        created_at: r.created_at,
    }));
    return NextResponse.json({ top_ups: topUps, next }, { headers: { 'Cache-Control': 'no-store' } });
}
