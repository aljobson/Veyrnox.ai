/**
 * POST /api/v1/montage/plan — step 1 of the video agent (ADR-0074 §2).
 *
 * Body: { brief, aspect_ratio? }. Asks the isolated runner to plan (no debit,
 * no provider spend), and returns what the user approves: a short plan, the
 * catalog price and an Approve ticket (lib/montagePlan.js). Approving is a
 * normal POST /api/v1/generations that carries the ticket and the idempotency
 * key it names. Identity comes from x-veyrnox-auth-id, set by middleware.js.
 */

import { NextResponse } from 'next/server';
import { rpc, select, envConfig } from '../../../../../packages/db/supabase-client.js';
import { callRunner, runtimeConfig } from '../../../../../lib/montageRuntime.js';
import { BRIEF_RE, ASPECTS, mintPlanToken, planIdempotencyKey, publicPlan } from '../../../../../lib/montagePlan.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATALOG_ID = 'video-agent';
const RATE_LIMIT_PER_WINDOW = 10;
const RATE_WINDOW_SECONDS = 60;

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    if (process.env.AGENT_VIDEO_ENABLED !== 'true') return NextResponse.json({ error: 'video_agent_unavailable' }, { status: 404 });

    const cfg = envConfig();
    const rt = runtimeConfig();
    const secret = process.env.MONTAGE_PLAN_SECRET;
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !rt || !secret) return NextResponse.json({ error: 'gateway_not_configured' }, { status: 503 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
    const brief = body && body.brief;
    const aspect = (body && body.aspect_ratio) || '9:16';
    if (typeof brief !== 'string' || !BRIEF_RE.test(brief)) return NextResponse.json({ error: 'inputs_invalid:brief' }, { status: 400 });
    if (!ASPECTS.includes(aspect)) return NextResponse.json({ error: 'inputs_invalid:aspect_ratio' }, { status: 400 });

    // Planning can cost us a model call, so it shares the generation attempt limit (0113).
    try {
        const rl = await rpc('check_generation_rate_limit', { p_auth_id: authId, p_limit_per_window: RATE_LIMIT_PER_WINDOW, p_window_seconds: RATE_WINDOW_SECONDS }, cfg);
        if (!rl || typeof rl.ok !== 'boolean') return NextResponse.json({ error: 'rate_check_unavailable' }, { status: 503 });
        if (rl.ok === false) {
            if (rl.code === 'RATE_LIMITED') {
                const retryAfter = Math.max(1, Math.min(600, Number(rl.retry_after_seconds) || 60));
                return new NextResponse(JSON.stringify({ error: 'rate_limited', retry_after_seconds: retryAfter }),
                    { status: 429, headers: { 'content-type': 'application/json', 'retry-after': String(retryAfter) } });
            }
            return NextResponse.json({ error: 'rate_check_unavailable' }, { status: 503 });
        }
    } catch (err) {
        console.error('[montage-plan] rate check failed:', err && err.message);
        return NextResponse.json({ error: 'rate_check_unavailable' }, { status: 503 });
    }

    let credits;
    try {
        const rows = await select('model_catalog', { columns: 'credits_5s,active', filter: `id=eq.${CATALOG_ID}` }, cfg);
        const row = Array.isArray(rows) && rows[0];
        if (!row || !row.active) return NextResponse.json({ error: 'model_not_found' }, { status: 404 });
        credits = row.credits_5s;
    } catch (err) {
        console.error('[montage-plan] catalog lookup failed:', err && err.message);
        return NextResponse.json({ error: 'catalog_lookup_failed' }, { status: 502 });
    }

    const planned = await callRunner('/plan', { brief, aspect_ratio: aspect }, { base: rt.runnerBase, secret: rt.runnerSecret });
    if (!planned.ok) return NextResponse.json({ error: 'plan_unavailable' }, { status: 502 });

    const { token, nonce, expiresAt } = await mintPlanToken({ secret, authId, brief, aspect, credits });
    return NextResponse.json({
        plan_id: token,
        idempotency_key: planIdempotencyKey(nonce),
        plan: publicPlan(planned.data),
        credits,
        aspect_ratio: aspect,
        expires_at: expiresAt,
    });
}
