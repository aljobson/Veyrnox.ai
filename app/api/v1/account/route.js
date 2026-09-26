/**
 * GET /api/v1/account — who the caller is, what they can spend and how
 * much they have actually made.
 *
 * Response (200): { email, credits, assets }
 *   email   — the verified identity, or null if the token carried none.
 *             No display name: public.users has no such column, and the
 *             browser already holds the one Google gave us, in the
 *             session's user_metadata (app/veyrnox/_lib/account.js).
 *   credits — credit_balances.balance, via the same read_user_credits
 *             RPC /api/v1/balance uses. One source for the money figure.
 *   assets  — rows in public.assets belonging to this user's jobs, or
 *             null if that count could not be taken. Never a guess: the
 *             header renders "—" rather than a number that is wrong.
 *
 * Identity comes from x-veyrnox-auth-id / x-veyrnox-auth-email, which
 * middleware.js sets after verifying the Supabase JWT and overwrites on
 * every request. A client-supplied id can never reach this handler.
 */

import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../lib/accountReadLimit.js';
import { rpc, select, count, envConfig, SupabaseError } from '../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    // A missing or malformed sub is an unauthenticated caller, not a 500.
    if (!authId || !UUID_RE.test(authId)) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }
    const authEmail = req.headers.get('x-veyrnox-auth-email');

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }

    const limited = await accountReadLimit(authId, cfg, {
        email: authEmail || null, credits: 0, assets: null, rights_attested_at: null, rights_attestation_version: null,
    });
    if (limited) return limited;

    let credits;
    let rows;
    try {
        [credits, rows] = await Promise.all([
            rpc('read_user_credits', { p_auth_id: authId }, cfg),
            select('users', { columns: 'id,email,rights_attested_at,rights_attestation_version', filter: `auth_id=eq.${authId}`, limit: 1 }, cfg),
        ]);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/account] identity read failed:', status, err && err.body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    const user = Array.isArray(rows) ? rows[0] : null;

    // assets joins to jobs, and jobs is what carries the user — so the
    // count is an !inner embed filtered on the owner. A failure here must
    // not cost the caller their balance, so it degrades to null.
    let assets = null;
    if (user && user.id) {
        try {
            assets = await count('assets', {
                query: `select=id,jobs!inner(user_id)&jobs.user_id=eq.${encodeURIComponent(user.id)}`,
            }, cfg);
        } catch (err) {
            const status = err instanceof SupabaseError ? err.status : 0;
            console.error('[api/v1/account] asset count failed:', status, err && err.body);
        }
    }

    // Per-user figures: never let a browser or intermediary keep a copy.
    return NextResponse.json({
        email: authEmail || (user && user.email) || null,
        credits: Number(credits && credits.balance) || 0,
        assets,
        // When, and under which AUP version, this user first attested to the
        // rights in an upload (ADR-0058 decision 7). Null until the first one.
        rights_attested_at: (user && user.rights_attested_at) || null,
        rights_attestation_version: (user && user.rights_attestation_version) || null,
    }, { headers: { 'Cache-Control': 'no-store' } });
}
