/**
 * GET /api/v1/library-sync — the account's Library favourites (job ids, newest first) and its unsent Create draft
 * (ADR-0340). Bearer-only like the rest of /api/v1: identity is the x-veyrnox-auth-id the middleware set. Off (404)
 * until LIBRARY_SYNC_ENABLED is "true". Never touches credits or the ledger.
 *
 * 200 { favourites: string[], draft: object|null, draft_updated_at: string|null }
 * Errors: 401 not_authenticated, 404 not_found (flag off) | account_not_found, 502 library_sync_unavailable,
 *   503 gateway_not_configured.
 */
import { NextResponse } from 'next/server';
import { gate, call, refused, NO_STORE } from './shared.js';

export async function GET(req) {
    const g = gate(req);
    if (g.response) return g.response;
    const result = await call('get_library_sync', { p_auth_id: g.authId }, g.cfg);
    if (result?.ok !== true) return refused(result);
    return NextResponse.json({
        favourites: Array.isArray(result.favourites) ? result.favourites : [],
        draft: result.draft && typeof result.draft === 'object' ? result.draft : null,
        draft_updated_at: typeof result.draft_updated_at === 'string' ? result.draft_updated_at : null,
    }, { headers: NO_STORE });
}
