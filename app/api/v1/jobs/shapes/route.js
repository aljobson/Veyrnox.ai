import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../../packages/adapters/r2.js';
import { defaultDeps } from '../../../../../lib/clipEditSources.js';
import { validShapeIds, measureVideoShapes } from '../../../../../lib/jobVideoShapes.js';
const NO_STORE = { 'Cache-Control': 'no-store' };
export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers: NO_STORE });
    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: NO_STORE }); }
    if (!validShapeIds(body)) return NextResponse.json({ error: 'invalid_job_ids' }, { status: 400, headers: NO_STORE });
    const cfg = envConfig(), r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) return NextResponse.json({ error: 'not_configured' }, { status: 503, headers: NO_STORE });
    // Same limiter and rollout switch as the asset route: each call costs ranged R2 reads.
    if (process.env.ASSET_LINK_RATE_LIMIT_ENABLED === 'true') {
        let rate;
        try {
            rate = await rpc('consume_asset_link_request', { p_auth_id: authId }, cfg);
        } catch {
            console.error('[jobs/shapes] rate limit unavailable');
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

    try {
        const shapes = await measureVideoShapes(authId, body.job_ids.map(id => id.toLowerCase()), { ...defaultDeps(cfg, r2cfg), rpc: (name, args) => rpc(name, args, cfg) });
        return NextResponse.json({ shapes }, { headers: NO_STORE });
    } catch {
        console.error('[jobs/shapes] measurement unavailable');
        return NextResponse.json({ error: 'shapes_unavailable' }, { status: 502, headers: NO_STORE });
    }
}
