/**
 * GET /api/v1/jobs/:id/provenance — what Veyrnox knows about how an asset
 * was made.
 *
 * This is the honest half of ADR-0025. Veyrnox is the generator, so for an
 * asset produced here the ledger and `jobs` are an exact record: which
 * model, when, at what price. No classifier, no vendor, no confidence
 * score — nothing that can be wrong.
 *
 * Deliberately NOT returned: `provider` and `provider_job_id`. Which vendor
 * served a model is an internal routing detail, and /api/v1/jobs/:id already
 * withholds it. Provenance is about what was made, not who we bought it from.
 *
 * Scope, stated plainly because it would be easy to oversell: this proves
 * that this account generated an asset under this job id. It does NOT bind a
 * file the caller is holding to that record — that needs a content hash
 * stored at ingest, which `assets` has no column for today. Until then this
 * is a record, not a proof.
 */

import { NextResponse } from 'next/server';
import { rpc, select, envConfig } from '../../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A job only has meaningful provenance once its output is actually stored.
// Anything earlier describes an intention, not a thing that exists.
const SETTLED = new Set(['SUCCEEDED', 'STORED']);

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
        // Ownership is enforced inside the RPC, which answers NOT_FOUND the
        // same way whether the job is missing or someone else's.
        row = await rpc('get_user_job', { p_auth_id: authId, p_job_id: id }, cfg);
    } catch (err) {
        console.error('[jobs/provenance] rpc failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!row || row.ok !== true) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (!SETTLED.has(String(row.state))) {
        return NextResponse.json({ error: 'not_generated' }, { status: 409 });
    }

    // The catalog holds the display name and modality. A missing row is not
    // fatal — a model can be retired after the job that used it — so the
    // record degrades to the id rather than failing.
    let model = { id: row.model_id, name: row.model_id, modality: null };
    try {
        const rows = await select(
            'model_catalog',
            { columns: 'id,name,modality', filter: `id=eq.${encodeURIComponent(row.model_id)}` },
            cfg,
        );
        const found = Array.isArray(rows) && rows[0];
        if (found) model = { id: found.id, name: found.name, modality: found.modality };
    } catch (err) {
        console.error('[jobs/provenance] catalog read failed:', err);
    }

    return NextResponse.json({
        job_id: id,
        platform: 'Veyrnox.ai',
        generated: true,
        model,
        credits: row.credits,
        created_at: row.created_at,
        completed_at: row.updated_at,
        // Say what this is and is not, in the payload, so a consumer cannot
        // mistake a record for a cryptographic proof.
        record_scope: 'Generation record held by Veyrnox.ai. Identifies how this job produced its output; does not bind an arbitrary file to this record.',
    }, { headers: { 'Cache-Control': 'no-store' } });
}
