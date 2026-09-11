/**
 * GET /api/v1/jobs/:id/asset — presigned R2 URL for the caller's own job.
 *
 * Ownership check via get_user_asset(auth_id, job_id) — returns
 * NOT_FOUND if the job doesn't exist OR doesn't belong to this
 * middleware-verified auth id. Same shape either way; no leak of
 * whether the job id exists at all.
 *
 * Response:
 *   { url, mime_type, size_bytes, expires_in }
 * Client GETs `url` directly (no proxy hop). 302 redirect would work
 * too but streaming apps prefer the URL in JSON for retries.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { presignGetUrl, envConfig as r2EnvConfig } from '../../../../../../packages/adapters/r2.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// CLAUDE.md R2 rule: "Presigned URL TTL <=15 min. Longer TTLs need an ADR."
const DEFAULT_EXPIRES_SEC = 900; // 15 min

export async function GET(req, { params }) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

    const { id } = await params;
    if (!id || !UUID_RE.test(id)) {
        return NextResponse.json({ error: 'invalid job id' }, { status: 400 });
    }

    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2cfg.accountId) {
        return NextResponse.json({ error: 'not configured' }, { status: 503 });
    }

    let asset;
    try {
        asset = await rpc('get_user_asset', { p_auth_id: authId, p_job_id: id }, cfg);
    } catch (err) {
        console.error('[jobs/asset] get_user_asset failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!asset || asset.ok !== true) {
        return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    let signed;
    try {
        signed = await presignGetUrl(asset.r2_key, DEFAULT_EXPIRES_SEC, r2cfg);
    } catch (err) {
        console.error('[jobs/asset] presign failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json({
        url: signed.url,
        mime_type: asset.mime_type,
        size_bytes: asset.size_bytes,
        expires_in: signed.expires,
    });
}
