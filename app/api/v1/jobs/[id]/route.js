/**
 * GET /api/v1/jobs/:id — ownership-checked job state.
 *
 * Response (200):
 *   { state, credits, model_id, error_code? }
 *   state ∈ ("queued" | "running" | "succeeded" | "failed")
 *
 * DB → UI state mapping (lib/jobState.js, so the UI stays honest with the ledger):
 *   PRICED, DEBITED, FAILOVER   → queued  (nothing user-visible yet)
 *   SUBMITTED, SUCCEEDED        → running (provider working / asset copying
 *                                  to R2 — no asset row until STORED)
 *   STORED                      → succeeded (asset copied, /asset resolves)
 *
 * A job whose R2 copy keeps failing therefore reads `running` rather than
 * a lying `succeeded`. It does not read that way forever: the webhook
 * answers 500 so fal retries, and sweep_stuck_jobs (0023) fails and
 * refunds a SUCCEEDED job that still has no asset after the grace window,
 * at which point this returns `failed`.
 *   FAILED, REFUNDED            → failed  (credits already back on ledger)
 *
 * 404 fires when the job doesn't exist OR belongs to someone else —
 * same shape either way; no existence leak. A job its owner has deleted
 * (DELETE below) reads the same way.
 *
 * DELETE /api/v1/jobs/:id (ADR-0116) — the owner deletes one creation: the
 * file and the prompt go, the job row and every ledger entry stay, no refund.
 *   200 { deleted: true, replayed }       (the same request again: replayed true)
 *   404 not_found                          (missing, someone else's, or a chat reply)
 *   409 job_in_progress | job_on_hold | used_by_post | used_by_cinema | used_by_library
 *   403 account_frozen   429 rate_limited
 * Irreversible: there is no restore.
 */

import { NextResponse } from 'next/server';
import { jobReadLimitResponse } from '../../../../../lib/jobReadLimit.js';
import { publicJob } from '../../../../../lib/jobState.js';
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req, { params }) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const { id } = await params;
    if (!id || !UUID_RE.test(id)) {
        return NextResponse.json({ error: 'invalid_job_id' }, { status: 400 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    let row;
    try {
        row = await rpc('get_user_job', { p_auth_id: authId, p_job_id: id }, cfg);
    } catch (err) {
        console.error('[jobs/get] rpc failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    const limited = jobReadLimitResponse(row);
    if (limited) return limited;
    if (!row || row.ok !== true) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // The mapping lives in lib/jobState.js, shared with the route that answers for a send by its key.
    return NextResponse.json(publicJob(row), { headers: { 'Cache-Control': 'no-store' } });
}

const DELETE_REFUSALS = {
    ACCOUNT_FROZEN: [403, 'account_frozen'],
    IN_PROGRESS: [409, 'job_in_progress'],
    ON_HOLD: [409, 'job_on_hold'],
    USED_BY_POST: [409, 'used_by_post'],
    USED_BY_CINEMA: [409, 'used_by_cinema'],
    USED_BY_LIBRARY: [409, 'used_by_library'],
};

export async function DELETE(req, { params }) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const { id } = await params;
    if (!id || !UUID_RE.test(id)) {
        return NextResponse.json({ error: 'invalid_job_id' }, { status: 400 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    let row;
    try {
        row = await rpc('delete_user_job', { p_auth_id: authId, p_job_id: id }, cfg);
    } catch (err) {
        console.error('[jobs/delete] rpc failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    const limited = jobReadLimitResponse(row);
    if (limited) return limited;
    const headers = { 'Cache-Control': 'no-store' };
    if (row?.ok === true) return NextResponse.json({ deleted: true, replayed: row.replayed === true }, { headers });
    const refusal = DELETE_REFUSALS[row?.code];
    if (refusal) return NextResponse.json({ error: refusal[1] }, { status: refusal[0], headers });
    if (row?.code === 'NOT_FOUND') return NextResponse.json({ error: 'not_found' }, { status: 404, headers });
    console.error('[jobs/delete] unexpected rpc answer');
    return NextResponse.json({ error: 'internal' }, { status: 502, headers });
}
