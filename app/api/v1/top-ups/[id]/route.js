/**
 * GET /api/v1/top-ups/:id — the caller's own Top-up status (#93).
 *
 * Polled by the credits page after the Stripe checkout redirect.
 * read_top_up scopes by the middleware-verified auth id, so another user's
 * Top-up is a 404 of the same shape as a missing one.
 *
 * Response (200): { id, status: "pending" | "credited", credits, price_usd_cents, created_at, credited_at }
 */

import { topUpReadLimit } from '../../../../../lib/topUpReadLimit.js';
import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(req, { params }) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const { id } = await params;
    if (!id || !UUID_RE.test(id)) {
        return NextResponse.json({ error: 'invalid_top_up_id' }, { status: 400 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const limited = await topUpReadLimit(authId, cfg);
    if (limited) return limited;

    let res;
    try {
        res = await rpc('read_top_up', { p_auth_id: authId, p_top_up_id: id }, cfg);
    } catch (err) {
        console.error('[api/v1/top-ups/get] rpc failed:', err && err.status);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!res || res.ok !== true || !res.top_up) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const t = res.top_up;
    return NextResponse.json({
        id: t.id,
        status: t.status,
        credits: t.credits,
        price_usd_cents: t.price_usd_cents,
        created_at: t.created_at,
        credited_at: t.credited_at,
    }, { headers: { 'Cache-Control': 'no-store' } });
}
