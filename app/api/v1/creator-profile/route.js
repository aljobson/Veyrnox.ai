/**
 * The Vibe Check profile (ADR-0251). Bearer-only like the rest of /api/v1:
 * identity is the x-veyrnox-auth-id the middleware set. Off (404) until
 * CREATOR_PROFILE_ENABLED is "true". Never touches credits or the ledger.
 *
 * GET    /api/v1/creator-profile — 200 { status: "none" }
 *          | { status: "skipped", answers: {}, skipped_at }
 *          | { status: "completed", answers, completed_at }
 * PUT    /api/v1/creator-profile — save a full answer set (the interview's last step,
 *          or a retake). Idempotent: the same body again changes nothing.
 *          Body: { look, goal, pace, chaos: 0-4, destination, audience, voice, studio_name? }
 *          200: { status: "completed", answers, changed: boolean }
 * DELETE /api/v1/creator-profile — "Reset my vibe". 200 { reset: true }; also when
 *          there was nothing, so a replay is a no-op.
 *
 * Errors: 400 body_invalid | invalid_answers (+ field), 401 not_authenticated,
 *   404 not_found (flag off) | account_not_found, 502 creator_profile_unavailable,
 *   503 gateway_not_configured.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { creatorProfileEnabled, cleanCreatorAnswers } from '../../../../lib/creatorProfile.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };

const fail = (error, status, extra = {}) => NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });

function gate(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return { response: fail('not_authenticated', 401) };
    if (!creatorProfileEnabled()) return { response: fail('not_found', 404) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { response: fail('gateway_not_configured', 503) };
    return { authId, cfg };
}

async function call(name, args, cfg) {
    try {
        return await rpc(name, args, cfg);
    } catch (err) {
        console.error(`[api/v1/creator-profile] ${name} failed:`, err && err.message);
        return null;
    }
}

function refused(result) {
    if (result?.error === 'account_not_found') return fail('account_not_found', 404);
    console.error('[api/v1/creator-profile] refused:', result?.error);
    return fail('creator_profile_unavailable', 502);
}

export async function GET(req) {
    const g = gate(req);
    if (g.response) return g.response;
    const result = await call('get_creator_profile', { p_auth_id: g.authId }, g.cfg);
    if (result?.ok !== true) return refused(result);
    if (result.status === 'none') return NextResponse.json({ status: 'none' }, { headers: NO_STORE });
    return NextResponse.json({
        status: result.status, answers: result.answers ?? {},
        ...(result.completed_at ? { completed_at: result.completed_at } : {}),
        ...(result.skipped_at ? { skipped_at: result.skipped_at } : {}),
    }, { headers: NO_STORE });
}

export async function PUT(req) {
    const g = gate(req);
    if (g.response) return g.response;
    let body;
    try { body = await req.json(); } catch { return fail('body_invalid', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('body_invalid', 400);

    const clean = cleanCreatorAnswers(body);
    if (!clean.ok) return fail('invalid_answers', 400, { field: clean.field });

    const result = await call('save_creator_profile', { p_auth_id: g.authId, p_answers: clean.answers }, g.cfg);
    if (result?.ok !== true) return result?.error === 'invalid_answers' ? fail('invalid_answers', 400) : refused(result);
    return NextResponse.json({ status: 'completed', answers: result.answers, changed: result.changed === true }, { headers: NO_STORE });
}

export async function DELETE(req) {
    const g = gate(req);
    if (g.response) return g.response;
    const result = await call('reset_creator_profile', { p_auth_id: g.authId }, g.cfg);
    if (result?.ok !== true) return refused(result);
    return NextResponse.json({ reset: true }, { headers: NO_STORE });
}
