/**
 * GET /api/v1/admin/users/lookup?email=… | ?user_id=… | ?job_id=…
 *
 * The read behind the violations UI (ADR-0058 decision 7): one user's
 * standing and their last 25 generations, so an operator can pick the job a
 * warning or takedown is about. Same three gates as the other admin routes;
 * the RPC re-checks users.is_admin and raises 42501 for anyone else.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig, SupabaseError } from '../../../../../../packages/db/supabase-client.js';

const NOT_ADMIN = '42501';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Loose on purpose: it is a lookup key matched case-insensitively in SQL, not
// an address we send to. Bounded so it cannot be a payload.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

const requireAal2 = () => process.env.ADMIN_REQUIRE_AAL2 === 'true';

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    if (requireAal2() && req.headers.get('x-veyrnox-auth-aal') !== 'aal2') {
        return NextResponse.json({ error: 'mfa_required' }, { status: 403 });
    }
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }

    const url = new URL(req.url);
    const email = url.searchParams.get('email');
    const userId = url.searchParams.get('user_id');
    const jobId = url.searchParams.get('job_id');
    const given = [email, userId, jobId].filter((v) => v !== null);
    if (given.length !== 1) return NextResponse.json({ error: 'lookup_invalid' }, { status: 400 });
    if (email !== null && !EMAIL_RE.test(email.trim())) return NextResponse.json({ error: 'email_invalid' }, { status: 400 });
    if (userId !== null && !UUID_RE.test(userId)) return NextResponse.json({ error: 'user_id_invalid' }, { status: 400 });
    if (jobId !== null && !UUID_RE.test(jobId)) return NextResponse.json({ error: 'job_id_invalid' }, { status: 400 });

    let result;
    try {
        result = await rpc('admin_lookup_user', {
            p_auth_id: authId, p_email: email === null ? null : email.trim(), p_user_id: userId, p_job_id: jobId,
        }, cfg);
    } catch (err) {
        const body = err instanceof SupabaseError ? err.body : null;
        const code = body && (body.code || (body.error && body.error.code));
        if (code === NOT_ADMIN || JSON.stringify(body || '').includes('not_admin')) {
            return NextResponse.json({ error: 'not_admin' }, { status: 403 });
        }
        console.error('[api/v1/admin/users/lookup] rpc failed:', err && err.status, body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!result || result.ok !== true) {
        const code = result && result.code ? String(result.code).toLowerCase() : 'lookup_failed';
        return NextResponse.json({ error: code }, { status: code === 'user_not_found' ? 404 : 400 });
    }
    // One user's standing and job list: never cacheable.
    return NextResponse.json({ user: result.user, jobs: Array.isArray(result.jobs) ? result.jobs : [] },
        { headers: { 'Cache-Control': 'no-store' } });
}
