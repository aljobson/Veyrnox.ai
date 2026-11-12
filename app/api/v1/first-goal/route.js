/**
 * The first-goal answer (ADR-0336): "What do you want to make first?". Bearer-only like the rest of /api/v1:
 * identity is the x-veyrnox-auth-id the middleware set. Off (404) until FIRST_GOAL_SYNC_ENABLED is "true". Never
 * touches credits or the ledger.
 *
 * GET /api/v1/first-goal — 200 { goal: null } | { goal: "image" | "video" | "audio" | "edit" | "publish" | "unsure" | "skipped" }
 * PUT /api/v1/first-goal — body { goal }. The database never lowers an answer (a real goal outranks "unsure",
 *        which outranks "skipped"), so the reply is what the account now holds: 200 { goal, changed: boolean }.
 *        Idempotent: the same body again changes nothing.
 *
 * Errors: 400 body_invalid | invalid_goal (+ field), 401 not_authenticated, 404 not_found (flag off) | account_not_found,
 *   502 first_goal_unavailable, 503 gateway_not_configured.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { cleanFirstGoal, firstGoalSyncEnabled } from '../../../../lib/firstGoal.js';
import { isUuidLoose } from '../../../../lib/validate.js';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (error, status, extra = {}) => NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });

function gate(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !isUuidLoose(authId)) return { response: fail('not_authenticated', 401) };
    if (!firstGoalSyncEnabled()) return { response: fail('not_found', 404) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { response: fail('gateway_not_configured', 503) };
    return { authId, cfg };
}

async function call(name, args, cfg) {
    try {
        return await rpc(name, args, cfg);
    } catch (err) {
        console.error(`[api/v1/first-goal] ${name} failed:`, err && err.message);
        return null;
    }
}

function refused(result) {
    if (result?.error === 'account_not_found') return fail('account_not_found', 404);
    console.error('[api/v1/first-goal] refused:', result?.error);
    return fail('first_goal_unavailable', 502);
}

export async function GET(req) {
    const g = gate(req);
    if (g.response) return g.response;
    const result = await call('get_first_goal', { p_auth_id: g.authId }, g.cfg);
    if (result?.ok !== true) return refused(result);
    return NextResponse.json({ goal: typeof result.goal === 'string' ? result.goal : null }, { headers: NO_STORE });
}

export async function PUT(req) {
    const g = gate(req);
    if (g.response) return g.response;
    let body;
    try { body = await req.json(); } catch { return fail('body_invalid', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('body_invalid', 400);

    const clean = cleanFirstGoal(body);
    if (!clean.ok) return fail('invalid_goal', 400, { field: clean.field });

    const result = await call('set_first_goal', { p_auth_id: g.authId, p_goal: clean.goal }, g.cfg);
    if (result?.ok !== true) return result?.error === 'invalid_goal' ? fail('invalid_goal', 400, { field: 'goal' }) : refused(result);
    return NextResponse.json({ goal: result.goal, changed: result.changed === true }, { headers: NO_STORE });
}
