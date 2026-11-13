/**
 * PUT /api/v1/library-sync/draft — body { draft }: replace the account's one unsent Create draft (ADR-0340). Words and
 * settings only; anything else in the body is dropped, never stored. Last write wins.
 * DELETE /api/v1/library-sync/draft — remove it.
 * Errors: 400 body_invalid, 401, 404 not_found (flag off), 502 library_sync_unavailable, 503.
 */
import { NextResponse } from 'next/server';
import { cleanDraftBody } from '../../../../../lib/librarySync.js';
import { gate, call, refused, fail, NO_STORE } from '../shared.js';

export async function PUT(req) {
    const g = gate(req);
    if (g.response) return g.response;
    let body;
    try { body = await req.json(); } catch { return fail('body_invalid', 400); }
    const clean = cleanDraftBody(body);
    if (!clean.ok) return fail('body_invalid', 400);
    const result = await call('put_create_draft', { p_auth_id: g.authId, p_draft: clean.draft }, g.cfg);
    if (result?.error === 'invalid_draft') return fail('body_invalid', 400);
    if (result?.ok !== true) return refused(result);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

export async function DELETE(req) {
    const g = gate(req);
    if (g.response) return g.response;
    const result = await call('clear_create_draft', { p_auth_id: g.authId }, g.cfg);
    if (result?.ok !== true) return refused(result);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
