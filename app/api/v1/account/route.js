/**
 * GET /api/v1/account — who the caller is, what they can spend and how
 * much they have actually made.
 *
 * Response (200): { email, credits, assets, created_at, ... }
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
import { accountDeletionEnabled, deleteAuthUser } from '../../../../lib/accountDeletion.js';

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
        email: authEmail || null, credits: 0, assets: null, created_at: null, rights_attested_at: null, rights_attestation_version: null,
    });
    if (limited) return limited;

    let credits;
    let rows;
    try {
        [credits, rows] = await Promise.all([
            rpc('read_user_credits', { p_auth_id: authId }, cfg),
            select('users', { columns: 'id,email,created_at,rights_attested_at,rights_attestation_version', filter: `auth_id=eq.${authId}`, limit: 1 }, cfg),
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
            const generated = await count('assets', {
                query: `select=id,jobs!inner(user_id)&jobs.user_id=eq.${encodeURIComponent(user.id)}`,
            }, cfg);
            let masters = 0;
            if (process.env.FILM_LIBRARY_MASTERS_ENABLED === 'true') {
                const saved = await rpc('list_film_library_masters', { p_auth_id: authId }, cfg);
                if (saved?.ok !== true || !Array.isArray(saved.masters)) throw new Error('master_count_unavailable');
                masters = saved.masters.length;
            }
            assets = generated + masters;
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
        // Account age drives the first-visit paywall (never a gate on anything).
        created_at: (user && user.created_at) || null,
        // When, and under which AUP version, this user first attested to the
        // rights in an upload (ADR-0058 decision 7). Null until the first one.
        rights_attested_at: (user && user.rights_attested_at) || null,
        rights_attestation_version: (user && user.rights_attestation_version) || null,
    }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * DELETE /api/v1/account — delete the caller's own account (ADR-0111).
 *
 * Body: { confirmation_token } from POST /api/v1/account/deletion. The token is
 * single use for the erasure and bound to this account; sending it again after
 * the account is gone answers 200 with { deleted: true, replayed: true }.
 *
 * Response (200): { deleted: true, replayed: boolean, forfeited_credits?: number }
 * Errors: 400 body_invalid | confirmation_invalid | confirmation_expired,
 *   401 not_authenticated, 404 not_found (flag off), 409 deletion_blocked
 *   (with blockers[]), 502 deletion_incomplete (data erased, sign-in removal
 *   failed: send the same request again), 503 gateway_not_configured.
 *
 * Order: erase the data (one transaction), then remove the Auth user, then
 * record that it is done. A failure between the last two leaves the person
 * signed in to an empty shell until the same request is sent again.
 */
export async function DELETE(req) {
    const noStore = { 'Cache-Control': 'no-store' };
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers: noStore });
    if (!accountDeletionEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: noStore });
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return NextResponse.json({ error: 'gateway_not_configured' }, { status: 503, headers: noStore });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'body_invalid' }, { status: 400, headers: noStore }); }
    const token = body && typeof body === 'object' ? body.confirmation_token : null;
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
        return NextResponse.json({ error: 'confirmation_invalid' }, { status: 400, headers: noStore });
    }

    let erased;
    try {
        erased = await rpc('erase_account', { p_auth_id: authId, p_token: token }, cfg);
    } catch (err) {
        console.error('[api/v1/account] erase failed:', err && err.message);
        return NextResponse.json({ error: 'deletion_unavailable' }, { status: 502, headers: noStore });
    }
    if (erased?.ok !== true) {
        const code = erased?.error;
        if (code === 'deletion_blocked') {
            return NextResponse.json({ error: 'deletion_blocked', blockers: Array.isArray(erased.blockers) ? erased.blockers : [] }, { status: 409, headers: noStore });
        }
        if (code === 'confirmation_invalid' || code === 'confirmation_expired') {
            return NextResponse.json({ error: code }, { status: 400, headers: noStore });
        }
        console.error('[api/v1/account] erase refused:', code);
        return NextResponse.json({ error: 'deletion_unavailable' }, { status: 502, headers: noStore });
    }
    if (erased.state === 'completed') {
        return NextResponse.json({ deleted: true, replayed: true }, { headers: noStore });
    }

    let gone = false;
    try {
        gone = await deleteAuthUser(authId, cfg);
    } catch (err) {
        console.error('[api/v1/account] auth user removal failed:', err && err.message);
    }
    if (!gone) return NextResponse.json({ error: 'deletion_incomplete' }, { status: 502, headers: noStore });

    try {
        await rpc('complete_account_deletion', { p_auth_id: authId, p_token: token }, cfg);
    } catch (err) {
        // The person is gone either way; the record catches up on the next send.
        console.error('[api/v1/account] completion record failed:', err && err.message);
    }
    return NextResponse.json({
        deleted: true,
        replayed: erased.replayed === true,
        ...(Number.isInteger(erased.forfeited_credits) ? { forfeited_credits: erased.forfeited_credits } : {}),
    }, { headers: noStore });
}
