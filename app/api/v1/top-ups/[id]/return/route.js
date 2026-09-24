/**
 * POST /api/v1/top-ups/:id/return — record the Stripe Checkout Session on
 * the caller's own pending Top-up (ADR-0033). This grants nothing; recovery
 * re-fetches and verifies the session before calling credit_top_up.
 * Body: { session_id: "cs_..." }. Response (200): { ok: true }.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID_RE = /^cs_[A-Za-z0-9_]{1,251}$/;

export async function POST(req, { params }) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not-authenticated' }, { status: 401 });

    const { id } = await params;
    if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: 'invalid-top-up-id' }, { status: 400 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid-json' }, { status: 400 }); }
    if (!body || typeof body.session_id !== 'string' || !SESSION_ID_RE.test(body.session_id)) {
        return NextResponse.json({ error: 'invalid-session-id' }, { status: 400 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'not-configured' }, { status: 503 });
    }

    let res;
    try {
        res = await rpc('record_top_up_return_session', {
            p_auth_id: authId,
            p_top_up_id: id.toLowerCase(),
            p_session_id: body.session_id,
        }, cfg);
    } catch (err) {
        console.error('[api/v1/top-ups/return] rpc failed:', err && err.status);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (res && res.ok === true) return NextResponse.json({ ok: true });
    if (res && res.code === 'INVALID_SESSION_ID') return NextResponse.json({ error: 'invalid-session-id' }, { status: 400 });
    if (res && res.code === 'TOP_UP_NOT_FOUND') return NextResponse.json({ error: 'not-found' }, { status: 404 });
    console.error('[api/v1/top-ups/return] unexpected verdict:', res && res.code);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
}
