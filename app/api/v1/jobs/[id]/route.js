/**
 * GET /api/v1/jobs/:id — ownership-checked job state.
 *
 * Response (200):
 *   { state, credits, model_id, provider_job_id, error_code? }
 *   state ∈ ("queued" | "running" | "succeeded" | "failed")
 *
 * DB → UI state mapping (kept here so UI stays honest with the ledger):
 *   PRICED, DEBITED, FAILOVER   → queued  (nothing user-visible yet)
 *   SUBMITTED, SUCCEEDED        → running (provider working / asset copying
 *                                  to R2 — no asset row until STORED)
 *   STORED                      → succeeded (asset copied, /asset resolves)
 *   FAILED, REFUNDED            → failed  (credits already back on ledger)
 *
 * 404 fires when the job doesn't exist OR belongs to someone else —
 * same shape either way; no existence leak.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    if (!row || row.ok !== true) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json({
        state: mapState(row.state),
        credits: row.credits,
        model_id: row.model_id,
        provider_job_id: row.provider_job_id,
        error_code: row.error_code || undefined,
    });
}
