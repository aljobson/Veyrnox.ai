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
 * Re-fetch each returned Stripe Session, verify its signed Top-up binding,
 * then credit its PaymentIntent through credit_top_up. Close terminal returns
 * using the Session id and a NULL identifier (0108). Transient failures remain
 * due after their database backoff. The retired LemonSqueezy sweep is disabled;
 * a Stripe search sweep is outside ADR-0033's scope.
 * Response: { checked, credited, idempotent, flagged, refused, skipped, retry,
 *   stopped, sweep: null }.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { fetchSession } from '../../../../packages/adapters/stripe.js';
import { runBackfill } from '../../../../lib/topUpBackfill.js';
import { tokenMatches, bearerToken } from '../../../../lib/tokenMatches.js';
import { retryAfterSeconds, recordFailure } from '../../../../lib/adminThrottle.js';
import { requireAccess } from '../../../../lib/accessJwt.js';

const LOG = '[top-up-backfill]';
const THROTTLE_BUCKET = 'top-up-backfill';
const BATCH = 25;
// Space provider calls and keep each batch within the cron request budget.
const SPACING_MS = 250;
const BUDGET_MS = 20000;
export async function POST(req) {
    // Cloudflare Access is the front door for anything that arrives from the
    // internet; the Worker cron's own invocation never crosses the edge and
    // is recognised by the absence of cf-ray (lib/accessJwt.js).
    const gate = await requireAccess(req);
    if (!gate.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

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
    const apiKey = process.env.STRIPE_SECRET_KEY;
    const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !apiKey || !signingSecret) {
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

    // Bound through globalThis, with a timeout so a stalled provider can retry.
    const stripeFetch = (url, init) => globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    const result = await runBackfill(rows, {
        fetchSession: (sessionId) => fetchSession(sessionId, { fetch: stripeFetch, apiKey }),
        credit: (args) => rpc('credit_top_up', args, cfg),
        close: (row) => rpc('close_top_up_return', {
            p_top_up_id: row.top_up_id, p_order_id: row.order_id, p_order_identifier: null,
        }, cfg),
        expectLiveMode: apiKey.startsWith('sk_live_'),
        signingSecret,
        budgetMs: BUDGET_MS,
        spacingMs: SPACING_MS,
    });
    return NextResponse.json({ ...result, sweep: null });
}
