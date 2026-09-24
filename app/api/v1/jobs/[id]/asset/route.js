/**
 * GET /api/v1/jobs/:id/asset — presigned R2 URL for the caller's own job.
 *
 * Ownership check via get_user_asset(auth_id, job_id) — returns
 * NOT_FOUND if the job doesn't exist OR doesn't belong to this
 * middleware-verified auth id. Same shape either way; no leak of
 * whether the job id exists at all.
 *
 * Response:
 *   { url, mime_type, size_bytes, expires_in, asset_expires_at }
 * Client GETs `url` directly (no proxy hop). 302 redirect would work
 * too but streaming apps prefer the URL in JSON for retries.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { presignGetUrl, isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../../../packages/adapters/r2.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// CLAUDE.md R2 rule: "Presigned URL TTL <=15 min. Longer TTLs need an ADR."
const DEFAULT_EXPIRES_SEC = 900; // 15 min

export async function GET(req, { params }) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const { id } = await params;
    if (!id || !UUID_RE.test(id)) {
        return NextResponse.json({ error: 'invalid_job_id' }, { status: 400 });
    }

    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    // Server-only rollout switch: enable after migration 0110 is applied.
    // Once enabled, a missing/broken limiter cannot fall through to signing.
    if (process.env.ASSET_LINK_RATE_LIMIT_ENABLED === 'true') {
        let rate;
        try {
            rate = await rpc('consume_asset_link_request', { p_auth_id: authId }, cfg);
        } catch {
            console.error('[jobs/asset] rate limit unavailable');
        }
        const headers = { 'Cache-Control': 'no-store' };
        if (rate?.ok === false && rate.code === 'RATE_LIMITED') {
            const retry = Number.isInteger(rate.retry_after_seconds)
                ? Math.max(1, Math.min(60, rate.retry_after_seconds)) : 60;
            return NextResponse.json({ error: 'rate_limited', retry_after_seconds: retry },
                { status: 429, headers: { ...headers, 'Retry-After': String(retry) } });
        }
        if (rate?.ok === false && rate.code === 'NOT_FOUND') {
            return NextResponse.json({ error: 'not_found' }, { status: 404, headers });
        }
        if (rate?.ok !== true) {
            return NextResponse.json({ error: 'rate_limit_unavailable' },
                { status: 503, headers: { ...headers, 'Retry-After': '30' } });
        }
    }

    let asset;
    try {
        asset = await rpc('get_user_asset', { p_auth_id: authId, p_job_id: id }, cfg);
    } catch (err) {
        console.error('[jobs/asset] get_user_asset failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!asset || asset.ok !== true) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    let signed;
    try {
        signed = await presignGetUrl(asset.r2_key, DEFAULT_EXPIRES_SEC, r2cfg);
    } catch (err) {
        console.error('[jobs/asset] presign failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    // The body carries a presigned URL that is valid for anyone holding it,
    // so no cache anywhere may keep it after the response is delivered.
    return NextResponse.json({
        url: signed.url,
        mime_type: asset.mime_type,
        size_bytes: asset.size_bytes,
        expires_in: signed.expires,
        asset_expires_at: asset.asset_expires_at ?? null,
    }, { headers: { 'Cache-Control': 'no-store' } });
}
