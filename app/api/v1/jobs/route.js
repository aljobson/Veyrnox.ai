/**
 * GET /api/v1/jobs — the caller's own jobs, newest first.
 *
 * The Library had no server-side list: its only source of job ids was a
 * 50-entry ring buffer in one browser (audit 2026-09-23, finding 11). This
 * is the account's list, so a second device, a cleared cache or a 51st
 * generation no longer hides work that exists.
 *
 * Ownership is enforced inside list_user_jobs (0102) against the verified
 * auth id from middleware — never a user id from the request.
 *
 * Query: ?limit=1..50 (default 24), and ?before=<ISO>&before_id=<uuid> from
 * the previous page's `next`. Response:
 *   { jobs: [{ job_id, state, refunded, credits, model_id, error_code,
 *              created_at, label, has_asset, asset_expires_at }], next: {before, before_id}|null }
 */

import { NextResponse } from 'next/server';
import { jobReadLimitResponse } from '../../../../lib/jobReadLimit.js';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_ERROR_RE = /^[a-z0-9_]{1,64}$/;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;

/** Same mapping as /jobs/:id, so one row means the same thing on both. */
function mapState(dbState) {
    switch (dbState) {
        case 'PRICED':
        case 'DEBITED':
        case 'FAILOVER':
            return 'queued';
        case 'SUBMITTED':
        case 'SUCCEEDED':
            return 'running';
        case 'STORED':
            return 'succeeded';
        case 'FAILED':
        case 'REFUNDED':
            return 'failed';
        default:
            return 'queued';
    }
}

function publicErrorCode(code) {
    if (!code) return undefined;
    const s = String(code).toLowerCase();
    return PUBLIC_ERROR_RE.test(s) ? s : 'provider_error';
}

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const url = new URL(req.url);
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        return NextResponse.json({ error: 'invalid_limit' }, { status: 400 });
    }

    // The cursor is ours, handed back from `next`; both halves or neither.
    const before = url.searchParams.get('before');
    const beforeId = url.searchParams.get('before_id');
    if ((before === null) !== (beforeId === null)) {
        return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 });
    }
    if (before !== null && (Number.isNaN(Date.parse(before)) || !UUID_RE.test(beforeId))) {
        return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    let row;
    try {
        row = await rpc('list_user_jobs', {
            p_auth_id: authId,
            p_limit: limit,
            p_before_created_at: before,
            p_before_id: beforeId,
        }, cfg);
    } catch (err) {
        console.error('[jobs/list] rpc failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    const limited = jobReadLimitResponse(row);
    if (limited) return limited;
    if (!row || row.ok !== true || !Array.isArray(row.jobs)) {
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    const jobs = row.jobs.map((j) => ({
        job_id: j.job_id,
        state: mapState(j.state),
        // FAILED is not REFUNDED; the Library shows the difference.
        refunded: j.state === 'REFUNDED',
        credits: j.credits,
        model_id: j.model_id,
        error_code: publicErrorCode(j.error_code),
        created_at: j.created_at,
        label: j.label || undefined,
        has_asset: !!j.has_asset,
        asset_expires_at: j.asset_expires_at ?? null,
    }));
    // A full page means there may be more; the cursor is the last row's key.
    const last = jobs.length === limit ? row.jobs[row.jobs.length - 1] : null;

    return NextResponse.json({
        jobs,
        next: last ? { before: last.created_at, before_id: last.job_id } : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
}
