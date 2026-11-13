/**
 * PUT /api/v1/library-sync/favourites — body { job_id, starred }: star or unstar one of the caller's own creations
 * (ADR-0340). Replaying either is a no-op. 200 { changed }.
 * Errors: 400 body_invalid, 401, 404 not_found (flag off) | job_not_found (not the caller's, or deleted),
 *   409 too_many_favourites (200 at most), 502 library_sync_unavailable, 503.
 */
import { NextResponse } from 'next/server';
import { cleanFavouriteBody } from '../../../../../lib/librarySync.js';
import { gate, call, refused, fail, NO_STORE } from '../shared.js';

export async function PUT(req) {
    const g = gate(req);
    if (g.response) return g.response;
    let body;
    try { body = await req.json(); } catch { return fail('body_invalid', 400); }
    const clean = cleanFavouriteBody(body);
    if (!clean.ok) return fail('body_invalid', 400);
    const result = await call('set_library_favourite', { p_auth_id: g.authId, p_job_id: clean.jobId, p_starred: clean.starred }, g.cfg);
    if (result?.error === 'job_not_found') return fail('job_not_found', 404);
    if (result?.error === 'too_many_favourites') return fail('too_many_favourites', 409);
    if (result?.ok !== true) return refused(result);
    return NextResponse.json({ changed: result.changed === true }, { headers: NO_STORE });
}
