/**
 * DELETE /api/v1/social/accounts/:accountId — disconnect one of the
 * caller's own connected accounts (technical spec §2.3, ADR-0061). Wraps
 * disconnect_social_account (packages/db/schema/supabase/0154), which
 * soft-deletes (status='revoked') rather than removing the row, so the
 * account keeps its place in the append-only audit log.
 *
 * Response (200): { ok: true } or { error } with ACCOUNT_NOT_FOUND mapped
 * to a 404 (does not distinguish "not found" from "not yours" — same shape
 * either way, no existence leak, same convention as /api/v1/jobs/:id).
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig, SupabaseError } from '../../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(req, { params }) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    const { accountId } = await params;
    if (!accountId || !UUID_RE.test(accountId)) {
        return NextResponse.json({ error: 'invalid_account_id' }, { status: 400 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    let result;
    try {
        result = await rpc('disconnect_social_account', { p_auth_id: authId, p_account_id: accountId }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/social/accounts/:id] disconnect failed:', status, err && err.body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!result || result.ok !== true) {
        const code = result && result.code;
        if (code === 'ACCOUNT_NOT_FOUND') return NextResponse.json({ error: 'not_found' }, { status: 404 });
        if (code === 'USER_NOT_FOUND') return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
