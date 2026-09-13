/**
 * POST /api/admin/top-up-backfill — credit paid Top-ups whose webhook was
 * missed (#94, ADR-0018 decision 5).
 *
 * Auth: `Authorization: Bearer <TOP_UP_BACKFILL_TOKEN>` (Worker secret),
 * compared in constant time. Anything else -> 401. Called about every 5
 * minutes by .github/workflows/top-up-backfill.yml (main only).
 *
 *   1. next_top_up_backfill_batch hands out up to BATCH Top-ups returned from
 *      checkout more than 10 minutes ago and created less than 7 days ago:
 *      pending ones, and credited ones whose returned order isn't the one
 *      that credited them, so a second paid order gets flagged (0060, 0064).
 *   2. For each, one at a time and SPACING_MS apart, re-fetch the returned
 *      order from LemonSqueezy. If the order's identifier matches and it
 *      passes the webhook's checks (lib/topUpBackfill.js), credit it through
 *      credit_top_up_with_refund, which also claws back any refund (0063).
 *   3. Close a row whose check reached a final answer (close_top_up_return).
 *   4. Stop at the time budget or on a LemonSqueezy 429. Transient failures
 *      stay open and are due again after their backoff.
 *
 * Response: { checked, credited, idempotent, flagged, refused, skipped, retry, stopped }.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { fetchOrder } from '../../../../packages/adapters/lemonsqueezy.js';
import { runBackfill } from '../../../../lib/topUpBackfill.js';
import { tokenMatches, bearerToken } from '../../../../lib/tokenMatches.js';

const LOG = '[top-up-backfill]';
const BATCH = 25;
// LemonSqueezy allows 300 API calls a minute; one every 250ms stays far below.
const SPACING_MS = 250;
const BUDGET_MS = 20000;

export async function POST(req) {
    const token = process.env.TOP_UP_BACKFILL_TOKEN;
    if (!token) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    if (!(await tokenMatches(bearerToken(req.headers.get('authorization')), token))) {
        console.error(LOG, 'unauthorized call');
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

    const result = await runBackfill(rows, {
        // Bound: Workers throw "Illegal invocation" for an unbound fetch.
        fetchOrder: (orderId) => fetchOrder(orderId, { fetch: fetch.bind(globalThis), apiKey }),
        credit: (args) => rpc('credit_top_up_with_refund', args, cfg),
        close: (row) => rpc('close_top_up_return', { p_top_up_id: row.top_up_id, p_order_id: row.order_id }, cfg),
        expectTestMode: testMode === 'true',
        expectStoreId: storeId,
        budgetMs: BUDGET_MS,
        spacingMs: SPACING_MS,
    });
    return NextResponse.json(result);
}
