/**
 * POST /api/v1/top-ups/:id/return — record the order the buyer came back
 * from checkout with (#94).
 *
 * LemonSqueezy fills [order_id] and [order_identifier] into the return URL.
 * The credits page posts them here so the backfill can find the order if the
 * webhook never lands. Nothing is credited here: record_top_up_return only
 * stores the pair on the caller's own pending Top-up, and the backfill
 * credits it only if the re-fetched order's identifier matches.
 *
 * Body: { order_id: "<digits>", order_identifier: "<uuid>" }
 * Response (200): { ok: true }
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_ID_RE = /^[0-9]{1,20}$/;

export async function POST(req, { params }) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const { id } = await params;
    if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: 'invalid_top_up_id' }, { status: 400 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    if (!body || typeof body.order_id !== 'string' || !ORDER_ID_RE.test(body.order_id)) {
        return NextResponse.json({ error: 'invalid_order_id' }, { status: 400 });
    }
    if (typeof body.order_identifier !== 'string' || !UUID_RE.test(body.order_identifier)) {
        return NextResponse.json({ error: 'invalid_order_identifier' }, { status: 400 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    let res;
    try {
        res = await rpc('record_top_up_return', {
            p_auth_id: authId,
            p_top_up_id: id.toLowerCase(),
            p_order_id: body.order_id,
            p_order_identifier: body.order_identifier.toLowerCase(),
        }, cfg);
    } catch (err) {
        console.error('[api/v1/top-ups/return] rpc failed:', err && err.status);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (res && res.ok === true) return NextResponse.json({ ok: true });
    if (res && res.code === 'TOP_UP_NOT_FOUND') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    console.error('[api/v1/top-ups/return] unexpected verdict:', res && res.code);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
}
