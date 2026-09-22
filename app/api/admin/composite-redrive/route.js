/**
 * POST /api/admin/composite-redrive — the composite-job sweep (ADR-0029).
 *
 * Called in-process by the five-minute Cron Trigger (worker.js), like the
 * Top-up backfill, because a scheduled invocation has no process.env for the
 * engine's Supabase and R2 config. It frees steps stranded between claim and
 * submit, retries steps whose provider callback never arrived (once; a step
 * has at most 2 attempts), and re-drives parents with ready work.
 *
 * Auth: the same cron bearer as /api/admin/top-up-backfill
 * (TOP_UP_BACKFILL_TOKEN), so no new secret is needed to deploy. Never
 * reachable without it.
 */
import { NextResponse } from 'next/server';
import { envConfig } from '../../../../packages/db/supabase-client.js';
import { engine } from '../../../../lib/compositeJobs.js';
import { tokenMatches, bearerToken } from '../../../../lib/tokenMatches.js';
import { retryAfterSeconds, recordFailure } from '../../../../lib/adminThrottle.js';

const LOG = '[composite-redrive]';
const THROTTLE_BUCKET = 'composite-redrive';

export async function POST(req) {
    const token = process.env.TOP_UP_BACKFILL_TOKEN;
    if (!token) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    if (!(await tokenMatches(bearerToken(req.headers.get('authorization')), token))) {
        const seen = recordFailure(THROTTLE_BUCKET);
        const wait = retryAfterSeconds(THROTTLE_BUCKET);
        console.error(LOG, 'unauthorized call, failures in window:', seen);
        return NextResponse.json({ error: 'unauthorized' }, {
            status: wait ? 429 : 401,
            headers: wait ? { 'Retry-After': String(wait) } : undefined,
        });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    try {
        const out = await engine.redriveDue(cfg, { falKey: process.env.FAL_KEY, publicHost: process.env.PUBLIC_HOST });
        if (out.retried || out.released) console.error(LOG, JSON.stringify(out));
        return NextResponse.json(out, { status: out.ok ? 200 : 502 });
    } catch (err) {
        console.error(LOG, 'failed:', err && err.message);
        return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
}
