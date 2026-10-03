/**
 * GET /api/v1/social/analytics?accountId=&from=&to= — the analytics
 * dashboard's read (ADR-0061 §2.5, get_social_analytics in 0188). from/to
 * are YYYY-MM-DD, inclusive, at most 366 days apart. The account must be
 * one of the caller's own; anything else is a 404.
 *
 * Response (200): { account: { id, network, display_name, status },
 *   sync: { last_ok_at, failing },
 *   evolution: [{ date, metrics }],   // oldest first, one per stored day
 *   posts: [{ id, published_at, type, permalink, caption, metrics }] }
 */

import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { rpc, envConfig, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

function dayMs(value) {
    if (typeof value !== 'string' || !DATE_RE.test(value)) return NaN;
    const ms = Date.parse(`${value}T00:00:00Z`);
    // Date.parse rolls 2026-02-31 over to March; a real date round-trips.
    return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value ? NaN : ms;
}

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    const url = new URL(req.url);
    const accountId = url.searchParams.get('accountId') || '';
    if (!UUID_RE.test(accountId)) {
        return NextResponse.json({ error: 'invalid_account_id' }, { status: 400 });
    }
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const fromMs = dayMs(from);
    const toMs = dayMs(to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs || toMs - fromMs > MAX_RANGE_DAYS * DAY_MS) {
        return NextResponse.json({ error: 'invalid_range' }, { status: 400 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }

    const limited = await accountReadLimit(authId, cfg, { account: null, sync: null, evolution: [], posts: [] });
    if (limited) return limited;

    let result;
    try {
        result = await rpc('get_social_analytics', {
            p_auth_id: authId, p_account_id: accountId, p_from: from, p_to: to,
        }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/social/analytics:GET] read failed:', status, err && err.body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!result || result.ok !== true) {
        const code = result && result.code;
        if (code === 'USER_NOT_FOUND') return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
        if (code === 'ACCOUNT_NOT_FOUND') return NextResponse.json({ error: 'account_not_found' }, { status: 404 });
        if (code === 'INVALID_RANGE') return NextResponse.json({ error: 'invalid_range' }, { status: 400 });
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json({
        account: result.account, sync: result.sync,
        evolution: result.evolution || [], posts: result.posts || [],
    }, { headers: { 'Cache-Control': 'no-store' } });
}
