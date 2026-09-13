/**
 * POST /api/admin/backfill-purchases — credit paid Top-ups whose webhook never
 * landed (ADR-0018 decision 5, ADR-0020).
 *
 *   1. Pending purchases created between 10 minutes and 24 hours ago. Younger
 *      ones may still get their webhook; older ones' Checkout Sessions have
 *      expired and cannot be paid.
 *   2. Stripe's completed Checkout Sessions since the oldest of them.
 *   3. purchase_fulfil for each paid session whose client_reference_id is one
 *      of those purchases — the same idempotent path the webhook takes, so a
 *      webhook arriving at the same moment cannot double-grant.
 *
 * Auth: shared secret ADMIN_BACKFILL_TOKEN in header x-veyrnox-admin-token.
 * Called every 10 minutes by .github/workflows/purchase-backfill.yml.
 *
 * Any purchase found here means a webhook was lost, so each is logged as an
 * error. The response is 500 when anything failed, so the scheduled job goes
 * red. Response: { pending, fulfilled, failed, truncated }.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { listCompletedCheckoutSessions } from '../../../../packages/adapters/stripe.js';
import { tokenMatches } from '../../../../lib/adminToken.js';

const MIN_AGE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PENDING_LIMIT = 500;
// Sessions are created a moment after their purchase row; allow for clock skew.
const SESSION_SLACK_SECONDS = 300;

async function selectPending(cfg, now) {
    const url = new URL('/rest/v1/purchases', cfg.supabaseUrl);
    url.searchParams.set('select', 'id,created_at');
    url.searchParams.set('state', 'eq.PENDING');
    url.searchParams.append('created_at', `lt.${new Date(now - MIN_AGE_MS).toISOString()}`);
    url.searchParams.append('created_at', `gt.${new Date(now - MAX_AGE_MS).toISOString()}`);
    url.searchParams.set('order', 'created_at.asc');
    url.searchParams.set('limit', String(PENDING_LIMIT));
    const res = await fetch(url, {
        headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` },
    });
    if (!res.ok) return { ok: false, error: `purchases read ${res.status}` };
    const rows = await res.json().catch(() => null);
    return Array.isArray(rows) ? { ok: true, rows } : { ok: false, error: 'purchases read unparseable' };
}

export async function POST(req) {
    const token = process.env.ADMIN_BACKFILL_TOKEN;
    if (!token) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    if (!(await tokenMatches(req.headers.get('x-veyrnox-admin-token'), token))) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const cfg = envConfig();
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !secretKey) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const now = Date.now();
    const pending = await selectPending(cfg, now);
    if (!pending.ok) {
        console.error('[purchase-backfill]', pending.error);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (pending.rows.length === 0) return NextResponse.json({ pending: 0, fulfilled: 0, failed: 0, truncated: false });

    // ponytail: scans every completed session since the oldest pending purchase —
    // about a day of paid checkouts, capped at 1,000 per run (truncated → red).
    // Past that volume, store the session id at checkout and retrieve each one.
    const pendingIds = new Set(pending.rows.map((r) => r.id));
    const oldest = Math.floor(Date.parse(pending.rows[0].created_at) / 1000) - SESSION_SLACK_SECONDS;
    const listed = await listCompletedCheckoutSessions(oldest, { secretKey });
    if (!listed.ok) {
        console.error('[purchase-backfill] session list failed:', listed.error);
        return NextResponse.json({ error: 'stripe_unavailable' }, { status: 502 });
    }
    if (listed.truncated) console.error('[purchase-backfill] session list truncated; older sessions not checked this run');

    let fulfilled = 0;
    let failed = 0;
    for (const s of listed.sessions) {
        if (!pendingIds.has(s.client_reference_id) || s.mode !== 'payment' || s.payment_status !== 'paid') continue;
        try {
            const res = await rpc('purchase_fulfil', {
                p_purchase_id: s.client_reference_id,
                p_session_id: s.id,
                p_payment_intent: typeof s.payment_intent === 'string' ? s.payment_intent : null,
            }, cfg);
            if (res && res.ok === true) {
                if (!res.idempotent) {
                    fulfilled++;
                    console.error('[purchase-backfill] credited a paid Top-up the webhook missed', s.client_reference_id, s.id);
                    if (res.frozen === true) console.error('[purchase-backfill] top-up paid into frozen account', res.user_id, s.client_reference_id);
                }
            } else {
                failed++;
                console.error('[purchase-backfill] purchase_fulfil rejected', s.client_reference_id, s.id, res && res.code);
            }
        } catch (err) {
            failed++;
            console.error('[purchase-backfill] purchase_fulfil threw', s.client_reference_id, err && err.status);
        }
    }

    const body = { pending: pending.rows.length, fulfilled, failed, truncated: listed.truncated };
    return NextResponse.json(body, { status: failed > 0 || listed.truncated ? 500 : 200 });
}
