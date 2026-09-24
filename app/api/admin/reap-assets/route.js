/**
 * POST /api/admin/reap-assets — Worker consumer for the asset_reap_queue.
 *
 * The queue drain itself is lib/assetReap.js, which the five-minute Worker
 * cron also calls (worker.js). This route is the manual replay.
 *
 * Auth: shared secret `ADMIN_REAP_TOKEN` in header `x-veyrnox-admin-token`,
 * compared in constant time and throttled after repeated failures
 * (lib/adminThrottle.js). Not exposed to end users. Meant for a cron worker or
 * manual replay.
 *
 * Response: { processed, deleted, failed, remaining? }.
 */

import { NextResponse } from 'next/server';
import { envConfig } from '../../../../packages/db/supabase-client.js';
import { tokenMatches } from '../../../../lib/tokenMatches.js';
import { requireAccess } from '../../../../lib/accessJwt.js';
import { retryAfterSeconds, recordFailure } from '../../../../lib/adminThrottle.js';
import { isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../packages/adapters/r2.js';
import { reapAssets } from '../../../../lib/assetReap.js';

const THROTTLE_BUCKET = 'reap-assets';

export async function POST(req) {
    // Cloudflare Access is the front door for anything that arrives from the
    // internet; the Worker cron's own invocation never crosses the edge and
    // is recognised by the absence of cf-ray (lib/accessJwt.js).
    const gate = await requireAccess(req);
    if (!gate.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const token = process.env.ADMIN_REAP_TOKEN;
    if (!token) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    // The secret is compared before the throttle is consulted, so a caller
    // presenting the right token is never locked out. Throttling first would
    // let anyone stall the reaper by spending ten wrong guesses.
    if (!(await tokenMatches(req.headers.get('x-veyrnox-admin-token'), token))) {
        // Logged so Worker observability shows probing, not just silence.
        const seen = recordFailure(THROTTLE_BUCKET);
        const wait = retryAfterSeconds(THROTTLE_BUCKET);
        console.error('[reap-assets] unauthorized call, failures in window:', seen);
        if (wait) {
            return NextResponse.json({ error: 'too_many_requests' }, {
                status: 429,
                headers: { 'retry-after': String(wait) },
            });
        }
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const out = await reapAssets(cfg, r2cfg);
    if (!out.ok) {
        console.error('[reap-assets] queue read failed:', out.error);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json({ processed: out.processed, deleted: out.deleted, failed: out.failed });
}
