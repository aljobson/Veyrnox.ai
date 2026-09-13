/**
 * POST /api/v1/top-ups/:id/order — record the order a returning buyer paid (#94).
 *
 * LemonSqueezy's API can't map a Top-up to its order (the order object has no
 * custom data), so the checkout redirect carries the link variables
 * [order_id] and [order_identifier] back to the credits page, which posts
 * them here. This only records the order id on the caller's pending Top-up
 * for the backfill; credits still come only from credit_top_up, via the
 * webhook or the backfill.
 *
 *   1. middleware.js verified the JWT and set x-veyrnox-auth-id
 *   2. Validate { order_id: numeric, order_identifier: UUID }
 *   3. read_top_up: the caller's own Top-up, before any LemonSqueezy call
 *   4. Re-fetch the order; its identifier must equal the redirect's. The
 *      numeric id is guessable, the identifier is not.
 *   5. Normalise it (store, test mode); only a paid or pending order is kept
 *   6. record_top_up_order re-checks ownership under a row lock, keeps the
 *      first order, refuses one used by another Top-up or with a different
 *      variant, pre-tax amount or currency
 *
 * Response: { recorded: true, idempotent } or a typed error.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { fetchOrder, normaliseOrder, orderIdentifierMatches } from '../../../../../../packages/adapters/lemonsqueezy.js';

const LOG = '[api/v1/top-ups/order]';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ANY_CASE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_ID_RE = /^[0-9]{1,20}$/;
const RECORDABLE_STATUS = new Set(['paid', 'pending']);

const DB_CODE_STATUS = {
    TOP_UP_NOT_FOUND: 404,
    INVALID_ORDER_ID: 400,
    ORDER_ALREADY_RECORDED: 409,
    ALREADY_CREDITED: 409,
    ORDER_ALREADY_USED: 409,
    VARIANT_MISMATCH: 422,
    AMOUNT_MISMATCH: 422,
    CURRENCY_MISMATCH: 422,
};

export async function POST(req, { params }) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const { id } = await params;
    if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: 'invalid_top_up_id' }, { status: 400 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    const orderId = body && body.order_id;
    const identifier = body && body.order_identifier;
    if (typeof orderId !== 'string' || !ORDER_ID_RE.test(orderId)) {
        return NextResponse.json({ error: 'invalid_order_id' }, { status: 400 });
    }
    if (typeof identifier !== 'string' || !ANY_CASE_UUID_RE.test(identifier)) {
        return NextResponse.json({ error: 'invalid_order_identifier' }, { status: 400 });
    }

    const cfg = envConfig();
    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    const storeId = process.env.LEMONSQUEEZY_STORE_ID;
    const testMode = process.env.LEMONSQUEEZY_TEST_MODE;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !apiKey || !storeId || (testMode !== 'true' && testMode !== 'false')) {
        return NextResponse.json({ error: 'top_ups_not_configured' }, { status: 503 });
    }

    try {
        // Ownership first, so a caller can't make us fetch orders for
        // someone else's Top-up. record_top_up_order re-checks under a lock.
        const own = await rpc('read_top_up', { p_auth_id: authId, p_top_up_id: id }, cfg);
        if (!own || own.ok !== true || !own.top_up) return NextResponse.json({ error: 'top_up_not_found' }, { status: 404 });

        const fetched = await fetchOrder(orderId, { fetch: fetch.bind(globalThis), apiKey });
        if (!fetched.ok) {
            if (!fetched.transient) return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
            console.error(LOG, 'order re-fetch failed:', orderId, fetched.error);
            return NextResponse.json({ error: 'order_fetch_failed' }, { status: 503 });
        }
        if (!orderIdentifierMatches(fetched.order, identifier)) {
            console.error(LOG, 'order identifier mismatch:', orderId, 'top_up', id);
            return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
        }

        const norm = normaliseOrder(fetched.order, { top_up_id: id }, { expectTestMode: testMode === 'true', expectStoreId: storeId });
        if (!norm.ok) {
            console.error(LOG, 'order not recordable:', orderId, norm.error);
            return NextResponse.json({ error: 'order_not_recordable' }, { status: 422 });
        }
        if (!RECORDABLE_STATUS.has(norm.order.status)) {
            return NextResponse.json({ error: 'order_not_recordable' }, { status: 422 });
        }

        const res = await rpc('record_top_up_order', {
            p_auth_id: authId,
            p_top_up_id: id,
            p_order_id: norm.order.orderId,
            p_paid_usd_cents: norm.order.paidCents,
            p_currency: norm.order.currency,
            p_variant_id: norm.order.variantId,
        }, cfg);
        if (res && res.ok === true) return NextResponse.json({ recorded: true, idempotent: res.idempotent === true });
        const status = res && DB_CODE_STATUS[res.code];
        if (!status) {
            console.error(LOG, 'record_top_up_order gave no usable verdict:', res && res.code);
            return NextResponse.json({ error: 'internal' }, { status: 502 });
        }
        if (status === 422 || res.code === 'ORDER_ALREADY_USED') console.error(LOG, 'order refused:', res.code, orderId, 'top_up', id);
        return NextResponse.json({ error: String(res.code).toLowerCase() }, { status });
    } catch (err) {
        console.error(LOG, 'failed:', err && (err.status ?? err.message));
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
}
