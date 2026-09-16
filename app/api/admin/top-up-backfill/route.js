/**
 * POST /api/admin/top-up-backfill — credit paid Top-ups whose webhook was
 * missed (#94, ADR-0018 decision 5).
 *
 * Auth: `Authorization: Bearer <TOP_UP_BACKFILL_TOKEN>` (Worker secret),
 * compared in constant time and throttled after repeated failures
 * (lib/adminThrottle.js). Anything else -> 401. Called about every 5 minutes by
 * the Worker's own Cron Trigger (lib/scheduledBackfill.js) and by
 * .github/workflows/top-up-backfill.yml (main only).
 *
 *   1. next_top_up_backfill_batch hands out up to BATCH Top-ups returned from
 *      checkout more than 10 minutes ago and created less than 7 days ago:
 *      pending ones, and credited ones whose returned order isn't the one
 *      that credited them, so a second paid order gets flagged (0060, 0064).
 *   2. For each, one at a time and SPACING_MS apart, re-fetch the returned
 *      order from LemonSqueezy. If the order's identifier matches and it
 *      passes the webhook's checks (lib/topUpBackfill.js), credit it through
 *      backfill_credit_top_up: the order's email must be the Top-up owner's,
 *      an order credited elsewhere is recorded as a collision (0068), and any
 *      refund is clawed back (0063).
 *   3. Close a row whose check reached a final answer (close_top_up_return).
 *   4. Stop at the time budget or on a LemonSqueezy 429. Transient failures
 *      stay open and are due again after their backoff.
 *   5. If the backfill finished, next_top_up_order_sweep_batch hands out up to
 *      SWEEP_BATCH credited Top-ups due a sweep. Each owner's orders are listed
 *      and any second paid order for the pack is flagged for an Operator
 *      refund through flag_swept_top_up_order, never credited (#143, 0068).
 *
 * Response: { checked, credited, idempotent, flagged, refused, skipped, retry, stopped,
 *   sweep: { checked, flagged, ambiguous, refused, retry, stopped } | null }.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { fetchOrder, listOrders } from '../../../../packages/adapters/lemonsqueezy.js';
import { runBackfill, runOrderSweep } from '../../../../lib/topUpBackfill.js';
import { tokenMatches, bearerToken } from '../../../../lib/tokenMatches.js';
import { retryAfterSeconds, recordFailure } from '../../../../lib/adminThrottle.js';

const LOG = '[top-up-backfill]';
const THROTTLE_BUCKET = 'top-up-backfill';
const BATCH = 25;
// LemonSqueezy allows 300 API calls a minute; one every 250ms stays far below.
const SPACING_MS = 250;
const BUDGET_MS = 20000;
// Each sweep is one list call plus a flag call per candidate. A row handed out
// but cut off by the budget waits for its next scheduled sweep.
const SWEEP_BATCH = 10;
const SWEEP_BUDGET_MS = 15000;

export async function POST(req) {
    const token = process.env.TOP_UP_BACKFILL_TOKEN;
    if (!token) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    // Compared before the throttle is consulted: the Cron Trigger and the
    // Actions run must never be locked out by someone else's wrong guesses.
    if (!(await tokenMatches(bearerToken(req.headers.get('authorization')), token))) {
        const seen = recordFailure(THROTTLE_BUCKET);
        const wait = retryAfterSeconds(THROTTLE_BUCKET);
        console.error(LOG, 'unauthorized call, failures in window:', seen);
        if (wait) {
            return NextResponse.json({ error: 'too_many_requests' }, {
                status: 429,
                headers: { 'retry-after': String(wait) },
            });
        }
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const cfg = envConfig();
    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    const storeId = process.env.LEMONSQUEEZY_STORE_ID;
    const testMode = process.env.LEMONSQUEEZY_TEST_MODE;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !apiKey || !storeId || (testMode !== 'true' && testMode !== 'false')) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    let rows;
    try {
        rows = await rpc('next_top_up_backfill_batch', { p_limit: BATCH }, cfg);
    } catch (err) {
        console.error(LOG, 'batch read failed:', err && err.status);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!Array.isArray(rows)) {
        console.error(LOG, 'batch read gave no rows array');
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    // Bound: Workers throw "Illegal invocation" for an unbound fetch.
    const lsFetch = fetch.bind(globalThis);
    const result = await runBackfill(rows, {
        fetchOrder: (orderId) => fetchOrder(orderId, { fetch: lsFetch, apiKey }),
        credit: (args) => rpc('backfill_credit_top_up', args, cfg),
        close: (row) => rpc('close_top_up_return', {
            p_top_up_id: row.top_up_id, p_order_id: row.order_id, p_order_identifier: row.order_identifier,
        }, cfg),
        expectTestMode: testMode === 'true',
        expectStoreId: storeId,
        budgetMs: BUDGET_MS,
        spacingMs: SPACING_MS,
    });
    if (result.stopped) return NextResponse.json({ ...result, sweep: null });

    let sweepRows;
    try {
        sweepRows = await rpc('next_top_up_order_sweep_batch', { p_limit: SWEEP_BATCH }, cfg);
    } catch (err) {
        console.error(LOG, 'sweep batch read failed:', err && err.status);
        return NextResponse.json({ ...result, sweep: null });
    }
    const sweep = await runOrderSweep(Array.isArray(sweepRows) ? sweepRows : [], {
        listOrders: (email) => listOrders({ storeId, email }, { fetch: lsFetch, apiKey }),
        flag: (args) => rpc('flag_swept_top_up_order', args, cfg),
        expectTestMode: testMode === 'true',
        expectStoreId: storeId,
        budgetMs: SWEEP_BUDGET_MS,
        spacingMs: SPACING_MS,
    });
    return NextResponse.json({ ...result, sweep });
}
