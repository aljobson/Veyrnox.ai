/**
 * GET /api/v1/jobs/:id/media-info — the real length and frame of the caller's
 * own finished video, so a client can offer trim points without playing it.
 *
 * Ownership is get_user_asset(auth_id, job_id), the same check as the asset
 * route: a job that is not the caller's reads exactly like one that does not
 * exist. The numbers come from the stored MP4's own headers (the reader the
 * clip editor uses to validate an edit), never from the client or the catalog.
 * No link is minted and no bytes are returned.
 *
 * Response: { seconds, width, height, size_bytes, mime_type }
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../../../packages/adapters/r2.js';
import { defaultDeps } from '../../../../../../lib/clipEditSources.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req, { params }) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

    const { id } = await params;
    if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: 'invalid_job_id' }, { status: 400 });

    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    // Same limiter and rollout switch as the asset route: each call costs ranged R2 reads.
    if (process.env.ASSET_LINK_RATE_LIMIT_ENABLED === 'true') {
        let rate;
        try {
            rate = await rpc('consume_asset_link_request', { p_auth_id: authId }, cfg);
        } catch {
            console.error('[jobs/media-info] rate limit unavailable');
        }
        if (rate?.ok === false && rate.code === 'RATE_LIMITED') {
            const retry = Number.isInteger(rate.retry_after_seconds)
                ? Math.max(1, Math.min(60, rate.retry_after_seconds)) : 60;
            return NextResponse.json({ error: 'rate_limited', retry_after_seconds: retry },
                { status: 429, headers: { ...NO_STORE, 'Retry-After': String(retry) } });
        }
        if (rate?.ok === false && rate.code === 'NOT_FOUND') return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
        if (rate?.ok !== true) {
            return NextResponse.json({ error: 'rate_limit_unavailable' }, { status: 503, headers: { ...NO_STORE, 'Retry-After': '30' } });
        }
    }

    const deps = defaultDeps(cfg, r2cfg);
    let asset;
    try {
        asset = await deps.asset(authId, id);
    } catch (err) {
        console.error('[jobs/media-info] get_user_asset failed:', err);
        return NextResponse.json({ error: 'internal' }, { status: 502, headers: NO_STORE });
    }
    if (!asset || asset.ok !== true || asset.state !== 'STORED') return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
    if (asset.mime_type !== 'video/mp4') return NextResponse.json({ error: 'not_video' }, { status: 400, headers: NO_STORE });

    const info = await deps.mp4(asset.r2_key, Number(asset.size_bytes)).catch(() => null);
    if (!info || !info.width || !info.height || !(info.seconds > 0)) {
        return NextResponse.json({ error: 'unreadable' }, { status: 422, headers: NO_STORE });
    }
    return NextResponse.json({
        seconds: info.seconds, width: info.width, height: info.height,
        size_bytes: Number(asset.size_bytes), mime_type: asset.mime_type,
    }, { headers: NO_STORE });
}
