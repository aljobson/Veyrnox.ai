/**
 * /api/v1/admin/violations — the content violation record (ADR-0058 decision 7).
 *
 *   GET  ?user_id=<uuid>&limit=<n>   list warnings, takedowns and content
 *                                    Freezes, newest first
 *   POST { user_id, job_id?, tier, reason }
 *                                    record a 'warning' or a 'takedown'. A
 *                                    takedown removes the job's assets at once
 *                                    and the third one Freezes the account.
 *                                    Requires an Idempotency-Key header: a
 *                                    replay answers 200 with the first record
 *                                    and `replayed: true`, never a second strike.
 *
 * Same four gates as /api/v1/admin/metrics: middleware identity, the
 * ADMIN_REQUIRE_AAL2 second-factor flag, the Cloudflare Access assertion
 * verified in code, and the RPC's own users.is_admin check (42501
 * 'not_admin'). Every write lands in the append-only
 * account_actions table with the admin's email as actor and the job as trace.
 *
 * After a write, the user is emailed (lib/violationEmail.js). `email` in the
 * response is 'sent', 'failed', or 'skipped' when sending is not configured.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig, SupabaseError } from '../../../../../packages/db/supabase-client.js';
import { notifyViolation } from '../../../../../lib/violationEmail.js';
import { requireDashboardAccess } from '../../../../../lib/accessJwt.js';

const NOT_ADMIN = '42501';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIERS = new Set(['warning', 'takedown']);
const MAX_BODY_BYTES = 4 * 1024;
// The form sends one key per attempt; the RPC stores it on the strike and
// answers a replay with the first result, so a lost response and a resubmit
// record one strike, not two (0246, audit P-07).
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,128}$/;

const requireAal2 = () => process.env.ADMIN_REQUIRE_AAL2 === 'true';

async function gate(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return { response: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }) };
    if (requireAal2() && req.headers.get('x-veyrnox-auth-aal') !== 'aal2') {
        return { response: NextResponse.json({ error: 'mfa_required' }, { status: 403 }) };
    }
    const access = await requireDashboardAccess(req);
    if (!access.ok) return { response: NextResponse.json({ error: access.error }, { status: access.status }) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return { response: NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 }) };
    }
    return { authId, cfg };
}

function rpcFailure(err, where) {
    const body = err instanceof SupabaseError ? err.body : null;
    const code = body && (body.code || (body.error && body.error.code));
    if (code === NOT_ADMIN || JSON.stringify(body || '').includes('not_admin')) {
        return NextResponse.json({ error: 'not_admin' }, { status: 403 });
    }
    console.error(`[api/v1/admin/violations] ${where} rpc failed:`, err && err.status, body);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
}

export async function GET(req) {
    const g = await gate(req);
    if (g.response) return g.response;
    const url = new URL(req.url);
    const userId = url.searchParams.get('user_id');
    if (userId !== null && !UUID_RE.test(userId)) {
        return NextResponse.json({ error: 'user_id_invalid' }, { status: 400 });
    }
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw === null ? 50 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return NextResponse.json({ error: 'limit_invalid' }, { status: 400 });
    }
    try {
        const rows = await rpc('list_content_violations', { p_auth_id: g.authId, p_user_id: userId, p_limit: limit }, g.cfg);
        return NextResponse.json({ violations: Array.isArray(rows) ? rows : [] }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return rpcFailure(err, 'list');
    }
}

export async function POST(req) {
    const g = await gate(req);
    if (g.response) return g.response;
    const idempotencyKey = req.headers.get('idempotency-key');
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_RE.test(idempotencyKey)) {
        return NextResponse.json({ error: 'idempotency_key_invalid' }, { status: 400 });
    }
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        return NextResponse.json({ error: 'body_too_large' }, { status: 413 });
    }
    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'body_invalid' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return NextResponse.json({ error: 'body_invalid' }, { status: 400 });
    }
    const { user_id: userId, job_id: jobId = null, tier, reason } = body;
    if (typeof userId !== 'string' || !UUID_RE.test(userId)) return NextResponse.json({ error: 'user_id_invalid' }, { status: 400 });
    if (jobId !== null && (typeof jobId !== 'string' || !UUID_RE.test(jobId))) return NextResponse.json({ error: 'job_id_invalid' }, { status: 400 });
    if (!TIERS.has(tier)) return NextResponse.json({ error: 'tier_invalid' }, { status: 400 });
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) return NextResponse.json({ error: 'reason_invalid' }, { status: 400 });
    if (tier === 'takedown' && jobId === null) return NextResponse.json({ error: 'job_id_required' }, { status: 400 });

    let result;
    try {
        result = await rpc('record_content_violation', {
            p_auth_id: g.authId, p_user_id: userId, p_job_id: jobId, p_tier: tier, p_reason: reason.trim(),
            p_idempotency_key: idempotencyKey,
        }, g.cfg);
    } catch (err) {
        return rpcFailure(err, 'record');
    }
    if (!result || result.ok !== true) {
        const code = result && result.code ? String(result.code).toLowerCase() : 'violation_rejected';
        const status = code === 'user_not_found' || code === 'job_not_found' ? 404 : 400;
        return NextResponse.json({ error: code }, { status });
    }
    if (result.replayed === true) {
        // The strike was recorded by an earlier delivery of this key and the
        // user was notified then. Report it; do not write or email again.
        return NextResponse.json({
            action_id: result.action_id, tier: result.tier, assets_removed: result.assets_removed,
            takedowns: result.takedowns, frozen: result.frozen, email: 'skipped', replayed: true,
        }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }
    console.error('[api/v1/admin/violations] recorded', tier, 'for', userId, 'job', jobId, 'takedowns', result.takedowns, 'frozen', result.frozen);
    const email = await notifyViolation({
        cfg: g.cfg, userId, actionId: result.action_id, tier, takedowns: result.takedowns, frozen: result.frozen,
    });
    return NextResponse.json({
        action_id: result.action_id, tier: result.tier, assets_removed: result.assets_removed,
        takedowns: result.takedowns, frozen: result.frozen, email,
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
