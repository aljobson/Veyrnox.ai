/**
 * POST /api/admin/backfill-top-ups — credit paid Top-ups whose webhook was lost (#94).
 *
 * LemonSqueezy retries a webhook only 3 times over about 2.5 minutes, so a
 * short outage can leave a paid order uncredited. Every ~5 minutes a
 * main-only GitHub Actions workflow calls this endpoint:
 *
 *   1. Bearer TOP_UP_BACKFILL_TOKEN (Worker secret), compared in constant time.
 *      Anything else -> 401.
 *   2. Pending Top-ups created 10 minutes to 7 days ago that have an order
 *      captured from the checkout redirect (record_top_up_order, 0060).
 *   3. Re-fetch and normalise each order (store, test mode); only a paid
 *      order goes on.
 *   4. credit_top_up, the same function the webhook calls: it locks the Top-up,
 *      grants once, and flags a mismatch instead of granting. A webhook that
 *      arrives later is an idempotent no-op.
 *
 * A pending Top-up with no captured order (the buyer never came back through
 * the redirect) can't be matched from the API and is left for an Operator.
 *
 * Response: { checked, credited, skipped, failed }. 503 when any order could
 * not be fetched, so the run shows as failed and the next run retries.
 */

import { NextResponse } from 'next/server';
import { rpc, select, envConfig } from '../../../../packages/db/supabase-client.js';
import { fetchOrder, normaliseOrder } from '../../../../packages/adapters/lemonsqueezy.js';

const LOG = '[top-up-backfill]';
const MIN_AGE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// ponytail: 20 per run keeps a run well inside Worker limits (one re-fetch
// each, 10s timeout); raise it or page with created_at if backlogs grow.
const BATCH = 20;
const FLAGGED_OR_REFUSED = new Set([
    'ALREADY_CREDITED', 'VARIANT_MISMATCH', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH',
    'TOP_UP_NOT_FOUND', 'ORDER_ALREADY_USED', 'INVALID_ORDER_ID',
]);

// Constant-time compare via SHA-256 digests: equal-length inputs, no early exit.
async function tokenMatches(presented, expected) {
    if (typeof presented !== 'string' || !presented) return false;
    const enc = new TextEncoder();
    const [a, b] = await Promise.all([
        crypto.subtle.digest('SHA-256', enc.encode(presented)),
        crypto.subtle.digest('SHA-256', enc.encode(expected)),
    ]);
    const va = new Uint8Array(a);
    const vb = new Uint8Array(b);
    let diff = 0;
    for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
    return diff === 0;
}

export async function POST(req) {
    const token = process.env.TOP_UP_BACKFILL_TOKEN;
    const cfg = envConfig();
    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    const storeId = process.env.LEMONSQUEEZY_STORE_ID;
    const testMode = process.env.LEMONSQUEEZY_TEST_MODE;
    if (!token || !cfg.supabaseUrl || !cfg.serviceRoleKey || !apiKey || !storeId || (testMode !== 'true' && testMode !== 'false')) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const auth = req.headers.get('authorization') || '';
    const presented = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    if (!(await tokenMatches(presented, token))) {
        console.error(LOG, 'unauthorized call');
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const now = Date.now();
    let rows;
    try {
        rows = await select('top_ups', {
            columns: 'id,checkout_order_id',
            filter: `status=eq.pending&checkout_order_id=not.is.null`
                + `&and=(created_at.lt.${new Date(now - MIN_AGE_MS).toISOString()},created_at.gt.${new Date(now - MAX_AGE_MS).toISOString()})`
                + `&order=created_at.asc`,
            limit: BATCH,
        }, cfg);
    } catch (err) {
        console.error(LOG, 'pending select failed:', err && err.status);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    const counts = { checked: 0, credited: 0, skipped: 0, failed: 0 };
    for (const row of Array.isArray(rows) ? rows : []) {
        counts.checked++;
        try {
            const fetched = await fetchOrder(row.checkout_order_id, { fetch: fetch.bind(globalThis), apiKey });
            if (!fetched.ok) {
                console.error(LOG, 'order re-fetch failed:', row.checkout_order_id, fetched.error);
                if (fetched.transient) counts.failed++; else counts.skipped++;
                continue;
            }
            const norm = normaliseOrder(fetched.order, { top_up_id: row.id }, { expectTestMode: testMode === 'true', expectStoreId: storeId });
            if (!norm.ok) {
                console.error(LOG, 'order not creditable:', row.checkout_order_id, norm.error);
                counts.skipped++;
                continue;
            }
            const o = norm.order;
            if (o.status !== 'paid') {
                counts.skipped++;
                continue;
            }
            const res = await rpc('credit_top_up', {
                p_top_up_id: row.id,
                p_order_id: o.orderId,
                p_paid_usd_cents: o.paidCents,
                p_currency: o.currency,
                p_variant_id: o.variantId,
            }, cfg);
            if (res && res.ok === true) {
                if (res.idempotent === false) {
                    counts.credited++;
                    console.error(LOG, 'credited a Top-up the webhook missed:', row.id, 'order', o.orderId);
                } else {
                    counts.skipped++;
                }
            } else if (res && FLAGGED_OR_REFUSED.has(res.code)) {
                console.error(LOG, 'credit_top_up refused:', res.code, 'order', o.orderId, 'top_up', row.id);
                counts.skipped++;
            } else {
                console.error(LOG, 'credit_top_up gave no usable verdict:', res && res.code);
                counts.failed++;
            }
        } catch (err) {
            console.error(LOG, 'top-up failed:', row.id, err && (err.status ?? err.message));
            counts.failed++;
        }
    }

    return NextResponse.json(counts, { status: counts.failed > 0 ? 503 : 200 });
}
